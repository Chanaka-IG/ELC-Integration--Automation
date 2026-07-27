import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/ohrm/LoginPage';
import { AddEmployeePage } from '../../pages/ohrm/AddEmployeePage';
import { IntegrationTabPage } from '../../pages/ohrm/IntegrationTabPage';
import { SysAdminPage } from '../../pages/ohrm/SysAdminPage';
import { OhrmApi, toReportTimestamp } from '../../api/ohrm';
import { CeligoApi } from '../../api/celigo';
import { BizpayApi } from '../../api/bizpay';
import { buildEmployee } from '../../factories/employee';
import { MAPPINGS } from '../../oracle/ohrm-to-bizpay';
import { diffEmployee, formatDiffReport } from '../../utils/diff';
import { pollUntil } from '../../utils/poll';

/**
 * E2E: Add Employee — OrangeHRM → (RabbitMQ) → Celigo → BizPay
 *
 * Serial by design: the delta cursor and the 5-min flow schedule are shared
 * state. The test is schedule-immune — it accepts whichever run (manual or
 * scheduled) consumes the event and locates its record via employee id.
 */

test.describe.configure({ mode: 'serial' });

test('new employee in OHRM syncs to BizPay with all mapped fields', async ({ page, request }) => {
  const emp = buildEmployee();
  const testStart = new Date();
  const ohrm = new OhrmApi(request);
  const celigo = new CeligoApi(request);
  const bizpay = new BizpayApi(request);
  // payroll_id = the part of Payroll Name before '_' (e.g. "685_BIZ... - JN" → "685")
  const payrollId = emp.payrollName.split('_')[0];

  const pim = new AddEmployeePage(page);
  const integrationTab = new IntegrationTabPage(page);

  await test.step('OHRM: add employee with all mapped fields', async () => {
    await new LoginPage(page).loginAsSysadmin(); // sysadmin performs all OHRM actions
    await pim.addEmployee(emp); // modal: names, employee id, joined date, location
    await pim.fillPersonalDetails(emp); // DOB, gender, Other Id (→NIS), TRN
    await pim.fillJobDetails(emp); // job title, sub unit, status, PAYROLL NAME
    await pim.fillContactDetails(emp); // address, mobile, work email
  });

  await test.step('OHRM: BizPay tab routing fields are insert-ready', async () => {
    // Exists=No/empty + Unique Id empty + Skip-sync off → insert path
    await integrationTab.assertReadyForInsertPath(pim.empNumber!);
  });

  await test.step('OHRM: trigger RabbitMQ consumer', async () => {
    await new SysAdminPage(page).runRabbitMqConsumer();
  });

  await test.step('OHRM: change event recorded and queue-ready', async () => {
    const event = await pollUntil(
      () =>
        ohrm.findAddEvent(
          emp.employeeId,
          toReportTimestamp(testStart),
          toReportTimestamp(new Date(Date.now() + 60_000)),
        ),
      { timeoutMs: 120_000, label: `Add Employee event for ${emp.employeeId}` },
    );
    expect(event.async_event_display_name).toBe('Add Employee');
    expect(event.event_recorded_date_time).toBeTruthy();
    // The exact payload Celigo will read — assert critical fields at source
    expect(event.empSubUnit).toBe(emp.subUnit);
    expect(event.otherId).toBe(emp.otherId); // → NIS
    expect(event.employeeSSN).toBe(emp.ssn); // → TRN
  });

  const flowRunStart = new Date();

  await test.step('Celigo: flow run consumes the event', async () => {
    await celigo.runSyncEmployeesFlow();
    const job = await celigo.waitForRunAfter(flowRunStart);
    expect(job.status, `run ${job._id} should complete`).toBe('completed');
    expect(job.numError ?? 0, `run ${job._id} should have no errors`).toBe(0);
  });

  await test.step('BizPay: employee exists with correct field values', async () => {
    const record = await pollUntil(
      () => bizpay.findEmployeeByNumber(payrollId, emp.employeeId),
      { timeoutMs: 60_000, label: `BizPay employee ${emp.employeeId}` },
    );
    const ctx = await bizpay.getLookupContext(payrollId);
    const diffs = diffEmployee(emp, record, MAPPINGS, ctx, 'full');
    const report = formatDiffReport(diffs);
    await test.info().attach('field-diff-report', { body: report, contentType: 'text/plain' });
    expect(diffs.filter((d) => !d.pass), `Field mismatches:\n${report}`).toEqual([]);
  });

  await test.step('OHRM: write-back sync status is Successful', async () => {
    const status = await integrationTab.readSyncStatus(pim.empNumber!);
    expect(status.lastSyncStatus).toBe('Successful');
    expect(status.employeeExistsInBizpay, 'Exists in BizPay flips to Yes').toBe(true);
    expect(status.bizpayUniqueId, 'BizPay unique id written back').not.toBe('');
    expect(status.lastSyncDate).toBeTruthy();
  });

  await test.step('Idempotency: a second run creates no duplicate', async () => {
    const secondRunStart = new Date();
    await celigo.runSyncEmployeesFlow();
    await celigo.waitForRunAfter(secondRunStart);
    // TODO: assert BizPay still returns exactly one employee with this number
  });
});
