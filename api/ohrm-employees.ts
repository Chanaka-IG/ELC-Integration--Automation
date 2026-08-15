import { APIRequestContext, Page } from '@playwright/test';
import { OhrmEmployeeInput } from '../oracle/ohrm-to-bizpay';

/**
 * OHRM employee-creation API client — replaces driving the Add Employee UI.
 *
 * WHY: this build toggles the 6-step Add Employee wizard on and off between
 * QA-instance rebuilds, so any UI page object is written against a moving
 * target. Both UI variants (wizard and legacy modal) end in the SAME backend
 * calls, captured live from a wizard run on 2026-08-15 (see the trace analysis
 * in explore/api-capture-notes.md):
 *
 *   POST  /api/wizard                      ← wizard finish: a BATCH whose body
 *                                            names the individual endpoints
 *   [ POST  employees                        create (modal fields)
 *     PATCH employees/{n}                    personal details
 *     PATCH employees/{n}/job               job ids
 *     PUT   employees/{n}/CustomFieldValues custom fields per section
 *     PATCH employees/{n}                    contact details               ]
 *
 * This client calls those individual endpoints directly, so it works no matter
 * which UI variant is enabled — and skips the emergency-contact / supervisor /
 * qualifications records entirely: they are wizard-step gate requirements, not
 * server-side ones, and the integration never reads them.
 *
 * AUTH: the SPA authenticates /api calls with a Bearer token it fetches from
 * GET /core/getLoggedInAccountToken using the login session cookie. This client
 * does the same: construct it from a Page whose context has already passed
 * LoginPage.loginAsSysadmin(), and it mints the token on first use. No extra
 * /oauth/issueToken traffic — important because OHRM temporarily blocks clients
 * that authenticate repeatedly.
 *
 * MASTER DATA: every dropdown the UI resolved for us (job title, sub unit,
 * nationality, ...) must be resolved name→id here. All tables are fetched live
 * per run — ids are instance state and a rebuild renumbers them (README rule 6).
 * A name that no longer exists fails loudly with the available options instead
 * of silently sending nothing.
 *
 * PAYROLL NAME: located by LABEL on the job-standard custom-field screen at
 * runtime (customFieldId 123 / section 4 on the current instance) — this client
 * does not depend on pages/ohrm/customFields.ts ids.
 */

interface CustomFieldRef {
  sectionId: string;
  customFieldId: string;
  type: string;
  extraData: string; // comma-separated option list (unmodifiedExtraData)
  options: string[];
}

export class OhrmEmployeeApi {
  private request: APIRequestContext;
  private token: string | null = null;
  private lookups: Map<string, Record<string, string>> = new Map();

  /** Construct AFTER LoginPage.loginAsSysadmin() — the token mint needs the session. */
  constructor(private page: Page, private baseUrl = process.env.OHRM_URL!) {
    this.request = page.request;
    this.baseUrl = this.baseUrl.replace(/\/+$/, '');
  }

  // ── auth ────────────────────────────────────────────────────────────────

  /**
   * The same token endpoint the SPA uses — but it only answers requests made
   * from INSIDE the page: replaying it through page.request with identical
   * cookies and headers gets 401 "Login Required" (verified 2026-08-15), so it
   * must be fetched in-page. The /api endpoints themselves accept the Bearer
   * from page.request just fine.
   */
  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await this.page.evaluate(async () => {
      const r = await fetch('/core/getLoggedInAccountToken', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      return { status: r.status, body: await r.text() };
    });
    if (res.status !== 200) {
      throw new Error(
        `getLoggedInAccountToken failed (${res.status} ${res.body.slice(0, 200)}). ` +
          'OhrmEmployeeApi must be used after LoginPage.loginAsSysadmin().',
      );
    }
    const body = JSON.parse(res.body) as { token?: { access_token?: string } };
    if (!body.token?.access_token) {
      throw new Error(`getLoggedInAccountToken returned no token: ${res.body.slice(0, 200)}`);
    }
    this.token = body.token.access_token;
    return this.token;
  }

  private async call(
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    data?: unknown,
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const doCall = async () =>
      this.request[method](url, {
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        ...(data !== undefined ? { data } : {}),
      });
    let res = await doCall();
    if (res.status() === 401) {
      this.token = null; // token lapsed mid-run — re-mint from the session once
      res = await doCall();
    }
    if (!res.ok()) {
      throw new Error(`${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`);
    }
    return res.json().catch(() => ({}));
  }

  // ── master-data lookups (name → id, fetched live, cached per run) ───────

