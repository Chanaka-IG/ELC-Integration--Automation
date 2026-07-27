const { chromium } = require('@playwright/test');
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
  await page.waitForSelector('#first-name-box', { timeout: 90000 });
  await page.waitForTimeout(2000);

  // 1) toggle Auto Generate Employee ID off -> what field appears?
  await page.locator('#autoGenerateEmployeeId').click({ force: true });
  await page.waitForTimeout(1500);
  const idField = await page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('[class*=modal]')).filter((m) => m.offsetParent !== null);
    const m = modals.find((x) => x.textContent.includes('Add Employee'));
    return Array.from(m.querySelectorAll('input[type=text]'))
      .filter((i) => i.offsetParent !== null)
      .map((i) => ({ id: i.id, cls: String(i.className).slice(0, 50), label: (i.closest('.row, [class*=field], .input-field')?.querySelector('label')?.textContent || '').trim() }));
  });
  console.log('visible text inputs after toggle:', JSON.stringify(idField, null, 2));

  // 2) open the Location dropdown, dump first options
  const locTrigger = page.locator('.dropdown-field-focus-element, input.placeholder').first();
  await locTrigger.click({ force: true });
  await page.waitForTimeout(1500);
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll('li, [class*=option], [class*=dropdown] span'))
      .filter((e) => e.offsetParent !== null)
      .map((e) => (e.textContent || '').trim())
      .filter((t) => t && t.length < 40)
      .slice(0, 20),
  );
  console.log('location options sample:', JSON.stringify(options));
  await page.screenshot({ path: 'explore/24-modal-probed.png', fullPage: false });
  // cancel out — do NOT save
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
  await browser.close();
})();
