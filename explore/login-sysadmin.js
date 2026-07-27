// Exploration step 1: sysadmin login (headed), save session + landing snapshot.
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://8101jnb1nw-temp14-kord.orangehrm.com';
const USER = process.env.OHRM_SYSADMIN_USER || '_ohrmSysAdmin_';
const PASS = process.argv[2];
if (!PASS) {
  console.error('usage: node explore/login-sysadmin.js <password>');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/auth/login`);
  await page.getByRole('textbox', { name: /Username/ }).fill(USER);
  await page.getByRole('textbox', { name: /Password/ }).fill(PASS);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  const url = page.url();
  const invalid = await page.getByText('Invalid Credentials').isVisible().catch(() => false);
  const onLoginPage = /auth\/login|retryLogin/.test(url);

  console.log('URL:', url);
  console.log('Invalid credentials banner:', invalid);

  if (!invalid && !onLoginPage) {
    console.log('LOGIN OK');
    await context.storageState({ path: 'explore/.sysadmin-state.json' });
    await page.screenshot({ path: 'explore/01-landing.png', fullPage: true });
    fs.writeFileSync('explore/01-landing.aria.yml', await page.locator('body').ariaSnapshot());
    console.log('Saved landing snapshot + session state');
  } else {
    console.log('LOGIN FAILED — not retrying (lockout protection on this instance)');
  }

  await page.waitForTimeout(3000);
  await browser.close();
  process.exit(!invalid && !onLoginPage ? 0 : 1);
})();
