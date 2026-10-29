from datetime import datetime, timezone
import csv
import io
import pytest
from pipeline.refresh import parse_sportsline, parse_fuel, parse_starters, make_slate, key, discover, discover_draftkings, make_draftkings_slate, refresh, fetch, apply_source_health

def yahoo_lobby():
    import json
    tip=int(datetime(2026,10,25,21,tzinfo=timezone.utc).timestamp()*1000)
    sports=[{'sportCode':'nba','series':[
        {'series':{'id':1},'earliestStartTime':tip,'gameCodeList':list(range(7))},
        {'series':{'id':2},'earliestStartTime':tip+7200000,'gameCodeList':list(range(5))},
        {'series':{'id':3},'earliestStartTime':tip,'gameCodeList':[1]},
        {'series':{'id':4},'earliestStartTime':tip+86400000,'gameCodeList':[1,2]}]}]
    # A valid public lobby can advertise NBA slates while its preview is all NFL.
    html=json.dumps({'ContestSeriesStore':sports,'ContestsStore':{'state':{'contests':[
        {'id':99,'sportCode':'nfl','seriesId':99,'slateType':'MULTI_GAME'}]}}},separators=(',',':'))
    return html,tip

def test_yahoo_discovery_uses_each_nba_slate_even_when_featured_preview_is_only_football(monkeypatch):
    from types import SimpleNamespace
    from urllib.parse import urlparse,parse_qs
    html,tip=yahoo_lobby();calls=[]
    def public_list(url):
        query=parse_qs(urlparse(url).query);calls.append(query)
        sid=query['seriesId'][0]
        row={'id':100+int(sid),'sportCode':'nba','seriesId':int(sid),'slateType':'MULTI_GAME',
             'scope':'public','state':'upcoming','startTime':tip+(7200000 if sid=='2' else 0)}
        return SimpleNamespace(json=lambda:{'contests':{'result':[row],'error':None}})
    monkeypatch.setattr('pipeline.refresh.fetch',public_list)
    actual=discover(html,'2026-10-25')
    assert [(r['seriesId'],r['contestId'],r['gameCount']) for r in actual]==[('1','101',7),('2','102',5)]
    assert len(calls)==2 and all(q['sport']==['nba'] and q['scope']==['public'] for q in calls)
    assert {q['seriesId'][0] for q in calls}=={'1','2'}

@pytest.mark.parametrize('change', ['sport','series','single_game','private','started','date','empty','error'])
def test_yahoo_discovery_reports_unmatched_or_failed_lookup_instead_of_silently_dropping_nba(monkeypatch,change):
    from types import SimpleNamespace
    html,tip=yahoo_lobby()
    row={'id':101,'sportCode':'nba','seriesId':1,'slateType':'MULTI_GAME',
         'scope':'public','state':'upcoming','startTime':tip}
    changes={'sport':('sportCode','nfl'),'series':('seriesId',99),'single_game':('slateType','SINGLE_GAME'),
             'private':('scope','private'),'started':('state','inprogress'),'date':('startTime',tip+86400000)}
    if change in changes:
        field,value=changes[change];row[field]=value
    payload={'result':[] if change=='empty' else [row],'error':{'code':500} if change=='error' else None}
    monkeypatch.setattr('pipeline.refresh.fetch',lambda url:SimpleNamespace(json=lambda:{'contests':payload}))
    with pytest.raises(ValueError,match='Yahoo'):
        discover(html,'2026-10-25')

def table(rows):
    return '<table>'+''.join('<tr>'+''.join('<td>'+str(c)+'</td>' for c in row)+'</tr>' for row in rows)+'</table>'

def test_sportsline_uses_components_not_displayed_fantasy_total():
    header=['PLAYER','POS','TEAM','GAME','MIN','PTS','TRB','AST','ST','BK','TO','FD']
    rows=[[f'Player {i}','PG','GS','GS@LAL',30,20,5,6,1,1,2,999] for i in range(8)]
    values=parse_sportsline(table([header,*rows]))
    assert values[('player0','GSW')]['points']==39
    assert values[('player0','GSW')]['matchup']=='GSW@LAL'
    with pytest.raises(ValueError,match='Duplicate'):
        parse_sportsline(table([header,*rows,rows[0]]))

