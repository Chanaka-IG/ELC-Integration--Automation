import { Page } from '@playwright/test';
import { OhrmEmployeeInput } from '../../oracle/ohrm-to-bizpay';

/**
 * PIM → Add Employee, plus the follow-up tabs (Personal Details, Job,
 * Contact Details) needed to populate every mapped field.
 *
 * All selectors are provisional until the live-UI exploration pass —
 * they follow standard OrangeHRM 5.x structure and are centralized here so
 * fixing them touches one file only.
 */
export class AddEmployeePage {
  constructor(private page: Page) {}

  async addEmployee(emp: OhrmEmployeeInput): Promise<void> {
    // 8.1 Enterprise serves routes at root (no /web/index.php prefix)
    await this.page.goto('/pim/addEmployee');
    await this.page.getByPlaceholder('First Name').fill(emp.firstName);
    if (emp.middleName) await this.page.getByPlaceholder('Middle Name').fill(emp.middleName);
    await this.page.getByPlaceholder('Last Name').fill(emp.lastName);
    // Employee Id field
    // TODO(selector): confirm — standard 5.x uses a generic input in the form grid
    await this.page.locator('.oxd-input-group:has-text("Employee Id") input').fill(emp.employeeId);
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForURL('**/viewPersonalDetails/**');
  }

  /** Personal Details tab: gender, DOB, Other ID (→NIS), SSN (→TRN). */
  async fillPersonalDetails(emp: OhrmEmployeeInput): Promise<void> {
    // Assumes we are on viewPersonalDetails after addEmployee()
    // TODO(selector): confirm each control on the QA instance
    if (emp.otherId) {
      await this.page.locator('.oxd-input-group:has-text("Other Id") input').fill(emp.otherId);
    }
    if (emp.ssn) {
      // OHRM "SSN Number" → BizPay TRN — deliberate, see mapping oracle
      await this.page.locator('.oxd-input-group:has-text("SSN") input').fill(emp.ssn);
    }
    await this.page
      .locator('.oxd-input-group:has-text("Date of Birth") input')
      .fill(emp.dateOfBirth);
    await this.page.locator(`label:has-text("${emp.gender}")`).click();
    await this.page.getByRole('button', { name: 'Save' }).first().click();
  }

  /** Job tab: joined date, job title, sub unit, employment status. */
  async fillJobDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.getByRole('link', { name: 'Job' }).click();
    await this.page
      .locator('.oxd-input-group:has-text("Joined Date") input')
      .fill(emp.joinedDate);
    if (emp.jobTitle) await this.selectDropdown('Job Title', emp.jobTitle);
    if (emp.employmentStatus) await this.selectDropdown('Employment Status', emp.employmentStatus);
    await this.selectDropdown('Sub Unit', emp.subUnit);
    await this.page.getByRole('button', { name: 'Save' }).first().click();
  }

  /** Contact Details tab: street1/street2/city, mobile, work email. */
  async fillContactDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.getByRole('link', { name: 'Contact Details' }).click();
    if (emp.street1)
      await this.page.locator('.oxd-input-group:has-text("Street 1") input').fill(emp.street1);
    if (emp.street2)
      await this.page.locator('.oxd-input-group:has-text("Street 2") input').fill(emp.street2);
    if (emp.city) await this.page.locator('.oxd-input-group:has-text("City") input').fill(emp.city);
    if (emp.mobile)
      await this.page.locator('.oxd-input-group:has-text("Mobile") input').fill(emp.mobile);
    if (emp.workEmail)
      await this.page.locator('.oxd-input-group:has-text("Work Email") input').fill(emp.workEmail);
    await this.page.getByRole('button', { name: 'Save' }).first().click();
  }

  private async selectDropdown(label: string, value: string): Promise<void> {
    const group = this.page.locator(`.oxd-input-group:has-text("${label}")`);
    await group.locator('.oxd-select-text').click();
    await this.page.getByRole('option', { name: value }).click();
  }
}
