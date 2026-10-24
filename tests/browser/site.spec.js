import { test, expect } from '@playwright/test';
import {readFileSync} from 'node:fs';
import {catalog,installFixtures,dk,yahoo} from './fixtures.js';
import {modelFixture,combinedFixture} from '../model-fixture.js';
import {generateLineup} from '../../src/optimizer.js';

// Published inputs stay real; hold the browser clock just after their snapshot
// so the same build can be checked tomorrow without bypassing expiry in the app.
const main = catalog.slates[0];
test.beforeEach(async ({page,context}) => {
  await installFixtures(page);
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
  await expect(page.locator('#snapshot-help')).toContainText('Run workflow');
  await expect(page.locator('#snapshot-help a')).toHaveAttribute('href',/actions\/workflows\/pages.yml/);
});
test('DraftKings selection uses its own cap, scoring source and position eligibility',async({page},testInfo)=>{
  await page.goto('./?platform=draftkings');await expect(page.locator('#slate-select')).toHaveValue('dk-123');
  await expect(page.locator('#remaining-salary')).toHaveText('$50,000 / $50,000');
  await expect(page.locator('#platform-pill')).toContainText('DraftKings');
  await page.locator('[data-position="SG"]').click();await expect(page.locator('[data-player-id="902"]')).toBeVisible();
  await page.getByRole('button',{name:'Lock Fixture Player 2',exact:true}).click();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('.lineup-player strong').filter({hasText:'Fixture Player 2'})).toHaveCount(1);
  const slots=await page.locator('.lineup-row').evaluateAll(rows=>rows.map(r=>r.dataset.slot));expect(slots).toEqual(['PG','SG','SF','PF','C','G','F','UTIL']);
  await page.locator('#copy-lineup').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('DraftKings NBA');
  await page.locator('#save-lineup').click();await page.locator('#mobile-saved').click();await expect(page.locator('.saved-card')).toContainText('DraftKings');await page.locator('#close-modal').click();
  await page.locator('#sources-link').click();await expect(page.locator('#modal-content')).toContainText('native DraftKings');await page.locator('#close-modal').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`screenshots/dk-test-${testInfo.project.name}.png`,fullPage:true});
  await page.locator('#slate-select').selectOption(main.seriesId);await expect(page.locator('#remaining-salary')).toHaveText('$200 / $200');
  await expect(page.locator('[data-lock][aria-pressed="true"]')).toHaveCount(0);await expect(page.locator('#roster-count')).toHaveText('0 / 8');
});
test('DraftKings salaries remain visible while current reports are pending',async({page})=>{
  await page.route('**/data/2026-10-21-dk-123.json*',route=>route.fulfill({json:{...dk,ready:false,readinessReason:'Waiting for current minutes and injury reports.',players:dk.players.map(p=>({...p,minutes:null,injury:'Unknown'}))}}));
  await page.goto('./?platform=draftkings');await expect(page.locator('#notice')).toContainText('Waiting for current minutes');
  await expect(page.locator('#generate')).toBeDisabled();await expect(page.locator('#eligible-only')).not.toBeChecked();
  await expect(page.locator('.player-row')).toHaveCount(dk.players.length);
});
test('copy remains usable when clipboard permission is denied', async ({page}) => {
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Permission denied'))}});});
  await page.goto('./');await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await page.locator('#copy-lineup').click();
  await expect(page.getByRole('textbox',{name:'Lineup to copy'})).toHaveValue(/Slate Lab.*Yahoo NBA/s);
});
test('two-game defaults apply and preserve explicit user settings across refreshes',async({page})=>{
  await page.goto('./?platform=draftkings');
  await expect(page.locator('#build-rules')).toContainText('Include bench · 16+');
  await page.locator('#settings-button').click();
  await expect(page.locator('#setting-minutes')).toHaveValue('16');
  await expect(page.locator('#setting-starters')).not.toBeChecked();
  await page.locator('#setting-minutes').selectOption('24');
  await page.locator('#setting-starters').check();
  await page.locator('#apply-settings').click();
  await page.locator('#refresh').click();
  await expect(page.locator('#build-rules')).toContainText('Starters · 24+');
  await page.locator('#slate-select').selectOption(main.seriesId);
  await expect(page.locator('#build-rules')).toContainText('Starters · 24+');
});
test('trained model is optional, compares totals and labels saved lineups and exports',async({page},testInfo)=>{
  await page.route('**/data/ml-*.json*',route=>route.fulfill({json:modelFixture(yahoo)}));
  await page.goto('./?platform=yahoo');
  await expect(page.locator('#projection-select')).toHaveValue('consensus');
  await expect(page.locator('#projection-status')).toContainText('Model trained through');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('#projection-comparison')).toContainText('50/50');
  await page.locator('#projection-select').selectOption('trained');
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('#model-label')).toContainText('Trained model');
  await page.locator('#copy-lineup').click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Trained model (experimental)');
  await page.locator('#save-lineup').click();await page.locator('#mobile-saved').click();
  await expect(page.locator('.saved-card')).toContainText('Trained model');await page.locator('#close-modal').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/model-comparison-${testInfo.project.name}.png`,fullPage:true});
});
test('unpublished model explains the limitation and leaves consensus usable',async({page})=>{
  await page.goto('./?platform=yahoo');await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#projection-select').selectOption('trained');
  await expect(page.locator('#generate')).toBeDisabled();
  await expect(page.locator('#notice')).toContainText('No trained-model snapshot');
  await page.locator('#projection-select').selectOption('consensus');
  await expect(page.locator('#generate')).toBeEnabled();
});

test('Combined labels all fallback sources and retains them in saved and exported lineups',async({page},testInfo)=>{
  const ids=generateLineup(yahoo,{},Date.parse(yahoo.updatedAt)+30000).lineup.slice(0,3).map(p=>p.id);
  const fixture=combinedFixture(yahoo,ids);
  await page.route(`**/data/${yahoo.date}-${yahoo.id}.json*`,route=>route.fulfill({json:fixture.slate}));
  await page.route('**/data/ml-*.json*',route=>route.fulfill({json:fixture.model}));
  await page.goto('./?platform=yahoo');
  await page.locator('#projection-select').selectOption('combined');
  await expect(page.locator('#projection-status')).toContainText('SportsLine');
  for (const [i,label] of ['SportsLine','Fuel','Trained model'].entries()) {
    const row=page.locator(`[data-player-id="${ids[i]}"]`);
    await expect(row.locator('.projection-cell .alt-projection')).toHaveText(label);
    await row.locator('[data-lock]').click();
  }
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await expect(page.locator('#model-label')).toHaveText('Combined');
  await expect(page.locator('#projection-comparison')).toContainText('50/50 —');
  await page.locator('#copy-lineup').click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('Method: Combined');expect(copied).toContain('Model minutes');
  for (const label of ['SportsLine','Fuel','Trained model']) expect(copied).toContain(label);
  await page.locator('#save-lineup').click();await page.locator('#mobile-saved').click();
  await expect(page.locator('.saved-card')).toContainText('Combined');await page.locator('#close-modal').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-lineup').click();
  const download=await downloadPromise;
  const csv=readFileSync(await download.path(),'utf8');
  expect(csv).toContain('"Projection source","Minutes","Minutes source"');
  for (const label of ['Combined','SportsLine','Fuel','Trained model']) expect(csv).toContain(`"${label}"`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:`screenshots/combined-${testInfo.project.name}.png`,fullPage:true});
});

test('Combined drops a lineup when model minutes expire, while provider builds remain available',async({page})=>{
  const ids=generateLineup(yahoo,{},Date.parse(yahoo.updatedAt)+30000).lineup.slice(0,3).map(p=>p.id);
  const fixture=combinedFixture(yahoo,ids);
  fixture.model.inputsAt=fixture.model.generatedAt=new Date(Date.parse(yahoo.updatedAt)-119*60000).toISOString();
  await page.route(`**/data/${yahoo.date}-${yahoo.id}.json*`,route=>route.fulfill({json:fixture.slate}));
  await page.route('**/data/ml-*.json*',route=>route.fulfill({json:fixture.model}));
  await page.goto('./?platform=yahoo');await page.locator('#projection-select').selectOption('combined');
  await page.locator(`[data-player-id="${ids[1]}"] [data-lock]`).click();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await page.clock.setFixedTime(new Date(Date.parse(yahoo.updatedAt)+2*60000));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');
  await expect(page.locator('#lineup-message')).toContainText('model inputs are over two hours');
  await expect(page.locator('#copy-lineup')).toBeDisabled();
  await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#reset-pool').click();
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
});
