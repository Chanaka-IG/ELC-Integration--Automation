// Exploration: what happens when clicking a task name on Scheduled Tasks?
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  page.on('dialog', async (d) => {
    console.log(`DIALOG [${d.type()}]: ${d.message()}`);
    await d.dismiss(); // observe only — do not execute yet
  });

  await page.goto(`${BASE}/client/#/noncore/managementtool_notship/viewScheduledCronTasks`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  console.log('frames:');
  for (const f of page.frames()) console.log(' -', f.url());

  // find whichever frame actually contains the task link
  let link = null;
  for (const f of page.frames()) {
    const candidate = f.getByRole('link', { name: 'RabbitMQ Queue Subscribing' });
    if ((await candidate.count().catch(() => 0)) > 0) {
      console.log('link found in frame:', f.url());
      link = candidate.first();
      break;
    }
  }
  if (!link) {
    // fallback: text-based
    for (const f of page.frames()) {
      const candidate = f.getByText('RabbitMQ Queue Subscribing', { exact: true });
      if ((await candidate.count().catch(() => 0)) > 0) {
        console.log('text found in frame:', f.url());
        link = candidate.first();
        break;
      }
    }
  }
  if (!link) throw new Error('RabbitMQ Queue Subscribing not found in any frame');

  await link.click();
  await page.waitForTimeout(3000);

  console.log('URL now:', page.url());
  for (const f of page.frames()) console.log('frame:', f.url());
  await page.screenshot({ path: 'explore/06-after-click.png', fullPage: true });
  let snap = '';
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    snap += `\n# ── frame: ${f.url()} ──\n`;
    snap += await f.locator('body').ariaSnapshot({ timeout: 8000 }).catch(() => '(failed)');
  }
  fs.writeFileSync('explore/06-after-click.aria.yml', snap);
  console.log('saved explore/06-after-click.*');

  await page.waitForTimeout(2000);
  await browser.close();
})();
