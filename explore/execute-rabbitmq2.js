// Execute "RabbitMQ Queue Subscribing" manually — fill Timeout, Execute, verify in history.
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

  await frame.getByRole('link', { name: TASK, exact: true }).click();
  await page.waitForTimeout(3000);

  // dump the modal form fields
  const fields = await frame.evaluate(() => {
    const visible = (el) => el.offsetParent !== null;
    return Array.from(document.querySelectorAll('.modal input, .modal select, .modal textarea'))
      .filter(visible)
      .map((i) => ({
        tag: i.tagName,
        type: i.type,
        id: i.id,
        name: i.name,
        value: i.value,
        required: i.required || i.className.includes('required'),
      }));
  });
  console.log('modal fields:', JSON.stringify(fields, null, 2));

  // fill any visible empty text/number input with a timeout value
  for (const f of fields) {
    if ((f.type === 'text' || f.type === 'number') && !f.value && f.id) {
      console.log(`filling #${f.id} with 120`);
      await frame.locator(`#${f.id}`).fill('120');
    }
  }

  await frame.locator('#saveTaskType').click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'explore/12-after-execute2.png', fullPage: false });
  const toast = await frame
    .evaluate(() =>
      Array.from(document.querySelectorAll('.toast, [class*=toast], .alert'))
        .map((t) => t.textContent.trim())
        .filter(Boolean),
    )
    .catch(() => []);
  console.log('toast:', toast);

  // verify in history: expect a run by our user (not "System")
  await page.goto(
    `${BASE}/client/#/noncore/index.php/managementtool_notship/cronHistory/taskId/16/taskName/RabbitMQ Queue Subscribing`,
  );
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  const hframe = page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url().includes('cronHistory'));
  const snap = await hframe.locator('table').first().ariaSnapshot({ timeout: 8000 });
  fs.writeFileSync('explore/13-history-after.aria.yml', snap);
  const topRows = snap.split('\n').filter((l) => l.includes('row "')).slice(0, 6);
  console.log(topRows.join('\n'));

  await browser.close();
})();
