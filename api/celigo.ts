import { APIRequestContext } from '@playwright/test';
import { pollUntil } from '../utils/poll';

/**
 * Celigo integrator.io client — READ + trigger-run only.
 * This framework never modifies integration configuration.
 *
 * Endpoint shapes verified live on 2026-07-27:
 *  - POST /flows/{id}/run           → 200, body includes _jobId
 *  - GET  /jobs/{jobId}             → job with status/numSuccess/numError...
 *  - GET  /jobs?_flowId={id}&type=flow → job list, newest first
 *  - GET  /flows/{id}/errors        → { flowErrors: [{_expOrImpId, numError, ...}] }
 *  (GET /flows/{id}/jobs does NOT exist — returns 404.)
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

  /** Trigger an on-demand run; returns the job id to track. */
  async runSyncEmployeesFlow(): Promise<string> {
    const res = await this.request.post(`${this.base}/flows/${this.flowId}/run`, {
      headers: this.headers(),
    });
    if (!res.ok()) {
      throw new Error(`Flow run trigger failed: ${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as { _jobId?: string };
    if (!body._jobId) throw new Error(`Run trigger returned no _jobId: ${JSON.stringify(body).slice(0, 200)}`);
    return body._jobId;
  }

  async getJob(jobId: string): Promise<CeligoJob> {
    const res = await this.request.get(`${this.base}/jobs/${jobId}`, { headers: this.headers() });
    if (!res.ok()) throw new Error(`Job fetch failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as CeligoJob;
  }

  /** Wait for a specific job (from runSyncEmployeesFlow) to reach a terminal state. */
  async waitForJob(jobId: string, timeoutMs = 8 * 60_000): Promise<CeligoJob> {
    return pollUntil(
      async () => {
        const job = await this.getJob(jobId);
        return ['completed', 'failed', 'canceled'].includes(job.status) ? job : null;
      },
      { timeoutMs, intervalMs: 10_000, label: `job ${jobId} terminal state` },
    );
  }

  /** Recent jobs for the flow (newest first) — includes scheduled runs. */
  async getRecentJobs(): Promise<CeligoJob[]> {
    const res = await this.request.get(
      `${this.base}/jobs?_flowId=${this.flowId}&type=flow`,
      { headers: this.headers() },
    );
    if (!res.ok()) throw new Error(`Job list failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as CeligoJob[];
  }

  /**
   * Schedule-immunity fallback: wait for ANY run created after `since`
   * (ours or the 5-min scheduler's) to finish.
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
   * Open-error summary per flow step: [{_expOrImpId, numError, lastErrorAt}].
   * Trace key format for drill-down: "<empNumber>_<employeeId>".
   */
  async getFlowErrorSummary(): Promise<Array<Record<string, unknown>>> {
    const res = await this.request.get(`${this.base}/flows/${this.flowId}/errors`, {
      headers: this.headers(),
    });
    if (!res.ok()) throw new Error(`Flow errors fetch failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    return (body.flowErrors ?? []) as Array<Record<string, unknown>>;
  }
}
