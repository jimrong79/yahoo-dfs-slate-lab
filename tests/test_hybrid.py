"""Hybrid component fixtures: no live Odds API requests."""
from copy import deepcopy
from datetime import timedelta
import json
import pytest
from pipeline.betting import BettingFeed, book_estimates, COMPONENT_METHOD
from pipeline.refresh import parse_sportsline, sportsline_components, key, TEAM_NAMES
from test_betting import NOW, STAMP, TIP, book, slate, api
from test_pipeline import table


@pytest.mark.parametrize('platform', ['yahoo', 'draftkings'])
def test_missing_turnovers_still_preserves_other_components_but_not_a_full_betting_score(platform):
    b=book(); b['markets']=[m for m in b['markets'] if m['key']!='player_turnovers']; parts={}
    assert not book_estimates(b,platform,NOW,key,components=parts)
    assert 'turnovers' not in parts['testplayer']
    assert parts['testplayer']['points']['points']==24.5
    assert ('dk_extras' in parts['testplayer']) == (platform=='draftkings')


@pytest.mark.parametrize('kind', ['threes','double_double','triple_double'])
def test_dk_extras_never_fill_a_missing_market_with_zero(kind):
    b=book();b['markets']=[m for m in b['markets'] if m['key']!='player_'+kind];parts={}
    book_estimates(b,'draftkings',NOW,key,components=parts)
    assert 'dk_extras' not in parts['testplayer']
    assert parts['testplayer']['points']['points']==24.5


def test_malformed_or_duplicate_stat_is_excluded_from_partial_components():
    for fault in ('missing','duplicate','stale'):
        b=book();parts={}
        if fault=='missing':b['markets'][0]['outcomes'][0]['point']=None
        if fault=='duplicate':b['markets'].append(deepcopy(b['markets'][0]))
        if fault=='stale':b['markets'][0]['last_update']=(NOW-timedelta(hours=3)).isoformat()
        book_estimates(b,'yahoo',NOW,key,components=parts)
        assert 'points' not in parts['testplayer']
        assert 'rebounds' in parts['testplayer']


def test_provider_components_reconcile_native_dk_and_preserve_actual_zero():
    header=['PLAYER','POS','TEAM','GAME','MIN','PTS','TRB','AST','ST','BK','TO','DK']
    rows=[[f'Player {i}','PG','GS','GS@LAL',30,20,5,6,0,1,2,39.75] for i in range(8)]
    p=parse_sportsline(table([header,*rows]))[('player0','GSW')]
    dk=sportsline_components(p,'draftkings','GSW@LAL',TIP,NOW)
    assert dk['values']=={'points':20,'rebounds':6.25,'assists':9,'steals':0,'blocks':2,'turnovers':-1,'dk_extras':3.5}
    assert sum(dk['values'].values())==dk['total']==39.75
    assert dk['updatedAt']==STAMP.replace('+00:00','Z')
    yahoo=sportsline_components(p,'yahoo','GSW@LAL',TIP,NOW)
    assert 'dk_extras' not in yahoo['values']
    assert sum(yahoo['values'].values())==yahoo['total']==36
    p['stats']['turnovers']=None
    assert sportsline_components(p,'draftkings','GSW@LAL',TIP,NOW) is None


def test_invalid_native_remainder_is_unavailable_not_clamped_to_zero():
    p={'points':5,'draftkings_points':5,'stats':{'points':10,'rebounds':0,'assists':0,'steals':0,'blocks':0,'turnovers':0}}
    assert sportsline_components(p,'draftkings','SAC@SAS',TIP,NOW) is None
    assert sportsline_components(p,'yahoo','SAC@SAS',TIP,NOW) is None


def test_partial_feed_uses_one_fetch_both_platforms_and_cache_never_renews_age():
    get,calls=api()
    def partial(url,**kwargs):
        r=get(url,**kwargs); data=r.json()
        if url.endswith('/odds'):data['bookmakers'][0]['markets']=[m for m in data['bookmakers'][0]['markets'] if m['key']!='player_turnovers']
        r.json=lambda:data;return r
    feed=BettingFeed(NOW,key,TEAM_NAMES,api_key='TEST_SECRET',allow_fetch=True,get=partial)
    yahoo=feed.attach(slate());dk=feed.attach(slate('draftkings'))
    assert len(calls)==2
    assert yahoo['sources']['betting']['playerCount']==dk['sources']['betting']['playerCount']==0
    assert yahoo['sources']['betting']['componentPlayerCount']==dk['sources']['betting']['componentPlayerCount']==1
    parts=dk['players'][0]['bettingComponents']
    assert parts['method']==COMPONENT_METHOD
    assert 'turnovers' not in parts['values']
    assert parts['values']['points']['points']==24.5
    assert parts['values']['dk_extras']['points']>0
    for forbidden in ['TEST_SECRET','"outcomes"','"price"','"point"']:
        assert forbidden not in json.dumps(dk)
    later=BettingFeed(NOW+timedelta(minutes=30),key,TEAM_NAMES,api_key='',allow_fetch=False,get=partial).attach(slate('draftkings'),dk)
    assert later['players'][0]['bettingComponents']==parts
    stale=BettingFeed(NOW+timedelta(minutes=121),key,TEAM_NAMES,api_key='',allow_fetch=False,get=partial).attach(slate('draftkings'),dk)
    assert 'bettingComponents' not in stale['players'][0]
    changed=slate('draftkings');changed['players'][0]['name']='Different Player'
    assert 'bettingComponents' not in BettingFeed(NOW,key,TEAM_NAMES,api_key='',allow_fetch=False).attach(changed,dk)['players'][0]
    assert len(calls)==2


def test_components_withdrawn_in_successful_refresh_are_removed():
    get,_=api();previous=BettingFeed(NOW,key,TEAM_NAMES,api_key='key',allow_fetch=True,get=get).attach(slate())
    def withdrawn(url,**kwargs):
        r=get(url,**kwargs);data=r.json()
        if url.endswith('/odds'):data['bookmakers']=[]
        r.json=lambda:data;return r
    result=BettingFeed(NOW+timedelta(minutes=61),key,TEAM_NAMES,api_key='key',allow_fetch=True,get=withdrawn).attach(slate(),previous)
    assert 'bettingComponents' not in result['players'][0]
    assert result['sources']['betting']['componentPlayerCount']==0