  private async lookup(
    table: string,
    path: string,
    name: string | undefined,
    nameKey = 'name',
    idKey = 'id',
  ): Promise<string | null> {
    if (!name) return null;
    if (!this.lookups.has(table)) {
      const body = await this.call('get', path);
      const map: Record<string, string> = {};
      for (const row of body.data ?? []) map[row[nameKey]] = row[idKey];
      this.lookups.set(table, map);
    }
    const map = this.lookups.get(table)!;
    if (!(name in map)) {
      throw new Error(
        `${table}: "${name}" does not exist on this instance. ` +
          `Available: ${Object.keys(map).slice(0, 30).join(', ')}` +
          (Object.keys(map).length > 30 ? ', …' : ''),
      );
    }
    return map[name];
  }

  // ── custom fields ────────────────────────────────────────────────────────

  /** Locate a custom field by its LABEL on a screen (ids are instance state). */
  private async customFieldByLabel(
    empNumber: string,
    screen: string,
    label: string,
  ): Promise<CustomFieldRef> {
    const body = await this.call(
      'get',
      `/api/employees/${empNumber}/CustomFieldValues?filter%5Bscreen%5D=${screen}&groupedBySection=true`,
    );
    for (const section of body.data ?? []) {
      for (const v of section.values ?? []) {
        if (v.lable !== label) continue; // (sic — the API misspells "label")
        return {
          sectionId: section.id,
          customFieldId: v.customFieldId,
          type: v.type,
          extraData: v.unmodifiedExtraData ?? '',
          options: (v.unmodifiedExtraData ?? '').split(',').filter(Boolean),
        };
      }
    }
    throw new Error(`custom field labelled "${label}" not found on screen "${screen}"`);
  }

  // ── creation ─────────────────────────────────────────────────────────────

  /**
   * Create a fully-populated employee. Returns the empNumber.
   *
   * Mirrors the captured wizard batch: create → personal → job (+ Payroll Name
   * custom field) → contact. Every PATCH goes through the same server services
   * the UI uses, so the async change events (→ RabbitMQ → change report) are
   * recorded exactly as for a UI-entered employee.
   */
  async createEmployee(emp: OhrmEmployeeInput): Promise<string> {
    const empNumber = await this.create(emp);
    await this.savePersonalDetails(empNumber, emp);
    await this.saveJobDetails(empNumber, emp);
    await this.savePayrollName(empNumber, emp.payrollName);
    await this.saveContactDetails(empNumber, emp);
    return empNumber;
  }

  /** POST /api/employees — the Add Employee modal fields. */
  private async create(emp: OhrmEmployeeInput): Promise<string> {
    const locationId = await this.lookup('locations', '/api/employees/locations', emp.location);
    const body = await this.call('post', '/api/employees', {
      firstName: emp.firstName,
      ...(emp.middleName ? { middleName: emp.middleName } : {}),
      lastName: emp.lastName,
      locationId,
      joinedDate: emp.joinedDate,
      autoGenerateEmployeeId: false,
      initiatePreboarding: false,
      employeeId: emp.employeeId,
    });
    const empNumber = body?.data?.empNumber ?? body?.data?.emp_number;
    if (!empNumber) {
      throw new Error(`POST /api/employees returned no empNumber: ${JSON.stringify(body).slice(0, 500)}`);
    }
    return String(empNumber);
  }

  /** PATCH /api/employees/{n} — Personal Details (incl. Other Id → NIS, TRN). */
  private async savePersonalDetails(empNumber: string, emp: OhrmEmployeeInput): Promise<void> {
    await this.call('patch', `/api/employees/${empNumber}`, {
      firstName: emp.firstName,
      ...(emp.middleName ? { middleName: emp.middleName } : {}),
      lastName: emp.lastName,
      employeeId: emp.employeeId,
      ...(emp.otherId ? { otherId: emp.otherId } : {}), // → BizPay NIS
      ...(emp.ssn ? { ssn: emp.ssn } : {}), // labelled TRN → BizPay TRN
      ...(emp.nisNumber ? { sin: emp.nisNumber } : {}), // UI-only "NIS Number"
      emp_birthday: emp.dateOfBirth,
      emp_gender: await this.lookup('gender', '/api/gender', emp.gender),
      emp_marital_status: await this.lookup(
        'marital-statuses',
        '/api/marital-statuses',
        emp.maritalStatus,
      ),
      nation_code: await this.lookup('nationality', '/api/nationality', emp.nationality),
      emp_dri_lice_exp_date: null,
    });
  }

