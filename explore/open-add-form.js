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
  await page.waitForTimeout(6000);

  // the "+" floating action button (top-right)
  const fab = page.locator('a:has(i:text("add")), [class*=fab], a[title*="Add" i], [class*=add-button]').first();
  let clicked = false;
  if (await fab.isVisible().catch(() => false)) {
    await fab.click(); clicked = true;
  } else {
    // fallback: click by position of the round blue + (from screenshot)
    const el = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('a, div, span, i')).filter((e) => {
        const t = (e.textContent || '').trim();
        return (t === 'add' || t === '+') && e.offsetParent !== null;
      });
      return cands.length ? true : false;
    });
    if (el) { await page.getByText(/^(add|\+)$/).first().click(); clicked = true; }
  }
  console.log('clicked add:', clicked);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  console.log('URL:', page.url());
  for (const f of page.frames()) console.log('frame:', f.url());
  await page.screenshot({ path: 'explore/20-add-form.png', fullPage: true });
  let snap = await page.locator('body').ariaSnapshot();
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    snap += `\n# ── frame: ${f.url()} ──\n` + (await f.locator('body').ariaSnapshot({ timeout: 8000 }).catch(() => '(failed)'));
  }
  fs.writeFileSync('explore/20-add-form.aria.yml', snap);
  await browser.close();
})();
