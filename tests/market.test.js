import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectProjection,lineupBettingProblem,playerSourceLabel} from '../src/projections.js';
import {generateLineup,playerProblem,slateProblem} from '../src/optimizer.js';
import {modelFixture} from './model-fixture.js';
import {draftKingsFixture} from './draftkings-fixture.js';
import {hybridExplanation} from '../src/hybrid.js';
const yahoo=JSON.parse(readFileSync('public/data/2026-10-21-26039.json','utf8'));
function addBetting(base){
  base=structuredClone(base);
  for(const p of base.players){
    p.sources.betting=30;
    p.betting={points:30,platform:base.platform||'yahoo',game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,method:'prop-lines-v2',complete:true};
  }
  return base;
}
test('all eight availability combinations use equal weights and never substitute model points',()=>{
  for(const fixture of [yahoo,draftKingsFixture()])for(let mask=0;mask<8;mask++){
    const base=addBetting(fixture),now=Date.parse(base.updatedAt)+30000;
    const p=base.players[0];
    p.sources={sportsline:mask&1?10:null,fuel:mask&2?20:null,betting:mask&4?30:null};
    const selected=selectProjection(base,modelFixture(base),'market',now).players[0];
    const values=Object.values(p.sources).filter(v=>v!==null);
    assert.equal(selected.projection,values.length?values.reduce((a,b)=>a+b,0)/values.length:null);
    assert.equal(selected.blendSources.length,values.length);
    assert.equal(selected.projectionSource,values.length?'market':'unavailable');
    if(!mask) assert.ok(playerProblem(selected));
  }
});
test('valid zero counts as a source; NaN, negatives, and incomplete betting estimates do not',()=>{
  const base=addBetting(yahoo),now=Date.parse(base.updatedAt)+30000,p=base.players[0];
  p.sources={sportsline:0,fuel:30,betting:30};
  let selected=selectProjection(base,null,'market',now).players[0];
  assert.equal(selected.projection,20);assert.equal(selected.blendSources.length,3);
  p.sources.sportsline=NaN;p.sources.fuel=-1;p.betting.complete=false;
  assert.equal(selectProjection(base,null,'market',now).players[0].projection,null);
});
test('expired, mismatched, or future betting data is excluded while the remaining providers work',()=>{
  for(const patch of [{updatedAt:'invalid'},{updatedAt:'2020-01-01T00:00:00Z'},{updatedAt:'2099-01-01T00:00:00Z'},{platform:'draftkings'},{game:'WRONG'},{tipoff:'wrong'},{points:999},{method:'devig-poisson-v1'},{complete:false},{points:null}]){
    const base=addBetting(yahoo),now=Date.parse(base.updatedAt)+30000,p=base.players[0];
    p.betting={...p.betting,...patch};
    const selected=selectProjection(base,null,'market',now).players[0];
    assert.deepEqual(selected.blendSources,['sportsline','fuel']);
    assert.equal(selected.projection,Math.round((p.sources.sportsline+p.sources.fuel)/2*1000)/1000);
  }
});
test('missing betting totals do not dilute the provider average with false zeroes',()=>{
  const base=addBetting(yahoo),now=Date.parse(base.updatedAt)+30000,p=base.players[0];
  p.sources={sportsline:40,fuel:50,betting:null};delete p.betting;
  const selected=selectProjection(base,null,'market',now).players[0];
  assert.equal(selected.projection,45);assert.equal(selected.bettingProjection,null);
  assert.deepEqual(selected.blendSources,['sportsline','fuel']);
  p.sources={sportsline:null,fuel:null,betting:0};
  p.betting={points:0,platform:'yahoo',game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,method:'prop-lines-v2',complete:true};
  assert.equal(selectProjection(base,null,'market',now).players[0].projection,0);
});
test('3-source blend generates legal Yahoo and DK lineups, preserving other modes and filters',()=>{
  for(const fixture of [yahoo,draftKingsFixture()]){
    const base=addBetting(fixture),now=Date.parse(base.updatedAt)+30000;
    const before=selectProjection(fixture,null,undefined,now);
    const after=selectProjection(base,null,undefined,now);
    assert.deepEqual(after.players.map(p=>p.projection),before.players.map(p=>p.projection));
    const selected=selectProjection(base,null,'market',now), result=generateLineup(selected,{},now);
    assert.equal(result.lineup.length,8);assert.ok(result.salary<=base.salaryCap);
    assert.ok(result.lineup.every(p=>p.blendSources.includes('betting')));
    assert.ok(new Set(result.lineup.map(p=>p.game)).size>=2);
    const healthy=result.lineup[0];
    for(const injury of ['Out','Questionable','Unknown'])assert.ok(playerProblem({...healthy,injury},{},base.platform));
    assert.ok(playerProblem({...healthy,providerFlagsClear:false},{},base.platform));
    assert.ok(slateProblem({...selected,ready:false},now));
    assert.match(playerSourceLabel(healthy),/Betting/);
  }
});
test('3-source blend can use fresh model minutes but missing minutes still exclude the player',()=>{
  const base=addBetting(yahoo),now=Date.parse(base.updatedAt)+30000,model=modelFixture(base);
  const p=base.players.find(p=>!playerProblem(p));p.minutes=null;
  let selected=selectProjection(base,model,'market',now).players.find(x=>x.id===p.id);
  assert.equal(selected.minutesSource,'model');assert.equal(playerProblem(selected),null);
  selected=selectProjection(base,null,'market',now).players.find(x=>x.id===p.id);
  assert.match(playerProblem(selected,{minMinutes:0}),/projected minutes/);
});
test('quote expiry invalidates an old lineup and is reevaluated at generation time',()=>{
  const base=addBetting(yahoo),now=Date.parse(base.updatedAt)+30000;
  base.players.forEach(p=>{p.betting.updatedAt=new Date(now-119*60000).toISOString();});
  const selected=selectProjection(base,null,'market',now),result=generateLineup(selected,{},now),later=now+2*60000;
  assert.equal(lineupBettingProblem(selected,result.lineup,now),null);
  assert.match(lineupBettingProblem(selected,result.lineup,later),/expired/);
  const rebuilt=generateLineup(selected,{},later);
  assert.ok(rebuilt.lineup.every(p=>!p.blendSources.includes('betting')));
});

