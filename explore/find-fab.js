const { chromium } = require('@playwright/test');
const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    storageState: 'explore/.sysadmin-state.json',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/client/#/pim/employees`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);
  // inspect what element sits at the FAB position (top-right, ~1550,133 at 1600w)
  const at = await page.evaluate(() => {
    const el = document.elementFromPoint(1545, 133);
    const chain = [];
    let cur = el;
    while (cur && chain.length < 5) {
      chain.push({
        tag: cur.tagName, id: cur.id, class: String(cur.className).slice(0, 100),
        text: (cur.textContent || '').trim().slice(0, 30),
        onclickAttr: cur.getAttribute && cur.getAttribute('onclick'),
        href: cur.getAttribute && cur.getAttribute('href'),
      });
      cur = cur.parentElement;
    }
    return chain;
  });
  console.log(JSON.stringify(at, null, 2));
  await browser.close();
})();
