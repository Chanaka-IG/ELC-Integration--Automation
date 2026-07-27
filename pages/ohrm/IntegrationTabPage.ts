import { Page } from '@playwright/test';
import { OhrmEmployeeInput } from '../../oracle/ohrm-to-bizpay';

/**
 * The employee's integration custom fields — the sync "routing switches":
 *   Payroll Name (cust121)          — required; selects target BizPay payroll
 *   Skip-sync    (cust128)          — MUST stay empty or the employee is filtered out
 *   BizPay Employee Exists (cust126)— empty/No routes to the INSERT path
 *   BizPay Unique Id (cust131)      — empty routes to the INSERT path
 *   Last Sync Date/Time/Status/Message (cust122-125) — write-back assertions
 *
 * TODO(explore): confirm which custom tab hosts these fields on the QA
 * instance and capture real selectors + the exact tab name.
 */
export class IntegrationTabPage {
  constructor(private page: Page) {}

  async setPayrollName(emp: OhrmEmployeeInput): Promise<void> {
    // TODO(selector): navigate to the custom tab, select Payroll Name option
    await this.openCustomTab();
    await this.selectDropdown('Payroll Name', emp.payrollName);
    await this.page.getByRole('button', { name: 'Save' }).first().click();
  }

  /** Read the write-back fields for post-sync assertions. */
  async readSyncStatus(): Promise<{
    lastSyncDate: string;
    lastSyncTime: string;
    lastSyncStatus: string;
    lastSyncMessage: string;
  }> {
    await this.openCustomTab();
    // TODO(selector): read the four fields
    throw new Error('Not implemented — needs live-UI exploration');
  }

  /** Used by teardown so deleted test employees never re-enter the queue. */
  async setSkipSync(value: string): Promise<void> {
    await this.openCustomTab();
    // TODO(selector)
    throw new Error('Not implemented — needs live-UI exploration');
  }

  private async openCustomTab(): Promise<void> {
    // TODO(selector): exact tab name, e.g. "BizPay" / "Integration"
    await this.page.getByRole('link', { name: /bizpay|integration/i }).click();
  }

  private async selectDropdown(label: string, value: string): Promise<void> {
    const group = this.page.locator(`.oxd-input-group:has-text("${label}")`);
    await group.locator('.oxd-select-text').click();
    await this.page.getByRole('option', { name: value }).click();
  }
}
