// Execute "RabbitMQ Queue Subscribing" via Executable Tasks — capture the full flow.
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';
const TASK = process.argv[2] || 'RabbitMQ Queue Subscribing';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/noncore/managementtool_notship/viewCronTasks`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  const frame = page
    .frames()
    .find(
      (f) => f !== page.mainFrame() && f.url().includes('managementtool_notship/viewCronTasks'),
    );
  if (!frame) throw new Error('viewCronTasks frame not found');

  console.log(`clicking task: ${TASK}`);
  await frame.getByRole('link', { name: TASK, exact: true }).click();
  await page.waitForTimeout(3000);

  // capture the modal that opened
  const modalSnap = await frame.locator('body').ariaSnapshot({ timeout: 8000 });
  fs.writeFileSync('explore/09-execute-modal.aria.yml', modalSnap);
  await page.screenshot({ path: 'explore/09-execute-modal.png', fullPage: false });

  // find visible buttons in the modal
  const buttons = await frame.evaluate(() => {
    const visible = (el) => el.offsetParent !== null;
    return Array.from(document.querySelectorAll('.modal button, .modal a.btn, .modal input[type=submit]'))
      .filter(visible)
      .map((b) => ({ text: b.textContent.trim(), id: b.id, class: b.className }));
  });
  console.log('modal buttons:', JSON.stringify(buttons, null, 2));

  // execute if an execute/run/save button is present
  const exec = buttons.find((b) => /execute|run|ok|save/i.test(b.text));
  if (exec) {
    console.log(`clicking: "${exec.text}" (#${exec.id})`);
    const btn = exec.id
      ? frame.locator(`#${exec.id}`)
      : frame.getByRole('button', { name: exec.text });
    await btn.click();
    await page.waitForTimeout(5000);
    const after = await frame.locator('body').ariaSnapshot({ timeout: 8000 });
    fs.writeFileSync('explore/10-after-execute.aria.yml', after);
    await page.screenshot({ path: 'explore/10-after-execute.png', fullPage: false });
    // look for toast/confirmation
    const toast = await frame
      .locator('.toast, .alert, [class*=toast]')
      .allTextContents()
      .catch(() => []);
    console.log('toast/alert:', toast);
  } else {
    console.log('no execute-like button found — inspect 09-execute-modal.aria.yml');
  }

  await page.waitForTimeout(2000);
  await browser.close();
})();
