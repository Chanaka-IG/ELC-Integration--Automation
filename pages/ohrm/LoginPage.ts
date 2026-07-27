import { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/');
    // NOTE: selectors below are the standard OrangeHRM login form; verify
    // against the QA instance during the live exploration pass.
    await this.page.getByPlaceholder('Username').fill(username);
    await this.page.getByPlaceholder('Password').fill(password);
    await this.page.getByRole('button', { name: 'Login' }).click();
    await this.page.waitForURL('**/dashboard/**');
  }

  async loginAsAdmin(): Promise<void> {
    await this.login(process.env.OHRM_ADMIN_USER!, process.env.OHRM_ADMIN_PASS!);
  }

  async loginAsSysadmin(): Promise<void> {
    await this.login(process.env.OHRM_SYSADMIN_USER!, process.env.OHRM_SYSADMIN_PASS!);
  }
}
