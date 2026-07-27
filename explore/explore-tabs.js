const { chromium } = require('@playwright/test');
const fs = require('fs');
const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';

async function dumpFields(page, name) {
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((i) => i.type !== 'hidden')
      .map((i) => ({
        tag: i.tagName, type: i.type || null, id: i.id,
        label: (i.closest('.row, [class*=field], .input-field, .form-group')?.querySelector('label')?.textContent || '').trim().slice(0, 50),
        value: (i.value || '').slice(0, 40),
        visible: i.offsetParent !== null,
      }))
      .filter((f) => f.visible),
  );
  console.log(`── ${name} fields:`, JSON.stringify(fields, null, 1));
  fs.writeFileSync(`explore/${name}.fields.json`, JSON.stringify(fields, null, 2));
  await page.screenshot({ path: `explore/${name}.png`, fullPage: true });
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/pim/employees/19448/profile`).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);

  // 1) BizPay Integration custom tab
  await page.getByText(/^BizPay Integration/).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  console.log('bizpay tab URL:', page.url());
  await dumpFields(page, '26-bizpay-tab');

  // 2) Personal Details tab
  await page.getByText('Personal Details', { exact: true }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  console.log('personal URL:', page.url());
  await dumpFields(page, '27-personal-details');

  await browser.close();
})();
