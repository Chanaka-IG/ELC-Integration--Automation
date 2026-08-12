import { APIRequestContext } from '@playwright/test';
import { LookupContext } from '../oracle/ohrm-to-bizpay';
import { NonRetryableError } from '../utils/poll';

/** Expiry of a JWT's `exp` claim, or null if it cannot be read. */
function jwtExpiry(token: string | undefined): Date | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return claims.exp ? new Date(claims.exp * 1000) : null;
  } catch {
    return null;
  }
}

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
 *
 * AUTH: the sandbox issues SHORT-LIVED bearer tokens, so a token pasted into
 * BIZPAY_API_TOKEN goes stale during the day and every BizPay assertion then
 * fails with a bodyless 401 (observed 2026-08-12: a token expired *between*
 * two steps of one run). Prefer BIZPAY_USERNAME + BIZPAY_API_KEY, which let
 * this client mint and silently re-mint tokens via POST /api/auth/token;
 * BIZPAY_API_TOKEN remains supported as a fallback for when only a token is at
 * hand.
 */
export class BizpayApi {
  private base: string;
  /** payrollId → owning companyId, resolved once per run. */
  private companyIdByPayroll = new Map<string, string>();
  /** Minted token cache (unused when only a static token is configured). */
  private mintedToken: string | null = null;
  private mintedExpiresAt = 0;

  constructor(
    private request: APIRequestContext,
    base = process.env.BIZPAY_URL!,
    private staticToken = process.env.BIZPAY_API_TOKEN,
    private username = process.env.BIZPAY_USERNAME,
    private apiKey = process.env.BIZPAY_API_KEY,
  ) {
    // BIZPAY_URL is written with a trailing slash in some environments
    this.base = base.replace(/\/+$/, '');
  }

  /** Can this client obtain a fresh token by itself? */
  private canMint(): boolean {
    return Boolean(this.username && this.apiKey);
  }

  /** POST /api/auth/token — { username, apiKey } → bearer token. */
  private async mintToken(): Promise<string> {
    const res = await this.request.post(`${this.base}/api/auth/token`, {
      headers: { 'Content-Type': 'application/json' },
      data: { username: this.username, apiKey: this.apiKey },
    });
    const text = await res.text();
    if (!res.ok()) {
      throw new NonRetryableError(
        `BizPay token request failed: ${res.status()} ${text.slice(0, 200)}. ` +
          'Check BIZPAY_USERNAME / BIZPAY_API_KEY.',
      );
    }
    let token: string | undefined;
    try {
      const body = JSON.parse(text);
      token = body.token ?? body.data?.token ?? body.accessToken ?? body.access_token;
    } catch {
      token = text.trim().replace(/^"|"$/g, '') || undefined;
    }
    if (!token) {
      throw new NonRetryableError(
        `BizPay token response carried no token: ${text.slice(0, 200)}`,
      );
    }
    this.mintedToken = token;
    // refresh a minute before expiry; assume 5 min when exp is unreadable
    const exp = jwtExpiry(token);
    this.mintedExpiresAt = exp ? exp.getTime() - 60_000 : Date.now() + 4 * 60_000;
    return token;
  }

  private async getToken(): Promise<string> {
    if (this.canMint()) {
      if (this.mintedToken && Date.now() < this.mintedExpiresAt) return this.mintedToken;
      return this.mintToken();
    }
    if (!this.staticToken) {
      throw new NonRetryableError(
        'No BizPay credentials: set BIZPAY_USERNAME + BIZPAY_API_KEY (preferred, ' +
          'lets tokens be re-minted automatically) or BIZPAY_API_TOKEN.',
      );
    }
    return this.staticToken;
  }

  private async headers() {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /**
   * Why a rejected token must abort the poll loop rather than be retried: an
   * expired token is not an eventual-consistency condition, so polling it for
   * the full timeout only delays a failure that will never clear — and reports
   * it as "timed out waiting for employee X" instead of "the token expired".
   */
  private async rejectedTokenError(status: number): Promise<NonRetryableError> {
    if (this.canMint()) {
      return new NonRetryableError(
        `BizPay rejected a freshly minted token (${status}). Check that ` +
          'BIZPAY_USERNAME / BIZPAY_API_KEY still grant access.',
      );
    }
    const exp = jwtExpiry(this.staticToken);
    const when = exp
      ? `it expired at ${exp.toISOString()} (now ${new Date().toISOString()})`
      : 'its expiry could not be read';
    return new NonRetryableError(
      `BizPay rejected BIZPAY_API_TOKEN (${status}) — ${when}. Paste a fresh ` +
        'token, or set BIZPAY_USERNAME + BIZPAY_API_KEY so tokens are minted ' +
        'and re-minted automatically.',
    );
  }

  /** GET a path and unwrap the { success, data } envelope into an array. */
  private async getRows<T>(path: string, what: string): Promise<T[]> {
    let res = await this.request.get(`${this.base}${path}`, { headers: await this.headers() });
    // A token can lapse mid-run; when we can mint, drop it and replay once.
    if ((res.status() === 401 || res.status() === 403) && this.canMint()) {
      this.mintedToken = null;
      this.mintedExpiresAt = 0;
      res = await this.request.get(`${this.base}${path}`, { headers: await this.headers() });
    }
    if (res.status() === 401 || res.status() === 403) throw await this.rejectedTokenError(res.status());
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
