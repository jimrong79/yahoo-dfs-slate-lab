import {test,expect} from '@playwright/test';
import {installFixtures,yahoo,dk} from './fixtures.js';

test.beforeEach(async({page})=>installFixtures(page));
for(const platform of ['yahoo','draftkings'])test(`Market blend ${platform} displays provenance and generates with three or fewer sources`,async({page},testInfo)=>{
  const base=structuredClone(platform==='yahoo'?yahoo:dk);
  for(const [i,p] of base.players.entries()){
    if(platform==='draftkings')p.sources.sportsline=p.sources.fuel+4;
    p.sources.betting=30;
    p.betting={points:30,platform,game:p.game,tipoff:p.tipoff,updatedAt:base.updatedAt,method:'devig-poisson-v1',complete:true};
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
test('Market blend without betting key clearly reports fallback coverage',async({page})=>{
  await page.goto('./');await page.locator('#projection-select').selectOption('market');
  await expect(page.locator('#projection-status')).toContainText('Betting 0/');
  await expect(page.locator('#projection-status')).toContainText('not configured');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
});
