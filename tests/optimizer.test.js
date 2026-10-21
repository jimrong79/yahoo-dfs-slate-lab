import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLineup, validateLineup, slateProblem, playerProblem, assignSlots } from '../src/optimizer.js';

const now = Date.parse('2026-10-21T17:30:00Z');
function fixture() {
  const positions = ['PG','SG','SG','SF','PF','PF','C','C','PG','SF','PF','C'];
  return { date:'2026-10-21', updatedAt:'2026-10-21T17:20:00Z', firstTip:'2026-10-21T23:00:00Z', injuryReportedAt:'2026-10-21T17:15:00Z', ready:true,
    players:positions.map((position,i) => ({ id:String(i),name:`Player ${i}`,position,team:['AAA','BBB','CCC','DDD'][i % 4],salary:15 + i,projection:24 + i * 2,minutes:30,starter:true,sourceCount:2,providerClear:true,injury:'Not listed',newPlayer:i===10,tipoff:`2026-10-${i%2 ? '22T02' : '21T23'}:00:00Z` })) };
}

test('MILP agrees with exhaustive search and creates valid Yahoo slots', () => {
  const slate = fixture(), result = generateLineup(slate, {}, now);
  let best = -Infinity;
  function choose(start, picks) {
    if (picks.length === 8) {
      try { const lineup = assignSlots(picks); validateLineup(lineup); best = Math.max(best, picks.reduce((n,p)=>n+p.projection,0)); } catch {}
      return;
    }
    for (let i=start;i<slate.players.length;i++) choose(i+1,[...picks,slate.players[i]]);
  }
  choose(0,[]);
  assert.equal(result.projection,best); assert.ok(result.salary<=200); assert.equal(validateLineup(result.lineup),true);
});
test('locks, exclusions and new-player cap are honored together', () => {
  const settings = {locked:['0'],excluded:['11'],maxNewPlayers:0};
  const result = generateLineup(fixture(),settings,now);
  assert.ok(result.lineup.some(p=>p.id==='0'));
  assert.ok(result.lineup.every(p=>p.id!=='11' && !p.newPlayer));
  assert.equal(validateLineup(result.lineup,settings),true);
});
test('unaffordable locked players fail without returning a partial lineup', () => {
  const slate=fixture();slate.players[0].salary=100;slate.players[1].salary=100;
  assert.throws(()=>generateLineup(slate,{locked:['0','1']},now),/No legal lineup/);
});
test('three teams are enforced even when two teams dominate forecasts', () => {
  const slate=fixture(); slate.players.forEach((p,i)=>{p.team=i===11?'CCC':i%2?'AAA':'BBB';p.projection=i===11?1:100;});
  const result=generateLineup(slate,{},now);
  assert.equal(new Set(result.lineup.map(p=>p.team)).size,3);
  assert.ok(result.lineup.some(p=>p.id==='11'));
});
test('stale, archived, started, future or invalid timestamps block generation', () => {
  for (const change of [{updatedAt:'2026-10-21T14:00:00Z'},{date:'2026-10-20'},{firstTip:'2026-10-21T16:00:00Z'},{updatedAt:'2026-10-21T19:00:00Z'},{firstTip:'bad'},{injuryReportedAt:'2026-10-21T14:00:00Z'},{injuryReportedAt:'2026-10-21T20:00:00Z'},{ready:false}]) {
    assert.ok(slateProblem({...fixture(),...change},now));
    assert.throws(()=>generateLineup({...fixture(),...change},{},now));
  }
});
test('unresolved injuries, missing data and low minutes cannot silently enter', () => {
  const player=fixture().players[0];
  for (const change of [{injury:'Out'},{injury:'Questionable'},{injury:'Unknown'},{injury:'typo'},{projection:null},{sourceCount:1},{providerClear:false},{minutes:null},{minutes:23},{starter:false}]) assert.ok(playerProblem({...player,...change}));
  assert.equal(playerProblem({...player,starter:false,minutes:20},{startersOnly:false,minMinutes:20}),null);
  assert.throws(()=>generateLineup(fixture(),{locked:['0'],excluded:['0']},now),/both locked and excluded/);
});
test('duplicate identities and invalid settings fail before solving', () => {
  const slate=fixture(); slate.players[1].id='0';
  assert.throws(()=>generateLineup(slate,{},now),/Duplicate/);
  assert.throws(()=>generateLineup(fixture(),{maxNewPlayers:-1},now),/Invalid build settings/);
});
