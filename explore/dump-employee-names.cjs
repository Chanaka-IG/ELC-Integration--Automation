/**
 * Read-only: list PIM rows with real employee NAMES. The Add Employee wizard's
 * Report-to step autocompletes against live names, so factories/employee.ts
 * needs a supervisor that still exists after an instance rebuild (names follow
 * emp_firstname_<empNumber>, and the low numbers do not survive a rebuild).
 *
 *   node explore/dump-employee-names.cjs [empNumber]
 */
require('dotenv').config();
const { chromium } = require('@playwright/test');

const BASE = process.env.OHRM_URL.replace(/\/+$/, '');
const EMP = process.argv[2] || '1105';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  page.setDefaultTimeout(60_000);

  await page.goto(`${BASE}/auth/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.OHRM_SYSADMIN_USER);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.OHRM_SYSADMIN_PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'));

  await page.goto(`${BASE}/client/#/pim/employees`);
  await page.waitForTimeout(8000);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr, .oxd-table-row')]
      .map((tr) =>
        [...tr.querySelectorAll('td, .oxd-table-cell')]
          .map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' | '),
      )
      .filter(Boolean)
      .slice(0, 12),
  );
  console.log('=== PIM rows (columns) ===');
  console.log(rows.map((r) => `  ${r}`).join('\n') || '  (none)');

  // the profile header carries the employee's real full name
  await page.goto(`${BASE}/client/#/pim/employees/${EMP}/personal_details`);
  await page.waitForTimeout(6000);
  const nameFields = await page.evaluate(() => {
    const get = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : null;
    };
    return {
      firstName: get('firstName') ?? get('first-name-box'),
      middleName: get('middleName') ?? get('middle-name-box'),
      lastName: get('lastName') ?? get('last-name-box'),
      heading: (document.querySelector('.employee-name, h5, h6, .oxd-text--h6') || {}).textContent,
    };
  });
  console.log(`\n=== employee ${EMP} name fields ===`);
  console.log(JSON.stringify(nameFields, null, 1));

  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
