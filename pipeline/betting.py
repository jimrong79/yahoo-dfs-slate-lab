"""Optional, experimental fantasy estimates from The Odds API player props.

Only derived fantasy estimates are published. API keys and raw quotes are never
included in snapshots or errors. See docs/betting-blend.md for assumptions.
"""
from collections import defaultdict
from datetime import datetime, timezone
import math
import os
from pathlib import Path
import re
from statistics import median

import requests

URL = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
DOCS = 'https://the-odds-api.com/sports-odds-data/betting-markets.html'
METHOD = 'devig-poisson-v1'
WEIGHTS = {
    'yahoo': {'points': 1, 'rebounds': 1.2, 'assists': 1.5, 'steals': 3, 'blocks': 3, 'turnovers': -1},
    'draftkings': {'points': 1, 'rebounds': 1.25, 'assists': 1.5, 'steals': 2, 'blocks': 2, 'turnovers': -.5, 'threes': .5},
}
MARKETS = ['player_' + k for k in WEIGHTS['draftkings']] + ['player_double_double', 'player_triple_double']


def stamp(value):
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return date.timestamp() if date.tzinfo else None
    except (TypeError, ValueError, AttributeError):
        return None


def fresh(value, now, minutes=120):
    at = stamp(value)
    return at is not None and -300 <= now.timestamp() - at <= minutes * 60


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def fair_probability(first, second):
    """Proportional removal of the margin from paired decimal odds."""
    if not all(number(v) and 1 < v <= 10000 for v in (first, second)):
        return None
    a, b = 1 / first, 1 / second
    if not .9 <= a + b <= 1.3:
        return None
    return a / (a + b)


def poisson_cdf(k, mean):
    term = total = math.exp(-mean)
    for i in range(1, k + 1):
        term *= mean / i
        total += term
    return min(total, 1.)


def mean_from_prop(line, over, under):
    """Infer a mean under an explicit Poisson assumption, not line == mean.

    Half-integer lines avoid pushes. Integer lines are deliberately unsupported.
    One O/U threshold cannot identify an unrestricted outcome distribution.
    """
    if not number(line) or not 0 <= line <= 100 or line % 1 != .5:
        return None
    probability = fair_probability(under, over)
    if probability is None:
        return None
    lo, hi = 0., 200.
    for _ in range(70):
        mid = (lo + hi) / 2
        if poisson_cdf(math.floor(line), mid) > probability:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def book_estimates(book, platform, now, name_key):
    """Require a complete score from a single bookmaker; never fill missing stats."""
    stats = defaultdict(dict)
    timestamps = defaultdict(dict)
    duplicates = set()
    for market in book.get('markets', []):
        kind = market.get('key', '').removeprefix('player_')
        if 'player_' + kind not in MARKETS or not fresh(market.get('last_update'), now):
            continue
        groups = defaultdict(list)
        for outcome in market.get('outcomes', []):
            if isinstance(outcome.get('description'), str):
                groups[name_key(outcome['description'])].append(outcome)
        for name, outcomes in groups.items():
            if (name, kind) in duplicates:
                continue
            if kind in stats[name]:
                stats[name].pop(kind)
                duplicates.add((name, kind))
                continue
            if len(outcomes) != 2:
                continue
            sides = {o.get('name'): o for o in outcomes}
            if kind in ('double_double', 'triple_double'):
                if set(sides) != {'Yes', 'No'}:
                    continue
                value = fair_probability(sides['Yes'].get('price'), sides['No'].get('price'))
            else:
                if set(sides) != {'Over', 'Under'} or sides['Over'].get('point') != sides['Under'].get('point'):
                    continue
                value = mean_from_prop(sides['Over'].get('point'), sides['Over'].get('price'), sides['Under'].get('price'))
            if value is not None:
                stats[name][kind] = value
                timestamps[name][kind] = market['last_update']
    required = set(WEIGHTS[platform])
    if platform == 'draftkings':
        required |= {'double_double', 'triple_double'}
    result = {}
    for name, values in stats.items():
        if not required <= values.keys():
            continue
        points = sum(values[k] * w for k, w in WEIGHTS[platform].items())
        if platform == 'draftkings':
            if values['triple_double'] > values['double_double']:
                continue
            points += 1.5 * values['double_double'] + 3 * values['triple_double']
        if not number(points) or points < 0:
            continue
        result[name] = {'points': points, 'updatedAt': min((timestamps[name][k] for k in required), key=stamp)}
    return result


