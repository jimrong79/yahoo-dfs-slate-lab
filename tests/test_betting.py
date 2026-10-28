"""Synthetic provider-schema fixtures; these do not claim live API coverage."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

import pytest

from pipeline.betting import BettingFeed, MARKETS, book_estimates, fair_probability, mean_from_prop, poisson_cdf
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
        return SimpleNamespace(status_code=200, headers={'x-requests-remaining': '400'}, json=lambda: data)
    return get, calls


def test_devig_and_poisson_inverse_are_explicit_mean_estimates():
    assert fair_probability(1.9, 1.9) == .5
    assert mean_from_prop(.5, 1.9, 1.9) == pytest.approx(.6931471805599453)
    assert poisson_cdf(24, mean_from_prop(24.5, 1.8, 2.1)) == pytest.approx(fair_probability(2.1, 1.8))
    for line, over, under in [(2, 1.9, 1.9), (-.5, 2, 2), (float('nan'), 2, 2), (.5, 0, 2), (.5, True, 2)]:
        assert mean_from_prop(line, over, under) is None


def test_platform_scoring_includes_dk_expected_bonus_not_threshold_bonus():
    means = {k: mean_from_prop(v, 1.9, 1.9) for k, v in LINES.items()}
    yahoo = means['points'] + 1.2*means['rebounds'] + 1.5*means['assists'] + 3*means['steals'] + 3*means['blocks'] - means['turnovers']
    dk = means['points'] + 1.25*means['rebounds'] + 1.5*means['assists'] + 2*means['steals'] + 2*means['blocks'] - .5*means['turnovers'] + .5*means['threes'] + 1.5*fair_probability(3, 1.5) + 3*fair_probability(10, 1.1)
    assert book_estimates(book(), 'yahoo', NOW, key)['testplayer']['points'] == pytest.approx(yahoo)
    assert book_estimates(book(), 'draftkings', NOW, key)['testplayer']['points'] == pytest.approx(dk)


@pytest.mark.parametrize('fault', ['missing_turnovers', 'single_side', 'different_line', 'stale', 'future', 'duplicate'])
def test_partial_malformed_or_stale_props_never_become_zero(fault):
    b = book()
    if fault == 'missing_turnovers': b['markets'] = [m for m in b['markets'] if m['key'] != 'player_turnovers']
    if fault == 'single_side': b['markets'][0]['outcomes'].pop()
    if fault == 'different_line': b['markets'][0]['outcomes'][1]['point'] = 30.5
    if fault == 'stale': b['markets'][0]['last_update'] = (NOW-timedelta(hours=3)).isoformat()
    if fault == 'future': b['markets'][0]['last_update'] = (NOW+timedelta(minutes=6)).isoformat()
    if fault == 'duplicate': b['markets'].append(deepcopy(b['markets'][0]))
    assert not book_estimates(b, 'yahoo', NOW, key)


def test_dk_requires_bonus_probs_but_yahoo_does_not():
    b = book(); b['markets'] = b['markets'][:-2]
    assert book_estimates(b, 'yahoo', NOW, key)
    assert not book_estimates(b, 'draftkings', NOW, key)


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
