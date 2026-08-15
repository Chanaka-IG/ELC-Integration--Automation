import { APIRequestContext } from '@playwright/test';
import { NonRetryableError } from '../utils/poll';

export interface ChangeEvent {
  empNumber: string;
  employeeId: string;
  async_event_display_name: string;
  event_recorded_date_time: string;
  [key: string]: unknown;
}

export class OhrmApi {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  /** Set once OHRM_ACCESS_TOKEN has been rejected — stop preferring it. */
  private suppliedTokenRejected = false;

  private baseUrl: string;

  constructor(
    private request: APIRequestContext,
    baseUrl = process.env.OHRM_URL!,
    private clientId = process.env.OHRM_CLIENT_ID!,
    private clientSecret = process.env.OHRM_CLIENT_SECRET!,
  ) {
    // OHRM_URL is written with a trailing slash in some environments, which
    // would make every path a double slash ("…com//oauth/issueToken").
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Mint (or reuse) a client_credentials access token. */
  private async getToken(): Promise<string> {
    if (process.env.OHRM_ACCESS_TOKEN && !this.suppliedTokenRejected) {
      return process.env.OHRM_ACCESS_TOKEN;
    }

    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;

    const res = await this.request.post(`${this.baseUrl}/oauth/issueToken`, {
      form: {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
    });
    if (!res.ok()) {
      const body = await res.text();
      // OHRM blocks a client after repeated auth traffic; polling through that
      // block only extends it, so fail the run immediately and say why
      if (res.status() === 403 && body.includes('temporarily_blocked')) {
        throw new NonRetryableError(
          'OHRM has temporarily blocked this client from authenticating ' +
            `(${res.status()} ${body}). Wait for the block to lapse before re-running.`,
        );
      }
      throw new Error(`OHRM token request failed: ${res.status()} ${body}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = body.access_token;
    // refresh 60s before expiry; default to 5 min if expires_in is absent
    this.tokenExpiresAt = Date.now() + ((body.expires_in ?? 300) - 60) * 1000;
    return this.accessToken;
  }

  private async headers() {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /**
   * GET with the bearer token, retrying once on 401.
   *
   * A token can be rejected mid-run for two reasons: OHRM_ACCESS_TOKEN was
   * already stale when the run started, or a minted token expired sooner than
   * `expires_in` claimed. Both look identical here — drop whatever token was
   * used, mint a fresh one, and replay the request once.
   */
  private async authedGet(url: string) {
    let res = await this.request.get(url, { headers: await this.headers() });
    if (res.status() !== 401) return res;

    if (process.env.OHRM_ACCESS_TOKEN && !this.suppliedTokenRejected) {
      this.suppliedTokenRejected = true; // stop using the supplied token
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;

    res = await this.request.get(url, { headers: await this.headers() });
    return res;
  }

  /**
   * Query the changed-employee report for a time window (GMT), mirroring the
   * Celigo export's query exactly (report_type=3, include_fields_changed=1).
   */
  async getChangeEvents(
    fromGmt: string,
    toGmt: string,
    separateEvents = false,
  ): Promise<ChangeEvent[]> {
    const params = new URLSearchParams({
      'filter[report_type]': '3',
      'filter[event_recorded_date_time_from]': fromGmt,
      'filter[event_recorded_date_time_to]': toGmt,
      // 0 (Celigo's mode) collapses to ONE row per employee named after the
      // latest change — a later edit (e.g. the Job-tab payroll name) masks
      // the Add Employee event name. Event-name assertions need 1.
      'filter[separate_emps_by_change_event]': separateEvents ? '1' : '0',
      'filter[include_fields_changed]': '1',
      'page[offset]': '0',
      'page[limit]': '100',
    });
    const res = await this.authedGet(
      `${this.baseUrl}/api/reports/Changed_Employee_Information_Export_Report?${params}`,
    );
    if (!res.ok()) {
      throw new Error(`Change report request failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    return (body.data ?? []) as ChangeEvent[];
  }

  /** Find the Add-Employee event for a specific test employee, if recorded. */
  async findAddEvent(employeeId: string, fromGmt: string, toGmt: string): Promise<ChangeEvent | null> {
    const events = await this.getChangeEvents(fromGmt, toGmt, true);
    return (
      events.find(
        (e) => e.employeeId === employeeId && e.async_event_display_name === 'Add Employee',
      ) ?? null
    );
  }

  /**
   * Find an update event for an already-synced employee. Edits on different
   * PIM tabs record differently-named events (e.g. "Update Personal Details"),
   * so match on anything that is not the initial Add-Employee event.
   */
  async findUpdateEvent(
    employeeId: string,
    fromGmt: string,
    toGmt: string,
  ): Promise<ChangeEvent | null> {
    const events = await this.getChangeEvents(fromGmt, toGmt, true);
    return (
      events.find(
        (e) => e.employeeId === employeeId && e.async_event_display_name !== 'Add Employee',
      ) ?? null
    );
  }
}

/** Format a Date as the GMT string the report filter expects. */
export function toReportTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}
