import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser', timeout:45000, expect:{timeout:15000}, retries:0,
  use:{baseURL:process.env.SLATE_LAB_URL || 'http://127.0.0.1:4173',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:process.env.SLATE_LAB_URL ? undefined : {command:'npm run preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI}
});