  /** PATCH /api/employees/{n}/job — all name-resolved job ids. */
  private async saveJobDetails(empNumber: string, emp: OhrmEmployeeInput): Promise<void> {
    // A job record may already exist from the create (joined date + location);
    // carry its id/event so the PATCH is an in-place edit, not a new event row.
    const existing = (await this.call('get', `/api/employees/${empNumber}/job`))?.data ?? {};
    await this.call('patch', `/api/employees/${empNumber}/job`, {
      ...(existing.id ? { id: existing.id } : {}),
      joined_date: emp.joinedDate,
      effective_date: emp.joinedDate,
      event_id: existing.event_id ?? '1', // "Joined"
      probation_end_date: null,
      date_of_permanency: null,
      job_title_id: await this.lookup('job-titles', '/api/job-titles?page%5Blimit%5D=0', emp.jobTitle, 'jobTitleName'),
      employment_status_id: await this.lookup('employment-statuses', '/api/employmentStatus', emp.employmentStatus),
      job_category_id: await this.lookup('job-categories', '/api/jobCategories', emp.jobCategory),
      subunit_id: await this.lookup('subunits', '/api/subunits?tree=true', emp.subUnit),
      location_id: await this.lookup('locations', '/api/employees/locations', emp.location),
      work_schedule_id: await this.lookup(
        'work-schedules',
        '/api/pim/workSchedules',
        emp.wizard?.workSchedule ?? 'Default Work Schedule',
      ),
      cost_centre_id: null,
      work_basis: '1', // "Work Schedule" attendance calculation basis
      has_contract_details: '1',
      contract_start_date: null,
      contract_end_date: null,
      comment: '',
    });
  }

  /**
   * PUT /api/employees/{n}/CustomFieldValues — "Payroll Name", the BizPay
   * routing field. Located by label so instance rebuilds cannot break it;
   * validated against the live option list because a payroll that is not in
   * the dropdown would otherwise be accepted here and fail only in the sync.
   */
  private async savePayrollName(empNumber: string, payrollName: string): Promise<void> {
    const field = await this.customFieldByLabel(empNumber, 'job-standard', 'Payroll Name');
    if (!field.options.includes(payrollName)) {
      throw new Error(
        `Payroll Name "${payrollName}" is not an option on this instance. ` +
          `Available: ${field.options.join(', ')}`,
      );
    }
    await this.call('put', `/api/employees/${empNumber}/CustomFieldValues`, [
      {
        section: field.sectionId,
        values: [
          {
            custom_field_id: field.customFieldId,
            type: field.type,
            value: payrollName,
            extra_data: field.extraData,
          },
        ],
      },
    ]);
  }

  /** PATCH /api/employees/{n} — Contact Details. */
  private async saveContactDetails(empNumber: string, emp: OhrmEmployeeInput): Promise<void> {
    const country = await this.lookup(
      'countries',
      '/api/countries',
      emp.wizard?.country,
      'cou_name',
      'cou_code',
    );
    await this.call('patch', `/api/employees/${empNumber}`, {
      ...(emp.street1 !== undefined ? { street1: emp.street1 } : {}),
      ...(emp.street2 !== undefined ? { street2: emp.street2 } : {}),
      ...(emp.city !== undefined ? { city: emp.city } : {}),
      ...(country ? { country } : {}),
      ...(emp.wizard?.province ? { province: emp.wizard.province } : {}),
      ...(emp.mobile !== undefined ? { emp_mobile: emp.mobile } : {}),
      ...(emp.workEmail !== undefined ? { emp_work_email: emp.workEmail } : {}),
      ...(emp.wizard?.personalEmail ? { emp_oth_email: emp.wizard.personalEmail } : {}),
    });
  }

  // ── read-back (verification) ─────────────────────────────────────────────

  /** GET /api/employees/{n} — the full merged employee record. */
  async getEmployee(empNumber: string): Promise<Record<string, unknown>> {
    return (await this.call('get', `/api/employees/${empNumber}`))?.data ?? {};
  }

  /** Current Payroll Name value, read back by label from the live screen. */
  async getPayrollName(empNumber: string): Promise<string> {
    const body = await this.call(
      'get',
      `/api/employees/${empNumber}/CustomFieldValues?filter%5Bscreen%5D=job-standard&groupedBySection=true`,
    );
    for (const section of body.data ?? []) {
      for (const v of section.values ?? []) {
        if (v.lable === 'Payroll Name') return v.value ?? '';
      }
    }
    return '';
  }
}
