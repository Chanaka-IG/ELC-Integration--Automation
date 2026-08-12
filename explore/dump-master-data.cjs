/**
 * One-shot: dump every Add-Employee-wizard dropdown's options from the live
 * OHRM instance, so factories/employee.ts can be re-pointed at master data that
 * actually exists after the QA instance is rebuilt.
 *
 * Aborts before the wizard's final Save — no employee is created.
 *   node explore/dump-master-data.cjs
 */
require('dotenv').config();
const { chromium } = require('@playwright/test');

const BASE = process.env.OHRM_URL.replace(/\/+$/, '');
const FIELD_MARK = 'data-pw-field';
const OPTION_MARK = 'data-pw-option';

/**
 * Tag the interactive control of the field labelled `label` (from
 * AddEmployeePage). Polls: each wizard step renders its fields only after the
 * route has already changed, so a single attempt races the render.
 */
async function control(page, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await tryControl(page, label);
    if (c) return c;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(500);
  }
}

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

/**
 * Tag the control and click it, retrying the pair together: Angular re-renders
 * the step under us, which drops the tag between tagging and clicking.
 */
async function openDropdown(page, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await control(page, label, Math.max(1000, deadline - Date.now()));
    if (!c) return null;
    try {
      await c.click({ force: true, timeout: 5_000 });
      await page.waitForTimeout(600);
      if ((await visibleOptions(page)).length) return c;
    } catch {
      // tag lost to a re-render — fall through and tag again
    }
    if (Date.now() > deadline) return c;
    await page.waitForTimeout(400);
  }
}

const visibleOptions = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role=option], ul.select-dropdown li, .dropdown-content li')]
      .filter((o) => o.offsetParent !== null)
      .map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );

async function readOptions(page, label) {
  const c = await openDropdown(page, label);
  if (!c) return `!! no control found for "${label}"`;
  const opts = await visibleOptions(page);
  // Close by toggling the control — pressing Escape inside the Add Employee
  // modal dismisses the whole modal, not just the option list.
  await c.click({ force: true });
  await page.waitForTimeout(300);
  if ((await visibleOptions(page)).length) {
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(300);
  }
  return opts;
}

/**
 * Choose `value` in the dropdown labelled `label`. This build mixes two
 * dropdown widgets — the oxd one (role=option) and Materialize
 * (ul.select-dropdown li, no role) — so match on text across both rather than
 * by role.
 */
async function pick(page, label, value) {
  const c = await openDropdown(page, label);
  if (!c) throw new Error(`no control for "${label}"`);
  const tagged = await page.evaluate(
    ({ value, mark }) => {
      document.querySelectorAll(`[${mark}]`).forEach((e) => e.removeAttribute(mark));
      const want = value.replace(/\s+/g, ' ').trim();
      for (const o of document.querySelectorAll(
        '[role=option], ul.select-dropdown li, .dropdown-content li',
      )) {
        if (o.offsetParent === null) continue;
        if ((o.textContent ?? '').replace(/\s+/g, ' ').trim() !== want) continue;
        o.setAttribute(mark, '1');
        return true;
      }
      return false;
    },
    { value, mark: OPTION_MARK },
  );
  if (!tagged) throw new Error(`option "${value}" not in the open "${label}" dropdown`);
  await page.locator(`[${OPTION_MARK}]`).click({ force: true });
  await page.waitForTimeout(400);
}

async function dump(page, label, limit = 40) {
  const opts = await readOptions(page, label);
  if (typeof opts === 'string') return console.log(`\n### ${label}\n  ${opts}`);
  console.log(`\n### ${label}  (${opts.length} options)`);
  console.log(opts.slice(0, limit).map((o) => `  ${JSON.stringify(o)}`).join('\n'));
  if (opts.length > limit) console.log(`  ...(${opts.length - limit} more)`);
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
  console.log('logged in OK');

  // ── modal step ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/client/#/pim/employees`);
  await page.locator('#addEmployeeButton').waitFor({ state: 'visible' });
  await page.locator('#addEmployeeButton').click();
  await page.locator('#first-name-box').waitFor({ state: 'visible' });
  console.log('\n========== MODAL ==========');

  const stamp = String(Date.now()).slice(-8);
  await page.locator('#first-name-box').fill('Zz');
  await page.locator('#last-name-box').fill('Probe');
  await page.locator('#autoGenerateEmployeeId').click({ force: true });
  await page.locator('#employeeId').waitFor({ state: 'visible' });
  await page.locator('#employeeId').fill(`ZZ-PROBE-${stamp}`);
  await page.locator('#employeeId').blur();
  await page.locator('#joinedDate').fill(new Date().toISOString().slice(0, 10));

  await dump(page, 'Location', 60);

  // The Location list is hierarchical (country headers group the real
  // locations) and clicking a header does not select or close — use a leaf.
  const loc = 'name_102';
  const c = await control(page, 'Location');
  await c.click({ force: true });
  await page.waitForTimeout(500);
  await page.getByRole('option', { name: loc, exact: true }).first().click({ force: true });
  await page.waitForTimeout(500);
  console.log(`\n(using Location=${JSON.stringify(loc)} to advance)`);

  await page.getByRole('dialog').getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/#\/pim\/wizard\/personal_details/, { timeout: 60_000 });

  console.log('\n========== STEP 1: personal_details ==========');
  for (const l of ['Marital Status', 'Gender', 'Nationality', 'Salutation']) await dump(page, l);

  // the step silently refuses to advance while a mandatory field is empty
  await page.locator('#ssn').waitFor({ state: 'visible' });
  await page.locator('#otherId').fill('Z999999');
  await page.locator('#ssn').fill('121012298');
  await page.locator('#sin').fill('Z999999');
  await page.locator('#emp_birthday').fill('1990-01-15');
  await pick(page, 'Marital Status', 'Single');
  await pick(page, 'Gender', 'Male');
  await pick(page, 'Nationality', 'Afghan');
  await pick(page, 'Salutation', 'Mr');

  await page.locator('button[ng-click="vm.onNextStep()"]').click();
  await page.waitForURL(/#\/pim\/wizard\/job/, { timeout: 60_000 });

  console.log('\n========== STEP 2: job ==========');
  for (const l of [
    'Job Title',
    'Employment Status',
    'Job Category',
    'Sub Unit',
    'Work Schedule',
    'Attendance Calculation Basis',
    'Contract Type',
    'Group',
    'Company',
    'Employee Work Location',
  ]) {
    await dump(page, l);
  }

  console.log('\n(aborting wizard — no employee created)');
  await browser.close();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
