import {test,expect} from '@playwright/test';
import {installFixtures,yahoo,dk} from './fixtures.js';

test.beforeEach(async({page})=>installFixtures(page));
for(const platform of ['yahoo','draftkings'])test(`3-source blend ${platform} displays provenance and generates with three or fewer sources`,async({page},testInfo)=>{
  const base=structuredClone(platform==='yahoo'?yahoo:dk);
  for(const [i,p] of base.players.entries()){
    if(platform==='draftkings')p.sources.sportsline=p.sources.fuel+4;
    p.sources.betting=30;
    p.betting={points:30,platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,method:'prop-lines-v2',complete:true};
    if(i%3===1){p.sources.sportsline=null;p.sources.betting=null;}
    if(i%3===2)p.sources.betting=null;
  }
  base.sources.betting={message:'Synthetic test quotes only.',playerCount:base.players.filter(p=>p.sources.betting!==null).length};
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto(`./?platform=${platform}`);
  await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('#projection-status')).toContainText('3 sources:');
  await expect(page.locator('#projection-status')).toContainText('Betting');
  await expect(page.locator('.alt-projection').filter({hasText:'SportsLine + Fuel + Betting'}).first()).toBeVisible();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('#lineup-message')).not.toContainText('error');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/market-${platform}-${testInfo.project.name}.png`,fullPage:true});
});
test('3-source blend without betting key clearly reports fallback coverage',async({page})=>{
  await page.goto('./');await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('#projection-status')).toContainText('Betting 0/');
  await expect(page.locator('#projection-status')).toContainText('not configured');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
});

for(const platform of ['yahoo','draftkings'])test(`${platform} whole-feed outage blocks builds and recovery restores Combined`,async({page})=>{
  const healthy=structuredClone(platform==='yahoo'?yahoo:dk);
  const failed=structuredClone(healthy);
  const message='Fantasy Fuel feed unavailable. Lineup generation is paused because projections or injury flags are incomplete. Run the refresh workflow, then click Refresh data after it succeeds.';
  Object.assign(failed,{ready:false,consensusReady:false,combinedReady:false,readinessReason:message,combinedReadinessReason:message,
    sourceHealth:{status:'unavailable',failedSources:['fuel'],message}});
  failed.players.forEach(p=>{p.sources.fuel=null;p.providerClear=false;p.providerFlagsClear=false;});
  let active=failed;
  await page.route(`**/data/${healthy.date}-${healthy.id}.json*`,route=>route.fulfill({json:active}));
  await page.goto(`./?platform=${platform}`);
  for(const method of ['combined','market','hybrid','consensus','trained']){
    await page.locator('#projection-select').selectOption(method);
    await expect(page.locator('#generate')).toBeDisabled();
    await expect(page.locator('#notice')).toContainText('Fantasy Fuel feed unavailable');
    await expect(page.locator('#top-status')).toHaveText('Projection feed unavailable');
  }
  active=healthy;
  await page.locator('#projection-select').selectOption('combined');
  await page.locator('#refresh').click();
  await expect(page.locator('#top-status')).toHaveText('Slate ready');
  await expect(page.locator('#notice')).toBeHidden();
  await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
});

test('3-source blend explains an unsuccessful manual attempt after a normal refresh',async({page})=>{
  const base=structuredClone(yahoo);
  base.sources.betting={playerCount:0,message:'Last manual attempt 2026-10-21T17:00:00Z: No matching betting events for 2 upcoming games; no player odds fetched for this slate. Cached quotes may have expired; normal refreshes do not fetch new odds.'};
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto('./');await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('#projection-status')).toContainText('Last manual attempt');
  await expect(page.locator('#projection-status')).toContainText('no player odds fetched');
});

test('missing markets display unavailable rather than zero and explain the missing components',async({page})=>{
  const base=structuredClone(dk);
  base.players.forEach(p=>{
    p.sources.betting=null;
    p.bettingStatus={method:'prop-lines-v2',status:'unavailable',message:'No complete bookmaker forecast. Closest is missing usable triple-double, turnovers.'};
  });
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto('./?platform=draftkings');await page.locator('#projection-select').selectOption('market');
  const cell=page.locator('.projection-cell').first();
  await expect(cell).toHaveAttribute('title',/Betting: —/);
  await expect(cell).toHaveAttribute('title',/missing usable triple-double, turnovers/);
  await expect(page.locator('#projection-status')).toContainText('Betting 0/');
});

test('Yes-only bonus estimates disclose bookmaker margin and the method explains missing data',async({page})=>{
  const base=structuredClone(dk);
  base.players.forEach(p=>{
    p.sources.betting=30;
    p.betting={points:30,platform:'draftkings',game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,method:'prop-lines-v2',complete:true,
      bonusProbabilityMethods:{double_double:['yes_only_implied'],triple_double:['devigged']}};
  });
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto('./?platform=draftkings');await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('.projection-cell').first()).toHaveAttribute('title',/Yes-only odds; bookmaker margin remains/);
  await page.locator('#help-button').click();
  await expect(page.locator('#modal')).toContainText('Missing or unusable markets stay unavailable, never zero.');
  await expect(page.locator('#modal')).toContainText('published stat lines are used directly');
});

for(const platform of ['yahoo','draftkings'])test(`${platform} adds filled betting as a third estimate and preserves Combined`,async({page},testInfo)=>{
  const base=structuredClone(platform==='yahoo'?yahoo:dk);
  for(const p of base.players){
    p.sources={sportsline:40,fuel:50,betting:null};p.projection=45;p.consensusProjection=45;
    p.sportslineComponents={method:'provider-components-v1',platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,total:40,
      values:{points:20,rebounds:6,assists:12,steals:3,blocks:3,turnovers:-4,...(platform==='draftkings'?{dk_extras:0}:{})}};
    p.bettingComponents={method:'prop-components-v1',platform,game:p.game,tipoff:p.tipoff,values:{points:{points:28,updatedAt:base.updatedAt}}};
  }
  // A missing quote must not manufacture a third provider-only estimate.
  base.players[0].bettingComponents.values={};
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto(`./?platform=${platform}`);await page.locator('#projection-select').selectOption('combined');
  await expect(page.locator('.projection-cell').first()).toContainText('45.0');
  await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('#projection-status')).toContainText(`${base.players.length-1} provider-filled`);
  await expect(page.locator('#projection-status')).toContainText('2 sources: 1');
  const cell=page.locator('.projection-cell').filter({has:page.locator('[data-hybrid]')}).first();
  await expect(cell).toContainText('46.0');
  await expect(cell).toContainText('SportsLine + Fuel + Betting (provider-filled)');
  await expect(cell).toHaveAttribute('title',/Betting \(provider-filled\): 48.0/);
  await page.locator('[data-hybrid]').first().click();
  await expect(page.locator('#modal-content')).toContainText('Betting: PTS.');
  await expect(page.locator('#modal-content')).toContainText('original SportsLine and Fuel');
  await expect(page.locator('#modal-content')).toContainText('not three independent forecasts');
  await expect(page.locator('#modal-content')).toContainText('SportsLine retained: REB, AST, STL, BLK, TO');
  await page.keyboard.press('Escape');await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('.lineup-row').first()).toContainText('SportsLine + Fuel + Betting (provider-filled)');
  const download=page.waitForEvent('download');await page.locator('#download-lineup').click();
  const file=await download;const stream=await file.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;
  expect(csv).toContain('Betting (provider-filled)');expect(csv).toContain('SportsLine retained:');
  expect(csv).toContain('original SportsLine and Fuel');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/market-filled-${platform}-${testInfo.project.name}.png`,fullPage:true});
  await page.locator('#projection-select').selectOption('combined');
  await expect(page.locator('.projection-cell').first()).toContainText('45.0');
});
