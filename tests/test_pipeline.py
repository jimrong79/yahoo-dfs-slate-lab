from datetime import datetime, timezone
import csv
import io
import pytest
from pipeline.refresh import parse_sportsline, parse_fuel, parse_starters, make_slate, key, discover_draftkings, make_draftkings_slate, refresh

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