def test_sportsline_native_dk_column_is_kept_separate_from_yahoo_and_fd():
    header=['PLAYER','POS','TEAM','GAME','MIN','PTS','TRB','AST','ST','BK','TO','FP','FD','DK']
    rows=[[f'Player {i}','PG','GS','GS@LAL',30,20,5,6,1,1,2,999,888,44.75] for i in range(8)]
    parsed=parse_sportsline(table([header,*rows]))
    assert parsed[('player0','GSW')]['points']==39
    assert parsed[('player0','GSW')]['draftkings_points']==44.75
    for value in ['', 'nan', '-1', 'not published']:
        rows[0][-1]=value
        p=parse_sportsline(table([header,*rows]))[('player0','GSW')]
        assert p['draftkings_points'] is None and p['points']==39
    rows[0][-1]=0
    assert parse_sportsline(table([header,*rows]))[('player0','GSW')]['draftkings_points']==0

def test_fuel_checks_date_and_preserves_injury_flag():
    rows=[[i,'PG/SG',f'Player {i} Q','','','GS','LAL','',30,'','','','','','',''] for i in range(8)]
    html='Updated At: Wed, Oct 21, 2026, 12:48 PM ET'+table(rows)
    values,stamp=parse_fuel(html,'2026-10-21')
    assert values[('player0','GSW')]=={'points':30,'opponent':'LAL','badge':'Q'}
    assert stamp=='2026-10-21T16:48:00Z'
    with pytest.raises(ValueError,match='another date'):parse_fuel(html,'2026-10-22')

def test_starters_need_current_date_and_five_names():
    html='October 21, 2026<div class="lineup__teams"><span class="lineup__abbr">GS</span></div><ul class="lineup__list"><li class="lineup__status is-confirmed"></li>'+''.join(f'<li class="lineup__player"><a title="Player {i}">P</a></li>' for i in range(6))+'</ul>'
    result=parse_starters(html,'2026-10-21')
    assert len(result)==5 and set(result.values())=={'confirmed'}
    with pytest.raises(ValueError,match='another date'):parse_starters(html,'2026-10-22')

def test_verified_sarr_alias_matches_starters_and_injuries_without_merging_other_sarrs():
    assert key('Alexandre Sarr') == key('Alex Sarr')
    assert key('Alexandre Sarr') != key('Olivier Sarr')

def slate_inputs():
    now=datetime(2026,10,21,17,0,tzinfo=timezone.utc)
    tip=datetime(2026,10,21,23,0,tzinfo=timezone.utc).timestamp()*1000
    contest={'sportCode':'nba','slateType':'MULTI_GAME','startTime':tip,'seriesId':'1','id':'2','title':'Public contest','series':{'games':[{'code':'game1','awayTeam':{'abbr':'GS'},'homeTeam':{'abbr':'LAL'},'startTime':tip}]}}
    rows=[['ID','First Name','Last Name','Position','Salary','Team','Opponent','Game','FPPG','Injury Status']]+[[str(i),'Player',str(i),'PG',10,'GS','LAL','GS@LAL',10,''] for i in range(20)]
    stream=io.StringIO();csv.writer(stream).writerows(rows)
    sports={(f'player{i}','GSW'):{'points':30,'minutes':30,'matchup':'GSW@LAL'} for i in range(20)}
    fuel={(f'player{i}','GSW'):{'points':40,'opponent':'LAL','badge':''} for i in range(20)}
    return contest,stream.getvalue(),sports,fuel,{}, {},{'GSW':'submitted','LAL':'submitted'},'2026-10-21',now,'2026-10-21T16:45:00Z',{}

def test_salary_joins_require_exact_matchups_and_pending_reports_block():
    args=list(slate_inputs());result=make_slate(*args)
    assert result['players'][0]['projection']==35
    assert result['players'][0]['injury']=='Not listed'
    args[6]['GSW']='pending';result=make_slate(*args)
    assert not result['ready'] and result['players'][0]['injury']=='Unknown'
    args[2][('player0','GSW')]['matchup']='GSW@SAC';result=make_slate(*args)
    assert result['players'][0]['projection'] is None
    args[1]=args[1].replace('GS@LAL','GS@SAC')
    with pytest.raises(ValueError,match='matchup'):make_slate(*args)

