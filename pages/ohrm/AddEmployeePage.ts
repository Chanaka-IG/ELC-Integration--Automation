import { Locator, Page, expect } from '@playwright/test';
import { OhrmEmployeeInput } from '../../oracle/ohrm-to-bizpay';
import { CUSTOM_FIELD_IDS as IDS, cf } from './customFields';

/**
 * PIM add-employee + profile tabs for OrangeHRM 8.1 Enterprise (JN build).
 *
 * ADD EMPLOYEE IS A 6-STEP WIZARD on this build (re-verified live 2026-07-31 —
 * the modal used to have a Save button and created the employee in one shot):
 *
 *   modal "Add Employee"  names / employee id / joined date / Location → NEXT
 *   1 #/pim/wizard/personal_details   Other Id, TRN, NIS, DOB, Marital
 *                                     Status, Gender, Nationality, Salutation
 *   2 #/pim/wizard/job                Job Title, Employment Status, Job
 *                                     Category, Sub Unit, Work Schedule,
 *                                     Attendance Calculation Basis, Contract
 *                                     Type, Group, Company, Work Location
 *   3 #/pim/wizard/contact_details    Street 1, Country, Parish, Mobile,
 *                                     Work Email, Personal Email
 *   4 #/pim/wizard/emergency_contact  >= 1 record required
 *   5 #/pim/wizard/employee_reportto  >= 1 supervisor required
 *   6 #/pim/wizard/qualifications     >= 1 work experience AND >= 1 education
 *                                     then SAVE → lands on the new profile
 *
 * The list steps (4-6) reject Next with "Failed to proceed. You must have at
 * least one record for the section(s) to proceed" until a record exists, so the
 * wizard cannot be short-circuited.
 *
 * PAYROLL NAME IS NOT IN THE WIZARD. The "Payroll Name" custom field — which
 * routes the employee to a BizPay payroll — only exists on the profile Job tab,
 * so setPayrollName() must run after the wizard completes. Its element id is an
 * instance-specific database id; see pages/ohrm/customFields.ts.
 *
 * Both email fields on step 3 are declared with ngModelOptions debounce (1000ms
 * work, 750ms personal). Clicking Next inside that window submits before the
 * model has the typed value, and the step silently stays put — hence the
 * explicit settle before advancing.
 *
 * Profile tabs (used by the update flow, unchanged by the wizard rework):
 *  - Personal Details (#/pim/employees/{n}/personal_details): #otherId,
 *    #ssn (labelled "TRN"), #sin (labelled "NIS Number"), #emp_birthday.
 *  - Job (#/pim/employees/{n}/job): Job Title / Sub Unit / Employment Status
 *    AND the "Payroll Name" custom dropdown.
 *
 * NIS/TRN trap (verified): the integration maps BizPay NIS ← "Other Id"
 * (#otherId) and BizPay TRN ← #ssn. The separate "NIS Number" field (#sin)
 * is NOT read by the integration.
 */
export class AddEmployeePage {
  /** empNumber of the employee created by addEmployee() (from profile URL). */
  empNumber: string | null = null;

  constructor(private page: Page) {}

