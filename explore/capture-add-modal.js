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
  const btn = page.locator('#addEmployeeButton');
  await btn.waitFor({ state: 'visible', timeout: 60000 });
  await btn.click();

  // wait for the modal AND for real input fields inside it (spinner gone)
  const modal = page.locator('.modal:visible, [class*=modal]:visible').filter({ hasText: 'Add Employee' }).first();
  await page.waitForFunction(() => {
    const modals = Array.from(document.querySelectorAll('[class*=modal]')).filter((m) => m.offsetParent !== null);
    const m = modals.find((x) => x.textContent.includes('Add Employee'));
    return m && m.querySelectorAll('input, select').length > 1;
  }, { timeout: 90000 });
  await page.waitForTimeout(3000);

  const fields = await page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('[class*=modal]')).filter((m) => m.offsetParent !== null);
    const m = modals.find((x) => x.textContent.includes('Add Employee'));
    return Array.from(m.querySelectorAll('input, select, textarea')).map((i) => ({
      tag: i.tagName, type: i.type || null, id: i.id, name: i.name,
      classes: String(i.className).slice(0, 60),
      label: (i.closest('.input-field, .row, .form-group, [class*=field]')?.querySelector('label')?.textContent || '').trim(),
      required: i.required || /required/i.test(String(i.className)),
      visible: i.offsetParent !== null,
    }));
  });
  console.log(JSON.stringify(fields, null, 2));
  await page.screenshot({ path: 'explore/23-add-modal.png', fullPage: false });
  fs.writeFileSync('explore/23-add-modal-fields.json', JSON.stringify(fields, null, 2));
  await browser.close();
})();