def test_identity_normalization_and_duplicate_salary_rejection():
    assert key('Nikola Jokić')=='nikolajokic'
    assert key('Gary Trent Jr.')=='garytrent'
    assert key('Dereck LivelyII')==key('Dereck Lively II')=='derecklively'
    assert key('Jimmy ButlerIII')==key('Jimmy Butler III')=='jimmybutler'
    assert key('WendellJr. Carter')==key('Wendell Carter Jr.')=='wendellcarter'
    args=list(slate_inputs());args[1]+='0,Player,0,PG,10,GS,LAL,GS@LAL,10,\r\n'
    with pytest.raises(ValueError,match='identity'):make_slate(*args)

def test_combined_separates_missing_forecasts_from_actual_injury_flags():
    args=list(slate_inputs());args[4][('player0','GSW')]='projected'
    del args[3][('player0','GSW')]
    args[3][('player1','GSW')]['badge']='Q'
    args[1]=args[1].replace('2,Player,2,PG,10,GS,LAL,GS@LAL,10,', '2,Player,2,PG,10,GS,LAL,GS@LAL,10,DTD')
    result=make_slate(*args)
    assert result['combinedReady']
    assert not result['players'][0]['providerClear']  # Strict modes unchanged.
    assert result['players'][0]['providerFlagsClear']
    assert not result['players'][1]['providerFlagsClear']
    assert not result['players'][2]['providerFlagsClear']
    args[2]={};args[3]={}
    result=make_slate(*args)
    assert not result['ready'] and result['combinedReady']  # Fresh ML may fill projections.
    args[6]['LAL']='pending'
    assert not make_slate(*args)['combinedReady']
    args[6]['LAL']='submitted';args[4]={}
    assert not make_slate(*args)['combinedReady']

def draftkings_inputs():
    now=datetime(2026,10,21,17,0,tzinfo=timezone.utc)
    group={'sportId':4,'gameTypeId':70,'draftGroupId':123,'minStartTime':'2026-10-21T23:00:00Z','contestType':{'gameType':'SalaryCap'},'allTags':['Featured'],'games':[
        {'gameId':1,'description':'GS @ LAL','startDate':'2026-10-21T23:00:00Z'},
        {'gameId':2,'description':'DEN @ OKC','startDate':'2026-10-22T01:00:00Z'}]}
    rows=[['Position','Name','ID','Roster Position','Salary','Game Info','TeamAbbrev','AvgPointsPerGame','Status']]
    for i in range(20):rows.append(['PG/SG',f'Player {i}',str(i),'PG/SG/G/UTIL',4000,('GS@LAL' if i%2==0 else 'DEN@OKC')+' 10/21/2026 07:00PM ET','GS' if i%2==0 else 'DEN',20,''])
    stream=io.StringIO();csv.writer(stream).writerows(rows)
    sports={(f'player{i}','GSW' if i%2==0 else 'DEN'):{'points':99,'minutes':30,'matchup':'GSW@LAL' if i%2==0 else 'DEN@OKC'} for i in range(20)}
    fuel={(f'player{i}','GSW' if i%2==0 else 'DEN'):{'points':40,'opponent':'LAL' if i%2==0 else 'OKC','badge':''} for i in range(20)}
    return group,stream.getvalue(),sports,fuel,{('player0','GSW'):'projected'}, {},{'GSW':'submitted','LAL':'submitted','DEN':'submitted','OKC':'submitted'},'2026-10-21',now,'2026-10-21T16:45:00Z',{}

def test_draftkings_main_discovery_excludes_showdown_and_other_dates():
    from copy import deepcopy
    g=draftkings_inputs()[0];other=deepcopy(g);other['gameTypeId']=81;other['draftGroupId']=456
    payload={'gameTypes':[{'gameTypeId':70,'name':'Classic'},{'gameTypeId':81,'name':'Showdown Captain Mode'}],'draftGroups':[other,g]}
    assert discover_draftkings(payload,'2026-10-21')['draftGroupId']==123
    assert discover_draftkings(payload,'2026-10-22') is None
    g['games'][1]['startDate']='2026-10-23T01:00:00Z'
    assert discover_draftkings(payload,'2026-10-21') is None

