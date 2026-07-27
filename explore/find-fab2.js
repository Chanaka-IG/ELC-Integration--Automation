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
  const cands = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach((e) => {
      const cls = String(e.className || '');
      const txt = (e.childNodes.length <= 2 ? (e.textContent || '').trim() : '');
      if (/fab|floating|add-emp|btn-add|quick-add/i.test(cls) || txt === 'add') {
        const r = e.getBoundingClientRect();
        out.push({
          tag: e.tagName, class: cls.slice(0, 120), text: txt.slice(0, 20),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
          visible: e.offsetParent !== null,
          parentTag: e.parentElement?.tagName,
          parentClass: String(e.parentElement?.className || '').slice(0, 120),
        });
      }
    });
    return out;
  });
  console.log(JSON.stringify(cands, null, 2));
  await browser.close();
})();
