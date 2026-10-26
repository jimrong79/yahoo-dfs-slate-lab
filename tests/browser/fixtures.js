import {readFileSync} from 'node:fs';
import {draftKingsFixture} from '../draftkings-fixture.js';
import {generateLineup} from '../../src/optimizer.js';
import {selectProjection} from '../../src/projections.js';
import {API_ORIGIN} from '../../src/auth.js';

// Historical Yahoo observations plus explicitly synthetic DK inputs. Route
// interception keeps these test records out of production data and deployments.
export const yahoo=JSON.parse(readFileSync('public/data/2026-10-21-26039.json','utf8'));
const evening=JSON.parse(readFileSync('public/data/2026-10-21-26040.json','utf8'));
export const dk={...draftKingsFixture(),updatedAt:yahoo.updatedAt,injuryReportedAt:yahoo.injuryReportedAt};
const snapshots=[yahoo,evening,dk];
export const catalog={schemaVersion:1,date:yahoo.date,updatedAt:yahoo.updatedAt,status:'ready',slates:snapshots.map((s,i)=>({seriesId:s.id,platform:s.platform||'yahoo',date:s.date,firstTip:s.firstTip,gameCount:s.games.length,label:i===1?'Evening slate':'Main slate',file:`${s.date}-${s.id}.json`,ready:true}))};
export async function installFixtures(page){
  await page.clock.setFixedTime(new Date(Date.parse(catalog.updatedAt)+30000));
  await page.addInitScript(()=>sessionStorage.setItem('slatelab-auth-v1',JSON.stringify({token:'a'.repeat(64),login:'jimrong79',expiresAt:4102444800000})));
  await page.route(`${API_ORIGIN}/api/**`,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type','access-control-allow-methods':'GET, POST, DELETE, OPTIONS'};
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(path==='/api/health'){await route.fulfill({json:{ok:true,authConfigured:true},headers});return;}
    if(path==='/api/session'){await route.fulfill({json:request.method()==='DELETE'?{ok:true}:{login:'jimrong79',allowed:true,expiresAt:4102444800000},headers});return;}
    if(path==='/api/generate'){
      const data=request.postDataJSON();
      try{
        // Solve from the test's intercepted published data, never browser-supplied players.
        const inputs=await page.evaluate(async file=>{
          const base=await (await fetch(new URL(`data/${file}`,document.baseURI))).json();
          const r=await fetch(new URL(`data/ml-${base.platform==='draftkings'?'draftkings-':''}${base.date}.json`,document.baseURI));
          return {base,model:r.ok?await r.json():null,now:Date.now()};
        },data.slateFile);
        const slate=selectProjection(inputs.base,inputs.model,data.projectionMethod,inputs.now);
        await route.fulfill({json:{ok:true,result:generateLineup(slate,data.settings,inputs.now)},headers});
      }catch(error){await route.fulfill({status:422,json:{error:error.message},headers});}
      return;
    }
    await route.fulfill({status:404,json:{error:'Unknown test endpoint'},headers});
  });
  await page.route('**/data/*.json*',async route=>{
    const filename=new URL(route.request().url()).pathname.split('/').at(-1);
    if(filename.startsWith('ml-')){await route.fulfill({status:404,body:'Not published'});return;}
    const data=filename==='catalog.json'?catalog:snapshots.find(s=>`${s.date}-${s.id}.json`===filename);
    if(data)await route.fulfill({json:data});else await route.continue();
  });
}
