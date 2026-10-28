import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReport,selectRows,totals,dailySeries,weeklySeries,monday,shiftDate} from '../src/results-data.js';
import {readFileSync} from 'node:fs';

const group=(date,platform,feesCents,payoutsCents,entries=1,cashed=Number(payoutsCents>0))=>({date,platform,contestType:'Tournament',feesCents,payoutsCents,entries,cashed,ticketCents:0});
const fixture=()=>({schemaVersion:1,currency:'USD',seasonStart:'2026-10-20',through:'2026-10-27',updatedAt:'2026-10-28T12:00:00Z',coverage:[{platform:'yahoo',firstDate:'2026-10-20',lastDate:'2026-10-27',importedAt:'2026-10-28T12:00:00Z'},{platform:'draftkings',firstDate:'2026-10-26',lastDate:'2026-10-26',importedAt:'2026-10-28T12:00:00Z'}],daily:[group('2026-10-20','yahoo',100,0),group('2026-10-21','yahoo',200,600),group('2026-10-26','draftkings',1000,0),group('2026-10-27','yahoo',100,150)]});

test('ROI uses total money at risk, not the mean of entry ROIs',()=>{
  const t=totals([group('2026-10-26','yahoo',100,200),group('2026-10-26','draftkings',1000,0)]);
  assert.equal(t.netCents,-900);assert.equal(t.roi,-900/1100);assert.equal(t.cashRate,.5);
  assert.equal(totals([]).roi,null);assert.equal(totals([]).cashRate,null);
});
test('last seven reported days are inclusive and distinct from season and calendar weeks',()=>{
  const r=validateReport(fixture());
  assert.equal(selectRows(r).length,3);
  assert.equal(selectRows(r,{period:'season'}).length,4);
  assert.equal(selectRows(r,{period:'2026-10-19'}).length,2);
  assert.equal(selectRows(r,{platform:'draftkings'}).length,1);
  assert.equal(monday('2026-10-25'),'2026-10-19');assert.equal(monday('2026-10-26'),'2026-10-26');
  assert.equal(shiftDate('2027-01-01',-1),'2026-12-31');
});
test('daily graph sums each date once, resets per selection, and preserves absent platforms',()=>{
  const r=fixture();r.daily.push(group('2026-10-26','yahoo',100,300));
  const days=dailySeries(selectRows(r));
  assert.equal(days.length,3);assert.deepEqual(days.map(d=>d.cumulativeCents),[400,-400,-350]);
  assert.deepEqual(days[2].platforms,['yahoo']);
  assert.equal(dailySeries(selectRows(r,{platform:'draftkings'}))[0].cumulativeCents,-1000);
  assert.equal(weeklySeries(r)[0].netCents,-750);
});
test('malformed or inconsistent reports fail instead of showing misleading totals',()=>{
  for(const mutate of [r=>r.daily[0].entries=-1,r=>r.daily[0].cashed=4,r=>r.daily[0].feesCents=.5,r=>r.daily.push(r.daily[0]),r=>r.coverage[0].lastDate='2026-10-26',r=>r.daily[0].date='2026-02-30',r=>r.daily[0].platform='__proto__']){
    const r=fixture();mutate(r);assert.throws(()=>validateReport(r));
  }
});
test('published aggregates reconcile across days, weeks and platforms',()=>{
  const report=validateReport(JSON.parse(readFileSync(new URL('../public/data/results.json',import.meta.url),'utf8')));
  const all=totals(report.daily);
  assert.equal(dailySeries(report.daily).at(-1).cumulativeCents,all.netCents);
  assert.equal(weeklySeries(report).reduce((s,w)=>s+w.netCents,0),all.netCents);
  assert.equal(['yahoo','draftkings'].reduce((s,p)=>s+totals(selectRows(report,{period:'season',platform:p})).netCents,0),all.netCents);
});
