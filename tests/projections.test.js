import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectProjection,trainedProblem,comparisonTotals,lineupModelProblem} from '../src/projections.js';
import {generateLineup,slateProblem,playerProblem} from '../src/optimizer.js';
import {modelFixture,combinedFixture} from './model-fixture.js';

const slate=JSON.parse(readFileSync('public/data/2026-10-21-26039.json','utf8'));
const now=Date.parse(slate.updatedAt)+30000;
test('consensus remains exactly the default; trained model changes the optimizer objective',()=>{
  const model=modelFixture(slate);
  const consensus=selectProjection(slate,model,undefined,now);
  assert.deepEqual(consensus.players.map(p=>p.projection),slate.players.map(p=>p.projection));
  const old=generateLineup(slate,{},now), normal=generateLineup(consensus,{},now);
  assert.equal(old.projection,normal.projection);
  const selected=selectProjection(slate,model,'trained',now);
  const result=generateLineup(selected,{},now);
  assert.equal(result.lineup.length,8);
  assert.ok(result.salary<=200);
  assert.ok(result.lineup.every(p=>p.projection===p.modelProjection));
  assert.equal(comparisonTotals(result.lineup).trained,result.projection);
  assert.notDeepEqual(result.lineup.map(p=>p.id).sort(),normal.lineup.map(p=>p.id).sort());
});
test('missing and expired model snapshots block only the model, never replace it with consensus',()=>{
  assert.equal(slateProblem(selectProjection(slate,null,'consensus',now),now),null);
  assert.match(slateProblem(selectProjection(slate,null,'trained',now),now),/No trained-model/);
  const future=now+121*60000;
  const fresh={...slate,updatedAt:new Date(future).toISOString(),injuryReportedAt:new Date(future).toISOString()};
  assert.match(slateProblem(selectProjection(fresh,modelFixture(slate),'trained',future),future),/model inputs are over two/);
  assert.equal(slateProblem(selectProjection(fresh,modelFixture(slate),'consensus',future),future),null);
});
test('news changes invalidate both teams in the matchup, with no per-player fallback',()=>{
  const model=modelFixture(slate), changed=structuredClone(slate), player=changed.players[0];
  player.starter=!player.starter;
  const selected=selectProjection(changed,model,'trained',now);
  const affected=selected.players.filter(p=>[player.team,player.opponent].includes(p.team));
  assert.ok(affected.every(p=>p.projection===null && !p.modelAvailable));
  assert.ok(selected.players.some(p=>p.modelAvailable));
  assert.match(playerProblem(affected[0]),/matching trained-model/);
});
test('model identity, dates, duplicate records and wrong platform fail closed',()=>{
  const model=modelFixture(slate);
  for (const patch of [{date:'2026-10-22'},{trainedThrough:slate.date},{inputsAt:'invalid'},
    {players:[...model.players,model.players[0]]},{players:[null]}]) {
    assert.ok(trainedProblem(slate,{...model,...patch},now));
  }
  const wrong=structuredClone(model);wrong.players[0].team='WRONG';
  assert.equal(selectProjection(slate,wrong,'trained',now).players[0].projection,null);
  assert.match(trainedProblem({...slate,platform:'draftkings'},model,now),/Yahoo only/);
});
test('missing comparison values do not masquerade as zero totals',()=>{
  assert.deepEqual(comparisonTotals([{consensusProjection:20,modelProjection:null}]),{consensus:20,trained:null});
});

