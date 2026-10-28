import {test,expect} from '@playwright/test';
import {installFixtures} from './fixtures.js';

// Synthetic aggregate values, never deployed as site data.
const row=(date,platform,contestType,entries,cashed,feesCents,payoutsCents)=>({date,platform,contestType,entries,cashed,feesCents,payoutsCents,ticketCents:0});
const report={schemaVersion:1,currency:'USD',seasonStart:'2026-10-20',through:'2026-10-27',updatedAt:'2026-10-28T12:00:00Z',coverage:[
  {platform:'yahoo',firstDate:'2026-10-20',lastDate:'2026-10-27',importedAt:'2026-10-28T12:00:00Z'},
  {platform:'draftkings',firstDate:'2026-10-26',lastDate:'2026-10-26',importedAt:'2026-10-28T12:00:00Z'},
],daily:[row('2026-10-20','yahoo','Double-up',1,0,200,0),row('2026-10-21','yahoo','Tournament',2,1,400,1000),row('2026-10-26','draftkings','Tournament',2,1,1000,1500),row('2026-10-27','yahoo','50/50',1,0,200,0)]};

test('public results work without sign-in, with period/platform filters and an accessible graph',async({page},testInfo)=>{
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  let authRequests=0;page.on('request',r=>{if(r.url().includes('/api/session'))authRequests++;});
  await page.route('**/data/results.json*',route=>route.fulfill({json:report}));
  await page.goto('./results.html');
  await expect(page.locator('#result-profit')).toHaveText('+$9.00');
  await expect(page.locator('#result-fees')).toHaveText('$16.00');
  await expect(page.locator('#result-cash-rate')).toHaveText('40.0%');
  await expect(page.locator('#results-coverage')).toContainText('DraftKings records through Oct 26');
  await expect(page.locator('#profit-chart .chart-dot')).toHaveCount(3);
  await page.locator('#profit-chart .chart-dot').first().focus();
  await expect(page.locator('#chart-detail')).toContainText('Oct 21');
  await page.locator('#results-platform').selectOption('draftkings');
  await expect(page.locator('#result-profit')).toHaveText('+$5.00');
  await expect(page.locator('#result-cash-rate')).toHaveText('50.0%');
  await expect(page.locator('#profit-chart .chart-dot')).toHaveCount(1);
  await page.locator('#results-platform').selectOption('all');
  await page.locator('#results-period').selectOption('season');
  await expect(page.locator('#result-profit')).toHaveText('+$7.00');
  await page.locator('[data-week="2026-10-19"]').click();
  await expect(page.locator('#result-profit')).toHaveText('+$4.00');
  await page.locator('#results-platform').selectOption('draftkings');
  await expect(page.locator('#results-empty')).toBeVisible();
  await expect(page.locator('#result-roi')).toHaveText('— ROI');
  await page.locator('#results-platform').selectOption('all');
  await page.locator('#results-period').selectOption('last7');
  await page.locator('details summary').click();
  await expect(page.locator('#results-daily tr')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(authRequests).toBe(0);expect(failures).toEqual([]);
  await page.screenshot({path:`screenshots/results-${testInfo.project.name}.png`,fullPage:true});
});

test('failed or malformed reports show an error and retry without stale figures',async({page})=>{
  let attempt=0;
  await page.route('**/data/results.json*',route=>{
    attempt++;
    return attempt===1?route.fulfill({status:503,body:'unavailable'}):attempt===2?route.fulfill({json:{...report,daily:[{...report.daily[0],feesCents:-1}]}}):route.fulfill({json:report});
  });
  await page.goto('./results.html');
  await expect(page.locator('#results-state')).toContainText('not available');
  await expect(page.locator('#results-content')).toBeHidden();
  await page.locator('#results-retry').click();
  await expect(page.locator('#results-state')).toContainText('invalid totals');
  await page.locator('#results-retry').click();
  await expect(page.locator('#result-profit')).toHaveText('+$9.00');
});

test('weekly results are reachable from the builder on desktop and mobile',async({page})=>{
  await installFixtures(page);
  await page.route('**/data/results.json*',route=>route.fulfill({json:report}));
  await page.goto('./');
  await page.locator('.refresh-actions a[href="./results.html"]').click();
  await expect(page).toHaveURL(/results\.html$/);
  await expect(page.locator('#result-profit')).toHaveText('+$9.00');
  await page.locator('.results-back').click();
  await expect(page.locator('#generate')).toBeVisible();
});
