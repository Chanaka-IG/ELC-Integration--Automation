# Negative test cases (to implement after the happy path is green)

Each case follows the same skeleton as `e2e/add-employee.spec.ts` but asserts
a `[Data]` validation error in Celigo flow errors (see
`VALIDATION_RULES` in `oracle/ohrm-to-bizpay.ts` for exact expected messages)
instead of a BizPay record.

| Case | Setup | Expected outcome |
|---|---|---|
| Unmapped department | subUnit that does not exist in BizPay | error `Department is required.`; no BizPay record |
| Misspelled job title | jobTitle off by case/typo | **syncs successfully but jobTitleId is null** (silent-null defect class) |
| Misspelled employment status | same | employeeCategoryId null |
| First name > 30 chars | 31-char firstName | error `First Name length should not exceed 30 characters.` |
| Non-binary gender | gender = Non-Binary | error mentioning Male/Female |
| Missing Payroll Name | custom field left empty | error `Payroll Name field is required.` |
| Skip-sync set | cust128 non-empty | employee never appears in any run (0 records) |
| Invalid TRN checksum | requires TRN toggle OFF in integration settings — coordinate with team; do NOT change settings from this framework | error `TRN Value is invalid.` |
| Invalid NIS format | requires NIS toggle OFF — same caveat | error `NIS Value is Invalid.` |
| Special characters | name `O'Brien-Ståhl` | syncs; value byte-identical in BizPay |
| Minimal fields only | buildMinimalEmployee() | syncs; optional BizPay fields are null (not stale/junk) |