  /** Run the whole Add Employee wizard; leaves the browser on the new profile. */
  async addEmployee(emp: OhrmEmployeeInput): Promise<void> {
    //passing data for wizard
    await this.submitAddEmployeeModal(emp);
    await this.wizardPersonalDetails(emp);
    await this.wizardJob(emp);
    await this.wizardContactDetails(emp);
    await this.wizardEmergencyContact(emp);
    await this.wizardReportTo(emp);
    await this.wizardQualifications(emp);

    await this.page.waitForURL(/#\/pim\/employees\/\d+/, { timeout: 120_000 });
    const m = this.page.url().match(/#\/pim\/employees\/(\d+)/);
    this.empNumber = m ? m[1] : null;
    expect(this.empNumber, 'empNumber parsed from profile URL').toBeTruthy();
  }

  // ── wizard ─────────────────────────────────────────────────────────────

  /** Step 0: the modal that starts the wizard (Next, not Save). */
  private async submitAddEmployeeModal(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.goto('/client/#/pim/employees');
    const addBtn = this.page.locator('#addEmployeeButton');
    await addBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await addBtn.click();

    const dialog = this.page.getByRole('dialog');
    await this.page.locator('#first-name-box').waitFor({ state: 'visible', timeout: 60_000 });
    await this.page.locator('#first-name-box').fill(emp.firstName);
    if (emp.middleName) await this.page.locator('#middle-name-box').fill(emp.middleName);
    await this.page.locator('#last-name-box').fill(emp.lastName);

    // our own traceable Employee Id instead of auto-generated
    await this.page.locator('#autoGenerateEmployeeId').click({ force: true });
    await this.page.locator('#employeeId').waitFor({ state: 'visible' });
    // the id is uniqueness-checked server-side (GET /api/employeeIds); clicking
    // Next while that is in flight leaves the form pending and is a silent no-op
    const idChecked = this.page
      .waitForResponse((r) => r.url().includes('/api/employeeIds'), { timeout: 30_000 })
      .catch(() => null);
    await this.page.locator('#employeeId').fill(emp.employeeId);
    await this.page.locator('#employeeId').blur();
    await idChecked;

    await this.page.locator('#joinedDate').fill(emp.joinedDate);
    await this.selectDropdown('Location', emp.location);

    await this.advance(
      () => dialog.getByRole('button', { name: 'Next' }).click(),
      /#\/pim\/wizard\/personal_details/,
      'Add Employee modal',
    );
  }

  private async wizardPersonalDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.locator('#ssn').waitFor({ state: 'visible', timeout: 60_000 });
    if (emp.otherId) await this.page.locator('#otherId').fill(emp.otherId); // → BizPay NIS
    if (emp.ssn) await this.page.locator('#ssn').fill(emp.ssn); // labelled TRN → BizPay TRN
    if (emp.nisNumber) await this.page.locator('#sin').fill(emp.nisNumber); // UI-only field
    await this.page.locator('#emp_birthday').fill(emp.dateOfBirth);

    if (emp.maritalStatus) await this.selectDropdown('Marital Status', emp.maritalStatus);
    await this.selectDropdown('Gender', emp.gender);
    if (emp.nationality) await this.selectDropdown('Nationality', emp.nationality);
    if (emp.wizard?.salutation) await this.selectDropdown('Salutation', emp.wizard.salutation);

    await this.wizardNext('job');
  }

  private async wizardJob(emp: OhrmEmployeeInput): Promise<void> {
    const w = emp.wizard;
    if (emp.jobTitle) await this.selectDropdown('Job Title', emp.jobTitle);
    if (emp.employmentStatus) await this.selectDropdown('Employment Status', emp.employmentStatus);
    if (emp.jobCategory) await this.selectDropdown('Job Category', emp.jobCategory);
    await this.selectDropdown('Sub Unit', emp.subUnit);
    if (w?.workSchedule) await this.selectDropdown('Work Schedule', w.workSchedule);
    if (w?.attendanceBasis)
      await this.selectDropdown('Attendance Calculation Basis', w.attendanceBasis);
    if (w?.contractType) await this.selectDropdown('Contract Type', w.contractType);
    if (w?.group) await this.selectDropdown('Group', w.group);
    if (w?.company) await this.selectDropdown('Company', w.company);
    if (w?.employeeWorkLocation)
      await this.selectDropdown('Employee Work Location', w.employeeWorkLocation);

    await this.wizardNext('contact_details');
  }

  private async wizardContactDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.page.locator('#street1').waitFor({ state: 'visible', timeout: 60_000 });
    if (emp.street1) await this.page.locator('#street1').fill(emp.street1);
    if (emp.street2) await this.page.locator('#street2').fill(emp.street2);
    if (emp.city) await this.page.locator('#city').fill(emp.city);
    if (emp.wizard?.province) await this.page.locator('#province').fill(emp.wizard.province);
    if (emp.mobile) await this.page.locator('#emp_mobile').fill(emp.mobile);
    if (emp.workEmail) await this.page.locator('#emp_work_email').fill(emp.workEmail);
    if (emp.wizard?.personalEmail)
      await this.page.locator('#emp_oth_email').fill(emp.wizard.personalEmail);
    if (emp.wizard?.country) await this.selectDropdown('Country', emp.wizard.country);

    // both email fields are declared with ngModelOptions debounce (1000ms work,
    // 750ms personal); submitting inside that window rolls the typed value back
    await this.page.waitForTimeout(1500);
    await this.wizardNext('emergency_contact');
  }

