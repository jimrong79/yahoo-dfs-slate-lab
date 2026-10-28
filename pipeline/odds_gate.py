"""Read GitHub run history before allowing one manual odds attempt per PT day.

Uses GitHub's API only, never The Odds API. Failed/cancelled earlier runs also
count, since they may have fetched odds before failing to publish their output.
The shared Pages concurrency group serializes the actual collection jobs.
"""
from datetime import datetime, time, timezone
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo('America/Los_Angeles')
REPO = 'jimrong79/yahoo-dfs-slate-lab'


def decision(env, now, list_runs):
    if not (env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and
            env.get('GITHUB_REPOSITORY') == REPO and
            env.get('GITHUB_REF') == 'refs/heads/main' and
            env.get('GITHUB_WORKFLOW') == 'Refresh betting odds (manual)' and
            env.get('GITHUB_ACTOR') == 'jimrong79' and
            env.get('GITHUB_ACTOR_ID') == '14351098' and
            env.get('GITHUB_TRIGGERING_ACTOR') == 'jimrong79'):
        return False, 'Odds fetch disabled: use the owner-only Refresh betting odds (manual) workflow on main.'
    if env.get('GITHUB_RUN_ATTEMPT') != '1':
        return False, 'Odds fetch skipped: reruns cannot spend credits again. Use a new manual run on a later Pacific date.'
    run_id = int(env['GITHUB_RUN_ID'])
    day_start = datetime.combine(now.astimezone(PACIFIC).date(), time.min, PACIFIC).astimezone(timezone.utc)
    # Includes all run states, including queued/cancelled/failed. Ignore newer
    # queued runs so they cannot prevent the first run from being authorized.
    for page in range(1, 11):
        runs = list_runs(day_start, page)
        if not isinstance(runs, list):
            raise ValueError('Invalid GitHub workflow history')
        for run in runs:
            if (run.get('head_branch') != 'main' or run.get('actor', {}).get('id') != 14351098 or
                    run.get('conclusion') == 'skipped'):
                continue
            created = datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))
            if int(run['id']) < run_id and created >= day_start:
                return False, 'Odds fetch skipped: a manual odds run was already requested today (Pacific time). Cached estimates and normal projections can still refresh.'
        if len(runs) < 100:
            return True, 'Odds fetch enabled for today’s first owner-requested manual run (Pacific time).'
    raise ValueError('GitHub workflow history exceeded the verification limit')


def github_runs(day_start, page):
    query = urlencode({'event': 'workflow_dispatch', 'created': '>=' + day_start.isoformat(), 'per_page': 100, 'page': page})
    request = Request(f'https://api.github.com/repos/{REPO}/actions/workflows/odds.yml/runs?{query}',
                      headers={'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
                               'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urlopen(request, timeout=20) as response:
        return json.load(response)['workflow_runs']


def main():
    try:
        enabled, reason = decision(os.environ, datetime.now(timezone.utc), github_runs)
    except Exception:
        # Fail closed without printing token-bearing request details.
        print('Cannot verify the daily odds limit. No odds fetch is authorized.')
        return 1
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as handle:
        handle.write(f'enabled={str(enabled).lower()}\n')
    with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as handle:
        handle.write('### Manual odds authorization\n\n' + reason + '\n\n')
    print(reason)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
