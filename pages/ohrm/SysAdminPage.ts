import { Page } from '@playwright/test';

/**
 * Sysadmin-only action: trigger the RabbitMQ consumer run that records the
 * async change events (making them visible to the changed-employee report,
 * and therefore to the Celigo delta export).
 *
 * TODO(explore): the trigger location/mechanism is instance-specific —
 * capture the real navigation + control during the live exploration pass
 * with the sysadmin credentials.
 */
export class SysAdminPage {
  constructor(private page: Page) {}

  async runRabbitMqConsumer(): Promise<void> {
    // TODO(selector): navigate to the sysadmin tool and trigger the run.
    throw new Error('Not implemented — needs sysadmin credentials + live-UI exploration');
  }
}
