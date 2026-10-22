import {readFileSync} from 'node:fs';
import {draftKingsFixture} from '../draftkings-fixture.js';

// Historical Yahoo observations plus explicitly synthetic DK inputs. Route
// interception keeps these test records out of production data and deployments.
export const yahoo=JSON.parse(readFileSync('public/data/2026-10-21-26039.json','utf8'));
const evening=JSON.parse(readFileSync('public/data/2026-10-21-26040.json','utf8'));
export const dk={...draftKingsFixture(),updatedAt:yahoo.updatedAt,injuryReportedAt:yahoo.injuryReportedAt};
const snapshots=[yahoo,evening,dk];
export const catalog={schemaVersion:1,date:yahoo.date,updatedAt:yahoo.updatedAt,status:'ready',slates:snapshots.map((s,i)=>({seriesId:s.id,platform:s.platform||'yahoo',date:s.date,firstTip:s.firstTip,gameCount:s.games.length,label:i===1?'Evening slate':'Main slate',file:`${s.date}-${s.id}.json`,ready:true}))};
export async function installFixtures(page){
  await page.clock.setFixedTime(new Date(Date.parse(catalog.updatedAt)+30000));
  await page.route('**/data/*.json*',async route=>{
    const filename=new URL(route.request().url()).pathname.split('/').at(-1);
    const data=filename==='catalog.json'?catalog:snapshots.find(s=>`${s.date}-${s.id}.json`===filename);
    if(data)await route.fulfill({json:data});else await route.continue();
  });
}
