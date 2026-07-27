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
  await page.goto(`${BASE}/client/#/pim/employees`);
  const fab = page.locator('.floating-add-btn:not(.ng-hide) a.btn-floating');
  await fab.waitFor({ state: 'visible', timeout: 60000 });
  await fab.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  console.log('URL:', page.url());
  await page.screenshot({ path: 'explore/20-add-form.png', fullPage: true });
  let snap = await page.locator('body').ariaSnapshot();
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    console.log('frame:', f.url());
    snap += `\n# ── frame: ${f.url()} ──\n` + (await f.locator('body').ariaSnapshot({ timeout: 8000 }).catch(() => '(failed)'));
  }
  fs.writeFileSync('explore/20-add-form.aria.yml', snap);
  console.log('saved 20-add-form.*');
  await browser.close();
})();