function addPartialBetting(fixture) {
  const base=structuredClone(fixture),platform=base.platform||'yahoo';
  for(const p of base.players){
    p.sources={sportsline:40,fuel:50,betting:null};delete p.betting;
    p.sportslineComponents={method:'provider-components-v1',platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,total:40,
      values:{points:20,rebounds:6,assists:12,steals:3,blocks:3,turnovers:-4,...(platform==='draftkings'?{dk_extras:0}:{})}};
    p.bettingComponents={method:'prop-components-v1',platform,game:p.game,tipoff:p.tipoff,values:{points:{points:28,updatedAt:base.updatedAt}}};
  }
  return base;
}
test('provider-filled betting is a third equal input, preserving Combined, 50/50, and the separate hybrid recipe',()=>{
  for(const fixture of [yahoo,draftKingsFixture()]){
    const base=addPartialBetting(fixture),now=Date.parse(base.updatedAt)+30000;
    const p=selectProjection(base,null,'market',now).players[0];
    assert.equal(p.marketBettingProjection,48);assert.equal(p.bettingProjection,null);
    assert.equal(p.projection,46);assert.deepEqual(p.blendSources,['sportsline','fuel','betting_filled']);
    assert.equal(playerSourceLabel(p),'SportsLine + Fuel + Betting (provider-filled)');
    assert.match(hybridExplanation(p),/original SportsLine and Fuel/);
    assert.match(hybridExplanation(p),/not three independent/);
    assert.match(hybridExplanation(p),/SportsLine retained: REB, AST, STL, BLK, TO/);
    assert.equal(selectProjection(base,null,'hybrid',now).players[0].projection,49);
    const without=structuredClone(base);without.players.forEach(p=>delete p.bettingComponents);
    for(const method of ['combined','consensus','provider','trained'])assert.deepEqual(
      selectProjection(base,null,method,now).players.map(p=>p.projection),selectProjection(without,null,method,now).players.map(p=>p.projection));
  }
});
test('complete betting takes precedence over filled estimates, including a real zero',()=>{
  for(const points of [0,30]){
    const base=addBetting(addPartialBetting(yahoo)),now=Date.parse(base.updatedAt)+30000;
    base.players[0].sources.betting=base.players[0].betting.points=points;
    const p=selectProjection(base,null,'market',now).players[0];
    assert.equal(p.marketBettingProjection,points);assert.equal(p.marketBettingSource,'betting');
    assert.equal(p.projection,(40+50+points)/3);
    assert.deepEqual(p.blendSources,['sportsline','fuel','betting']);
  }
});
test('filled estimates require actual betting and matching provider data; missing categories never become zero',()=>{
  const base=addPartialBetting(yahoo),now=Date.parse(base.updatedAt)+30000,p=base.players[0];
  p.sources.fuel=null;
  assert.equal(selectProjection(base,null,'market',now).players[0].projection,44);
  p.sources.fuel=50;
  for(const invalid of [null,undefined,false,'0',NaN]){
    p.bettingComponents.values.points.points=invalid;
    const selected=selectProjection(base,null,'market',now).players[0];
    assert.equal(selected.projection,45);assert.equal(selected.marketBettingProjection,null);
    assert.deepEqual(selected.blendSources,['sportsline','fuel']);
  }
  p.bettingComponents.values.points.points=0;
  assert.equal(selectProjection(base,null,'market',now).players[0].marketBettingProjection,20);
  p.bettingComponents.values={points:{points:0,updatedAt:base.updatedAt},turnovers:{points:-24,updatedAt:base.updatedAt}};
  assert.equal(selectProjection(base,null,'market',now).players[0].marketBettingProjection,0);
  assert.equal(selectProjection(base,null,'market',now).players[0].projection,30);
  p.sources.sportsline=null;
  const selected=selectProjection(base,null,'market',now).players[0];
  assert.equal(selected.projection,50);assert.deepEqual(selected.blendSources,['fuel']);
});
test('filled betting generates legal lineups and expires by individual contribution at rebuild time',()=>{
  for(const fixture of [yahoo,draftKingsFixture()]){
    const base=addPartialBetting(fixture),now=Date.parse(base.updatedAt)+30000,later=now+2*60000;
    base.players.forEach(p=>{
      p.bettingComponents.values.points.updatedAt=new Date(now-119*60000).toISOString();
      p.bettingComponents.values.rebounds={points:9,updatedAt:base.updatedAt};
    });
    const selected=selectProjection(base,null,'market',now),result=generateLineup(selected,{},now);
    assert.equal(result.lineup.length,8);assert.ok(result.salary<=base.salaryCap);
    assert.ok(new Set(result.lineup.map(p=>p.game)).size>=2);
    assert.ok(result.lineup.every(p=>p.marketBettingProjection===51));
    assert.equal(lineupBettingProblem(selected,result.lineup,now),null);
    assert.match(lineupBettingProblem(selected,result.lineup,later),/expired/);
    const rebuilt=generateLineup(selected,{},later);
    assert.ok(rebuilt.lineup.every(p=>p.marketBettingProjection===43));
    assert.ok(rebuilt.lineup.every(p=>p.blendSources.includes('betting_filled')));
    base.players.forEach(p=>{p.bettingComponents.values={};});
    const fallback=generateLineup(selectProjection(base,null,'market',later),{},later);
    assert.ok(fallback.lineup.every(p=>p.projection===45 && p.blendSources.length===2));
  }
});
