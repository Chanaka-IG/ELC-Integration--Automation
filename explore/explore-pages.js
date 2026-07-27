// Exploration step 2+: visit pages with the saved sysadmin session, dump snapshots.
// usage: node explore/explore-pages.js "<name>=<url>" ["<name>=<url>" ...]
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';

(async () => {
  const targets = process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return { name: a.slice(0, i), url: a.slice(i + 1) };
  });
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();

  for (const t of targets) {
    const url = t.url.startsWith('http') ? t.url : `${BASE}${t.url}`;
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    console.log(`${t.name}: ${page.url()}`);
    await page.screenshot({ path: `explore/${t.name}.png`, fullPage: true });
    let snapshot = await page.locator('body').ariaSnapshot();
    // noncore modules render inside iframes — capture their content too
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      console.log(`  frame: ${frame.url()}`);
      const frameSnap = await frame
        .locator('body')
        .ariaSnapshot({ timeout: 10000 })
        .catch(() => '(frame snapshot failed)');
      snapshot += `\n# ── frame: ${frame.url()} ──\n${frameSnap}`;
    }
    fs.writeFileSync(`explore/${t.name}.aria.yml`, snapshot);
  }

  await browser.close();
})();
