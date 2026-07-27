/**
 * OHRM → BizPay field-mapping oracle.
 *
 * Reconstructed (read-only) from the Celigo QA integration
 * "[JN] [BIZPAY] [4.0] [QA]" (6a436a975a81b3a657c433ea):
 *  - Export  "Export changed Employee data from OrangeHRM" (6a436b29c2387aaa87a5298f)
 *  - Import  "Insert new Employees to BizPay"              (6a436b2fc2387aaa87a52cd7)
 *  - Import  "Update Employees in BizPay"                  (6a436b33c2387aaa87a52e54)
 *  - Script  "JN BizPay Scripts"                           (6a436b26c2387aaa87a527ff)
 *
 * A new employee is processed by INSERT and then UPDATE within the same flow
 * run. Fields with sentOnInsert=false only reach BizPay via the follow-up PUT.
 */

export interface OhrmEmployeeInput {
  /** PIM Employee Id (becomes BizPay employeeNumber) */
  employeeId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  /** 'Male' | 'Female' — Non-Binary is rejected by the integration */
  gender: string;
  dateOfBirth: string; // YYYY-MM-DD
  joinedDate: string; // YYYY-MM-DD
  /** Sub Unit — must EXACTLY match a BizPay department name (case-sensitive) */
  subUnit: string;
  jobTitle?: string;
  employmentStatus?: string;
  /** OHRM "Other ID" → BizPay NIS (format: 1 uppercase letter + 6 digits) */
  otherId?: string;
  /** OHRM "SSN" → BizPay TRN (9 digits, mod-11 checksum) */
  ssn?: string;
  workEmail?: string;
  mobile?: string;
  street1?: string;
  street2?: string;
  city?: string;
  /** Custom field 121 — format "685_BIZPAY4718 - JN Bank LTD" */
  payrollName: string;
  bankAccount?: { type: 'Savings' | 'Chequing'; branch: string; number: string };
}

export interface FieldMapping {
  /** Field name in the OHRM changed-employee report */
  ohrmReportField: string;
  /** Property on OhrmEmployeeInput used to derive the expected value */
  inputField: keyof OhrmEmployeeInput | null;
  /** Field name on the BizPay employee API record */
  bizpayField: string;
  sentOnInsert: boolean;
  sentOnUpdate: boolean;
  /** Derive expected BizPay value from the OHRM input (null = expect null) */
  expected?: (input: OhrmEmployeeInput, ctx: LookupContext) => unknown;
  notes?: string;
}

/** Name→id lookup tables fetched live from BizPay before verification. */
export interface LookupContext {
  departments: Record<string, number>;
  jobTitles: Record<string, number>;
  employeeCategories: Record<string, number>;
}

/** Mirrors getGender() in the Celigo script. */
export function toBizpaySex(gender: string): string {
  if (gender === 'Male') return 'M';
  if (gender === 'Female') return 'F';
  return gender; // Non-Binary produces a data error upstream — never reaches BizPay
}

/** Mirrors extractValueFromName(): exact, case-sensitive name match; miss = ''. */
function lookupId(name: string | undefined, table: Record<string, number>): number | null {
  if (!name) return null;
  return table[name] ?? null; // null = the integration silently sent nothing
}