const fallbackIds=generateLineup(slate,{},now).lineup.slice(0,3).map(p=>p.id);
test('Combined uses both, sole provider, then model, and preserves original consensus',()=>{
  const {slate:base,model}=combinedFixture(slate,fallbackIds);
  const selected=selectProjection(base,model,'combined',now);
  const rows=fallbackIds.map(id=>selected.players.find(p=>p.id===id));
  assert.deepEqual(rows.map(p=>p.projectionSource),['sportsline','fuel','model']);
  assert.deepEqual(rows.map(p=>p.minutesSource),['sportsline','model','model']);
  assert.ok(rows.every(p=>playerProblem(p)===null));
  assert.ok(rows.every(p=>p.consensusProjection===null));
  const both=selected.players.find(p=>p.sourceCount===2);
  assert.equal(both.projection,both.consensusProjection);
  assert.equal(both.projectionSource,'consensus');
  const result=generateLineup(selected,{locked:fallbackIds},now);
  assert.ok(fallbackIds.every(id=>result.lineup.some(p=>p.id===id)));
  assert.equal(result.lineup.length,8);assert.ok(result.salary<=200);
  assert.equal(comparisonTotals(result.lineup).consensus,null);
  assert.equal(lineupModelProblem(selected,result.lineup,now),null);
  assert.ok(selectProjection(base,model,'consensus',now).players.filter(p=>fallbackIds.includes(p.id)).every(p=>p.projection===null));
});
test('Combined never replaces a valid zero forecast with the model',()=>{
  const {slate:base,model}=combinedFixture(slate,fallbackIds);
  const row=base.players.find(p=>p.id===fallbackIds[0]);row.sources.sportsline=0;
  const selected=selectProjection(base,model,'combined',now).players.find(p=>p.id===row.id);
  assert.equal(selected.projection,0);assert.equal(selected.projectionSource,'sportsline');
  assert.ok(playerProblem(selected));
});
test('Combined keeps providers usable without ML but never invents missing minutes',()=>{
  const {slate:base}=combinedFixture(slate,fallbackIds);
  const selected=selectProjection(base,null,'combined',now);
  const rows=fallbackIds.map(id=>selected.players.find(p=>p.id===id));
  assert.equal(playerProblem(rows[0]),null);
  assert.equal(rows[1].projectionSource,'fuel');
  assert.match(playerProblem(rows[1],{minMinutes:0}),/Awaiting projected minutes/);
  assert.equal(rows[2].projection,null);assert.ok(playerProblem(rows[2]));
  assert.equal(slateProblem(selected,now),null);
});
test('Combined excludes stale models at build time and invalidates lineups that used model minutes',()=>{
  const {slate:base,model}=combinedFixture(slate,fallbackIds);
  const selected=selectProjection(base,model,'combined',now);
  const rows=fallbackIds.map(id=>selected.players.find(p=>p.id===id));
  const later=now+121*60000;
  assert.match(lineupModelProblem(selected,[rows[1]],later),/over two hours/);
  assert.equal(lineupModelProblem(selected,[rows[0]],later),null);
  const fresh={...selected,updatedAt:new Date(later).toISOString(),injuryReportedAt:new Date(later).toISOString()};
  assert.throws(()=>generateLineup(fresh,{locked:[rows[2].id]},later),/matching trained-model/);
  const refreshed=selectProjection(fresh,model,'combined',later);
  assert.equal(refreshed.players.find(p=>p.id===rows[1].id).projection,rows[1].projection);
  assert.equal(refreshed.players.find(p=>p.id===rows[1].id).minutes,null);
});
test('Combined can build during a projection outage but not with missing injury or starter reports',()=>{
  const base=structuredClone(slate);base.ready=false;base.combinedReady=true;
  base.players.forEach(p=>{p.sources={sportsline:null,fuel:null};p.sourceCount=0;p.projection=null;p.minutes=null;p.providerFlagsClear=p.providerClear;});
  const model=modelFixture(base);
  model.players.forEach((p,i)=>{p.points=slate.players[i].projection??0;p.minutes=slate.players[i].minutes??0;});
  const selected=selectProjection(base,model,'combined',now);
  assert.equal(slateProblem(selected,now),null);
  assert.equal(generateLineup(selected,{},now).lineup.length,8);
  const blocked=selectProjection({...base,combinedReady:false,combinedReadinessReason:'Official team injury reports pending'},model,'combined',now);
  assert.match(slateProblem(blocked,now),/injury reports pending/);
  for (const injury of ['Out','Questionable','Unknown']) assert.ok(playerProblem({...selected.players.find(p=>!playerProblem(p)),injury}));
  assert.match(playerProblem({...selected.players.find(p=>!playerProblem(p)),providerFlagsClear:false}),/injury flag/);
});
test('Combined rejects model points and minutes when matchup news changes; DraftKings stays native',()=>{
  const {slate:base,model}=combinedFixture(slate,fallbackIds);
  const player=base.players.find(p=>p.id===fallbackIds[2]);player.starter=!player.starter;
  const selected=selectProjection(base,model,'combined',now).players.find(p=>p.id===player.id);
  assert.equal(selected.projection,null);assert.equal(selected.minutes,null);
  const dk={...slate,platform:'draftkings'};
  assert.deepEqual(selectProjection(dk,model,'combined',now).players,dk.players);
});
