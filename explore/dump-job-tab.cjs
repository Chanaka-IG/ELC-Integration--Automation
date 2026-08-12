/**
 * Read-only: dump the profile Job-tab dropdowns (including Payroll Name /
 * cust121, which is absent from the Add Employee wizard) and the Qualifications
 * "Level" list, from an EXISTING employee. Nothing is saved.
 *
 *   node explore/dump-job-tab.cjs [empNumber]
 */
require('dotenv').config();
const { chromium } = require('@playwright/test');

const BASE = process.env.OHRM_URL.replace(/\/+$/, '');
const FIELD_MARK = 'data-pw-field';

async function tryControl(page, label) {
  const ok = await page.evaluate(
    ({ label, mark }) => {
      document.querySelectorAll(`[${mark}]`).forEach((e) => e.removeAttribute(mark));
      const want = label.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
      const ownText = (el) =>
        [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .replace(/\*/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const CONTROL =
        '.dropdown-field-focus-element, .select-wrapper input, input:not([type=hidden]), textarea';
      for (const el of document.querySelectorAll('label, div, span, p')) {
        if (ownText(el) !== want) continue;
        let scope = el;
        for (let i = 0; i < 5 && scope; i++) {
          const c = scope.querySelector(CONTROL);
          if (c && c.offsetParent !== null) {
            c.setAttribute(mark, '1');
            return true;
          }
          scope = scope.parentElement;
        }
      }
      return false;
    },
    { label, mark: FIELD_MARK },
  );
  return ok ? page.locator(`[${FIELD_MARK}]`) : null;
}

const visibleOptions = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role=option], ul.select-dropdown li, .dropdown-content li')]
      .filter((o) => o.offsetParent !== null)
      .map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

async function dump(page, label) {
  const deadline = Date.now() + 45_000;
  let opts = null;
  for (;;) {
    const c = await tryControl(page, label);
    if (c) {
      try {
        await c.click({ force: true, timeout: 5_000 });
        await page.waitForTimeout(600);
        const found = await visibleOptions(page);
        if (found.length) {
          opts = found;
          await c.click({ force: true }).catch(() => {});
          await page.waitForTimeout(250);
          break;
        }
      } catch {
        /* tag lost to a re-render — retry */
      }
    }
    if (Date.now() > deadline) break;
    await page.waitForTimeout(400);
  }
  if (!opts) return console.log(`\n### ${label}\n  !! could not open`);
  console.log(`\n### ${label}  (${opts.length} options)`);
  console.log(opts.map((o) => `  ${JSON.stringify(o)}`).join('\n'));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  page.setDefaultTimeout(60_000);

  await page.goto(`${BASE}/auth/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.OHRM_SYSADMIN_USER);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.OHRM_SYSADMIN_PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'));

  let emp = process.argv[2];
  if (!emp) {
    await page.goto(`${BASE}/client/#/pim/employees`);
    await page.waitForTimeout(6000);
    emp = await page.evaluate(() => {
      const m = [...document.querySelectorAll('a[href*="/pim/employees/"]')]
        .map((a) => (a.getAttribute('href') || '').match(/\/pim\/employees\/(\d+)/))
        .find(Boolean);
      return m ? m[1] : null;
    });
  }
  if (!emp) throw new Error('could not find an existing employee to inspect');
  console.log(`inspecting employee ${emp} (READ-ONLY, nothing is saved)`);

  await page.goto(`${BASE}/client/#/pim/employees/${emp}/job`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  console.log('\n========== JOB TAB ==========');
  for (const l of [
    'Payroll Name',
    'Sub Unit',
    'Employee Work Location',
    'Employment Status',
    'Job Title',
  ]) {
    await dump(page, l);
  }

  await page.goto(`${BASE}/client/#/pim/employees/${emp}/qualifications`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  console.log('\n========== QUALIFICATIONS (Education Level) ==========');
  console.log('(Level lives in the add-education modal; listing page dropdowns only)');

  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
