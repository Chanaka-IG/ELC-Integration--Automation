import { Page, Frame, expect } from '@playwright/test';

/**
 * Sysadmin: manually execute a Management Tools task (verified live 2026-07-27).
 *
 * Flow: Management Tools → Executable Tasks (renders in an iframe) → click the
 * task-name link (class `executionTask`) → modal `#taskExecutionModal` with a
 * `#timeout` field (the CLI `--timeout` arg) → `#saveTaskType` (Execute).
 * Verified via cron history: run appears with the sysadmin username + Success.
 *
 * IMPORTANT findings from live exploration:
 *  - On this instance the RabbitMQ crons ALSO run on schedule every minute
 *    ("RabbitMQ Queue Publishing"/"Subscribing"), and "Trigger Async Events"
 *    every 5 min — a manual run makes the test deterministic, not possible.
 *  - The --timeout value is how long the consumer RUNS. 120s made the
 *    instance unresponsive for ~2 min. Keep it small (default 15s).
 */

const EXECUTABLE_TASKS_URL = '/client/#/noncore/managementtool_notship/viewCronTasks';

const TASK_IDS: Record<string, number> = {
  'RabbitMQ Queue Publishing': 15,
  'RabbitMQ Queue Subscribing': 16,
  'Trigger Async Events': 25,
};

export class SysAdminPage {
  constructor(private page: Page) {}

  /**
   * The RabbitMQ step of the manual QA procedure — BOTH tasks, in this order.
   *
   * Publishing puts the pending change events on the queue; Subscribing drains
   * the queue into the change-event store the Celigo export reads. Running only
   * the subscriber consumes a queue nothing has published to yet, so the new
   * employee's event is missed until the scheduled publisher happens to run.
   */
  async runRabbitMqSync(timeoutSeconds = 15): Promise<void> {
    await this.executeTask('RabbitMQ Queue Publishing', timeoutSeconds);
    await this.executeTask('RabbitMQ Queue Subscribing', timeoutSeconds);
  }

  async executeTask(taskName: keyof typeof TASK_IDS, timeoutSeconds = 15): Promise<void> {
    const startedAt = new Date();

    await this.page.goto(EXECUTABLE_TASKS_URL);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    const frame = await this.taskFrame('managementtool_notship/viewCronTasks');

    await frame.getByRole('link', { name: taskName, exact: true }).click();
    const timeoutField = frame.locator('#taskExecutionModal #timeout');
    await timeoutField.waitFor({ state: 'visible' });
    await timeoutField.fill(String(timeoutSeconds));
    await frame.locator('#saveTaskType').click();

    // The task runs synchronously for up to timeoutSeconds — give it room,
    // then confirm via cron history that OUR run (sysadmin user) succeeded.
    await this.page.waitForTimeout((timeoutSeconds + 5) * 1000);
    await this.assertRunSucceeded(taskName, startedAt);
  }

  /** Poll the task's cron history until a Success row from our user appears. */
  private async assertRunSucceeded(
    taskName: keyof typeof TASK_IDS,
    since: Date,
    timeoutMs = 90_000,
  ): Promise<void> {
    const user = process.env.OHRM_SYSADMIN_USER!;
    const historyUrl =
      `/client/#/noncore/index.php/managementtool_notship/cronHistory` +
      `/taskId/${TASK_IDS[taskName]}/taskName/${taskName}`;

    await expect(async () => {
      await this.page.goto(historyUrl);
      await this.page.waitForLoadState('networkidle').catch(() => {});
      const frame = await this.taskFrame('cronHistory');
      // top rows: "<username> <start> <end> <command> <status>"
      const row = frame.getByRole('row', { name: new RegExp(`^${user} .* Success`) }).first();
      await row.waitFor({ state: 'visible', timeout: 5_000 });
    }).toPass({ timeout: timeoutMs, intervals: [10_000] });
  }

  /** Noncore pages render in an iframe whose URL contains `urlPart`. */
  private async taskFrame(urlPart: string): Promise<Frame> {
    let frame: Frame | undefined;
    await expect(async () => {
      frame = this.page
        .frames()
        .find((f) => f !== this.page.mainFrame() && f.url().includes(urlPart));
      if (!frame) throw new Error(`iframe containing "${urlPart}" not loaded yet`);
    }).toPass({ timeout: 30_000, intervals: [1_000] });
    return frame!;
  }
}
