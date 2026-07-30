import { APIRequestContext } from '@playwright/test';
import { LookupContext } from '../oracle/ohrm-to-bizpay';

/**
 * BizPay sandbox client — read-only verification side.
 * Endpoint paths follow the integration's usage (/api/Payroll/{payrollId}/...);
 * TODO(auth+paths): confirm against the real sandbox once the token arrives.
 */
export class BizpayApi {
  constructor(
    private request: APIRequestContext,
    private base = process.env.BIZPAY_URL!,
    private token = process.env.BIZPAY_API_TOKEN!,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
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
    const res = await this.request.get(`${this.base}/api/Payroll/${payrollId}/Employee`, {
      headers: this.headers(),
    });
    if (!res.ok()) {
      throw new Error(`BizPay employee list failed: ${res.status()} ${await res.text()}`);
    }
    const employees = (await res.json()) as Array<Record<string, unknown>>;
    return employees.filter((e) => e.employeeNumber === employeeNumber);
  }

  /**
   * Live name→id lookup tables (departments, job titles, categories) for the
   * mapping oracle — the same lists the flow itself looks up against.
   */
  async getLookupContext(payrollId: string): Promise<LookupContext> {
    const fetchTable = async (path: string): Promise<Record<string, number>> => {
      const res = await this.request.get(`${this.base}${path}`, { headers: this.headers() });
      if (!res.ok()) {
        throw new Error(`BizPay lookup ${path} failed: ${res.status()}`);
      }
      const rows = (await res.json()) as Array<{ id: number; name: string }>;
      return Object.fromEntries(rows.map((r) => [r.name, r.id]));
    };
    return {
      departments: await fetchTable(`/api/Payroll/${payrollId}/Department`),
      jobTitles: await fetchTable(`/api/Payroll/${payrollId}/JobTitle`),
      employeeCategories: await fetchTable(`/api/Payroll/${payrollId}/EmployeeCategory`),
    };
  }
}
