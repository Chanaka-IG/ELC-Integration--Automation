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
  const btn = page.locator('#addEmployeeButton');
  await btn.waitFor({ state: 'visible', timeout: 60000 });
  await btn.click();
  // wait for the list to be replaced by a form: look for input fields appearing
  await page.waitForSelector('input[type=text], form', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  console.log('URL:', page.url());
  await page.screenshot({ path: 'explore/22-add-form.png', fullPage: true });
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((i) => i.offsetParent !== null)
      .map((i) => ({
        tag: i.tagName, type: i.type, id: i.id, name: i.name,
        placeholder: i.placeholder,
        label: i.labels && i.labels[0] ? i.labels[0].textContent.trim() : (i.closest('.input-field, .row')?.querySelector('label')?.textContent?.trim() ?? ''),
      })),
  );
  console.log(JSON.stringify(inputs, null, 2));
  fs.writeFileSync('explore/22-add-form.aria.yml', await page.locator('body').ariaSnapshot());
  await browser.close();
})();
