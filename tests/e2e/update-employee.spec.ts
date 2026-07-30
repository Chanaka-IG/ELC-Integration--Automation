import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/ohrm/LoginPage';
import { AddEmployeePage } from '../../pages/ohrm/AddEmployeePage';
import { IntegrationTabPage } from '../../pages/ohrm/IntegrationTabPage';
import { SysAdminPage } from '../../pages/ohrm/SysAdminPage';
import { OhrmApi, toReportTimestamp } from '../../api/ohrm';
import { CeligoApi } from '../../api/celigo';
import { BizpayApi } from '../../api/bizpay';
import { buildEmployee } from '../../factories/employee';
import { MAPPINGS, OhrmEmployeeInput } from '../../oracle/ohrm-to-bizpay';
import { diffEmployee, formatDiffReport } from '../../utils/diff';
import { pollUntil } from '../../utils/poll';

/**
 * E2E: Update already-synced employee — OrangeHRM → (RabbitMQ) → Celigo → BizPay
 *
 * Exercises the "Update Employees in BizPay" import leg in isolation: the
 * employee already exists in BizPay (Exists=Yes + Unique Id set on the BizPay
 * tab), so the flow must route the change through the UPDATE path — a PUT on
 * the existing record, never a second insert.
 *
 * The updated field set deliberately spans both mapping classes:
 *  - insert+update fields (dateOfBirth, otherId→NIS, street1)
 *  - update-leg-only fields (mobile, street2, city, workEmail)
 * Unchanged fields are still verified via the full oracle diff, proving the
 * update does not clobber data it did not carry.
 *
 * Serial by design — same shared delta cursor / schedule as the add spec.
 */

test.describe.configure({ mode: 'serial' });

