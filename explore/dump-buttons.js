const { chromium } = require('@playwright/test');
const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/pim/employees`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(8000);
  const info = await page.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll('button')).map((b) => ({
      text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      class: b.className.slice(0, 80),
      visible: b.offsetParent !== null,
    })),
    gridInfo: document.querySelector('[class*=pagination], [class*=records]')?.textContent?.trim(),
  }));
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'explore/19-employees-full.png', fullPage: true });
  await browser.close();
})();
