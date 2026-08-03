import { Page, expect } from '@playwright/test';

/**
 * "BizPay Integration - Sync Information" custom tab (pim tab id 397).
 * URL: /client/#/pim/employees/{empNumber}/employee_pim_tab/397
 * Selectors verified live on 2026-07-27 (input ids = custom field ids). The ids
 * start with a digit, so they are only reachable as [id="..."] — "#122" is not
 * a valid CSS selector and throws in the browser:
 *   122 Last Sync Date (UTC)     123 Last Sync Time (UTC)
 *   Last Sync Status             (custom dropdown, no id — label-anchored)
 *   126_Yes / 126_No             "Employee Exists in BizPay?" radios
 *   127Yes                       "Re-sync Employee" checkbox
 *   128Yes                       "Skip-sync" checkbox
 *   131                          "Bizpay Employee Unique Identifier"
 *
 * NOTE: "Payroll Name" (cust121) is NOT on this tab — it is a dropdown on
 * the JOB tab (see AddEmployeePage.setPayrollName).
 */
export class IntegrationTabPage {
  constructor(private page: Page) {}

  async open(empNumber: string): Promise<void> {
    await this.page.goto(`/client/#/pim/employees/${empNumber}/employee_pim_tab/397`);
    await this.page.locator('[id="122"]').waitFor({ state: 'visible', timeout: 60_000 });
  }

  /** Write-back fields — the post-sync assertion target. */
  async readSyncStatus(empNumber: string): Promise<{
    lastSyncDate: string;
    lastSyncTime: string;
    lastSyncStatus: string;
    employeeExistsInBizpay: boolean;
    bizpayUniqueId: string;
  }> {
    await this.open(empNumber);
    const statusInput = this.page
      .locator('.row:has(label:text-is("Last Sync Status")) input, [class*=field]:has(label:text-is("Last Sync Status")) input')
      .first();
    return {
      lastSyncDate: await this.page.locator('[id="122"]').inputValue(),
      lastSyncTime: await this.page.locator('[id="123"]').inputValue(),
      lastSyncStatus: await statusInput.inputValue(),
      employeeExistsInBizpay: await this.page.locator('[id="126_Yes"]').isChecked(),
      bizpayUniqueId: await this.page.locator('[id="131"]').inputValue(),
    };
  }

  /**
   * Set Skip-sync — used by teardown BEFORE deleting a test employee so the
   * deletion never re-enters the sync queue.
   */
  async setSkipSync(empNumber: string, value: boolean): Promise<void> {
    await this.open(empNumber);
    const checkbox = this.page.locator('[id="128Yes"]');
    if ((await checkbox.isChecked()) !== value) {
      await checkbox.click({ force: true });
      await this.page.getByRole('button', { name: /^save$/i }).first().click();
      await this.page.waitForLoadState('networkidle').catch(() => {});
    }
  }

  /** Guard: a fresh add-path employee must have empty routing fields. */
  async assertReadyForInsertPath(empNumber: string): Promise<void> {
    const s = await this.readSyncStatus(empNumber);
    expect(s.employeeExistsInBizpay, 'Employee Exists in BizPay must not be Yes').toBe(false);
    expect(s.bizpayUniqueId, 'BizPay Unique Id must be empty for insert path').toBe('');
    expect(await this.page.locator('[id="128Yes"]').isChecked(), 'Skip-sync must be off').toBe(false);
  }
}