  private async wizardEmergencyContact(emp: OhrmEmployeeInput): Promise<void> {
    const c = emp.wizard?.emergencyContact;
    expect(c, 'wizard.emergencyContact is required — the step rejects Next with 0 records')
      .toBeTruthy();
    await this.openListItemModal();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(c!.name);
    await dialog.getByRole('textbox', { name: /^Relationship/ }).fill(c!.relationship);
    await dialog.getByRole('textbox', { name: /^Mobile/ }).fill(c!.mobile);
    await this.saveListItemModal();

    await this.wizardNext('employee_reportto');
  }

  private async wizardReportTo(emp: OhrmEmployeeInput): Promise<void> {
    const s = emp.wizard?.supervisor;
    expect(s, 'wizard.supervisor is required — the step rejects Next with 0 records').toBeTruthy();
    // this step's FAB expands into a single "add supervisor" sub-button
    await this.openListItemModal('a.btn-floating.blue');
    const dialog = this.page.getByRole('dialog');
    const nameBox = dialog.getByRole('textbox', { name: 'Select Supervisor' });
    await nameBox.pressSequentially(s!.name);
    await dialog.getByText(s!.name, { exact: false }).first().click();
    await this.selectDropdown('Reporting Method', s!.reportingMethod);
    await this.saveListItemModal();

    await this.wizardNext('qualifications');
  }

