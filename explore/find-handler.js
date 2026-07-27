// Find the JS click handler for .executionTask links (external scripts too).
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/noncore/managementtool_notship/viewScheduledCronTasks`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  const frame = page
    .frames()
    .find(
      (f) =>
        f !== page.mainFrame() &&
        f.url().includes('managementtool_notship/viewScheduledCronTasks'),
    );

  // fetch all same-origin scripts referenced by the frame and grep them
  const scriptUrls = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s) => s.src),
  );
  console.log('external scripts:', scriptUrls.length);
  const hits = [];
  for (const url of scriptUrls) {
    const body = await frame.evaluate(async (u) => {
      try {
        const r = await fetch(u);
        return await r.text();
      } catch {
        return '';
      }
    }, url);
    if (/executionTask/.test(body)) {
      hits.push({ url, body });
    }
  }
  for (const h of hits) {
    console.log('== handler script:', h.url);
    // print the region around executionTask
    const idx = h.body.indexOf('executionTask');
    console.log(h.body.slice(Math.max(0, idx - 400), idx + 2000));
    fs.writeFileSync('explore/08-handler.js.txt', h.body);
  }
  await browser.close();
})();