def test_draftkings_uses_native_points_and_exact_roster_eligibility():
    args=list(draftkings_inputs());slate=make_draftkings_slate(*args)
    assert slate['platform']=='draftkings' and slate['salaryCap']==50000
    assert slate['players'][0]['projection']==40  # Never average with Yahoo-scored 99.
    assert slate['players'][0]['sourceCount']==1 and slate['players'][0]['minutes']==30
    assert set(slate['players'][0]['eligibleSlots'])=={'PG','SG','G','UTIL'}
    args[1]=args[1].replace('PG/SG/G/UTIL','PG/SG/C/G/UTIL')
    with pytest.raises(ValueError,match='eligibility'):make_draftkings_slate(*args)

def test_draftkings_consensus_and_combined_metadata_do_not_reuse_yahoo_points():
    args=list(draftkings_inputs())
    for p in args[2].values():p['draftkings_points']=50
    slate=make_draftkings_slate(*args)
    p=slate['players'][0]
    assert p['projection']==40 and p['consensusProjection']==45
    assert p['sources']=={'sportsline':50,'fuel':40} and p['sourceCount']==2
    assert slate['consensusReady'] and slate['combinedReady']
    del args[3][('player0','GSW')]
    p=make_draftkings_slate(*args)['players'][0]
    assert p['consensusProjection'] is None and p['providerFlagsClear']
    args[2]={};args[3]={}
    empty=make_draftkings_slate(*args)
    assert not empty['ready'] and not empty['consensusReady'] and empty['combinedReady']
    args[6]['LAL']='pending'
    assert not make_draftkings_slate(*args)['combinedReady']

def test_draftkings_rejects_wrong_dates_and_duplicate_players():
    args=list(draftkings_inputs());args[1]=args[1].replace('10/21/2026','10/20/2026')
    with pytest.raises(ValueError,match='another date'):make_draftkings_slate(*args)
    args=list(draftkings_inputs());args[1]+='PG/SG,Player 0,0,PG/SG/G/UTIL,4000,GS@LAL 10/21/2026 07:00PM ET,GS,20,\r\n'
    with pytest.raises(ValueError,match='identity'):make_draftkings_slate(*args)

def test_fuel_rejects_wrong_scoring_platform_and_stale_player_rows():
    with pytest.raises(ValueError,match='platform'):parse_fuel("window.platform='fanduel';",'2026-10-21','draftkings')
    with pytest.raises(ValueError,match='another date'):parse_fuel("window.platform='draftkings';<table><tr class='projections-listing' data-start_date='2026-10-20'></tr></table>",'2026-10-21','draftkings')

def test_platform_failures_keep_previous_slate_timestamps(monkeypatch,tmp_path):
    import json
    from zoneinfo import ZoneInfo
    date=datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    old={'schemaVersion':1,'date':date,'slates':[{'platform':'draftkings','seriesId':'dk-123','file':date+'-dk-123.json'}]}
    snapshot={'updatedAt':'2026-10-20T17:00:00Z','id':'dk-123'}
    (tmp_path/'catalog.json').write_text(json.dumps(old));(tmp_path/(date+'-dk-123.json')).write_text(json.dumps(snapshot))
    def fail(url):raise RuntimeError('Public source unavailable')
    monkeypatch.setattr('pipeline.refresh.fetch',fail)
    result=refresh(tmp_path,date)
    assert result['status']=='partial' and result['slates']==old['slates']
    assert json.loads((tmp_path/(date+'-dk-123.json')).read_text())==snapshot


@pytest.mark.parametrize('fault', ['timeout', 'connection', 429, 500, 502, 503, 504])
def test_public_feed_retries_transient_failures_then_recovers(monkeypatch, fault):
    import requests
    calls, sleeps = [], []
    def get(url, **kwargs):
        calls.append(url)
        if len(calls) < 3:
            if fault == 'timeout': raise requests.ReadTimeout('temporary')
            if fault == 'connection': raise requests.ConnectionError('temporary')
        response = requests.Response()
        response.status_code = fault if isinstance(fault, int) and len(calls) < 3 else 200
        return response
    monkeypatch.setattr('pipeline.refresh.requests.get', get)
    monkeypatch.setattr('pipeline.refresh.time.sleep', sleeps.append)
    assert fetch('https://www.dailyfantasyfuel.com/fixture').status_code == 200
    assert len(calls) == 3 and sleeps == [1, 2]


