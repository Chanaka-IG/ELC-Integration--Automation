/**
 * Read-only: dump the numeric custom-field input ids (and their labels) on the
 * PIM Job tab and on the "BizPay Integration - Sync Information" custom tab.
 *
 * Rebuilding the OHRM instance re-numbers custom fields, which silently breaks
 * every [id="..."] selector in pages/ohrm/* — this prints the current ids.
 *
 *   node explore/dump-custom-field-ids.cjs <empNumber> [customTabId]
 */
require('dotenv').config();
const { chromium } = require('@playwright/test');

const BASE = process.env.OHRM_URL.replace(/\/+$/, '');
const EMP = process.argv[2];
const TAB = process.argv[3] || '397';
if (!EMP) {
  console.error('usage: node explore/dump-custom-field-ids.cjs <empNumber> [customTabId]');
  process.exit(1);
}

/**
 * Every element carrying a digit-bearing id, with its nearest meaningful label.
 * Not just form controls: on the Job tab the custom-field id sits on a wrapper
 * around the dropdown, not on an <input>.
 */
const dumpFields = (page) =>
  page.evaluate(() => {
    const NOISE = /^(yes|no|▼|--\s*select\s*--)?$/i;
    const ownTexts = (root) =>
      [...root.querySelectorAll('label, div, span, p, td, th')]
        .map((l) =>
          [...l.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter((t) => t && !NOISE.test(t));

    // Prefer a label that is not "Yes"/"No" — the sync-flag checkboxes each sit
    // next to a bare "Yes", which cannot tell Re-sync from Skip-sync apart.
    const labelFor = (el) => {
      let scope = el;
      for (let i = 0; i < 8 && scope; i++) {
        const t = ownTexts(scope)[0];
        if (t) return t;
        scope = scope.parentElement;
      }
      return '(no label found)';
    };

    return [...document.querySelectorAll('[id]')]
      .filter((el) => /^\d+([_A-Za-z]*)$/.test(el.id))
      .map((el) => ({
        id: el.id,
        type: el.type || el.tagName.toLowerCase(),
        value: (el.value ?? '').slice(0, 60),
        visible: el.offsetParent !== null,
        label: labelFor(el),
      }));
  });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  page.setDefaultTimeout(60_000);

  await page.goto(`${BASE}/auth/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.OHRM_SYSADMIN_USER);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.OHRM_SYSADMIN_PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'));

  for (const [what, url] of [
    ['JOB TAB', `${BASE}/client/#/pim/employees/${EMP}/job`],
    ['CUSTOM TAB ' + TAB, `${BASE}/client/#/pim/employees/${EMP}/employee_pim_tab/${TAB}`],
  ]) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(6000);
    const fields = await dumpFields(page);
    console.log(`\n========== ${what} (${fields.length} numeric-id fields) ==========`);
    console.log(`url: ${url}`);
    for (const f of fields) {
      console.log(
        `  id=${JSON.stringify(f.id).padEnd(14)} ${f.visible ? 'vis' : '   '} ` +
          `${f.type.padEnd(8)} label=${JSON.stringify(f.label).padEnd(42)} value=${JSON.stringify(f.value)}`,
      );
    }
    const selects = await page.evaluate(() =>
      [...document.querySelectorAll('select[id]')]
        .filter((s) => /^\d+$/.test(s.id))
        .map((s) => ({
          id: s.id,
          selectedText: s.selectedOptions[0] ? s.selectedOptions[0].textContent.trim() : null,
          options: [...s.options].map((o) => ({ value: o.value, text: o.textContent.trim() })),
        })),
    );
    for (const s of selects) {
      console.log(`\n  --- <select id="${s.id}"> selected=${JSON.stringify(s.selectedText)}`);
      for (const o of s.options) {
        console.log(`      value=${JSON.stringify(o.value).padEnd(28)} text=${JSON.stringify(o.text)}`);
      }
    }
  }

  console.log('\n(read-only — nothing saved)');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
