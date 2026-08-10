import { FieldMapping, LookupContext, OhrmEmployeeInput } from '../oracle/ohrm-to-bizpay';

export interface FieldDiff {
  bizpayField: string;
  ohrmSource: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  notes?: string;
}

/**
 * Field-by-field verification of a BizPay employee record against the mapping
 * oracle. Iterates the oracle so coverage grows with the mapping table —
 * no hand-written per-field assertions.
 */
export function diffEmployee(
  input: OhrmEmployeeInput,
  bizpayRecord: Record<string, unknown>,
  mappings: FieldMapping[],
  ctx: LookupContext,
  phase: 'insert' | 'full' = 'full',
): FieldDiff[] {
  return mappings
    .filter((m) => (phase === 'insert' ? m.sentOnInsert : true))
    .map((m) => {
      const expected = m.expected ? m.expected(input, ctx) : undefined;
      const actual = bizpayRecord[m.bizpayField];
      return {
        bizpayField: m.bizpayField,
        ohrmSource: m.ohrmReportField,
        expected,
        actual,
        pass: normalize(expected) === normalize(actual),
        notes: m.notes,
      };
    });
}

function normalize(v: unknown): string {
  if (v === null || v === undefined || v === '') return '<empty>';
  const s = String(v);
  // BizPay returns dates as full timestamps ("1990-01-15T00:00:00") while the
  // oracle expresses them the way they are entered in OHRM ("1990-01-15") —
  // compare the calendar day only, or every date field reads as a mismatch.
  const asDate = s.match(/^(\d{4}-\d{2}-\d{2})T[\d:.]+/);
  return asDate ? asDate[1] : s;
}

export function formatDiffReport(diffs: FieldDiff[]): string {
  const failed = diffs.filter((d) => !d.pass);
  const lines = [
    `Field verification: ${diffs.length - failed.length}/${diffs.length} passed`,
    '',
    'field'.padEnd(22) + 'expected'.padEnd(30) + 'actual'.padEnd(30) + 'result',
    '-'.repeat(90),
    ...diffs.map(
      (d) =>
        d.bizpayField.padEnd(22) +
        normalize(d.expected).padEnd(30) +
        normalize(d.actual).padEnd(30) +
        (d.pass ? 'PASS' : `FAIL  <- ${d.ohrmSource}`),
    ),
  ];
  return lines.join('\n');
}
