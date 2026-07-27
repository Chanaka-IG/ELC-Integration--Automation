import { APIRequestContext } from '@playwright/test';
import { pollUntil } from '../utils/poll';

/**
 * Celigo integrator.io client — READ + trigger-run only.
 * This framework never modifies integration configuration.
 */

export interface CeligoJob {
  _id: string;
  status: string; // queued | running | completed | failed | canceled
  numSuccess?: number;
  numError?: number;
  numIgnore?: number;
  numPagesProcessed?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export class CeligoApi {
  private flowId = process.env.CELIGO_SYNC_EMPLOYEES_FLOW_ID!;

  constructor(
    private request: APIRequestContext,
    private base = process.env.CELIGO_API_BASE ?? 'https://api.integrator.io/v1',
    private token = process.env.CELIGO_API_TOKEN!,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  /** Trigger an on-demand run of the Sync Employees flow. */
  async runSyncEmployeesFlow(): Promise<void> {
    const res = await this.request.post(`${this.base}/flows/${this.flowId}/run`, {
      headers: this.headers(),
    });
    if (!res.ok()) {
      throw new Error(`Flow run trigger failed: ${res.status()} ${await res.text()}`);
    }
  }

  /** Latest jobs for the flow, newest first. */
  async getRecentJobs(): Promise<CeligoJob[]> {
    const res = await this.request.get(`${this.base}/flows/${this.flowId}/jobs`, {
      headers: this.headers(),
    });
    if (!res.ok()) {
      throw new Error(`Job list failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as CeligoJob[];
  }

  /**
   * Wait for a flow run created after `since` to finish — whether we triggered
   * it or the 5-min schedule did. The test doesn't care WHICH run consumed the
   * event; it identifies its record afterwards via the trace key.
   */
  async waitForRunAfter(since: Date, timeoutMs = 8 * 60_000): Promise<CeligoJob> {
    return pollUntil(
      async () => {
        const jobs = await this.getRecentJobs();
        const done = jobs.find(
          (j) =>
            j.createdAt &&
            new Date(j.createdAt) >= since &&
            ['completed', 'failed', 'canceled'].includes(j.status),
        );
        return done ?? null;
      },
      { timeoutMs, intervalMs: 10_000, label: `flow ${this.flowId} run after ${since.toISOString()}` },
    );
  }

  /**
   * Open errors for the flow — used to assert clean runs and, in negative
   * tests, to find the expected [Data] validation error for our employee.
   * Trace key format: "<empNumber>_<employeeId>" (from the insert import).
   */
  async getFlowErrors(): Promise<Array<Record<string, unknown>>> {
    const res = await this.request.get(`${this.base}/flows/${this.flowId}/errors`, {
      headers: this.headers(),
    });
    if (!res.ok()) {
      throw new Error(`Flow errors fetch failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    return Array.isArray(body) ? body : (body.errors ?? []);
  }
}