class BettingFeed:
    def __init__(self, now, name_key, team_names, *, api_key=None, allow_fetch=None, get=None):
        self.now, self.name_key, self.team_names = now, name_key, team_names
        self.api_key = os.environ.get('ODDS_API_KEY', '') if api_key is None else api_key
        self.allow_fetch = os.environ.get('ODDS_FETCH_ENABLED', '').lower() == 'true' if allow_fetch is None else allow_fetch
        self.configured = bool(self.api_key) or os.environ.get('ODDS_CONFIGURED', '').lower() == 'true'
        self.get = get or requests.get
        self.events = None
        self.odds = {}
        self.error = None
        self.credits_remaining = None
        self.odds_requests = self.credits_used = self.unknown_cost_requests = 0
        self.requests_blocked = False

    def request(self, path, **params):
        if not self.api_key or not self.allow_fetch or self.requests_blocked:
            return None
        billable = path.endswith('/odds')
        self.odds_requests += int(billable)
        accounted = False
        try:
            response = self.get(URL + path, params={'apiKey': self.api_key, **params},
                                timeout=(10, 25), allow_redirects=False)
            # Never propagate requests' errors: they can contain the key in the URL.
            remaining = response.headers.get('x-requests-remaining')
            if remaining is not None and str(remaining).isdigit():
                self.credits_remaining = int(remaining)
            if billable:
                cost = response.headers.get('x-requests-last')
                if cost is not None and str(cost).isdigit():
                    self.credits_used += int(cost)
                    accounted = True
            if response.status_code != 200:
                self.error = f'Betting feed unavailable (HTTP {response.status_code}).'
                self.requests_blocked = True
                return None
            return response.json()
        except Exception:
            self.error = 'Betting feed unavailable (network or response error).'
            self.requests_blocked = True
            return None
        finally:
            if billable and not accounted:
                self.unknown_cost_requests += 1

    def write_summary(self):
        lines = ['### Odds API usage', '', f'- Event odds requests: **{self.odds_requests}**.']
        if self.unknown_cost_requests:
            lines.append(f'- Confirmed credits: **{self.credits_used}**; cost unknown for {self.unknown_cost_requests} request(s), up to {len(MARKETS)} additional credits each.')
        else:
            lines.append(f'- Credits used by this run: **{self.credits_used}**.')
        if self.credits_remaining is not None:
            lines.append(f'- Provider-reported credits remaining: **{self.credits_remaining}**.')
        if not self.allow_fetch:
            lines.append('- New odds fetches disabled. SportsLine/Fuel refresh normally; fresh cached betting estimates can still be used.')
        elif not self.api_key:
            lines.append('- ODDS_API_KEY is missing; no betting requests were made.')
        if self.error:
            lines.append('- ' + self.error)
        lines.append('- Quotes keep their original timestamp and expire after two hours; a normal refresh does not renew them.')
        print(f'Odds requests: {self.odds_requests}; confirmed credits used: {self.credits_used}; unknown-cost requests: {self.unknown_cost_requests}', flush=True)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as handle:
                handle.write('\n'.join(lines) + '\n\n')

    def matchup(self, event):
        teams = [self.team_names.get(re.sub(r'[^A-Za-z]', '', event.get(k, ''))) for k in ('away_team', 'home_team')]
        return '@'.join(teams) if all(teams) else None

    def event_for(self, game):
        if self.events is None:
            payload = self.request('/events')
            self.events = payload if isinstance(payload, list) else []
        matches = [e for e in self.events if self.matchup(e) == game['matchup'] and stamp(e.get('commence_time')) == stamp(game['tipoff'])]
        return matches[0] if len(matches) == 1 else None

    def attach(self, slate, previous=None):
        try:
            return self._attach(slate, previous)
        except Exception:
            # Provider schema changes must not take SportsLine/Fuel or the salary
            # publisher down. No exception text may escape with request credentials.
            for player in slate['players']:
                player.pop('betting', None)
                player['sources']['betting'] = None
            slate['sources']['betting'] = {'url': DOCS, 'capturedAt': self.now.isoformat(),
                'status': 'unavailable', 'playerCount': 0, 'method': METHOD, 'experimental': True,
                'message': 'Betting response could not be validated. Using available SportsLine / Fuel forecasts.'}
            return slate

    def _attach(self, slate, previous=None):
        platform = slate['platform']
        cached = {p['id']: p for p in (previous or {}).get('players', [])} if (
            previous and previous.get('date') == slate['date'] and previous.get('platform') == platform) else {}
        info = {'url': DOCS, 'capturedAt': self.now.isoformat().replace('+00:00', 'Z'),
                'status': 'unavailable', 'method': METHOD, 'experimental': True}
        if previous and previous.get('date') == slate['date'] and previous.get('platform') == platform:
            info['eventCaptures'] = {k: v for k, v in previous.get('sources', {}).get('betting', {}).get('eventCaptures', {}).items() if fresh(v, self.now, 60)}
        slate['sources']['betting'] = info
        for player in slate['players']:
            player['sources']['betting'] = None
            old = cached.get(player['id'], {})
            estimate = old.get('betting')
            if estimate and all(old.get(k) == player.get(k) for k in ('name', 'team', 'opponent', 'game', 'tipoff')) and valid_estimate(estimate, player, platform, self.now):
                player['betting'] = estimate
                player['sources']['betting'] = estimate['points']
        if self.api_key and self.allow_fetch:
            for game in slate['games']:
                if stamp(game['tipoff']) is None or stamp(game['tipoff']) <= self.now.timestamp():
                    continue
                pool = [p for p in slate['players'] if p['game'] == game['matchup']]
                # Reuse a successful event capture for one hour, even if no player
                # had a complete stat set. Reuse never renews quote timestamps.
                previous_capture = (previous or {}).get('sources', {}).get('betting', {}).get('eventCaptures', {}).get(game['matchup'])
                if previous_capture and fresh(previous_capture, self.now, 60):
                    info.setdefault('eventCaptures', {})[game['matchup']] = previous_capture
                    continue
                event = self.event_for(game)
                if not event or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', str(event.get('id', ''))):
                    continue
                event_id = event['id']
                if event_id not in self.odds:
                    if self.credits_remaining is not None and self.credits_remaining < len(MARKETS):
                        self.error = 'Betting feed quota is too low for a complete refresh.'
                        continue
                    self.odds[event_id] = self.request(f'/events/{event_id}/odds', regions='us', markets=','.join(MARKETS), oddsFormat='decimal')
                data = self.odds[event_id]
                if not isinstance(data, dict) or data.get('id') != event_id or self.matchup(data) != game['matchup'] or stamp(data.get('commence_time')) != stamp(game['tipoff']):
                    continue
                info.setdefault('eventCaptures', {})[game['matchup']] = info['capturedAt']
                # A newer successful event response supersedes cached player quotes,
                # including withdrawn/incomplete props. Failed fetches retain only fresh cache.
                for player in pool:
                    player.pop('betting', None)
                    player['sources']['betting'] = None
                by_name = defaultdict(list)
                books = data.get('bookmakers', [])
                book_keys = [b.get('key') for b in books]
                for book in books:
                    if not isinstance(book.get('key'), str) or book_keys.count(book['key']) != 1:
                        continue
                    for name, estimate in book_estimates(book, platform, self.now, self.name_key).items():
                        by_name[name].append({**estimate, 'book': book['key']})
                names = [self.name_key(p['name']) for p in pool]
                for player in pool:
                    name = self.name_key(player['name'])
                    estimates = by_name.get(name, [])
                    if names.count(name) != 1 or not estimates:
                        continue
                    estimate = {'points': round(median(e['points'] for e in estimates), 3),
                                'platform': platform, 'game': player['game'], 'tipoff': player['tipoff'],
                                'updatedAt': min((e['updatedAt'] for e in estimates), key=stamp),
                                'eventId': event_id, 'bookmakers': sorted(e['book'] for e in estimates),
                                'method': METHOD, 'complete': True}
                    player['betting'] = estimate
                    player['sources']['betting'] = estimate['points']
        count = sum(p['sources']['betting'] is not None for p in slate['players'])
        info.update(playerCount=count, status='available' if count else 'not_configured' if not self.configured else 'unavailable')
        info['message'] = (self.error or ('Betting estimates available; complete, fresh props only.' if count else
                           'Betting feed not configured. Using available SportsLine / Fuel forecasts.' if not self.configured else
                           'Run Refresh betting odds (manual) to fetch today’s props. SportsLine / Fuel remain available.' if not self.allow_fetch else
                           'No complete, fresh betting estimates matched this slate. Using available SportsLine / Fuel forecasts.'))
        if self.credits_remaining is not None:
            info['creditsRemaining'] = self.credits_remaining
        return slate


def valid_estimate(value, player, platform, now):
    return (isinstance(value, dict) and value.get('complete') is True and value.get('method') == METHOD and value.get('platform') == platform and
            value.get('game') == player['game'] and value.get('tipoff') == player['tipoff'] and
            number(value.get('points')) and value['points'] >= 0 and fresh(value.get('updatedAt'), now))
