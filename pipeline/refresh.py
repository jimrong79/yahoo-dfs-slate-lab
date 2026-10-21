"""Public, read-only daily slate publishing. No Yahoo account or entry access.

The private research ML model is deliberately not promoted by this publisher.
Version 1 reproduces the reviewed live-consensus projection recipe.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import re
import sys
import unicodedata
from zoneinfo import ZoneInfo
import requests
from bs4 import BeautifulSoup
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
EASTERN = ZoneInfo('America/New_York')
UTC = timezone.utc
TEAM_NAMES = dict(zip(
    ['AtlantaHawks','BostonCeltics','BrooklynNets','CharlotteHornets','ChicagoBulls','ClevelandCavaliers','DallasMavericks','DenverNuggets','DetroitPistons','GoldenStateWarriors','HoustonRockets','IndianaPacers','LAClippers','LosAngelesClippers','LosAngelesLakers','MemphisGrizzlies','MiamiHeat','MilwaukeeBucks','MinnesotaTimberwolves','NewOrleansPelicans','NewYorkKnicks','OklahomaCityThunder','OrlandoMagic','Philadelphia76ers','PhoenixSuns','PortlandTrailBlazers','SacramentoKings','SanAntonioSpurs','TorontoRaptors','UtahJazz','WashingtonWizards'],
    ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS']))
POSITIONS = {'PG','SG','SF','PF','C'}
STAT_WEIGHTS = {'PTS': 1, 'TRB': 1.2, 'AST': 1.5, 'ST': 3, 'BK': 3, 'TO': -1}

def team(value):
    return {'GS':'GSW','NO':'NOP','PHO':'PHX','NY':'NYK','SA':'SAS'}.get(value, value)

def key(name):
    value = unicodedata.normalize('NFKD', name).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]', '', re.sub(r'\b(jr|sr|ii|iii|iv)\b\.?', '', value))

def iso(value):
    return value.astimezone(UTC).isoformat().replace('+00:00', 'Z')

def fetch(url):
    response = requests.get(url, timeout=(10, 30), headers={'User-Agent':'SlateLab/1.0 public NBA slate research'})
    response.raise_for_status()
    return response

def store(html, name):
    marker = '"' + name + '":'
    if marker not in html:
        raise ValueError(f'Yahoo no longer exposes {name}; refusing to guess a contest.')
    return json.JSONDecoder().raw_decode(html[html.index(marker)+len(marker):])[0]

def tables(html):
    soup = BeautifulSoup(html, 'html.parser')
    return [[cell.get_text(' ', strip=True) for cell in row.find_all(['td','th'], recursive=False)] for row in soup.select('table tr')]

def parse_sportsline(html):
    rows = tables(html)
    header = next((r for r in rows if r[:4] == ['PLAYER','POS','TEAM','GAME']), None)
    if not header or not set(STAT_WEIGHTS).issubset(header):
        raise ValueError('SportsLine component-stat schema changed.')
    result = {}
    for row in rows:
        if len(row) != len(header) or row == header:
            continue
        p = dict(zip(header,row))
        try:
            stats = {k:float(p[k]) for k in STAT_WEIGHTS}
            minutes = float(p['MIN'])
        except (ValueError,KeyError):
            continue
        if not all(math.isfinite(n) and n >= 0 for n in [minutes,*stats.values()]) or minutes > 48:
            raise ValueError('Invalid component projection.')
        identity = (key(p['PLAYER']),team(p['TEAM']))
        if identity in result:
            raise ValueError('Duplicate SportsLine player identity.')
        result[identity] = {'points':sum(stats[k]*w for k,w in STAT_WEIGHTS.items()),'minutes':minutes,
                            'matchup':'@'.join(team(t) for t in p['GAME'].split('@'))}
    if len(result) < 8:
        raise ValueError('SportsLine has too few complete forecasts.')
    return result

def parse_fuel(html, date):
    soup = BeautifulSoup(html,'html.parser')
    text = soup.get_text(' ',strip=True)
    stamp = re.search(r'Updated At:\s*([A-Za-z]{3},\s*[A-Za-z]{3}\s+\d{1,2},\s*\d{4},\s*\d{1,2}:\d{2}\s*[AP]M)\s*ET',text)
    if not stamp:
        raise ValueError('Daily Fantasy Fuel update timestamp is missing.')
    updated = datetime.strptime(stamp[1],'%a, %b %d, %Y, %I:%M %p').replace(tzinfo=EASTERN)
    if updated.date().isoformat() != date:
        raise ValueError('Daily Fantasy Fuel is showing another date.')
    result = {}
    for row in tables(html):
        if len(row)!=16 or not set(row[1].split('/')).issubset(POSITIONS):
            continue
        name = re.sub(r'\s+(Q|O|D|P|OUT|GTD|DTD)$','',row[2])
        badge = row[2][len(name):].strip()
        identity = (key(name),team(row[5]))
        if identity in result:
            raise ValueError('Duplicate DFF player identity.')
        points = float(row[8])
        if not math.isfinite(points) or points < 0:
            raise ValueError('Invalid DFF projection.')
        result[identity] = {'points':points,'opponent':team(row[6]),'badge':badge}
    if len(result)<8:
        raise ValueError('DFF has too few forecasts.')
    return result, iso(updated)

def parse_starters(html, date):
    soup = BeautifulSoup(html,'html.parser')
    heading = datetime.fromisoformat(date).strftime('%B %d, %Y').replace(' 0',' ')
    if heading not in soup.get_text(' ',strip=True):
        raise ValueError('Starting-lineup page is showing another date.')
    teams = [team(t.get_text(strip=True)) for t in soup.select('.lineup__teams .lineup__abbr')]
    lists = soup.select('ul.lineup__list')
    if len(teams)!=len(lists) or not teams:
        raise ValueError('Starting-lineup team coverage changed.')
    result = {}
    for t,listing in zip(teams,lists):
        players = listing.select('li.lineup__player a[title]')[:5]
        if len(players)!=5:
            continue
        status = 'confirmed' if listing.select_one('.lineup__status.is-confirmed') else 'projected'
        for p in players:
            result[(key(p['title']),t)] = status
    return result

def parse_injuries(content, date):
    if not content.startswith(b'%PDF'):
        raise ValueError('Official report response is not a PDF.')
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = '\n'.join(p.extract_text() or '' for p in pdf.pages)
        words = [dict(w,page=i) for i,p in enumerate(pdf.pages) for w in p.extract_words(use_text_flow=True)]
    stamp = re.search(r'Injury\s+Report:\s*(\d{2}/\d{2}/\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)',text)
    if not stamp:
        raise ValueError('Official report timestamp is missing.')
    reported = datetime.strptime(stamp[1]+' '+stamp[2].replace(' ',''),'%m/%d/%y %I:%M%p').replace(tzinfo=EASTERN)
    if reported.date().isoformat()!=date:
        raise ValueError('Official injury report has the wrong date.')
    words.sort(key=lambda w:(w['page'],w['top'],w['x0']))
    anchors=[w for w in words if 410<=w['x0']<570 and ',' in w['text'] and 70<=w['top']<525]
    contexts=[w for w in words if w['x0']<410 and 70<=w['top']<525]
    current_date=date; matchup=None; current_team=None; index=0; result={}; coverage={}; matchup_dates={}
    for anchor in anchors:
        while index<len(contexts) and (contexts[index]['page'],contexts[index]['top']) <= (anchor['page'],anchor['top']+0.5):
            w=contexts[index];x=w['x0'];value=w['text']
            if x<100 and re.fullmatch(r'\d{2}/\d{2}/\d{4}',value):current_date=datetime.strptime(value,'%m/%d/%Y').date().isoformat()
            elif 190<=x<250 and '@' in value:
                matchup='@'.join(team(t) for t in value.split('@'));matchup_dates[matchup]=current_date
            elif 250<=x<410 and value in TEAM_NAMES:current_team=TEAM_NAMES[value]
            index+=1
        if current_date!=date:
            continue
        status=''.join(w['text'] for w in words if w['page']==anchor['page'] and 570<=w['x0']<650 and abs(w['top']-anchor['top'])<=1.5)
        if status not in {'Out','Doubtful','Questionable','Probable','Available'}:
            raise ValueError(f'Could not parse injury status for {anchor["text"]}.')
        if not current_team or not matchup or current_team not in matchup.split('@'):
            raise ValueError('Ambiguous team context in injury report.')
        last,first=anchor['text'].split(',',1)
        identity=(key(first+' '+last),current_team)
        if identity in result:raise ValueError('Duplicate official injury row.')
        result[identity]=status
    # Read team submission markers independently, including teams with no player rows.
    current_date=date; matchup=None
    for i,w in enumerate(contexts):
        x=w['x0'];value=w['text']
        if x<100 and re.fullmatch(r'\d{2}/\d{2}/\d{4}',value):current_date=datetime.strptime(value,'%m/%d/%Y').date().isoformat()
        if 190<=x<250 and '@' in value:
            matchup='@'.join(team(t) for t in value.split('@'))
            if current_date==date:
                for t in matchup.split('@'):coverage.setdefault(t,'submitted')
        if current_date==date and 250<=x<410 and value in TEAM_NAMES:
            same_line=''.join(k['text'] for k in words if k['page']==w['page'] and k['x0']>=570 and abs(k['top']-w['top'])<3)
            coverage[TEAM_NAMES[value]]='pending' if 'NOTYETSUBMITTED' in same_line else 'submitted'
    if not coverage:
        raise ValueError('No current team coverage in official report.')
    return result,coverage,iso(reported)

def latest_injuries(date, now):
    end=now.astimezone(EASTERN).replace(second=0,microsecond=0)
    end=end.replace(minute=(end.minute//15)*15)
    for offset in range(12):
        moment=end-timedelta(minutes=15*offset)
        if moment.date().isoformat()!=date:break
        url=f'https://ak-static.cms.nba.com/referee/injury/Injury-Report_{date}_{moment.strftime("%I_%M%p")}.pdf'
        try:
            content=fetch(url).content
        except requests.HTTPError as exc:
            if exc.response.status_code in (403,404):continue
            raise
        result=parse_injuries(content,date)
        if datetime.fromisoformat(result[2].replace('Z','+00:00'))>now+timedelta(minutes=1):raise ValueError('Future injury timestamp.')
        return (*result,url)
    raise ValueError('No official injury report is available within the past three hours.')

def discover(html, date, preferred=None):
    contests=store(html,'ContestsStore')['state']['contests']
    sports=store(html,'ContestSeriesStore')
    series={str(s['series']['id']):s for sport in sports if sport['sportCode']=='nba' for s in sport['series']
            if datetime.fromtimestamp(s['earliestStartTime']/1000,UTC).astimezone(EASTERN).date().isoformat()==date and len(s['gameCodeList'])>=2}
    result=[]
    for sid,s in series.items():
        options=[c for c in contests if c['sportCode']=='nba' and str(c['seriesId'])==sid and c['slateType']=='MULTI_GAME']
        if not options:continue
        chosen=str(options[0]['id'])
        result.append({'seriesId':sid,'contestId':chosen,'gameCount':len(s['gameCodeList']),'firstTip':iso(datetime.fromtimestamp(s['earliestStartTime']/1000,UTC))})
    result.sort(key=lambda r:(-r['gameCount'],r['firstTip']))
    if preferred and result:result[0]['contestId']=str(preferred)
    return result

def make_slate(contest, csv_text, sports, fuel, starters, injuries, coverage, date, now, reported, source_info):
    if contest['sportCode']!='nba' or contest['slateType']!='MULTI_GAME':raise ValueError('Only Yahoo NBA multi-game contests are supported.')
    first=datetime.fromtimestamp(contest['startTime']/1000,UTC)
    if first.astimezone(EASTERN).date().isoformat()!=date:raise ValueError('Contest date does not match requested date.')
    games=[]
    for g in contest['series']['games']:
        away,home=team(g['awayTeam']['abbr']),team(g['homeTeam']['abbr'])
        games.append({'id':g['code'],'away':away,'home':home,'matchup':away+'@'+home,'tipoff':iso(datetime.fromtimestamp(g['startTime']/1000,UTC)),
                      'total':(g.get('odds') or {}).get('overUnder'),'spread':(g.get('odds') or {}).get('homeSpread')})
    by_matchup={g['matchup']:g for g in games}
    reader=csv.DictReader(io.StringIO(csv_text.lstrip('\ufeff')))
    if not {'ID','First Name','Last Name','Position','Salary','Team','Opponent','Game','FPPG','Injury Status'}.issubset(reader.fieldnames or []):raise ValueError('Yahoo salary schema changed.')
    players=[];seen=set()
    for p in reader:
        name=p['First Name']+' '+p['Last Name']; t=team(p['Team']); opponent=team(p['Opponent']); identity=(key(name),t)
        matchup='@'.join(team(x) for x in p['Game'].split('@'))
        salary=int(p['Salary']); position=p['Position']; pid=p['ID']
        if matchup not in by_matchup or {t,opponent}!=set(matchup.split('@')):raise ValueError('Yahoo player matchup does not match the contest schedule.')
        if pid in seen or position not in POSITIONS or not 10<=salary<=200:raise ValueError('Invalid Yahoo player identity, position, or salary.')
        seen.add(pid)
        a,b=sports.get(identity),fuel.get(identity)
        if a and a['matchup']!=matchup:a=None
        if b and b['opponent']!=opponent:b=None
        status=injuries.get(identity,'Not listed') if coverage.get(t)=='submitted' else 'Unknown'
        yahoo_status=p['Injury Status'].strip().upper()
        if yahoo_status in {'O','OUT','INJ'}:status='Out'
        if yahoo_status in {'GTD','Q'} and status not in {'Out','Doubtful'}:status='Questionable'
        if yahoo_status=='D' and status!='Out':status='Doubtful'
        points=(a['points']+b['points'])/2 if a and b else None
        players.append({'id':pid,'name':name,'position':position,'team':t,'opponent':opponent,'game':matchup,'tipoff':by_matchup[matchup]['tipoff'],
                        'salary':salary,'projection':round(points,3) if points is not None else None,
                        'minutes':a['minutes'] if a else None,'sourceCount':int(bool(a))+int(bool(b)),
                        'sources':{'sportsline':round(a['points'],3) if a else None,'fuel':b['points'] if b else None},
                        'starter':identity in starters,'starterStatus':starters.get(identity,'reserve'),
                        'injury':status,'providerClear':bool(b) and b['badge'] not in {'O','OUT','Q','D','GTD','DTD'},
                        'newPlayer':float(p['FPPG'])==0,'historicalAverage':float(p['FPPG'])})
    if len(players)<20:raise ValueError('Yahoo salary pool is incomplete.')
    ready=all(coverage.get(g[k])=='submitted' for g in games for k in ['away','home']) and sum(p['sourceCount']==2 for p in players)>=8
    return {'schemaVersion':1,'id':str(contest['seriesId']),'contestId':str(contest['id']),'contestTitle':contest['title'],
            'date':date,'updatedAt':iso(now),'firstTip':iso(first),'salaryCap':200,'ready':ready,
            'readinessReason':None if ready else 'Some team injury reports or daily projections are not ready.',
            'injuryReportedAt':reported,'model':{'id':'live-consensus-v1','name':'Daily consensus','version':'1.0',
            'description':'Equal weight current SportsLine component stats converted to Yahoo scoring and Daily Fantasy Fuel FanDuel projections. Both platforms use the same NBA scoring. The private research ML model has not been promoted.',
            'validatedProfitability':False},'sources':source_info,'games':games,'players':players}

def refresh(output, date, contest_id=None):
    now=datetime.now(UTC)
    if date!=now.astimezone(EASTERN).date().isoformat():raise ValueError('Live refresh must use today’s Eastern date.')
    config=json.loads((ROOT/'config.json').read_text())
    preferred=contest_id or config['preferred_contests'].get(date)
    lobby=fetch('https://sports.yahoo.com/dailyfantasy/contests/nba').text
    slates=discover(lobby,date,preferred)
    output.mkdir(parents=True,exist_ok=True)
    if not slates:
        catalog={'schemaVersion':1,'date':date,'updatedAt':iso(now),'lastAttemptAt':iso(now),'status':'awaiting','slates':[],
                 'message':'Today’s Yahoo NBA multi-game slates have not been found yet. Automatic checks run every 15 minutes.'}
    else:
        urls={'sportsline':'https://www.sportsline.com/nba/expert-projections/simulation/',
              'fuel':f'https://www.dailyfantasyfuel.com/nba/projections/fanduel/{date}/',
              'starters':'https://www.rotowire.com/basketball/nba-lineups.php'}
        source_errors={}
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures={k:executor.submit(fetch,url) for k,url in urls.items()}
            official=executor.submit(latest_injuries,date,now)
            html={}
            for k,f in futures.items():
                try:html[k]=f.result().text
                except Exception as exc:source_errors[k]=str(exc)
            try:injuries,coverage,reported,injury_url=official.result()
            except Exception as exc:
                injuries,coverage,reported,injury_url={},{},None,'https://official.nba.com/nba-injury-report-2026-27-season/'
                source_errors['injuries']=str(exc)
        sports={};fuel={};starters={};fuel_updated=None
        for name,parser in [('sportsline',lambda h:parse_sportsline(h)),('fuel',lambda h:parse_fuel(h,date)),('starters',lambda h:parse_starters(h,date))]:
            if name not in html:continue
            try:
                parsed=parser(html[name])
                if name=='sportsline':sports=parsed
                elif name=='fuel':fuel,fuel_updated=parsed
                else:starters=parsed
            except Exception as exc:source_errors[name]=str(exc)
        source_info={k:{'url':u,'capturedAt':iso(now)} for k,u in urls.items()}
        source_info['fuel']['updatedAt']=fuel_updated
        source_info['sportsline']['updatedAt']=None
        source_info['injuries']={'url':injury_url,'updatedAt':reported,'capturedAt':iso(now)}
        published=[];pending_files={}
        for i,s in enumerate(slates):
            contest=store(fetch(f'https://sports.yahoo.com/dailyfantasy/contest/{s["contestId"]}').text,'ContestStore')
            if str(contest['seriesId'])!=s['seriesId']:raise ValueError('Preferred contest does not belong to today’s main slate.')
            pool=fetch(f'https://dfyql-ro.sports.yahoo.com/v2/export/contestPlayers?contestId={s["contestId"]}').text
            slate=make_slate(contest,pool,sports,fuel,starters,injuries,coverage,date,now,reported,source_info)
            if source_errors or not starters:
                slate['ready']=False
                slate['readinessReason']='Salaries are available. Waiting for current projections, starting lineups, or official team injury reports.'
            slate['sourceErrors']=source_errors
            filename=f'{date}-{s["seriesId"]}.json'
            pending_files[filename]=json.dumps(slate,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n'
            published.append({**s,'date':date,'label':('Main slate' if i==0 else 'Late slate' if i==len(slates)-1 else 'Evening slate'),
                              'file':filename,'ready':slate['ready'],'playerCount':len(slate['players'])})
            print(f'Published {filename}: {len(slate["players"])} salaries, {sum(p["sourceCount"]==2 for p in slate["players"])} matched forecasts, ready={slate["ready"]}',flush=True)
        catalog={'schemaVersion':1,'date':date,'updatedAt':iso(now),'lastAttemptAt':iso(now),'status':'ready','slates':published,
                 'refreshIntervalMinutes':15,'repository':config['repository']}
        for filename,content in pending_files.items():(output/filename).write_text(content)
    (output/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    return catalog

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date',default=datetime.now(EASTERN).date().isoformat())
    parser.add_argument('--contest-id')
    parser.add_argument('--output',type=Path,default=ROOT/'public/data')
    parser.add_argument('--strict',action='store_true')
    args=parser.parse_args()
    try:
        refresh(args.output,args.date,args.contest_id)
    except Exception as exc:
        print(f'Refresh failed: {exc}',file=sys.stderr)
        path=args.output/'catalog.json'
        existing=json.loads(path.read_text()) if path.exists() else {'schemaVersion':1,'date':args.date,'slates':[]}
        existing.update(lastAttemptAt=iso(datetime.now(UTC)),refreshError=str(exc),status='refresh_failed')
        # Never give old forecasts a new successful-update timestamp.
        args.output.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(existing,indent=2)+'\n')
        if args.strict:return 1
    return 0

if __name__=='__main__':
    raise SystemExit(main())
