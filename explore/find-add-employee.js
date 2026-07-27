// Find the Add Employee entry point: expand top-nav dropdowns on #/pim/employees.
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
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);

  // collect all menu-ish elements in banner and expand each dropdown
  const menus = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('nav li, nav a, [class*=menu] a, [class*=topbar] a').forEach((el) => {
      const t = el.textContent?.trim();
      if (t && t.length < 40) out.push(t);
    });
    return [...new Set(out)];
  });
  console.log('nav items:', JSON.stringify(menus.slice(0, 60)));

  // try clicking "Manage Data" style dropdowns and dump revealed links
  for (const label of ['Manage Data', 'More', 'Configurations']) {
    const el = page.getByText(label, { exact: true }).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(1000);
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a'))
          .filter((a) => a.offsetParent !== null)
          .map((a) => `${a.textContent.trim()} -> ${a.getAttribute('href')}`)
          .filter((s) => /add|employee/i.test(s)),
      );
      console.log(`after clicking "${label}":`, JSON.stringify(links, null, 2));
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      console.log(`"${label}" not visible`);
    }
  }

  await page.screenshot({ path: 'explore/16-employees-page.png', fullPage: true });
  fs.writeFileSync(
    'explore/16-employees-page.aria.yml',
    await page.locator('body').ariaSnapshot(),
  );
  await browser.close();
})();
