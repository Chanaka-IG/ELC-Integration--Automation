import { APIRequestContext } from '@playwright/test';
import { LookupContext } from '../oracle/ohrm-to-bizpay';

/**
 * BizPay sandbox client — read-only verification side.
 *
 * Paths verified against the sandbox's own OpenAPI document
 * ({BIZPAY_URL}/swagger/v1/swagger.json) on 2026-08-10:
 *  - GET /api/Payroll/{payrollId}/Employees          employee list (PLURAL —
 *    the singular /Employee is POST-only and answers GET with 405)
 *  - GET /api/Company/{companyId}/Department
 *  - GET /api/Company/{companyId}/JobTitle
 *  - GET /api/Company/{companyId}/EmployeeCategory
 *
 * The lookup tables are keyed by COMPANY, not payroll (BIZPAY_COMPANY_ID) —
 * addressing them by payrollId returns 404.
 *
 * Every response is wrapped in an envelope: { success: true, data: [...] }.
 */
export class BizpayApi {
  private base: string;
  /** payrollId → owning companyId, resolved once per run. */
  private companyIdByPayroll = new Map<string, string>();

  constructor(
    private request: APIRequestContext,
    base = process.env.BIZPAY_URL!,
    private token = process.env.BIZPAY_API_TOKEN!,
  ) {
    // BIZPAY_URL is written with a trailing slash in some environments
    this.base = base.replace(/\/+$/, '');
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /** GET a path and unwrap the { success, data } envelope into an array. */
  private async getRows<T>(path: string, what: string): Promise<T[]> {
    const res = await this.request.get(`${this.base}${path}`, { headers: this.headers() });
    if (!res.ok()) {
      throw new Error(`BizPay ${what} failed: ${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as { success?: boolean; data?: T[] } | T[];
    // tolerate a bare array in case an endpoint ever answers unwrapped
    const rows = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(rows)) {
      throw new Error(`BizPay ${what} returned no data array: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return rows;
  }

  /** Employees of a payroll — find our test employee by employeeNumber. */
  async findEmployeeByNumber(
    payrollId: string,
    employeeNumber: string,
  ): Promise<Record<string, unknown> | null> {
    const matches = await this.findAllEmployeesByNumber(payrollId, employeeNumber);
    return matches[0] ?? null;
  }

  /** All records for an employeeNumber — update tests assert exactly one. */
  async findAllEmployeesByNumber(
    payrollId: string,
    employeeNumber: string,
  ): Promise<Array<Record<string, unknown>>> {
    const employees = await this.getRows<Record<string, unknown>>(
      `/api/Payroll/${payrollId}/Employees`,
      'employee list',
    );
    return employees.filter((e) => e.employeeNumber === employeeNumber);
  }

  /**
   * The company that owns `payrollId`, found by asking each company for its
   * payrolls.
   *
   * The lookup tables are per-company, so this MUST follow the payroll under
   * test rather than a fixed env var. Different companies hold same-named rows
   * under different ids — department "test" is 20038 under company 562 (which
   * owns payroll 685) but 20036 under company 545 — so reading the tables from
   * the wrong company yields expected ids that can never match, and the field
   * diff fails on correctly-synced data.
   */
  async resolveCompanyId(payrollId: string): Promise<string> {
    const cached = this.companyIdByPayroll.get(payrollId);
    if (cached) return cached;

    const companies = await this.getRows<{ id: number }>('/api/Company', 'company list');
    for (const company of companies) {
      const payrolls = await this.getRows<{ id: number }>(
        `/api/GetPayrollsByCompany?companyId=${company.id}`,
        `payrolls of company ${company.id}`,
      );
      if (payrolls.some((p) => String(p.id) === String(payrollId))) {
        const companyId = String(company.id);
        this.companyIdByPayroll.set(payrollId, companyId);
        return companyId;
      }
    }
    throw new Error(`No BizPay company owns payroll ${payrollId}`);
  }

  /**
   * Live name→id lookup tables (departments, job titles, categories) for the
   * mapping oracle — the same lists the flow itself looks up against, read
   * from the company that owns the payroll under test.
   */
  async getLookupContext(payrollId: string): Promise<LookupContext> {
    const companyId = await this.resolveCompanyId(payrollId);
    const fetchTable = async (table: string): Promise<Record<string, number>> => {
      const rows = await this.getRows<{ id: number; name: string }>(
        `/api/Company/${companyId}/${table}`,
        `lookup ${table}`,
      );
      return Object.fromEntries(rows.map((r) => [r.name, r.id]));
    };
    return {
      departments: await fetchTable('Department'),
      jobTitles: await fetchTable('JobTitle'),
      employeeCategories: await fetchTable('EmployeeCategory'),
    };
  }
}
