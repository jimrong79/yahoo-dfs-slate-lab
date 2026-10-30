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
from zoneinfo import ZoneInfo

import requests

URL = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
DOCS = 'https://the-odds-api.com/sports-odds-data/betting-markets.html'
METHOD = 'prop-lines-v2'
EVENT_TOLERANCE_SECONDS = 15 * 60
EASTERN = ZoneInfo('America/New_York')
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


def stat_line(outcomes):
    """Use a published O/U threshold as an approximate stat, never as a mean.

    One quoted side is sufficient to identify the line. Conflicting lines,
    duplicate sides, and absent/non-numeric values remain unavailable.
    """
    if not 1 <= len(outcomes) <= 2:
        return None
    sides = [o.get('name') for o in outcomes]
    if len(set(sides)) != len(sides) or not set(sides) <= {'Over', 'Under'}:
        return None
    lines = [o.get('point') for o in outcomes]
    if not all(number(v) and 0 <= v <= 100 for v in lines) or len(set(lines)) != 1:
        return None
    if not all(number(o.get('price')) and 1 < o['price'] <= 10000 for o in outcomes):
        return None
    return lines[0]


def bonus_probability(outcomes):
    """Return probability and provenance; an absent Yes quote is never zero."""
    if not 1 <= len(outcomes) <= 2:
        return None
    sides = {o.get('name'): o for o in outcomes}
    if len(sides) != len(outcomes) or 'Yes' not in sides or not set(sides) <= {'Yes', 'No'}:
        return None
    yes = sides['Yes'].get('price')
    if not number(yes) or not 1 < yes <= 10000:
        return None
    if 'No' in sides:
        value = fair_probability(yes, sides['No'].get('price'))
        return (value, 'devigged') if value is not None else None
    return 1 / yes, 'yes_only_implied'


def book_estimates(book, platform, now, name_key, diagnostics=None):
    """Require a complete score from a single bookmaker; never fill missing stats."""
    stats = defaultdict(dict)
    timestamps = defaultdict(dict)
    probability_methods = defaultdict(dict)
    issues = defaultdict(dict)
    seen = set()
    required = set(WEIGHTS[platform])
    if platform == 'draftkings':
        required |= {'double_double', 'triple_double'}
    for market in book.get('markets', []):
        kind = market.get('key', '').removeprefix('player_')
        if kind not in required:
            continue
        groups = defaultdict(list)
        for outcome in market.get('outcomes', []):
            if isinstance(outcome.get('description'), str):
                groups[name_key(outcome['description'])].append(outcome)
        for name, outcomes in groups.items():
            values = stats[name]
            if (name, kind) in seen:
                values.pop(kind, None)
                issues[name][kind] = 'duplicate_market'
                continue
            seen.add((name, kind))
            if not fresh(market.get('last_update'), now):
                issues[name][kind] = 'stale_or_missing_timestamp'
                continue
            if kind in ('double_double', 'triple_double'):
                parsed = bonus_probability(outcomes)
                value = parsed[0] if parsed is not None else None
                if parsed is not None:
                    probability_methods[name][kind] = parsed[1]
            else:
                value = stat_line(outcomes)
            if value is not None:
                values[kind] = value
                timestamps[name][kind] = market['last_update']
            else:
                issues[name][kind] = 'invalid_or_missing_yes_odds' if kind in ('double_double', 'triple_double') else 'invalid_or_ambiguous_line'
    result = {}
    for name, values in stats.items():
        missing = sorted(required - values.keys())
        diagnostic = {'missingMarkets': missing, 'issues': {k: issues[name].get(k, 'missing_market') for k in missing},
                      'status': 'incomplete' if missing else 'complete'}
        if diagnostics is not None:
            diagnostics[name] = diagnostic
        if missing:
            continue
        points = sum(values[k] * w for k, w in WEIGHTS[platform].items())
        if platform == 'draftkings':
            if values['triple_double'] > values['double_double']:
                diagnostic.update(status='invalid_bonus_probabilities')
                continue
            points += 1.5 * values['double_double'] + 3 * values['triple_double']
        if not number(points) or points < 0:
            diagnostic.update(status='invalid_fantasy_total')
            continue
        result[name] = {'points': points, 'updatedAt': min((timestamps[name][k] for k in required), key=stamp),
                        'bonusProbabilityMethods': probability_methods[name]}
    return result