@pytest.mark.parametrize('status,expected_calls', [(404, 1), (403, 1), (503, 3)])
def test_public_feed_retries_are_bounded_and_do_not_retry_permanent_errors(monkeypatch, status, expected_calls):
    import requests
    calls = []
    def get(*args, **kwargs):
        calls.append(1)
        response = requests.Response(); response.status_code = status
        return response
    monkeypatch.setattr('pipeline.refresh.requests.get', get)
    monkeypatch.setattr('pipeline.refresh.time.sleep', lambda _: None)
    with pytest.raises(requests.HTTPError): fetch('https://www.dailyfantasyfuel.com/fixture')
    assert len(calls) == expected_calls


@pytest.mark.parametrize('failed_source', ['fuel', 'fuel_dk', 'sportsline'])
def test_refresh_publishes_feed_failure_guard_and_isolates_platforms(monkeypatch, tmp_path, failed_source):
    import json
    from types import SimpleNamespace
    import pipeline.refresh as module
    yahoo, dk = list(slate_inputs()), list(draftkings_inputs())
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None): return yahoo[8]
    monkeypatch.setattr(module, 'datetime', FrozenDateTime)
    monkeypatch.setattr(module, 'discover', lambda *a: [{'seriesId':'1','contestId':'2','gameCount':1,'firstTip':'2026-10-21T23:00:00Z'}])
    monkeypatch.setattr(module, 'discover_draftkings', lambda *a: dk[0])
    monkeypatch.setattr(module, 'store', lambda *a: yahoo[0])
    marker = {'fuel':'/fanduel/', 'fuel_dk':'/draftkings/', 'sportsline':'sportsline.com'}[failed_source]
    def get(url):
        if marker in url: raise TimeoutError('provider timed out')
        text = yahoo[1] if 'contestPlayers' in url else dk[1] if 'getavailableplayerscsv' in url else ''
        return SimpleNamespace(text=text, json=lambda: {})
    monkeypatch.setattr(module, 'fetch', get)
    sports = {**yahoo[2], **dk[2]}
    for p in sports.values(): p['draftkings_points'] = 50
    monkeypatch.setattr(module, 'parse_sportsline', lambda _: sports)
    monkeypatch.setattr(module, 'parse_fuel', lambda h, d, p: (yahoo[3] if p == 'fanduel' else dk[3], yahoo[9]))
    monkeypatch.setattr(module, 'parse_starters', lambda *a: dk[4])
    monkeypatch.setattr(module, 'latest_injuries', lambda *a: ({}, dk[6], yahoo[9], 'https://example.com/injuries'))
    monkeypatch.setenv('ODDS_FETCH_ENABLED', 'false')
    refresh(tmp_path, yahoo[7])
    for platform, filename in [('yahoo','2026-10-21-1.json'), ('draftkings','2026-10-21-dk-123.json')]:
        result = json.loads((tmp_path / filename).read_text())
        failed = failed_source == 'sportsline' or failed_source == ('fuel' if platform == 'yahoo' else 'fuel_dk')
        assert result['sourceHealth']['status'] == ('unavailable' if failed else 'ready')
        if failed:
            assert not result['ready'] and not result['combinedReady'] and not result['consensusReady']
            assert 'generation is paused' in result['combinedReadinessReason']
            if failed_source != 'sportsline':
                assert all(not p['providerFlagsClear'] and not p['providerClear'] for p in result['players'])
        else:
            assert result['combinedReady']


def test_healthy_feed_with_one_missing_player_retains_combined_fallback():
    args = list(slate_inputs()); args[4][('player0','GSW')] = 'projected'
    del args[3][('player0','GSW')]
    result = apply_source_health(make_slate(*args))
    assert result['sourceHealth']['status'] == 'ready' and result['combinedReady']
    assert result['players'][0]['providerFlagsClear']