test('editing a synced employee in OHRM updates the BizPay record without duplicating it', async ({
  page,
  request,
}) => {
  const emp = buildEmployee();
  const ohrm = new OhrmApi(request);
  const celigo = new CeligoApi(request);
  const bizpay = new BizpayApi(request);
  const payrollId = emp.payrollName.split('_')[0];

  const pim = new AddEmployeePage(page);
  const integrationTab = new IntegrationTabPage(page);
  const sysadmin = new SysAdminPage(page);

  // Same employee, changed values — the expected state after the update sync.
  const updated: OhrmEmployeeInput = {
    ...emp,
    dateOfBirth: '1992-03-20',
    otherId: 'B654321', // → BizPay NIS (letter + 6 digits)
    nisNumber: 'B654321', // UI-only field, kept consistent with otherId
    mobile: '5559876543',
    street1: 'QA Street One Updated',
    street2: 'QA Street Two Updated',
    city: 'Montego Bay',
    workEmail: emp.workEmail!.replace('qa.add.', 'qa.upd.'),
  };

  let syncedUniqueId = '';

  await test.step('Setup — OHRM: add employee with all mapped fields', async () => {
    await new LoginPage(page).loginAsSysadmin();
    await pim.addEmployee(emp);
    await pim.fillPersonalDetails(emp);
    await pim.fillJobDetails(emp);
    await pim.fillContactDetails(emp);
  });

  await test.step('Setup — sync employee to BizPay (insert path)', async () => {
    const setupStart = new Date();
    await sysadmin.runRabbitMqConsumer();
    await pollUntil(
      () =>
        ohrm.findAddEvent(
          emp.employeeId,
          toReportTimestamp(setupStart),
          toReportTimestamp(new Date(Date.now() + 60_000)),
        ),
      { timeoutMs: 120_000, label: `Add Employee event for ${emp.employeeId}` },
    );
    const jobId = await celigo.runSyncEmployeesFlow();
    const job = await celigo.waitForJob(jobId);
    expect(job.status, `setup run ${jobId} should complete`).toBe('completed');
    expect(job.numError ?? 0, `setup run ${jobId} should have no errors`).toBe(0);

    // Precondition for the update path: write-back marks the employee synced.
    const status = await pollUntil(
      async () => {
        const s = await integrationTab.readSyncStatus(pim.empNumber!);
        return s.lastSyncStatus === 'Successful' && s.bizpayUniqueId !== '' ? s : null;
      },
      { timeoutMs: 120_000, label: `insert write-back for ${emp.employeeId}` },
    );
    expect(status.employeeExistsInBizpay, 'Exists in BizPay must be Yes before updating').toBe(true);
    syncedUniqueId = status.bizpayUniqueId;
  });

  const updateStart = new Date();

  await test.step('OHRM: edit synced personal and contact fields', async () => {
    await pim.fillPersonalDetails(updated); // DOB, Other Id (→NIS)
    await pim.fillContactDetails(updated); // address, mobile, work email
  });

  await test.step('OHRM: BizPay tab still routes to the update path', async () => {
    // Exists=Yes + Unique Id populated → the flow must take the UPDATE leg
    const s = await integrationTab.readSyncStatus(pim.empNumber!);
    expect(s.employeeExistsInBizpay, 'Exists in BizPay stays Yes').toBe(true);
    expect(s.bizpayUniqueId, 'Unique Id unchanged by the OHRM edit').toBe(syncedUniqueId);
  });

  await test.step('OHRM: trigger RabbitMQ consumer', async () => {
    await sysadmin.runRabbitMqConsumer();
  });

  await test.step('OHRM: update event recorded with the new values', async () => {
    const event = await pollUntil(
      () =>
        ohrm.findUpdateEvent(
          emp.employeeId,
          toReportTimestamp(updateStart),
          toReportTimestamp(new Date(Date.now() + 60_000)),
        ),
      { timeoutMs: 120_000, label: `update event for ${emp.employeeId}` },
    );
    expect(event.async_event_display_name).not.toBe('Add Employee');
    expect(event.event_recorded_date_time).toBeTruthy();
    // The exact payload Celigo will read — new values must already be there
    expect(event.otherId).toBe(updated.otherId); // → NIS
    expect(event.empBirthday).toBe(updated.dateOfBirth);
    expect(event.mobile).toBe(updated.mobile);
    expect(event.street1).toBe(updated.street1);
  });

  await test.step('Celigo: flow run consumes the update event', async () => {
    const jobId = await celigo.runSyncEmployeesFlow();
    const job = await celigo.waitForJob(jobId);
    expect(job.status, `run ${jobId} should complete`).toBe('completed');
    expect(job.numError ?? 0, `run ${jobId} should have no errors`).toBe(0);
    expect(job.numSuccess ?? 0, `run ${jobId} should process our update`).toBeGreaterThan(0);
  });

  await test.step('BizPay: record updated in place — new values, no duplicate', async () => {
    test.skip(!process.env.BIZPAY_URL, 'BizPay verification out of scope (BIZPAY_URL not set)');
    // Poll on an updated marker field so we assert post-update state, not a
    // stale read that happens to still match the insert.
    const record = await pollUntil(
      async () => {
        const r = await bizpay.findEmployeeByNumber(payrollId, emp.employeeId);
        return r && r.phoneNumber === updated.mobile ? r : null;
      },
      { timeoutMs: 60_000, label: `BizPay employee ${emp.employeeId} with updated mobile` },
    );

    const matches = await bizpay.findAllEmployeesByNumber(payrollId, emp.employeeId);
    expect(matches.length, 'update must not create a duplicate record').toBe(1);

    // Full oracle diff against the UPDATED input: changed fields carry the new
    // values, unchanged fields (names, TRN, sub unit, ...) are untouched.
    const ctx = await bizpay.getLookupContext(payrollId);
    const diffs = diffEmployee(updated, record, MAPPINGS, ctx, 'full');
    const report = formatDiffReport(diffs);
    await test.info().attach('field-diff-report', { body: report, contentType: 'text/plain' });
    expect(diffs.filter((d) => !d.pass), `Field mismatches:\n${report}`).toEqual([]);
  });

  await test.step('OHRM: write-back sync status is Successful, Unique Id stable', async () => {
    const status = await pollUntil(
      async () => {
        const s = await integrationTab.readSyncStatus(pim.empNumber!);
        return s.lastSyncStatus === 'Successful' ? s : null;
      },
      { timeoutMs: 120_000, label: `update write-back for ${emp.employeeId}` },
    );
    expect(status.employeeExistsInBizpay, 'Exists in BizPay stays Yes').toBe(true);
    expect(status.bizpayUniqueId, 'update must not reassign the BizPay unique id').toBe(
      syncedUniqueId,
    );
    expect(status.lastSyncDate).toBeTruthy();
  });

  await test.step('Idempotency: a second run re-sends nothing', async () => {
    const jobId = await celigo.runSyncEmployeesFlow();
    const job = await celigo.waitForJob(jobId);
    expect(job.status).toBe('completed');
    // update event already consumed → nothing left to process
    expect(job.numSuccess ?? 0, 'second run should find no pending events').toBe(0);
  });
});
