import {test,expect} from '@playwright/test';
import {installFixtures} from './fixtures.js';
import {API_ORIGIN} from '../../src/auth.js';
test.beforeEach(async({page})=>{await installFixtures(page);});
test('visitors can browse, but Generate opens the access popup without a build request',async({page})=>{
  await page.addInitScript(()=>sessionStorage.removeItem('slatelab-auth-v1'));
  let builds=0;page.on('request',r=>{if(r.url().includes('/api/generate'))builds++;});
  await page.goto('./');await expect(page.locator('#auth-status')).toContainText('sign-in required');
  await expect(page.locator('.player-row').first()).toBeVisible();
  await page.locator('#generate').click();
  await expect(page.locator('#modal-title')).toHaveText('Lineup generation access');
  await expect(page.locator('#modal-content')).toContainText('jimrong79');
  await expect(page.locator('#modal-content a')).toHaveAttribute('href','mailto:jimrong79@gmail.com');
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');expect(builds).toBe(0);
});
test('a denied GitHub account sees the contact popup and leaves no sign-in code in the URL',async({page})=>{
  await page.goto('./#slatelab-auth-error=access_denied');
  await expect(page.locator('#modal-content')).toContainText('jimrong79@gmail.com');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#auth-status')).toContainText('sign-in required');
});
test('forging browser login state cannot override server denial',async({page})=>{
  await page.route(`${API_ORIGIN}/api/session`,route=>route.fulfill({status:401,json:{error:'Sign in required',code:'sign_in_required'},headers:{'access-control-allow-origin':'*'}}));
  await page.goto('./');await expect(page.locator('#auth-status')).toContainText('sign-in required');
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');
});
test('expired authorization during generation gives the access popup and no lineup',async({page})=>{
  await page.route(`${API_ORIGIN}/api/generate`,route=>route.fulfill({status:401,json:{error:'Your session expired.',code:'sign_in_required'},headers:{'access-control-allow-origin':'*'}}));
  await page.goto('./');await expect(page.locator('#auth-status')).toContainText('Signed in as jimrong79');
  await page.locator('#generate').click();await expect(page.locator('#modal-content')).toContainText('session expired');
  await expect(page.locator('#roster-count')).toHaveText('0 / 8');
});
test('sign out removes the lineup and restores the access gate',async({page})=>{
  await page.goto('./');await expect(page.locator('#auth-status')).toContainText('Signed in as jimrong79');
  await page.locator('#generate').click();await expect(page.locator('#roster-count')).toHaveText('8 / 8');
  await page.locator('#auth-button').click();await expect(page.locator('#roster-count')).toHaveText('0 / 8');
  await page.locator('#generate').click();await expect(page.locator('#modal-content')).toContainText('jimrong79@gmail.com');
});
test('authorization exchange uses the browser verifier and clears the one-time code',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('slatelab-auth-verifier-v1',JSON.stringify({verifier:'c'.repeat(64),expiresAt:4102444800000})));
  let exchange;
  await page.route(`${API_ORIGIN}/api/session`,async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type'}});return;}
    if(route.request().method()==='POST')exchange=route.request().postDataJSON();
    await route.fulfill({json:{token:'b'.repeat(64),login:'jimrong79',allowed:true,expiresAt:4102444800000},headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto('./#slatelab-auth='+'d'.repeat(64));await expect(page.locator('#auth-status')).toContainText('Signed in as jimrong79');
  expect(exchange).toEqual({code:'d'.repeat(64),verifier:'c'.repeat(64)});expect(new URL(page.url()).hash).toBe('');
});
