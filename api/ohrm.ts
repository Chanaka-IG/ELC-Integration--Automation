import { APIRequestContext } from '@playwright/test';

/**
 * OrangeHRM API client.
 *
 * Auth: OAuth2 client_credentials — mirrors the Celigo connection's iClient
 * exactly (verified from "[JN] [BIZPAY] [4.0] - OrangeHRM OAuth Client"):
 *   POST {base}/oauth/issueToken  (credentials in body)  → Bearer token
 * Tokens are minted on demand and cached until shortly before expiry;
 * no static token is stored anywhere.
 *
 * The changed-employee report is the EXACT endpoint the Celigo flow's page
 * generator calls — verifying against it proves the OHRM half of the pipeline
 * (add → async event → RabbitMQ consumer → report) independently of Celigo.
 */

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

  constructor(
    private request: APIRequestContext,
    private baseUrl = process.env.OHRM_URL!,
    private clientId = process.env.OHRM_CLIENT_ID!,
    private clientSecret = process.env.OHRM_CLIENT_SECRET!,
  ) {}

  /** Mint (or reuse) a client_credentials access token. */
  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;

    const res = await this.request.post(`${this.baseUrl}/oauth/issueToken`, {
      form: {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
    });
    if (!res.ok()) {
      throw new Error(`OHRM token request failed: ${res.status()} ${await res.text()}`);
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
   * Query the changed-employee report for a time window (GMT), mirroring the
   * Celigo export's query exactly (report_type=3, include_fields_changed=1).
   */
  async getChangeEvents(fromGmt: string, toGmt: string): Promise<ChangeEvent[]> {
    const params = new URLSearchParams({
      'filter[report_type]': '3',
      'filter[event_recorded_date_time_from]': fromGmt,
      'filter[event_recorded_date_time_to]': toGmt,
      'filter[separate_emps_by_change_event]': '0',
      'filter[include_fields_changed]': '1',
      'page[offset]': '0',
      'page[limit]': '100',
    });
    const res = await this.request.get(
      `${this.baseUrl}/api/reports/Changed_Employee_Information_Export_Report?${params}`,
      { headers: await this.headers() },
    );
    if (!res.ok()) {
      throw new Error(`Change report request failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    return (body.data ?? []) as ChangeEvent[];
  }

  /** Find the Add-Employee event for a specific test employee, if recorded. */
  async findAddEvent(employeeId: string, fromGmt: string, toGmt: string): Promise<ChangeEvent | null> {
    const events = await this.getChangeEvents(fromGmt, toGmt);
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
    const events = await this.getChangeEvents(fromGmt, toGmt);
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
