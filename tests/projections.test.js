import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectProjection,trainedProblem,comparisonTotals} from '../src/projections.js';
import {generateLineup,slateProblem,playerProblem} from '../src/optimizer.js';
import {modelFixture} from './model-fixture.js';

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
