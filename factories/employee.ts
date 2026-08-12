import { OhrmEmployeeInput, WizardOnlyInput } from '../oracle/ohrm-to-bizpay';

/**
 * Test-data factory. Every employee gets a unique, traceable id so it can be
 * located in the change report, Celigo trace keys and BizPay, and cleaned up.
 */

let seq = 0;

export function makeRunId(): string {
  // e.g. 0727-143205 — readable in evidence, unique per run. Seconds are part
  // of the id because BizPay enforces "Employee number must be unique within
  // the payroll": two runs started in the same minute would otherwise build
  // the same employeeId and the second one could not be inserted.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Jamaican TRN check digit, reverse-engineered from the QA sandbox's own data
 * and confirmed against all 2706 distinct 9-digit TRNs on the company's
 * payrolls (100% match, 2026-08-10):
 *
 *   weights 9 8 7 6 5 4 3 2 over the first 8 digits, r = sum mod 11,
 *   check digit = (11 - r) mod 10
 *
 * (Sanity check: 12101229|8 → sum 69, 69 mod 11 = 3, (11-3) mod 10 = 8.)
 */
export function trnCheckDigit(first8: string): number {
  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(first8[i]), 0);
  return (11 - (sum % 11)) % 10;
}

const randomDigits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/**
 * A fresh, checksum-valid TRN.
 *
 * BizPay rejects duplicates ("TRN must be unique within the payroll"), so this
 * must NOT be a constant — a hardcoded TRN makes every run after the first
 * un-insertable. Every real TRN in the sandbox starts 10-13, so the generated
 * ones stay in that range to look like production data.
 */
export function makeTrn(): string {
  const first8 = `1${Math.floor(Math.random() * 4)}${randomDigits(6)}`;
  return `${first8}${trnCheckDigit(first8)}`;
}

/**
 * A fresh NIS in the sandbox's dominant format (one uppercase letter + 6
 * digits). Unique for the same reason as the TRN.
 */
export function makeNis(): string {
  const letter = 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)];
  return `${letter}${randomDigits(6)}`;
}

export interface EmployeeOverrides extends Partial<OhrmEmployeeInput> {}

/**
 * Wizard-only master data — every value confirmed to exist in the QA instance's
 * dropdowns on 2026-07-31. None of it reaches BizPay (see WizardOnlyInput);
 * it only exists so the mandatory wizard steps can be completed.
 */
function buildWizardInput(uniq: string): WizardOnlyInput {
  return {
    salutation: 'Mr',
    workSchedule: 'Default Work Schedule',
    attendanceBasis: 'Work Schedule',
    contractType: 'Fixed-Term Contract',
    group: 'Jamaica National Group Ltd. (MHC)',
    company: 'FHC',
    employeeWorkLocation: 'Telecommute',
    province: 'Kingston',
    country: 'Jamaica',
    personalEmail: `qa.add.${uniq}.personal@jngroup.com`.toLowerCase(),
    emergencyContact: { name: 'QA Emergency', relationship: 'Spouse', mobile: '8765550101' },
    // must be an employee that actually exists — the Report-to step
    // autocompletes against live names (re-confirmed 2026-08-12)
    supervisor: { name: 'emp_firstname_1105', reportingMethod: 'Direct' },
    workExperience: { company: 'QA Previous Employer', jobTitle: 'QA Analyst' },
    education: {
      level: 'AAAA',
      institute: 'QA University',
      major: 'Testing',
      year: '2015',
      startDate: '2011-09-01',
      endDate: '2015-06-30',
    },
  };
}

/**
 * A fully-populated, valid employee (happy-path "all mapped fields" case).
 *
 * subUnit / jobTitle / employmentStatus MUST each name a value that exists in
 * BOTH systems, because the integration resolves them by exact, case-sensitive
 * NAME into a BizPay id. Picking a value that exists only in OHRM does not fail
 * the UI — it fails later and differently:
 *   subUnit           → departmentId, required; no match is a hard data error
 *   jobTitle          → jobTitleId, SILENT NULL on mismatch
 *   employmentStatus  → employeeCategoryId, SILENT NULL on mismatch
 * so the wizard passes and the field-diff step is what finally reports it.
 *
 * Rebuilding the OHRM QA instance replaces its master data wholesale and these
 * defaults go stale (2026-08-12: "test"/"Test one"/"Active" all disappeared).
 * Re-derive them from the live intersection rather than guessing — dump each
 * side with explore/dump-job-tab.cjs (OHRM) and the BizPay lookup tables, then
 * intersect. On 2026-08-12 that intersection was very thin: exactly ONE shared
 * job title and ONE shared employment status, so these are effectively forced.
 */
// BizPay rejects names with anything but letters ("Names can only contain
// letters"), so uniqueness in name fields is spelled out as letters; the
// employeeId keeps the exact digits for tracing.
const toLetters = (digits: string) =>
  digits
    .replace(/\D/g, '')
    .split('')
    .map((d) => 'ABCDEFGHIJ'[Number(d)])
    .join('');

export function buildEmployee(overrides: EmployeeOverrides = {}): OhrmEmployeeInput {
  seq += 1;
  const runId = makeRunId();
  const uniq = `${runId}-${seq}`;

  return {
    employeeId: `QA-ADD-${uniq}`,
    firstName: `Qa${toLetters(String(seq)) || 'A'}`,
    lastName: `Add${toLetters(runId)}`,
    middleName: 'Test',
    gender: 'Male',
    dateOfBirth: '1990-01-15',
    joinedDate: new Date().toISOString().slice(0, 10),
    // Master data — re-confirmed against BOTH systems on 2026-08-12 after the
    // QA instance was rebuilt (see the note above buildEmployee).
    subUnit: 'jntestsubunit', // OHRM sub unit + BizPay department (id 20038)
    jobTitle: 'JNTestJobTitle', // OHRM job title + BizPay job title (id 40147)
    jobCategory: 'Assistant General Manager', // OHRM-only, not synced
    employmentStatus: 'Freelancer', // OHRM status + BizPay category (id 8195)
    location: 'name_102',
    maritalStatus: 'Single',
    nationality: 'Afghan',
    // TRN and NIS are generated per employee, never hardcoded: BizPay enforces
    // "TRN must be unique within the payroll" / "NIS must be unique within the
    // payroll", so a fixed value only ever inserts once and every later run
    // fails with a 400 from the insert import.
    otherId: makeNis(), // → BizPay NIS (letter + 6 digits)
    ssn: makeTrn(), // → BizPay TRN (9 digits, valid check digit)
    nisNumber: makeNis(), // UI-only "NIS Number" field (not synced)
    // a real company domain, matching how the field is used in production
    workEmail: `qa.add.${uniq}@jngroup.com`.toLowerCase(),
    mobile: '5551234567',
    street1: 'QA Street One',
    street2: 'QA Street Two',
    city: 'Kingston',
    wizard: buildWizardInput(uniq),
    // Proven-to-sync payroll option (employee 19456 synced Successful with it)
    payrollName: '685_BIZPAY4718 - JN Bank LTD',
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
    location: full.location, // required by the Add Employee modal
    payrollName: full.payrollName,
    ...overrides,
  };
}
