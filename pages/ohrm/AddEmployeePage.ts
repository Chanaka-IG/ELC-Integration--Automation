import { Page, expect } from '@playwright/test';
import { OhrmEmployeeInput } from '../../oracle/ohrm-to-bizpay';

/**
 * PIM add-employee + profile tabs for OrangeHRM 8.1 Enterprise (JN build).
 * All selectors verified against the live QA instance on 2026-07-27:
 *
 *  - Employee list (#/pim/employees) has a floating "+" button
 *    (#addEmployeeButton) that opens the "Add Employee" MODAL (in-place,
 *    no URL change): #first-name-box / #middle-name-box / #last-name-box,
 *    "Auto Generate Employee ID" toggle (#autoGenerateEmployeeId — turning it
 *    OFF reveals #employeeId), #joinedDate, REQUIRED Location dropdown, Save.
 *  - Personal Details (#/pim/employees/{n}/personal_details): #otherId,
 *    #ssn (labelled "TRN"), #sin (labelled "NIS Number"), #emp_birthday,
 *    Gender/Marital Status/Nationality custom dropdowns.
 *  - Job tab (#/pim/employees/{n}/job): Job Title / Sub Unit / Employment
 *    Status dropdowns AND the "Payroll Name" custom dropdown (cust121).
 *
 * NIS/TRN trap (verified): the integration maps BizPay NIS ← "Other Id"
 * (#otherId) and BizPay TRN ← #ssn. The separate "NIS Number" field (#sin)
 * is NOT read by the integration.
 */
export class AddEmployeePage {
  /** empNumber of the employee created by addEmployee() (from profile URL). */
  empNumber: string | null = null;

  constructor(private page: Page) {}

  /** Create the employee via the Add Employee modal. */
  async addEmployee(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.goto('/client/#/pim/employees');
    const addBtn = this.page.locator('#addEmployeeButton');
    await addBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await addBtn.click();

    await this.page.locator('#first-name-box').waitFor({ state: 'visible', timeout: 60_000 });
    await this.page.locator('#first-name-box').fill(emp.firstName);
    if (emp.middleName) await this.page.locator('#middle-name-box').fill(emp.middleName);
    await this.page.locator('#last-name-box').fill(emp.lastName);

    // our own traceable Employee Id instead of auto-generated
    await this.page.locator('#autoGenerateEmployeeId').click({ force: true });
    await this.page.locator('#employeeId').waitFor({ state: 'visible' });
    await this.page.locator('#employeeId').fill(emp.employeeId);

    await this.page.locator('#joinedDate').fill(emp.joinedDate);

    // Location is REQUIRED on this build (searchable custom dropdown)
    await this.selectModalDropdown(emp.location);

    await this.page.getByRole('button', { name: 'Save' }).click();
    // app navigates to the new profile: #/pim/employees/{empNumber}/...
    await this.page.waitForURL(/#\/pim\/employees\/\d+/, { timeout: 60_000 });
    const m = this.page.url().match(/#\/pim\/employees\/(\d+)/);
    this.empNumber = m ? m[1] : null;
    expect(this.empNumber, 'empNumber parsed from profile URL').toBeTruthy();
  }

  /** Personal Details tab: DOB, gender, Other Id (→NIS), TRN, NIS Number. */
  async fillPersonalDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('personal_details');
    if (emp.otherId) await this.page.locator('#otherId').fill(emp.otherId); // → BizPay NIS
    if (emp.ssn) await this.page.locator('#ssn').fill(emp.ssn); // labelled TRN → BizPay TRN
    if (emp.nisNumber) await this.page.locator('#sin').fill(emp.nisNumber); // UI-only field
    await this.page.locator('#emp_birthday').fill(emp.dateOfBirth);
    await this.page.keyboard.press('Escape'); // dismiss datepicker popup
    await this.selectLabelledDropdown('Gender', emp.gender);
    await this.saveSection('Personal Details');
  }

  /** Job tab: job title, sub unit, employment status AND Payroll Name. */
  async fillJobDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('job');
    if (emp.jobTitle) await this.selectLabelledDropdown('Job Title', emp.jobTitle);
    if (emp.employmentStatus)
      await this.selectLabelledDropdown('Employment Status', emp.employmentStatus);
    await this.selectLabelledDropdown('Sub Unit', emp.subUnit);
    // Payroll Name (cust121) — the sync routing field — lives on THIS tab
    await this.selectLabelledDropdown('Payroll Name', emp.payrollName);
    await this.saveSection('Job');
  }

  /** Contact Details tab: address, mobile, work email. */
  async fillContactDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('contact_details');
    // TODO(verify): field ids on first supervised run; labels per UI
    if (emp.street1) await this.fillLabelled('Street 1', emp.street1);
    if (emp.street2) await this.fillLabelled('Street 2', emp.street2);
    if (emp.city) await this.fillLabelled('City', emp.city);
    if (emp.mobile) await this.fillLabelled('Mobile', emp.mobile);
    if (emp.workEmail) await this.fillLabelled('Work Email', emp.workEmail);
    await this.saveSection('Contact Details');
  }

  private async gotoTab(tab: string): Promise<void> {
    expect(this.empNumber, 'addEmployee() must run first').toBeTruthy();
    await this.page.goto(`/client/#/pim/employees/${this.empNumber}/${tab}`);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  /** Custom searchable dropdown inside the Add Employee modal (Location). */
  private async selectModalDropdown(value: string): Promise<void> {
    const trigger = this.page.locator('.dropdown-field-focus-element').first();
    await trigger.click({ force: true });
    await this.page.keyboard.type(value.slice(0, 20));
    await this.page.getByText(value, { exact: true }).first().click();
  }

  /** Dropdown identified by its field label (Job/Personal Details tabs). */
  private async selectLabelledDropdown(label: string, value: string): Promise<void> {
    const field = this.page
      .locator(`.row:has(label:text-is("${label}")), [class*=field]:has(label:text-is("${label}"))`)
      .first();
    await field.locator('input, .select-wrapper').first().click({ force: true });
    await this.page.getByText(value, { exact: true }).first().click();
  }

  private async fillLabelled(label: string, value: string): Promise<void> {
    const field = this.page
      .locator(`.row:has(label:text-is("${label}")), [class*=field]:has(label:text-is("${label}"))`)
      .first();
    await field.locator('input[type=text], textarea').first().fill(value);
  }

  private async saveSection(section: string): Promise<void> {
    await this.page.getByRole('button', { name: /^save$/i }).first().click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }
}