export const MAPPINGS: FieldMapping[] = [
  {
    ohrmReportField: 'employeeId',
    inputField: 'employeeId',
    bizpayField: 'employeeNumber',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.employeeId,
  },
  {
    ohrmReportField: 'employeeFirstname',
    inputField: 'firstName',
    bizpayField: 'firstName',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.firstName,
    notes: 'required, max 30 chars',
  },
  {
    ohrmReportField: 'employeeMiddlename',
    inputField: 'middleName',
    bizpayField: 'middleName',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i) => i.middleName ?? null,
    notes: 'max 30 chars; arrives via UPDATE leg only',
  },
  {
    ohrmReportField: 'employeeLastname',
    inputField: 'lastName',
    bizpayField: 'lastName',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.lastName,
    notes: 'required, max 30 chars',
  },
  {
    ohrmReportField: 'empGender',
    inputField: 'gender',
    bizpayField: 'sex',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => toBizpaySex(i.gender),
    notes: "Male→M, Female→F; 'Non-Binary' rejected with data error",
  },
  {
    ohrmReportField: 'empBirthday',
    inputField: 'dateOfBirth',
    bizpayField: 'dateOfBirth',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.dateOfBirth,
    notes: 'required',
  },
  {
    ohrmReportField: 'empJoinedDate',
    inputField: 'joinedDate',
    bizpayField: 'employmentDate',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.joinedDate,
    notes: 'required',
  },
  {
    ohrmReportField: 'empSubUnit',
    inputField: 'subUnit',
    bizpayField: 'departmentId',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i, ctx) => lookupId(i.subUnit, ctx.departments),
    notes: 'exact case-sensitive name match; no match → data error (required)',
  },
  {
    ohrmReportField: 'empJobTitle',
    inputField: 'jobTitle',
    bizpayField: 'jobTitleId',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i, ctx) => lookupId(i.jobTitle, ctx.jobTitles),
    notes: 'SILENT NULL on name mismatch — validation commented out in script',
  },
  {
    ohrmReportField: 'empEmploymentStatus',
    inputField: 'employmentStatus',
    bizpayField: 'employeeCategoryId',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i, ctx) => lookupId(i.employmentStatus, ctx.employeeCategories),
    notes: 'SILENT NULL on name mismatch — validation commented out in script',
  },
  {
    ohrmReportField: 'otherId',
    inputField: 'otherId',
    bizpayField: 'nis',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.otherId ?? null,
    notes: 'from OHRM "Other ID"; format check only when NIS toggle is OFF',
  },
  {
    ohrmReportField: 'employeeSSN',
    inputField: 'ssn',
    bizpayField: 'trn',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.ssn ?? null,
    notes: 'from OHRM "SSN"; mod-11 checksum only when TRN toggle is OFF',
  },
  {
    ohrmReportField: 'workEmail',
    inputField: 'workEmail',
    bizpayField: 'email',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i) => i.workEmail ?? null,
    notes: 'max 50 chars',
  },
  {
    ohrmReportField: 'mobile',
    inputField: 'mobile',
    bizpayField: 'phoneNumber',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i) => i.mobile ?? null,
  },
  {
    ohrmReportField: 'street1',
    inputField: 'street1',
    bizpayField: 'address1',
    sentOnInsert: true,
    sentOnUpdate: true,
    expected: (i) => i.street1 ?? null,
    notes: 'max 50 chars',
  },
  {
    ohrmReportField: 'street2',
    inputField: 'street2',
    bizpayField: 'address2',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i) => i.street2 ?? null,
  },
  {
    ohrmReportField: 'city_code',
    inputField: 'city',
    bizpayField: 'address3',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: (i) => i.city ?? null,
  },
  {
    ohrmReportField: 'terminationDate',
    inputField: null,
    bizpayField: 'employeeStatus',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: () => 0,
    notes: 'new hire → 0 (active); 2 only when termination date is in the past',
  },
  {
    ohrmReportField: '(hardcoded)',
    inputField: null,
    bizpayField: 'paymentMethod',
    sentOnInsert: false,
    sentOnUpdate: true,
    expected: () => 3,
    notes: 'hardcoded to 3 in the update import mapping',
  },
];

/** accountType lookup used by the update import for primaryBankAccount. */
export const BANK_ACCOUNT_TYPE_MAP: Record<string, string> = {
  Savings: 'savings',
  Chequing: 'chequings',
};

/**
 * Integration-level validation rules (validateEmployee in the script).
 * Encoded so negative tests can assert on the exact expected error text.
 */
export const VALIDATION_RULES = {
  firstNameRequired: 'First Name field is required.',
  firstNameMax: 'First Name length should not exceed 30 characters.',
  middleNameMax: 'Middle Name length should not exceed 30 characters.',
  lastNameRequired: 'Last Name field is required.',
  lastNameMax: 'Last Name length should not exceed 30 characters.',
  payrollNameRequired: 'Payroll Name field is required.',
  dobRequired: 'Date of Birth is required.',
  emailMax: 'Email length should not exceed 50 characters.',
  address1Max: 'Address1 length should not exceed 50 characters.',
  joinedDateRequired: 'Joined date is required.',
  departmentRequired: 'Department is required.',
  genderRequired: 'Employee Gender is required.',
  nonBinaryRejected:
    "Employee Gender option 'Non-Binary' not found within BizPay. Please select 'Male' or 'Female'",
  trnInvalid: 'TRN Value is invalid.',
  nisInvalid: 'NIS Value is Invalid.',
} as const;
