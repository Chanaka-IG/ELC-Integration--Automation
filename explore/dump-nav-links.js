// Dump ALL link hrefs on #/pim/employees (dropdown items live in DOM even when hidden).
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
  await page.waitForTimeout(5000);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .map((a) => `${(a.textContent || '').trim().replace(/\s+/g, ' ')} => ${a.getAttribute('href')}`)
      .filter((s) => s.length > 4),
  );
  console.log([...new Set(links)].join('\n'));
  await browser.close();
})();
