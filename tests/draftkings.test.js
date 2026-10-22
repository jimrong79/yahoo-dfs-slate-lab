import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateLineup,validateLineup,assignSlots,playerProblem} from '../src/optimizer.js';
import {eligibleSlots,platformRules} from '../src/platforms.js';
import {draftKingsFixture} from './draftkings-fixture.js';
const now=Date.parse('2026-10-21T17:30:00Z');
test('DraftKings multi-position solution matches exhaustive search',()=>{
  const slate=draftKingsFixture(),result=generateLineup(slate,{},now);let best=-Infinity;
  function choose(start,picks){
    if(picks.length===8){try{validateLineup(assignSlots(picks,'draftkings'),{},'draftkings');best=Math.max(best,picks.reduce((n,p)=>n+p.projection,0));}catch{} return;}
    for(let i=start;i<slate.players.length;i++)choose(i+1,[...picks,slate.players[i]]);
  }
  choose(0,[]);assert.equal(result.projection,best);assert.ok(result.salary<=50000);assert.equal(new Set(result.lineup.map(p=>p.id)).size,8);
  assert.deepEqual(result.lineup.map(p=>p.slot),platformRules('draftkings').slots);
});
test('secondary position can fill a narrow slot without duplicating a player',()=>{
  const slate=draftKingsFixture();slate.players=slate.players.slice(0,8);slate.players[3].position='SG/SF';slate.players[5].position='PF';
  const result=generateLineup(slate,{locked:slate.players.map(p=>p.id)},now);
  assert.equal(result.lineup.find(p=>p.slot==='SF').id,'903');
  assert.equal(validateLineup(result.lineup,{},'draftkings'),true);
  assert.deepEqual(eligibleSlots({position:'PG/SG'},'draftkings'),['PG','G','UTIL','SG']);
});
test('DraftKings locks/exclusions, rookie limit and cap are enforced',()=>{
  const slate=draftKingsFixture(),settings={locked:['900'],excluded:['911'],maxNewPlayers:0};
  const result=generateLineup(slate,settings,now);assert.ok(result.lineup.some(p=>p.id==='900'));assert.ok(result.lineup.every(p=>p.id!=='911'&&!p.newPlayer));
  slate.players[0].salary=45000;assert.throws(()=>generateLineup(slate,settings,now),/No legal lineup/);
});
test('two teams in a single game are insufficient for DraftKings Classic',()=>{
  const slate=draftKingsFixture();slate.players.forEach((p,i)=>{p.game='AAA@BBB';p.team=i%2?'AAA':'BBB';});
  assert.throws(()=>generateLineup(slate,{},now),/two different games/);
});
test('one exceptional game cannot consume all eight slots',()=>{
  const slate=draftKingsFixture();slate.players.forEach((p,i)=>{p.game=i===11?'CCC@DDD':'AAA@BBB';p.team=i===11?'CCC':i%2?'AAA':'BBB';p.projection=i===11?1:100;});
  const result=generateLineup(slate,{},now);assert.ok(result.lineup.some(p=>p.id==='911'));
});
test('DraftKings scoring source and salary scale cannot leak into Yahoo',()=>{
  const slate=draftKingsFixture(),p=slate.players[2];
  assert.equal(playerProblem(p,{},'draftkings'),null);assert.ok(playerProblem(p,{},'yahoo'));
  assert.throws(()=>generateLineup({...slate,salaryCap:200},{},now),/salary cap/);
  assert.throws(()=>generateLineup({...slate,platform:'unknown'},{},now),/Unsupported/);
});
