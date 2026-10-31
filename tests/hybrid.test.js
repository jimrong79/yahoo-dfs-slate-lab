import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hybridSportsline,hybridExplanation} from '../src/hybrid.js';
import {selectProjection,lineupBettingProblem} from '../src/projections.js';
import {generateLineup,playerProblem} from '../src/optimizer.js';
import {draftKingsFixture} from './draftkings-fixture.js';
const yahoo=JSON.parse(readFileSync('public/data/2026-10-21-26039.json','utf8'));
function player(platform='yahoo') {
  const p={game:'AAA@BBB',tipoff:'2026-10-21T23:00:00Z',sources:{sportsline:40,fuel:50}};
  p.sportslineComponents={method:'provider-components-v1',platform,game:p.game,tipoff:p.tipoff,updatedAt:'2026-10-21T17:00:00Z',total:40,
    values:platform==='yahoo'?{points:20,rebounds:6,assists:12,steals:3,blocks:3,turnovers:-4}:{points:20,rebounds:6.25,assists:9,steals:2,blocks:2,turnovers:-1,dk_extras:1.75}};
  p.bettingComponents={method:'prop-components-v1',platform,game:p.game,tipoff:p.tipoff,values:{points:{points:25,updatedAt:'2026-10-21T17:00:00Z'}}};
  return p;
}
const now=Date.parse('2026-10-21T17:30:00Z');
test('partial betting replaces categories while retaining negative turnovers and all missing provider categories',()=>{
  for(const platform of ['yahoo','draftkings']){
    const p=player(platform),d=hybridSportsline(p,platform,now);
    assert.equal(d.points,45);assert.deepEqual(d.used,['points']);assert.ok(d.provider.includes('turnovers'));
    if(platform==='draftkings')assert.ok(d.provider.includes('dk_extras'));
  }
});
test('null, absent, NaN and signed-invalid components are never zero; genuine zero is usable',()=>{
  for(const value of [null,undefined,NaN,'0',false,-1]){
    const p=player();p.bettingComponents.values.points.points=value;
    assert.equal(hybridSportsline(p,'yahoo',now).points,null);
  }
  const p=player();p.bettingComponents.values.points.points=0;
  assert.equal(hybridSportsline(p,'yahoo',now).points,20);
  p.bettingComponents.values.turnovers={points:0,updatedAt:p.sportslineComponents.updatedAt};
  assert.equal(hybridSportsline(p,'yahoo',now).points,24);
  p.sportslineComponents.values.turnovers=null;
  assert.equal(hybridSportsline(p,'yahoo',now).points,null);
});
test('DK extras replace a combined provider contribution without double counting threes or bonuses',()=>{
  const p=player('draftkings');
  p.bettingComponents.values.dk_extras={points:2.25,updatedAt:p.sportslineComponents.updatedAt,
    bonusProbabilityMethods:{double_double:['yes_only_implied'],triple_double:['devigged']}};
  const d=hybridSportsline(p,'draftkings',now);
  assert.equal(d.points,45.5);assert.equal(d.yesOnly,true);
  assert.match(hybridExplanation({...p,hybridDetails:d,hybridSources:['hybrid','fuel']}),/Yes-only/);
  assert.match(hybridExplanation({...p,hybridDetails:d,hybridSources:['hybrid','fuel']}),/not counted again/);
});
test('mismatched, unreconciled, incomplete, and stale baselines cannot create hybrid forecasts',()=>{
  for(const patch of [{method:'unknown'},{game:'WRONG'},{platform:'draftkings'},{tipoff:'WRONG'},{updatedAt:'2020-01-01T00:00:00Z'},{updatedAt:'2099-01-01T00:00:00Z'},{total:41},{values:{points:40}}]){
    const p=player();Object.assign(p.sportslineComponents,patch);assert.equal(hybridSportsline(p,'yahoo',now).points,null);
  }
  for(const patch of [{method:'unknown'},{game:'WRONG'},{platform:'draftkings'},{tipoff:'WRONG'}]){
    const p=player();Object.assign(p.bettingComponents,patch);assert.equal(hybridSportsline(p,'yahoo',now).points,null);
  }
});
test('each quote expires independently and falls back to its own provider category',()=>{
  const p=player();p.bettingComponents.values.points.updatedAt='2026-10-21T15:00:00Z';
  p.bettingComponents.values.rebounds={points:10,updatedAt:'2026-10-21T17:00:00Z'};
  const d=hybridSportsline(p,'yahoo',now);
  assert.equal(d.points,44);assert.deepEqual(d.used,['rebounds']);assert.ok(d.provider.includes('points'));
});
test('hybrid replaces SportsLine in a two-input blend and never becomes a third copy',()=>{
  for(const platform of ['yahoo','draftkings']){
    const base={platform,date:'2026-10-21',players:[player(platform)]};
    let p=selectProjection(base,null,'hybrid',now).players[0];
    assert.equal(p.projection,47.5);assert.deepEqual(p.hybridSources,['hybrid','fuel']);
    base.players[0].sources.fuel=null;
    assert.equal(selectProjection(base,null,'hybrid',now).players[0].projection,45);
    delete base.players[0].bettingComponents;
    assert.equal(selectProjection(base,null,'hybrid',now).players[0].projection,40);
    base.players[0].sources={sportsline:null,fuel:0};
    assert.equal(selectProjection(base,null,'hybrid',now).players[0].projection,0);
    base.players[0].sources.fuel=null;
    assert.equal(selectProjection(base,null,'hybrid',now).players[0].projection,null);
  }
});
test('legal Yahoo and DK lineups retain filters, reevaluate expired components, and leave existing modes unchanged',()=>{
  for(const fixture of [yahoo,draftKingsFixture()]){
    const base=structuredClone(fixture),platform=base.platform||'yahoo',time=Date.parse(base.updatedAt)+30000;
    for(const p of base.players){
      if(!Number.isFinite(p.sources.sportsline))p.sources.sportsline=p.sources.fuel;
      const total=p.sources.sportsline;
      if(!Number.isFinite(total))continue;
      p.sportslineComponents={method:'provider-components-v1',platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,total,
        values:{points:total,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0,...(platform==='draftkings'?{dk_extras:0}:{})}};
      p.bettingComponents={method:'prop-components-v1',platform,game:p.game,tipoff:p.tipoff,values:{points:{points:total+2,updatedAt:new Date(time-119*60000).toISOString()}}};
    }
    const without=structuredClone(base);without.players.forEach(p=>{delete p.bettingComponents;delete p.sportslineComponents;});
    for(const method of ['consensus','combined','trained','provider'])assert.deepEqual(selectProjection(base,null,method,time).players.map(p=>p.projection),selectProjection(without,null,method,time).players.map(p=>p.projection));
    const selected=selectProjection(base,null,'hybrid',time),result=generateLineup(selected,{},time);
    assert.equal(result.lineup.length,8);assert.ok(result.salary<=base.salaryCap);
    assert.ok(result.lineup.every(p=>p.hybridSources.includes('hybrid')));
    assert.match(playerProblem({...result.lineup[0],injury:'Out'},{},platform),/Out/);
    assert.ok(playerProblem({...result.lineup[0],providerFlagsClear:false},{},platform));
    assert.equal(lineupBettingProblem(selected,result.lineup,time),null);
    assert.match(lineupBettingProblem(selected,result.lineup,time+2*60000),/expired/);
    const next=generateLineup(selected,{},time+2*60000);
    assert.ok(next.lineup.every(p=>!p.hybridDetails.used.length));
  }
});
