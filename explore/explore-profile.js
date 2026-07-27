const { chromium } = require('@playwright/test');
const fs = require('fs');
const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/pim/employees`).catch(() => {});
  await page.waitForSelector('#addEmployeeButton', { timeout: 60000 });
  // open first employee (Jason Adams, 19448) — read-only look
  await page.getByText('Jason Adams').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);
  console.log('profile URL:', page.url());

  // dump the tab names
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a, li'))
      .filter((e) => e.offsetParent !== null)
      .map((e) => (e.textContent || '').trim().replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 45),
  );
  console.log('visible items:', JSON.stringify([...new Set(tabs)].slice(0, 80), null, 1));
  await page.screenshot({ path: 'explore/25-profile.png', fullPage: true });
  fs.writeFileSync('explore/25-profile.aria.yml', await page.locator('body').ariaSnapshot());
  await browser.close();
})();
