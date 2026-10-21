import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Published inputs stay real; hold the browser clock just after their snapshot
// so the same build can be checked tomorrow without bypassing expiry in the app.
const catalog = JSON.parse(readFileSync('public/data/catalog.json','utf8'));
const main = catalog.slates[0];
test.beforeEach(async ({page,context}) => {
  await page.clock.setFixedTime(new Date(Date.parse(catalog.updatedAt)+30000));
  await context.grantPermissions(['clipboard-read','clipboard-write']);
});
test('generate, lock, exclude, save, copy and download', async ({page}, testInfo) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('.lineup-player')).toHaveCount(8);
  const salaryText=await page.locator('#remaining-salary').innerText();
  expect(Number(salaryText.match(/\$(\d+)/)[1])).toBeGreaterThanOrEqual(0);
  const name=await page.locator('.lineup-player strong').first().innerText();
  await page.locator('#search').fill(name);
  await page.getByRole('button',{name:`Lock ${name}`,exact:true}).click();
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');
  await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('.lineup-player strong').filter({hasText:name})).toHaveCount(1);
  await page.getByRole('button',{name:`Exclude ${name}`,exact:true}).click();
  await page.locator('#generate').click();
  await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('.lineup-player strong').filter({hasText:name})).toHaveCount(0);
  await page.locator('#search').fill('');
  await page.locator('#save-lineup').click();
  await page.locator('#mobile-saved').click();
  await expect(page.locator('.saved-card')).toHaveCount(1);
  await page.locator('#close-modal').click();
  await page.locator('#copy-lineup').click();
  await expect(page.locator('#toast')).toContainText('copied');
  const download=page.waitForEvent('download');await page.locator('#download-lineup').click();
  expect((await download).suggestedFilename()).toMatch(/slatelab-.*\.csv/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/${testInfo.project.name}.png`,fullPage:true});
  expect(errors).toEqual([]);
});
test('slates, filters and build settings work', async ({page}) => {
  await page.goto('./');await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('[data-position="PG"]').click();
  const positions=await page.locator('.pos-tag').allTextContents();expect(positions.length).toBeGreaterThan(0);expect(positions.every(x=>x==='PG')).toBe(true);
  await page.locator('#reset-pool').click();
  await page.locator('#settings-button').click();
  await page.locator('#setting-minutes').selectOption('20');
  await page.locator('#setting-starters').uncheck();
  await page.locator('#apply-settings').click();
  await expect(page.locator('#build-rules')).toContainText('Include bench · 20+');
  if (catalog.slates.length>1) {await page.locator('#slate-select').selectOption(catalog.slates[1].seriesId); await expect(page.locator('#game-count')).toHaveText(`${catalog.slates[1].gameCount} GAMES ON THIS SLATE`);}
});
test('stale published data disables generation with an explanation', async ({page}) => {
  await page.clock.setFixedTime(new Date(Date.parse(catalog.updatedAt)+121*60000));
  await page.goto('./');await expect(page.locator('#notice')).toContainText('over two hours old');
  await expect(page.locator('#generate')).toBeDisabled();
});
test('copy remains usable when clipboard permission is denied', async ({page}) => {
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Permission denied'))}});});
  await page.goto('./');await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await page.locator('#copy-lineup').click();
  await expect(page.getByRole('textbox',{name:'Lineup to copy'})).toHaveValue(/Slate Lab.*Yahoo NBA/s);
});
