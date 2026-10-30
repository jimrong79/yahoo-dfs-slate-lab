"""Synthetic provider-schema fixtures; these do not claim live API coverage."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

import pytest

from pipeline.betting import BettingFeed, MARKETS, METHOD, WEIGHTS, book_estimates, fair_probability, stat_line, bonus_probability
from pipeline.refresh import key, TEAM_NAMES

NOW = datetime(2026, 10, 27, 20, tzinfo=timezone.utc)
STAMP = NOW.isoformat()
TIP = '2026-10-27T23:30:00Z'
LINES = {'points': 24.5, 'rebounds': 7.5, 'assists': 5.5, 'steals': .5, 'blocks': .5, 'turnovers': 2.5, 'threes': 2.5}


def book():
    markets = [{'key': 'player_' + kind, 'last_update': STAMP, 'outcomes': [
        {'name': side, 'description': 'Test Player', 'point': line, 'price': 1.9} for side in ('Over', 'Under')]} for kind, line in LINES.items()]
    markets += [{'key': 'player_' + kind, 'last_update': STAMP, 'outcomes': [
        {'name': 'Yes', 'description': 'Test Player', 'price': yes},
        {'name': 'No', 'description': 'Test Player', 'price': no}]} for kind, yes, no in [('double_double', 3., 1.5), ('triple_double', 10., 1.1)]]
    return {'key': 'fixture_book', 'markets': markets}


def slate(platform='yahoo'):
    return {'platform': platform, 'date': '2026-10-27', 'sources': {},
            'games': [{'matchup': 'SAC@SAS', 'tipoff': TIP}],
            'players': [{'id': '1', 'name': 'Test Player', 'team': 'SAS', 'opponent': 'SAC', 'game': 'SAC@SAS', 'tipoff': TIP, 'sources': {'sportsline': 40, 'fuel': 42}}]}


def api():
    event = {'id': 'event_fixture', 'home_team': 'San Antonio Spurs', 'away_team': 'Sacramento Kings', 'commence_time': TIP}
    calls = []
    def get(url, **kwargs):
        calls.append((url, kwargs))
        data = {**event, 'bookmakers': [book()]} if url.endswith('/odds') else [event]
        return SimpleNamespace(status_code=200, headers={'x-requests-remaining': '400', 'x-requests-last': '9' if url.endswith('/odds') else '0'}, json=lambda: data)
    return get, calls


def test_bonus_probabilities_preserve_provenance_and_missing_quotes():
    assert fair_probability(1.9, 1.9) == .5
    assert bonus_probability([{'name':'Yes','price':5}]) == (.2, 'yes_only_implied')
    assert bonus_probability([{'name':'Yes','price':3}, {'name':'No','price':1.5}]) == (1/3, 'devigged')
    for outcomes in [[], [{'name':'No','price':2}], [{'name':'Yes','price':None}],
                     [{'name':'Yes','price':True}], [{'name':'Yes','price':1}],
                     [{'name':'Yes','price':2}, {'name':'No','price':None}],
                     [{'name':'Yes','price':2}, {'name':'Yes','price':2}]]:
        assert bonus_probability(outcomes) is None


def test_stat_lines_are_used_directly_including_real_zero_and_integer_lines():
    for line in [0, .5, 10, 24.5]:
        quote = {'name':'Over', 'point':line, 'price':1.9}
        assert stat_line([quote]) == line
        assert stat_line([quote, {**quote, 'name':'Under', 'price':2.05}]) == line
    for line in [None, '0', False, float('nan'), float('inf'), -1]:
        assert stat_line([{'name':'Over','point':line,'price':2}]) is None
    assert stat_line([]) is None
    assert stat_line([{'name':'Over','price':2}]) is None


def test_platform_scoring_includes_dk_expected_bonus_not_threshold_bonus():
    means = LINES
    yahoo = means['points'] + 1.2*means['rebounds'] + 1.5*means['assists'] + 3*means['steals'] + 3*means['blocks'] - means['turnovers']
    dk = means['points'] + 1.25*means['rebounds'] + 1.5*means['assists'] + 2*means['steals'] + 2*means['blocks'] - .5*means['turnovers'] + .5*means['threes'] + 1.5*fair_probability(3, 1.5) + 3*fair_probability(10, 1.1)
    assert book_estimates(book(), 'yahoo', NOW, key)['testplayer']['points'] == pytest.approx(yahoo)
    assert book_estimates(book(), 'draftkings', NOW, key)['testplayer']['points'] == pytest.approx(dk)


@pytest.mark.parametrize('fault', ['missing_turnovers', 'different_line', 'stale', 'future', 'duplicate'])
def test_partial_malformed_or_stale_props_never_become_zero(fault):
    b = book()
    if fault == 'missing_turnovers': b['markets'] = [m for m in b['markets'] if m['key'] != 'player_turnovers']
    if fault == 'different_line': b['markets'][0]['outcomes'][1]['point'] = 30.5
    if fault == 'stale': b['markets'][0]['last_update'] = (NOW-timedelta(hours=3)).isoformat()
    if fault == 'future': b['markets'][0]['last_update'] = (NOW+timedelta(minutes=6)).isoformat()
    if fault == 'duplicate': b['markets'].append(deepcopy(b['markets'][0]))
    assert not book_estimates(b, 'yahoo', NOW, key)


def test_dk_requires_bonus_probs_but_yahoo_does_not():
    b = book(); b['markets'] = b['markets'][:-2]
    assert book_estimates(b, 'yahoo', NOW, key)
    assert not book_estimates(b, 'draftkings', NOW, key)


@pytest.mark.parametrize('platform,kind', [(platform, kind) for platform, weights in WEIGHTS.items()
    for kind in [*weights, *(['double_double', 'triple_double'] if platform == 'draftkings' else [])]])
def test_each_required_market_is_missing_not_zero(platform, kind):
    b = book(); diagnostics = {}
    b['markets'] = [m for m in b['markets'] if m['key'] != 'player_' + kind]
    assert not book_estimates(b, platform, NOW, key, diagnostics)
    assert diagnostics['testplayer'] == {'status': 'incomplete', 'missingMarkets': [kind],
                                        'issues': {kind: 'missing_market'}}


def test_single_stat_sides_and_yes_only_bonuses_produce_labeled_dk_estimate():
    b = book()
    for market in b['markets']:
        market['outcomes'] = market['outcomes'][:1]
    estimate = book_estimates(b, 'draftkings', NOW, key)['testplayer']
    expected = sum(LINES[k] * w for k, w in WEIGHTS['draftkings'].items()) + 1.5 / 3 + 3 / 10
    assert estimate['points'] == pytest.approx(expected)
    assert estimate['bonusProbabilityMethods'] == {'double_double': 'yes_only_implied', 'triple_double': 'yes_only_implied'}


@pytest.mark.parametrize('point', [None, False, '0', 0])
def test_only_actual_numeric_zero_is_usable_as_a_stat(point):
    b = book(); diagnostics = {}
    for outcome in b['markets'][3]['outcomes']:
        outcome['point'] = point
    result = book_estimates(b, 'yahoo', NOW, key, diagnostics)
    if type(point) is int:
        expected = sum(LINES[k] * w for k, w in WEIGHTS['yahoo'].items()) - 3 * LINES['steals']
        assert result['testplayer']['points'] == expected
    else:
        assert not result
        assert diagnostics['testplayer']['issues'] == {'steals': 'invalid_or_ambiguous_line'}


def test_no_only_and_inconsistent_bonus_odds_are_not_zero_or_partial_totals():
    b = book(); diagnostics = {}
    b['markets'][-1]['outcomes'] = b['markets'][-1]['outcomes'][1:]
    assert not book_estimates(b, 'draftkings', NOW, key, diagnostics)
    assert diagnostics['testplayer']['issues'] == {'triple_double': 'invalid_or_missing_yes_odds'}
    b = book()
    b['markets'][-1]['outcomes'] = [{'name': 'Yes', 'description': 'Test Player', 'price': 2}]
    assert not book_estimates(b, 'draftkings', NOW, key, diagnostics)
    assert diagnostics['testplayer']['status'] == 'invalid_bonus_probabilities'


def test_missing_markets_are_reported_without_publishing_raw_quotes(monkeypatch, tmp_path):
    get, calls = api()
    def partial(url, **kwargs):
        response = get(url, **kwargs); data = response.json()
        if url.endswith('/odds'):
            data['bookmakers'][0]['markets'] = [m for m in data['bookmakers'][0]['markets']
                if m['key'] not in {'player_turnovers', 'player_triple_double'}]
        response.json = lambda: data
        return response
    summary = tmp_path / 'summary'; monkeypatch.setenv('GITHUB_STEP_SUMMARY', str(summary))
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=partial)
    result = feed.attach(slate('draftkings')); feed.write_summary()
    p = result['players'][0]
    assert p['sources'] == {'sportsline': 40, 'fuel': 42, 'betting': None}
    assert 'betting' not in p
    assert p['bettingStatus']['missingMarkets'] == ['triple_double', 'turnovers']
    assert 'triple-double, turnovers' in p['bettingStatus']['message']
    assert result['sources']['betting']['lastAttempt']['coverage'][0]['missingMarkets'] == {'triple_double': 1, 'turnovers': 1}
    assert '0/1 complete player estimates' in summary.read_text()
    assert 'turnovers: 1' in summary.read_text()
    serialized = json.dumps(result)
    for forbidden in ['TEST_SECRET', '"outcomes"', '"price"', '"point"']:
        assert forbidden not in serialized
    later = BettingFeed(NOW+timedelta(minutes=30), key, TEAM_NAMES, api_key='', allow_fetch=False, get=partial).attach(slate('draftkings'), result)
    assert later['players'][0]['bettingStatus'] == p['bettingStatus']
    assert len(calls) == 2


def test_legacy_estimate_cannot_be_reused_or_relabeled_as_direct_lines():
    get, calls = api()
    previous = BettingFeed(NOW, key, TEAM_NAMES, api_key='key', allow_fetch=True, get=get).attach(slate())
    previous['players'][0]['betting']['method'] = 'devig-poisson-v1'
    previous['sources']['betting']['method'] = 'devig-poisson-v1'
    cached = BettingFeed(NOW, key, TEAM_NAMES, api_key='', allow_fetch=False, get=get).attach(slate(), previous)
    assert cached['players'][0]['sources']['betting'] is None
    assert 'betting' not in cached['players'][0]
    assert not cached['sources']['betting'].get('eventCaptures')
    fresh = BettingFeed(NOW, key, TEAM_NAMES, api_key='key', allow_fetch=True, get=get).attach(slate(), cached)
    assert len(calls) == 4
    assert fresh['players'][0]['betting']['method'] == METHOD


def test_live_adapter_reuses_one_event_fetch_across_platforms_and_never_publishes_key():
    get, calls = api()
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=get)
    yahoo, dk = feed.attach(slate()), feed.attach(slate('draftkings'))
    assert len(calls) == 2
    assert calls[-1][1]['params']['markets'].split(',') == MARKETS
    assert calls[-1][1]['allow_redirects'] is False
    assert yahoo['players'][0]['betting']['points'] != dk['players'][0]['betting']['points']
    assert yahoo['sources']['betting']['playerCount'] == 1
    assert 'TEST_SECRET' not in json.dumps([yahoo, dk])


def test_missing_key_and_disabled_schedule_do_not_call_api():
    def unexpected(*args, **kwargs): raise AssertionError('No network expected')
    for secret, allowed in [('', True), ('TEST_SECRET', False)]:
        result = BettingFeed(NOW, key, TEAM_NAMES, api_key=secret, allow_fetch=allowed, get=unexpected).attach(slate())
        assert result['players'][0]['sources'] == {'sportsline': 40, 'fuel': 42, 'betting': None}
        assert result['sources']['betting']['playerCount'] == 0


def test_quote_cache_keeps_original_age_and_refuses_changed_identity():
    get, calls = api()
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='key', allow_fetch=True, get=get)
    previous = feed.attach(slate())
    later = BettingFeed(NOW+timedelta(minutes=30), key, TEAM_NAMES, api_key='key', allow_fetch=True, get=get).attach(slate(), previous)
    assert len(calls) == 2
    assert later['players'][0]['betting']['updatedAt'] == STAMP
    assert later['sources']['betting']['eventCaptures'] == previous['sources']['betting']['eventCaptures']
    stale = BettingFeed(NOW+timedelta(minutes=121), key, TEAM_NAMES, api_key='', get=get).attach(slate(), previous)
    assert stale['players'][0]['sources']['betting'] is None
    changed = slate(); changed['players'][0]['name'] = 'Someone Else'
    result = BettingFeed(NOW, key, TEAM_NAMES, api_key='', get=get).attach(changed, previous)
    assert result['players'][0]['sources']['betting'] is None


@pytest.mark.parametrize('fault', ['network', 'redirect', 'wrong_event', 'wrong_tip', 'ambiguous_name', 'malformed'])
def test_failed_or_unmatched_feed_is_unavailable_without_affecting_other_providers(fault):
    get, _ = api(); base = slate()
    if fault == 'ambiguous_name': base['players'].append({**deepcopy(base['players'][0]), 'id': '2'})
    def broken(url, **kwargs):
        if fault == 'network': raise RuntimeError('https://provider.example?apiKey=TEST_SECRET')
        response = get(url, **kwargs)
        if fault == 'redirect': response.status_code = 302
        if url.endswith('/odds'):
            data = response.json()
            if fault == 'wrong_event': data['id'] = 'unmatched'
            if fault == 'wrong_tip': data['commence_time'] = '2026-10-28T23:30:00Z'
            if fault == 'malformed': data['bookmakers'] = None
            response.json = lambda: data
        return response
    result = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=broken).attach(base)
    assert all(p['sources'] == {'sportsline': 40, 'fuel': 42, 'betting': None} for p in result['players'])
    assert result['sources']['betting']['lastAttempt']['playerCount'] == 0
    assert 'TEST_SECRET' not in json.dumps(result)


def test_complete_books_are_one_source_and_partial_books_cannot_be_spliced():
    get, _ = api()
    def split(url, **kwargs):
        response = get(url, **kwargs)
        data = response.json()
        if url.endswith('/odds'):
            a, b = book(), book(); b['key'] = 'second_fixture'
            a['markets'] = a['markets'][:3]; b['markets'] = b['markets'][3:]
            data['bookmakers'] = [a, b]
        response.json = lambda: data
        return response
    assert BettingFeed(NOW, key, TEAM_NAMES, api_key='key', allow_fetch=True, get=split).attach(slate())['sources']['betting']['playerCount'] == 0


@pytest.mark.parametrize('event', ['workflow_dispatch', 'schedule', 'push', 'workflow_call', ''])
def test_secret_alone_and_legacy_scheduled_switch_never_enable_requests(monkeypatch,event):
    monkeypatch.setenv('ODDS_API_KEY','TEST_SECRET')
    monkeypatch.setenv('GITHUB_EVENT_NAME',event)
    monkeypatch.setenv('ODDS_SCHEDULED','true')
    monkeypatch.delenv('ODDS_FETCH_ENABLED',raising=False)
    get,calls=api()
    feed=BettingFeed(NOW,key,TEAM_NAMES,get=get)
    result=feed.attach(slate())
    assert feed.request('/events') is None
    assert not calls and not feed.allow_fetch
    assert 'Refresh betting odds (manual)' in result['sources']['betting']['message']


def test_explicit_authorization_fetches_once_and_reports_real_cost(monkeypatch,tmp_path):
    monkeypatch.setenv('ODDS_API_KEY','TEST_SECRET');monkeypatch.setenv('ODDS_FETCH_ENABLED','true')
    path=tmp_path/'summary';monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(path))
    get,calls=api();feed=BettingFeed(NOW,key,TEAM_NAMES,get=get)
    feed.attach(slate());feed.attach(slate('draftkings'));feed.write_summary()
    assert len(calls)==2 and feed.odds_requests==1 and feed.credits_used==9
    assert 'Credits used by this run: **9**' in path.read_text()
    assert 'remaining: **400**' in path.read_text()
    assert 'TEST_SECRET' not in path.read_text()


def test_normal_refresh_reuses_quotes_without_key_or_odds_requests_and_does_not_reset_age(monkeypatch,tmp_path):
    get,calls=api();previous=BettingFeed(NOW,key,TEAM_NAMES,api_key='TEST_SECRET',allow_fetch=True,get=get).attach(slate())
    monkeypatch.setenv('ODDS_CONFIGURED','true');monkeypatch.setenv('ODDS_FETCH_ENABLED','false')
    path=tmp_path/'summary';monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(path))
    feed=BettingFeed(NOW+timedelta(minutes=30),key,TEAM_NAMES,api_key='',get=get)
    cached=feed.attach(slate(),previous);feed.write_summary()
    assert len(calls)==2 and feed.odds_requests==0
    assert cached['players'][0]['betting']['updatedAt']==STAMP
    assert 'Credits used by this run: **0**' in path.read_text()
    later=BettingFeed(NOW+timedelta(minutes=121),key,TEAM_NAMES,api_key='',get=get).attach(slate(),cached)
    assert later['players'][0]['sources']['betting'] is None
    assert 'Last manual attempt' in later['sources']['betting']['message']
    assert later['sources']['betting']['lastAttempt']['at'] == previous['sources']['betting']['lastAttempt']['at']


def test_failed_request_with_unknown_cost_is_not_claimed_as_free(monkeypatch,tmp_path):
    get,calls=api()
    def broken(url,**kwargs):
        if url.endswith('/odds'):raise RuntimeError('TEST_SECRET')
        return get(url,**kwargs)
    path=tmp_path/'summary';monkeypatch.setenv('GITHUB_STEP_SUMMARY',str(path))
    feed=BettingFeed(NOW,key,TEAM_NAMES,api_key='TEST_SECRET',allow_fetch=True,get=broken)
    feed.attach(slate());feed.write_summary()
    assert feed.odds_requests==1 and feed.unknown_cost_requests==1
    assert 'cost unknown for 1' in path.read_text()
    assert 'Credits used by this run: **0**' not in path.read_text()
    assert 'TEST_SECRET' not in path.read_text()


@pytest.mark.parametrize('offset', [-15, -10, 0, 10, 15])
def test_event_matching_accepts_small_provider_start_offsets_and_keeps_slate_tip(offset):
    get, calls = api()
    def shifted(url, **kwargs):
        response = get(url, **kwargs); data = response.json()
        events = data if isinstance(data, list) else [data]
        for event in events:
            event['commence_time'] = (datetime.fromisoformat(TIP.replace('Z', '+00:00')) + timedelta(minutes=offset)).isoformat()
        response.json = lambda: data
        return response
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=shifted)
    for platform in ('yahoo', 'draftkings'):
        result = feed.attach(slate(platform))
        assert result['sources']['betting']['playerCount'] == 1
        assert result['players'][0]['betting']['tipoff'] == TIP
        assert result['sources']['betting']['lastAttempt']['gamesMatched'] == 1
    assert len(calls) == 2 and feed.event_requests == 1 and feed.odds_requests == 1


def test_philadelphia_76ers_match_without_dropping_digits():
    get, calls = api()
    def sixers(url, **kwargs):
        response = get(url, **kwargs); data = response.json()
        for event in data if isinstance(data, list) else [data]:
            event.update(away_team='Philadelphia 76ers', home_team='Indiana Pacers')
        response.json = lambda: data
        return response
    base = slate(); base['games'][0]['matchup'] = 'PHI@IND'
    base['players'][0].update(team='IND', opponent='PHI', game='PHI@IND')
    result = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=sixers).attach(base)
    assert len(calls) == 2 and result['sources']['betting']['playerCount'] == 1


@pytest.mark.parametrize('fault,status', [('far_time','tipoff_mismatch'), ('other_date','tipoff_mismatch'),
                                        ('reverse_teams','matchup_missing'), ('duplicate','ambiguous_events'),
                                        ('empty','no_events'), ('schema','no_events')])
def test_unmatched_events_report_reason_and_never_spend_odds_credits(monkeypatch, tmp_path, fault, status):
    get, calls = api()
    def unmatched(url, **kwargs):
        assert not url.endswith('/odds')
        response = get(url, **kwargs); data = response.json()
        if fault == 'far_time': data[0]['commence_time'] = '2026-10-28T00:00:00Z'
        if fault == 'other_date': data[0]['commence_time'] = '2026-10-28T23:30:00Z'
        if fault == 'reverse_teams': data[0]['away_team'], data[0]['home_team'] = data[0]['home_team'], data[0]['away_team']
        if fault == 'duplicate': data.append({**data[0], 'id':'another'})
        if fault == 'empty': data = []
        if fault == 'schema': data = {'bad':'TEST_SECRET'}
        response.json = lambda: data
        return response
    summary = tmp_path / 'summary'; monkeypatch.setenv('GITHUB_STEP_SUMMARY', str(summary))
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='TEST_SECRET', allow_fetch=True, get=unmatched)
    result = feed.attach(slate()); feed.write_summary()
    attempt = result['sources']['betting']['lastAttempt']
    assert attempt['gamesMatched'] == 0 and attempt['games'][0]['status'] == status
    assert len(calls) == 1 and feed.odds_requests == 0 and feed.credits_used == 0
    assert status in summary.read_text() and 'Event discovery requests: **1**' in summary.read_text()
    assert 'TEST_SECRET' not in summary.read_text() + json.dumps(result)
    # Scheduled refreshes preserve the failed attempt instead of implying it never ran.
    cached = BettingFeed(NOW+timedelta(minutes=30), key, TEAM_NAMES, api_key='', allow_fetch=False).attach(slate(), result)
    assert cached['sources']['betting']['lastAttempt'] == attempt
    assert 'Last manual attempt' in cached['sources']['betting']['message']


def test_nearby_but_different_eastern_date_is_rejected():
    feed = BettingFeed(NOW, key, TEAM_NAMES, api_key='', allow_fetch=False)
    game = {'matchup':'SAC@SAS', 'tipoff':'2026-10-28T03:55:00Z'}
    event = {'away_team':'Sacramento Kings', 'home_team':'San Antonio Spurs', 'commence_time':'2026-10-28T04:05:00Z'}
    assert not feed.matches_game(event, game)