  private async wizardQualifications(emp: OhrmEmployeeInput): Promise<void> {
    const work = emp.wizard?.workExperience;
    const edu = emp.wizard?.education;
    expect(work, 'wizard.workExperience is required by the Qualifications step').toBeTruthy();
    expect(edu, 'wizard.education is required by the Qualifications step').toBeTruthy();

    await this.openListItemModal('#additem-options-dropdown-qualifications', 'Work Experience');
    let dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /^Company/ }).fill(work!.company);
    await dialog.getByRole('textbox', { name: /^Job Title/ }).fill(work!.jobTitle);
    await this.saveListItemModal();

    await this.openListItemModal('#additem-options-dropdown-qualifications', 'Education');
    dialog = this.page.getByRole('dialog');
    await this.selectDropdown('Level', edu!.level);
    await dialog.getByRole('textbox', { name: /^Institute/ }).fill(edu!.institute);
    await dialog.getByRole('textbox', { name: /^Major\/Specialization/ }).fill(edu!.major);
    await dialog.getByRole('textbox', { name: /^Year/ }).fill(edu!.year);
    await dialog.getByRole('textbox', { name: /^Start Date/ }).fill(edu!.startDate);
    await dialog.getByRole('textbox', { name: /^End Date/ }).fill(edu!.endDate);
    await this.saveListItemModal();

    // final step: Save replaces Next and creates the employee
    await this.advance(
      () => this.page.locator('button[ohrm-click-and-wait="vm.onFinish()"]').click(),
      /#\/pim\/employees\/\d+/,
      'wizard finish (Save)',
    );
  }

  /** Click the wizard's Next and wait for the expected next route. */
  private async wizardNext(nextRoute: string): Promise<void> {
    await this.advance(
      () => this.page.locator('button[ng-click="vm.onNextStep()"]').click(),
      new RegExp(`#/pim/wizard/${nextRoute}`),
      `wizard step → ${nextRoute}`,
    );
  }

  /**
   * Click a Next/Save that advances the wizard, retrying until the route
   * changes.
   *
   * Every step in this wizard rejects invalid input by doing NOTHING — no
   * message, no disabled button — most often because an async validation
   * (employee id uniqueness, work email domain) is still pending. Retrying is
   * what makes the difference between a flaky suite and a stable one; on a
   * genuine validation failure the fields are reported in the error instead of
   * a bare navigation timeout.
   */
  private async advance(
    click: () => Promise<void>,
    route: RegExp,
    what: string,
    timeoutMs = 120_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    while (Date.now() < deadline) {
      // A submit that already landed is indistinguishable from one still
      // pending until the route is checked: the wizard's Save disables itself
      // while it submits and then detaches on navigation, so the NEXT click
      // attempt fails on a button that did its job. Check before clicking.
      if (route.test(this.page.url())) return;

      attempts += 1;
      await this.dismissToasts();
      try {
        await click();
      } catch {
        // The click itself can fail for the same reason — "element is not
        // enabled" / "element was detached from the DOM" is what a successful
        // submit looks like from the clicker's side. Never let that escape the
        // retry loop; the route check below is the real verdict.
      }
      try {
        await this.page.waitForURL(route, { timeout: 15_000 });
        return;
      } catch {
        // silently rejected — fall through and try again
      }
    }
    const problems = await this.formProblems();
    throw new Error(
      `${what}: never advanced to ${route} after ${attempts} attempts. ` +
        `Rejected fields: ${problems.length ? problems.join('; ') : '(the form reported none)'}`,
    );
  }

  /** Labels of ng-invalid controls plus any toast text, for failure messages. */
  private async formProblems(): Promise<string[]> {
    return this.page.evaluate(() => {
      const labelFor = (el: Element) => {
        let scope: Element | null = el;
        for (let i = 0; i < 6 && scope; i++) {
          const text = [...scope.querySelectorAll('label')]
            .map((l) => l.textContent?.trim())
            .filter(Boolean)[0];
          if (text) return text;
          scope = scope.parentElement;
        }
        return el.id || el.tagName;
      };
      const invalid = [...document.querySelectorAll('input.ng-invalid, select.ng-invalid')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          // the failing Angular validator is named in the ng-invalid-* classes
          const why = [...el.classList]
            .filter((c) => c.startsWith('ng-invalid-'))
            .map((c) => c.replace('ng-invalid-', ''))
            .join(',');
          const value = (el as HTMLInputElement).value;
          return `${labelFor(el)} (#${el.id || '?'}) value="${value}" failed=[${why}]`;
        });
      const toasts = [...document.querySelectorAll('#toast-container .toast')].map((t) =>
        (t.textContent ?? '').replace(/^×/, '').trim(),
      );
      return [...new Set([...invalid, ...toasts])];
    });
  }

  /**
   * Open the "add record" modal on a list step. The floating + is either the
   * modal trigger itself, a FAB that expands to one sub-button, or a FAB that
   * opens a dropdown of record types.
   */
  private async openListItemModal(subTrigger?: string, itemLabel?: string): Promise<void> {
    await this.dismissToasts();
    const fab = this.page.locator('a.btn-floating.btn-large');
    if (subTrigger) {
      const sub = itemLabel
        ? this.page.locator(subTrigger).getByText(itemLabel, { exact: true })
        : this.page.locator(subTrigger);
      // Materialize FAB menus expand on hover; clicking the main FAB then
      // TOGGLES the menu shut again (hover opened it, the click closed it),
      // leaving the sub-button animating away — hover first, click only if
      // the trigger is the dropdown kind that needs an actual click.
      await fab.hover();
      try {
        await sub.waitFor({ state: 'visible', timeout: 3_000 });
      } catch {
        await fab.click();
        await sub.waitFor({ state: 'visible', timeout: 10_000 });
      }
      await sub.click();
    } else {
      await fab.click();
    }
    await this.page.getByRole('dialog').waitFor({ state: 'visible', timeout: 30_000 });
  }

  private async saveListItemModal(): Promise<void> {
    await this.page.locator('#modal-save-button').click();
    await this.page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
  }

  /**
   * Error toasts are position-fixed over the floating + and intercept clicks
   * for their whole lifetime, so remove them rather than waiting them out.
   */
  private async dismissToasts(): Promise<void> {
    await this.page.evaluate(() => {
      document.querySelectorAll('#toast-container .toast').forEach((t) => t.remove());
    });
  }

  // ── profile tabs (update flow) ─────────────────────────────────────────

  /**
   * Payroll Name (cust121) — the sync routing field. Absent from the wizard, so
   * it has to be set on the profile Job tab once the employee exists.
   */
  async setPayrollName(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('job');
    await this.selectDropdown('Payroll Name', emp.payrollName);
    // The Job tab stacks several sections that each have their own Save; the
    // page-wide first Save submits a DIFFERENT section (without cust121) and
    // the value silently never persists. The Job-details card's own Save is
    // an <a>, not a <button>, so target the Save inside the nearest container
    // that also holds the Payroll Name field.
    const card = this.page
      .locator(cf(IDS.payrollName))
      .locator(
        'xpath=ancestor::*[.//a[normalize-space()="Save"] or .//button[normalize-space()="Save"]][1]',
      );
    // the save request is issued asynchronously after the click (and may pop
    // a confirmation dialog first) — reloading too early cancels it entirely
    const saveResponse = this.page
      .waitForResponse(
        (r) =>
          ['PUT', 'POST'].includes(r.request().method()) &&
          /\/api\/employees\/\d+\//.test(r.url()),
        { timeout: 20_000 },
      )
      .catch(() => null);
    await card.locator('a:text-is("Save"), button:text-is("Save")').first().click();
    const confirmDialog = this.page.getByRole('dialog');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3_000 });
      await confirmDialog.getByRole('button', { name: /^(save|yes|confirm|ok)$/i }).click();
    } catch {
      // no confirmation dialog appeared — the save fires directly
    }
    await saveResponse;
    // the save reports nothing on failure — reload and prove it stuck
    await this.page.reload();
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await expect(this.page.locator(`${cf(IDS.payrollName)} input`)).toHaveValue(emp.payrollName, {
      timeout: 30_000,
    });
  }

  /** Personal Details tab: DOB, gender, Other Id (→NIS), TRN, NIS Number. */
  async fillPersonalDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('personal_details');
    if (emp.otherId) await this.page.locator('#otherId').fill(emp.otherId); // → BizPay NIS
    if (emp.ssn) await this.page.locator('#ssn').fill(emp.ssn); // labelled TRN → BizPay TRN
    if (emp.nisNumber) await this.page.locator('#sin').fill(emp.nisNumber); // UI-only field
    await this.page.locator('#emp_birthday').fill(emp.dateOfBirth);
    await this.selectDropdown('Gender', emp.gender);
    if (emp.maritalStatus) await this.selectDropdown('Marital Status', emp.maritalStatus);
    if (emp.nationality) await this.selectDropdown('Nationality', emp.nationality);
    await this.saveSection('Personal Details');
  }

  /** Job tab: job title, sub unit, employment status AND Payroll Name. */
  async fillJobDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('job');
    if (emp.jobTitle) await this.selectDropdown('Job Title', emp.jobTitle);
    if (emp.jobCategory) await this.selectDropdown('Job Category', emp.jobCategory);
    if (emp.employmentStatus) await this.selectDropdown('Employment Status', emp.employmentStatus);
    await this.selectDropdown('Sub Unit', emp.subUnit);
    await this.selectDropdown('Payroll Name', emp.payrollName);
    await this.saveSection('Job');
  }

  /** Contact Details tab: address, mobile, work email. */
  async fillContactDetails(emp: OhrmEmployeeInput): Promise<void> {
    await this.gotoTab('contact_details');
    if (emp.street1) await this.page.locator('#street1').fill(emp.street1);
    if (emp.street2) await this.page.locator('#street2').fill(emp.street2);
    if (emp.city) await this.page.locator('#city').fill(emp.city);
    if (emp.mobile) await this.page.locator('#emp_mobile').fill(emp.mobile);
    if (emp.workEmail) await this.page.locator('#emp_work_email').fill(emp.workEmail);
    await this.saveSection('Contact Details');
  }

  private async gotoTab(tab: string): Promise<void> {
    expect(this.empNumber, 'addEmployee() must run first').toBeTruthy();
    await this.page.goto(`/client/#/pim/employees/${this.empNumber}/${tab}`);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  private async saveSection(section: string): Promise<void> {
    await this.page.getByRole('button', { name: /^save$/i }).first().click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  // ── dropdowns ─────────────────────────────────────────────────────────

  /**
   * Select a value in the dropdown belonging to `label`.
   *
   * This build mixes two dropdown widgets — Materialize (hidden <select> + a
   * .select-wrapper input, options in ul.select-dropdown) and the oxd widget
   * (.dropdown-field-focus-element, options with role=option) — and labels are
   * sometimes a <label> and sometimes a plain div next to the control. Rather
   * than one CSS selector per variant, the label is resolved in the page and
   * the control is tagged so the click itself still gets Playwright's
   * actionability checks.
   */
  private async selectDropdown(label: string, value: string): Promise<void> {
    // an option list left open by the previous field is absolutely positioned
    // over this one, and a forced click would land on the overlay instead
    await this.waitForClosedDropdowns();
    const control = await this.tagFieldControl(label);
    await control.click({ force: true });
    const option = await this.tagOption(value);
    await option.click({ force: true });
    await this.waitForClosedDropdowns();
  }

  private async waitForClosedDropdowns(): Promise<void> {
    await expect
      .poll(
        () =>
          this.page.evaluate(() =>
            [
              ...document.querySelectorAll('[role=option], ul.select-dropdown li'),
            ].some((o) => (o as HTMLElement).offsetParent !== null),
          ),
        { timeout: 15_000, message: 'a dropdown option list stayed open' },
      )
      .toBe(false);
  }

  /**
   * Tag the interactive element of the field labelled `label`. Polls because
   * each wizard step renders its fields after the route has already changed.
   */
  private async tagFieldControl(label: string): Promise<Locator> {
    const findControl = () =>
      this.page.evaluate(
      ({ label, mark }) => {
        document.querySelectorAll(`[${mark}]`).forEach((e) => e.removeAttribute(mark));
        const want = label.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
        const ownText = (el: Element) =>
          [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .replace(/\*/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const CONTROL =
          '.dropdown-field-focus-element, .select-wrapper input, input:not([type=hidden]), textarea';
        for (const el of document.querySelectorAll('label, div, span, p')) {
          if (ownText(el) !== want) continue;
          let scope: Element | null = el;
          for (let i = 0; i < 5 && scope; i++) {
            const control = scope.querySelector(CONTROL);
            if (control && (control as HTMLElement).offsetParent !== null) {
              control.setAttribute(mark, '1');
              return true;
            }
            scope = scope.parentElement;
          }
        }
        return false;
      },
      { label, mark: FIELD_MARK },
    );
    await expect
      .poll(findControl, {
        timeout: 30_000,
        message: `no control found for field "${label}" on ${this.page.url()}`,
      })
      .toBe(true);
    return this.page.locator(`[${FIELD_MARK}]`);
  }

  /** Tag the open dropdown's option whose text is `value`. */
  private async tagOption(value: string): Promise<Locator> {
    await expect
      .poll(
        async () =>
          this.page.evaluate(
            ({ value, mark }) => {
              document.querySelectorAll(`[${mark}]`).forEach((e) => e.removeAttribute(mark));
              const want = value.replace(/\s+/g, ' ').trim();
              const options = document.querySelectorAll(
                '[role=option], ul.select-dropdown li, .dropdown-content li',
              );
              for (const o of options) {
                if ((o as HTMLElement).offsetParent === null) continue;
                if ((o.textContent ?? '').replace(/\s+/g, ' ').trim() !== want) continue;
                o.setAttribute(mark, '1');
                return true;
              }
              return false;
            },
            { value, mark: OPTION_MARK },
          ),
        { timeout: 30_000, message: `option "${value}" never appeared in the open dropdown` },
      )
      .toBe(true);
    return this.page.locator(`[${OPTION_MARK}]`);
  }
}

const FIELD_MARK = 'data-pw-field';
const OPTION_MARK = 'data-pw-option';
