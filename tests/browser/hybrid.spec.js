import {test,expect} from '@playwright/test';
import {installFixtures,yahoo,dk} from './fixtures.js';
test.beforeEach(async({page})=>installFixtures(page));
for(const platform of ['yahoo','draftkings'])test(`${platform} partial betting is labeled, generates legally, and exports provenance`,async({page},testInfo)=>{
  const base=structuredClone(platform==='yahoo'?yahoo:dk);
  for(const p of base.players){
    if(!Number.isFinite(p.sources.sportsline))p.sources.sportsline=p.sources.fuel;
    const total=p.sources.sportsline;if(!Number.isFinite(total))continue;
    p.sportslineComponents={method:'provider-components-v1',platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,total,
      values:{points:total,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0,...(platform==='draftkings'?{dk_extras:0}:{})}};
    p.bettingComponents={method:'prop-components-v1',platform,game:p.game,tipoff:p.tipoff,values:{points:{points:total+4,updatedAt:base.updatedAt}}};
    p.sources.betting=null;
  }
  await page.route(`**/data/${base.date}-${base.id}.json*`,route=>route.fulfill({json:base}));
  await page.goto(`./?platform=${platform}`);await page.locator('#projection-select').selectOption('hybrid');
  await expect(page.locator('#projection-status')).toContainText('hybrid replaces SportsLine');
  await expect(page.locator('.alt-projection').filter({hasText:'Betting/SportsLine hybrid + Fuel'}).first()).toBeVisible();
  await page.locator('[data-hybrid]').first().click();
  await expect(page.locator('#modal-content')).toContainText('Betting: PTS.');
  await expect(page.locator('#modal-content')).toContainText('SportsLine retained: REB, AST, STL, BLK, TO');
  await expect(page.locator('#modal-content')).toContainText('not counted again');
  await page.keyboard.press('Escape');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  const rows=page.locator('.lineup-row');
  expect((await rows.nth(1).boundingBox()).y).toBeGreaterThan((await rows.nth(0).boundingBox()).y);
  const download=page.waitForEvent('download');await page.locator('#download-lineup').click();
  const file=await download;const stream=await file.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;
  expect(csv).toContain('Betting hybrid (experimental)');expect(csv).toContain('Hybrid stat sources');expect(csv).toContain('SportsLine retained:');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/hybrid-${platform}-${testInfo.project.name}.png`,fullPage:true});
});
test('old snapshots stay usable with explicit provider fallback and no invented betting estimate',async({page})=>{
  await page.goto('./');await page.locator('#projection-select').selectOption('hybrid');
  await expect(page.locator('#projection-status')).toContainText('Betting contributes to 0/');
  await expect(page.locator('#projection-status')).toContainText('manual odds workflow');
  await page.locator('[data-hybrid]').first().click();
  await expect(page.locator('#modal-content')).toContainText('retaining provider totals');
  await page.keyboard.press('Escape');await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
});
