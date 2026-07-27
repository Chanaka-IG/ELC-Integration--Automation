import { APIRequestContext } from '@playwright/test';

/**
 * OrangeHRM API client.
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
  constructor(
    private request: APIRequestContext,
    private baseUrl = process.env.OHRM_URL!,
    private token = process.env.OHRM_API_TOKEN!,
  ) {}

  private headers() {
    // TODO(auth): confirm scheme once token is provided (Bearer vs session cookie)
    return { Authorization: `Bearer ${this.token}` };
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
      { headers: this.headers() },
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
}

/** Format a Date as the GMT string the report filter expects. */
export function toReportTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}