class BettingFeed:
    def __init__(self, now, name_key, team_names, *, api_key=None, allow_fetch=None, get=None):
        self.now, self.name_key, self.team_names = now, name_key, team_names
        self.api_key = os.environ.get('ODDS_API_KEY', '') if api_key is None else api_key
        self.allow_fetch = os.environ.get('ODDS_FETCH_ENABLED', '').lower() == 'true' if allow_fetch is None else allow_fetch
        self.configured = bool(self.api_key) or os.environ.get('ODDS_CONFIGURED', '').lower() == 'true'
        self.get = get or requests.get
        self.events = None
        self.event_requests = 0
        self.event_checks = {}
        self.coverage = []
        self.odds = {}
        self.error = None
        self.credits_remaining = None
        self.odds_requests = self.credits_used = self.unknown_cost_requests = 0
        self.requests_blocked = False

    def request(self, path, **params):
        if not self.api_key or not self.allow_fetch or self.requests_blocked:
            return None
        billable = path.endswith('/odds')
        self.event_requests += int(path == '/events')
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
        lines = ['### Odds API usage', '',
                 f'- Event discovery requests: **{self.event_requests}** (quota-free); events returned: **{len(self.events or [])}**.',
                 f'- Event odds requests: **{self.odds_requests}**.']
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
        if self.event_checks:
            lines.extend(['', '| Game | Slate tipoff (UTC) | Match result | Odds result | Candidate starts (UTC) |',
                          '| --- | --- | --- | --- | --- |'])
            for check in self.event_checks.values():
                lines.append(f'| {check["game"]} | {check["tipoff"]} | {check["status"]} | {check.get("oddsStatus", "not requested")} | {", ".join(check["candidateStarts"])} |')
        for row in self.coverage:
            missing = ', '.join(f'{k}: {v}' for k, v in sorted(row['missingMarkets'].items())) or 'none'
            lines.append(f'- {row["platform"]} {row["game"]}: {row["completePlayers"]}/{row["players"]} complete player estimates; '
                         f'{row["noPlayerQuotes"]} players without matching quotes. Missing/unusable markets in closest bookmaker: {missing}.')
        lines.append('- Quotes keep their original timestamp and expire after two hours; a normal refresh does not renew them.')
        print(f'Odds requests: {self.odds_requests}; confirmed credits used: {self.credits_used}; unknown-cost requests: {self.unknown_cost_requests}', flush=True)
        print('\n'.join(lines), flush=True)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as handle:
                handle.write('\n'.join(lines) + '\n\n')

    def matchup(self, event):
        teams = [self.team_names.get(re.sub(r'[^A-Za-z0-9]', '', event.get(k, ''))) for k in ('away_team', 'home_team')]
        return '@'.join(teams) if all(teams) else None

    def matches_game(self, event, game):
        tip, start = stamp(game.get('tipoff')), stamp(event.get('commence_time'))
        return (tip is not None and start is not None and self.matchup(event) == game['matchup'] and
                abs(start - tip) <= EVENT_TOLERANCE_SECONDS and
                datetime.fromtimestamp(start, EASTERN).date() == datetime.fromtimestamp(tip, EASTERN).date())

    def event_for(self, game):
        if self.events is None:
            payload = self.request('/events')
            valid = isinstance(payload, list) and all(isinstance(e, dict) for e in payload)
            self.events = payload if valid else []
            if payload is not None and not valid:
                self.error = 'Betting event discovery returned an unsupported response.'
        candidates = [e for e in self.events if self.matchup(e) == game['matchup']]
        matches = [e for e in candidates if self.matches_game(e, game)]
        status = ('matched' if len(matches) == 1 else 'ambiguous_events' if matches else
                  'tipoff_mismatch' if candidates else 'matchup_missing' if self.events else 'no_events')
        event = matches[0] if len(matches) == 1 else None
        if event and not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', str(event.get('id', ''))):
            event, status = None, 'invalid_event_id'
        self.event_checks[(game['matchup'], game['tipoff'])] = {
            'game': game['matchup'], 'tipoff': game['tipoff'], 'status': status,
            'candidateStarts': sorted({datetime.fromtimestamp(stamp(e['commence_time']), timezone.utc).isoformat().replace('+00:00', 'Z')
                                       for e in candidates if stamp(e.get('commence_time')) is not None})}
        return event

    def attach(self, slate, previous=None):
        try:
            return self._attach(slate, previous)
        except Exception:
            # Provider schema changes must not take SportsLine/Fuel or the salary
            # publisher down. No exception text may escape with request credentials.
            for player in slate['players']:
                player.pop('betting', None)
                player.pop('bettingStatus', None)
                player['sources']['betting'] = None
            self.error = 'Betting response could not be validated. Using available SportsLine / Fuel forecasts.'
            slate['sources']['betting'] = {'url': DOCS, 'capturedAt': self.now.isoformat(),
                'status': 'unavailable', 'playerCount': 0, 'method': METHOD, 'experimental': True,
                'message': self.error}
            if self.api_key and self.allow_fetch:
                slate['sources']['betting']['lastAttempt'] = {'at': self.now.isoformat().replace('+00:00', 'Z'),
                    'playerCount': 0, 'message': self.error, 'status': 'invalid_response'}
            return slate

    def _attach(self, slate, previous=None):
        platform = slate['platform']
        cached = {p['id']: p for p in (previous or {}).get('players', [])} if (
            previous and previous.get('date') == slate['date'] and previous.get('platform') == platform) else {}
        info = {'url': DOCS, 'capturedAt': self.now.isoformat().replace('+00:00', 'Z'),
                'status': 'unavailable', 'method': METHOD, 'experimental': True}
        if previous and previous.get('date') == slate['date'] and previous.get('platform') == platform:
            old_info = previous.get('sources', {}).get('betting', {})
            if old_info.get('method') == METHOD:
                info['eventCaptures'] = {k: v for k, v in old_info.get('eventCaptures', {}).items() if fresh(v, self.now, 60)}
            if previous.get('sources', {}).get('betting', {}).get('lastAttempt'):
                info['lastAttempt'] = previous['sources']['betting']['lastAttempt']
        slate['sources']['betting'] = info
        for player in slate['players']:
            player['sources']['betting'] = None
            old = cached.get(player['id'], {})
            estimate = old.get('betting')
            identity_matches = all(old.get(k) == player.get(k) for k in ('name', 'team', 'opponent', 'game', 'tipoff'))
            if identity_matches and old.get('bettingStatus', {}).get('method') == METHOD:
                player['bettingStatus'] = old['bettingStatus']
            if estimate and identity_matches and valid_estimate(estimate, player, platform, self.now):
                player['betting'] = estimate
                player['sources']['betting'] = estimate['points']
        checks, slate_coverage = [], []
        if self.api_key and self.allow_fetch:
            for game in slate['games']:
                if stamp(game['tipoff']) is None or stamp(game['tipoff']) <= self.now.timestamp():
                    continue
                pool = [p for p in slate['players'] if p['game'] == game['matchup']]
                # Reuse a successful event capture for one hour, even if no player
                # had a complete stat set. Reuse never renews quote timestamps.
                previous_capture = (previous or {}).get('sources', {}).get('betting', {}).get('eventCaptures', {}).get(game['matchup'])
                if previous_capture and (previous or {}).get('sources', {}).get('betting', {}).get('method') == METHOD and fresh(previous_capture, self.now, 60):
                    info.setdefault('eventCaptures', {})[game['matchup']] = previous_capture
                    checks.append({'game': game['matchup'], 'tipoff': game['tipoff'], 'status': 'cached_capture'})
                    continue
                event = self.event_for(game)
                check = self.event_checks[(game['matchup'], game['tipoff'])]
                checks.append(check)
                if not event:
                    continue
                event_id = event['id']
                if event_id not in self.odds:
                    if self.credits_remaining is not None and self.credits_remaining < len(MARKETS):
                        self.error = 'Betting feed quota is too low for a complete refresh.'
                        check['oddsStatus'] = 'quota_low'
                        continue
                    self.odds[event_id] = self.request(f'/events/{event_id}/odds', regions='us', markets=','.join(MARKETS), oddsFormat='decimal')
                data = self.odds[event_id]
                if not isinstance(data, dict) or data.get('id') != event_id or not self.matches_game(data, game):
                    check['oddsStatus'] = 'unavailable_or_invalid_response'
                    continue
                check['oddsStatus'] = 'validated'
                info.setdefault('eventCaptures', {})[game['matchup']] = info['capturedAt']
                # A newer successful event response supersedes cached player quotes,
                # including withdrawn/incomplete props. Failed fetches retain only fresh cache.
                for player in pool:
                    player.pop('betting', None)
                    player['sources']['betting'] = None
                by_name = defaultdict(list)
                audits = defaultdict(list)
                books = data.get('bookmakers', [])
                book_keys = [b.get('key') for b in books]
                for book in books:
                    if not isinstance(book.get('key'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', book['key']) or book_keys.count(book['key']) != 1:
                        continue
                    diagnostics = {}
                    for name, estimate in book_estimates(book, platform, self.now, self.name_key, diagnostics).items():
                        by_name[name].append({**estimate, 'book': book['key']})
                    for name, diagnostic in diagnostics.items():
                        audits[name].append({'book': book['key'], **diagnostic})
                names = [self.name_key(p['name']) for p in pool]
                coverage = {'platform': platform, 'game': game['matchup'], 'players': len(pool),
                            'completePlayers': 0, 'noPlayerQuotes': 0, 'missingMarkets': {}}
                for player in pool:
                    name = self.name_key(player['name'])
                    estimates = by_name.get(name, [])
                    details = {'method': METHOD, 'checkedAt': info['capturedAt'], 'bookChecks': audits.get(name, [])}
                    player['bettingStatus'] = details
                    if names.count(name) != 1 or not estimates:
                        best = min(audits[name], key=lambda a: len(a['missingMarkets'])) if audits[name] else None
                        missing = best['missingMarkets'] if best else sorted(set(WEIGHTS[platform]) | ({'double_double', 'triple_double'} if platform == 'draftkings' else set()))
                        details.update(status='unavailable', missingMarkets=missing)
                        if names.count(name) != 1:
                            details['message'] = 'Betting player name is ambiguous in this game.'
                        elif not best:
                            details['message'] = 'No matching player quotes in the required betting markets.'
                            coverage['noPlayerQuotes'] += 1
                        elif missing:
                            details['message'] = 'No complete bookmaker forecast. Closest is missing usable ' + ', '.join(k.replace('_', '-') for k in missing) + '.'
                        else:
                            details['message'] = 'Betting bonus probabilities or fantasy total failed validation.'
                        for kind in (missing if best else []):
                            coverage['missingMarkets'][kind] = coverage['missingMarkets'].get(kind, 0) + 1
                        continue
                    coverage['completePlayers'] += 1
                    details.update(status='complete', missingMarkets=[], message='Complete betting estimate from published stat lines and bonus odds.')
                    estimate = {'points': round(median(e['points'] for e in estimates), 3),
                                'platform': platform, 'game': player['game'], 'tipoff': player['tipoff'],
                                'updatedAt': min((e['updatedAt'] for e in estimates), key=stamp),
                                'eventId': event_id, 'bookmakers': sorted(e['book'] for e in estimates),
                                'bonusProbabilityMethods': {kind: sorted({e['bonusProbabilityMethods'][kind] for e in estimates})
                                                            for kind in ('double_double', 'triple_double') if platform == 'draftkings'},
                                'method': METHOD, 'complete': True}
                    player['betting'] = estimate
                    player['sources']['betting'] = estimate['points']
                self.coverage.append(coverage)
                slate_coverage.append(coverage)
        count = sum(p['sources']['betting'] is not None for p in slate['players'])
        if self.api_key and self.allow_fetch:
            matched = sum(c['status'] in {'matched', 'cached_capture'} for c in checks)
            result_message = (self.error or ('Betting estimates available; complete, fresh props only.' if count else
                              'No upcoming games to fetch for this slate.' if not checks else
                              f'No matching betting events for {len(checks)} upcoming games; no player odds fetched for this slate.' if not matched else
                              f'Matched {matched}/{len(checks)} upcoming games, but no complete, fresh player estimates matched this slate.'))
            info['lastAttempt'] = {'at': info['capturedAt'], 'eventsListed': len(self.events or []),
                                   'gamesConsidered': len(checks), 'gamesMatched': matched,
                                   'playerCount': count, 'message': result_message,
                                   'coverage': slate_coverage,
                                   'games': [dict(c) for c in checks]}
        info.update(playerCount=count, status='available' if count else 'not_configured' if not self.configured else 'unavailable')
        info['message'] = (self.error or ('Betting estimates available; complete, fresh props only.' if count else
                           f'Last manual attempt {info["lastAttempt"]["at"]}: {info["lastAttempt"]["message"]} Cached quotes may have expired; normal refreshes do not fetch new odds.' if info.get('lastAttempt') and not self.allow_fetch else
                           'Betting feed not configured. Using available SportsLine / Fuel forecasts.' if not self.configured else
                           'Run Refresh betting odds (manual) to fetch today’s props. SportsLine / Fuel remain available.' if not self.allow_fetch else
                           info['lastAttempt']['message'] if info.get('lastAttempt') else
                           'No complete, fresh betting estimates matched this slate. Using available SportsLine / Fuel forecasts.'))
        if self.credits_remaining is not None:
            info['creditsRemaining'] = self.credits_remaining
        return slate


def valid_estimate(value, player, platform, now):
    return (isinstance(value, dict) and value.get('complete') is True and value.get('method') == METHOD and value.get('platform') == platform and
            value.get('game') == player['game'] and value.get('tipoff') == player['tipoff'] and
            number(value.get('points')) and value['points'] >= 0 and fresh(value.get('updatedAt'), now))
