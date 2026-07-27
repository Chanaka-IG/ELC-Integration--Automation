// Inspect the DOM of the scheduled-tasks table: onclick handlers, modal markup.
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
  if (!frame) throw new Error('frame not found');

  const info = await frame.evaluate(() => {
    const out = { links: [], forms: [], modals: [], scripts: [] };
    // task-name links and their handlers/attributes
    document.querySelectorAll('table a').forEach((a) => {
      if (a.textContent.includes('RabbitMQ')) {
        out.links.push({
          text: a.textContent.trim(),
          href: a.getAttribute('href'),
          onclick: a.getAttribute('onclick'),
          id: a.id,
          class: a.className,
          rowHtml: a.closest('tr')?.outerHTML?.slice(0, 1500),
        });
      }
    });
    document.querySelectorAll('form').forEach((f) => {
      out.forms.push({ id: f.id, action: f.action, method: f.method });
    });
    document.querySelectorAll('[id*=modal i], [class*=modal i], [id*=dialog i]').forEach((m) => {
      out.modals.push({ id: m.id, class: m.className, text: m.textContent.trim().slice(0, 200) });
    });
    // inline scripts mentioning execute/run
    document.querySelectorAll('script:not([src])').forEach((s) => {
      if (/execut|runTask|cron/i.test(s.textContent)) {
        out.scripts.push(s.textContent.slice(0, 3000));
      }
    });
    return out;
  });

  fs.writeFileSync('explore/07-task-dom.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify({ links: info.links.map(l => ({text: l.text, href: l.href, onclick: l.onclick, class: l.class})), forms: info.forms, modals: info.modals.slice(0, 10) }, null, 2));
  console.log('scripts captured:', info.scripts.length);
  await browser.close();
})();
