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
  const fabWrap = page.locator('.floating-add-btn:not(.ng-hide)');
  await fabWrap.waitFor({ state: 'visible', timeout: 60000 });

  // structure of the FAB: children, ng-click handlers
  const structure = await page.evaluate(() => {
    const w = document.querySelector('.floating-add-btn');
    return {
      html: w.outerHTML.slice(0, 1200),
    };
  });
  console.log(structure.html);

  const before = page.url();
  await fabWrap.locator('a.btn-floating').first().click();
  await page.waitForTimeout(5000);
  console.log('URL before:', before);
  console.log('URL after :', page.url());
  await page.screenshot({ path: 'explore/21-after-fab.png', fullPage: false });
  await browser.close();
})();
