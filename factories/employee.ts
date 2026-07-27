import { OhrmEmployeeInput } from '../oracle/ohrm-to-bizpay';

/**
 * Test-data factory. Every employee gets a unique, traceable id so it can be
 * located in the change report, Celigo trace keys and BizPay, and cleaned up.
 */

let seq = 0;

export function makeRunId(): string {
  // e.g. 0727-1432 — readable in evidence, unique enough per run
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface EmployeeOverrides extends Partial<OhrmEmployeeInput> {}

/**
 * A fully-populated, valid employee (happy-path "all mapped fields" case).
 * subUnit / jobTitle / employmentStatus / payrollName defaults MUST be values
 * confirmed to exist in the QA BizPay company — set once per environment here.
 */
export function buildEmployee(overrides: EmployeeOverrides = {}): OhrmEmployeeInput {
  seq += 1;
  const runId = makeRunId();
  const uniq = `${runId}-${seq}`;

  return {
    employeeId: `QA-ADD-${uniq}`,
    firstName: `Qa${seq}`,
    lastName: `Add-${runId}`,
    middleName: 'Test',
    gender: 'Male',
    dateOfBirth: '1990-01-15',
    joinedDate: new Date().toISOString().slice(0, 10),
    // TODO(env): replace with real master data confirmed on BOTH systems
    subUnit: 'SET-ME-department-existing-in-bizpay',
    jobTitle: 'SET-ME-jobtitle-existing-in-bizpay',
    employmentStatus: 'SET-ME-category-existing-in-bizpay',
    otherId: 'A123456', // → NIS (letter + 6 digits)
    ssn: '121012298', // → TRN (9 digits; this sample passes the mod-11 check)
    workEmail: `qa.add.${uniq}@example.com`.toLowerCase(),
    mobile: '5551234567',
    street1: 'QA Street One',
    street2: 'QA Street Two',
    city: 'Kingston',
    // TODO(env): replace with the real payroll option used in QA
    payrollName: 'SET-ME 685_BIZPAY4718 - JN Bank LTD',
    bankAccount: { type: 'Savings', branch: '---', number: '565566565' },
    ...overrides,
  };
}

/** Minimal valid employee — only fields the integration requires. */
export function buildMinimalEmployee(overrides: EmployeeOverrides = {}): OhrmEmployeeInput {
  const full = buildEmployee(overrides);
  return {
    employeeId: full.employeeId,
    firstName: full.firstName,
    lastName: full.lastName,
    gender: full.gender,
    dateOfBirth: full.dateOfBirth,
    joinedDate: full.joinedDate,
    subUnit: full.subUnit,
    payrollName: full.payrollName,
    ...overrides,
  };
}
