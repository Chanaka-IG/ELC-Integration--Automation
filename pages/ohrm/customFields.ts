/**
 * OHRM custom-field element ids used by the BizPay sync page objects.
 *
 * These are DATABASE ids, not stable identifiers. Rebuilding the OHRM QA
 * instance renumbers every custom field, and the breakage is quiet rather than
 * loud: label-anchored actions (selecting "Payroll Name") keep working, and only
 * the id-anchored ones fail — a Save button that is never found, a sync-status
 * field that reads empty. Collecting them here makes a rebuild a one-place edit.
 *
 * Re-derive after any instance rebuild with:
 *   node explore/dump-custom-field-ids.cjs <empNumber>
 *
 * Verified against jntest-temp14-kord on 2026-08-12. The previous instance used
 * 121/122/123/126_Yes/127Yes/128Yes — every id below except `bizpayUniqueId`
 * moved, so do not assume any of them survived.
 *
 * All of these start with a digit, so they are only reachable as [id="..."]:
 * "#123" is not a valid CSS selector and throws in the browser. Use cf().
 */
export const CUSTOM_FIELD_IDS = {
  /** Job tab — "Payroll Name" (cust field routing the employee to a payroll). */
  payrollName: '123',

  /** "BizPay Integration - Sync Information" custom tab id (in the URL). */
  syncTab: '397',

  lastSyncDate: '124',
  lastSyncTime: '125',
  /**
   * "Last Sync Status" — a native <select> on this build (it had no id at all
   * on the previous instance). Option VALUES carry an Angular "string:" prefix
   * ("string:Successful"), so read the selected option's TEXT, not its value.
   */
  lastSyncStatus: '126',
  /** "Employee Exists in BizPay?" radios. */
  existsInBizpayYes: '128_Yes',
  existsInBizpayNo: '128_No',
  reSyncEmployee: '129Yes',
  skipSync: '130Yes',
  bizpayUniqueId: '131',
} as const;

/** CSS selector for an element id that starts with a digit. */
export const cf = (id: string): string => `[id="${id}"]`;
