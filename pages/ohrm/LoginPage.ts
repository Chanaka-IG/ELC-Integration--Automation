import { Page } from '@playwright/test';

/**
 * OrangeHRM 8.1 Enterprise (JN Group instance) login.
 * Selectors verified against the live QA instance on 2026-07-27.
 * Note: an SSO option ("JNGROUP" SAML link) exists on the page — this page
 * object uses local credential login, not SSO.
 */
export class LoginPage {
  constructor(private page: Page) {}

  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/auth/login');
    await this.page.getByRole('textbox', { name: 'Username' }).fill(username);
    await this.page.getByRole('textbox', { name: 'Password' }).fill(password);
    await this.page.getByRole('button', { name: 'Login' }).click();
    // Post-login landing route to be confirmed with credentials (dashboard)
    await this.page.waitForURL((url) => !url.pathname.includes('/auth/login'));
  }

  async loginAsAdmin(): Promise<void> {
    await this.login(process.env.OHRM_ADMIN_USER!, process.env.OHRM_ADMIN_PASS!);
  }

  async loginAsSysadmin(): Promise<void> {
    await this.login(process.env.OHRM_SYSADMIN_USER!, process.env.OHRM_SYSADMIN_PASS!);
  }
}
