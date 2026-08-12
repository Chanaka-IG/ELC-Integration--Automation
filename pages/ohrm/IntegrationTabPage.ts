import { Page, expect } from '@playwright/test';
import { CUSTOM_FIELD_IDS as IDS, cf } from './customFields';

/**
 * "BizPay Integration - Sync Information" custom tab.
 * URL: /client/#/pim/employees/{empNumber}/employee_pim_tab/{syncTab}
 *
 * Every input id on this tab is an instance-specific database id — they are all
 * declared in pages/ohrm/customFields.ts and were renumbered by the 2026-08-12
 * instance rebuild. Re-derive them with explore/dump-custom-field-ids.cjs rather
 * than editing selectors here.
 *
 * NOTE: "Payroll Name" is NOT on this tab — it is a dropdown on the JOB tab
 * (see AddEmployeePage.setPayrollName).
 */
export class IntegrationTabPage {
  constructor(private page: Page) {}

  async open(empNumber: string): Promise<void> {
    await this.page.goto(
      `/client/#/pim/employees/${empNumber}/employee_pim_tab/${IDS.syncTab}`,
    );
    await this.page.locator(cf(IDS.lastSyncDate)).waitFor({ state: 'visible', timeout: 60_000 });
  }

  /**
   * "Last Sync Status" is a native <select> whose option values carry an Angular
   * "string:" prefix, so inputValue() would yield "string:Successful". Read the
   * selected option's text instead, and report the placeholder as empty.
   */
  private async readSyncStatusValue(): Promise<string> {
    const text = await this.page.locator(cf(IDS.lastSyncStatus)).evaluate((el) => {
      const select = el as HTMLSelectElement;
      return select.selectedOptions[0]?.textContent?.trim() ?? '';
    });
    return /^--.*--$/.test(text) ? '' : text;
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
    return {
      lastSyncDate: await this.page.locator(cf(IDS.lastSyncDate)).inputValue(),
      lastSyncTime: await this.page.locator(cf(IDS.lastSyncTime)).inputValue(),
      lastSyncStatus: await this.readSyncStatusValue(),
      employeeExistsInBizpay: await this.page.locator(cf(IDS.existsInBizpayYes)).isChecked(),
      bizpayUniqueId: await this.page.locator(cf(IDS.bizpayUniqueId)).inputValue(),
    };
  }

  /**
   * Set Skip-sync — used by teardown BEFORE deleting a test employee so the
   * deletion never re-enters the sync queue.
   */
  async setSkipSync(empNumber: string, value: boolean): Promise<void> {
    await this.open(empNumber);
    const checkbox = this.page.locator(cf(IDS.skipSync));
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
    expect(
      await this.page.locator(cf(IDS.skipSync)).isChecked(),
      'Skip-sync must be off',
    ).toBe(false);
  }
}
