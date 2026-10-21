from datetime import datetime, timezone
import csv
import io
import pytest
from pipeline.refresh import parse_sportsline, parse_fuel, parse_starters, make_slate, key

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
    args=list(slate_inputs());args[1]+='0,Player,0,PG,10,GS,LAL,GS@LAL,10,\r\n'
    with pytest.raises(ValueError,match='identity'):make_slate(*args)
