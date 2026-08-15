# Employee-creation API — live capture notes (2026-08-15)

Source: Playwright trace of one full Add Employee wizard run on
jntest-temp14-kord (throwaway employee `QA-APIPROBE-0815-100749-1`,
empNumber 19466). These are the endpoints `api/ohrm-employees.ts` is built on.

## The wizard is a client-side shell

The wizard's Finish button sends **one batch request**:

```
POST /api/wizard
[ {endpoint, method, data, params}, ... ]     // <EMPNUMBER> placeholder
```

whose entries name ordinary REST endpoints — the server just replays them.
The legacy (non-wizard) modal calls the same endpoints directly. So creating
an employee via those endpoints is UI-variant-proof:

| Step | Call | Notes |
|---|---|---|
| create | `POST /api/employees` | `{firstName, middleName, lastName, locationId, joinedDate, autoGenerateEmployeeId:false, initiatePreboarding:false, employeeId}` — response `data.empNumber` |
| personal | `PATCH /api/employees/{n}` | `otherId` (→NIS), `ssn` (→TRN), `sin`, `emp_birthday`, `emp_gender`, `emp_marital_status`, `nation_code` (all ids) |
| job | `PATCH /api/employees/{n}/job` | `job_title_id, employment_status_id, job_category_id, subunit_id, location_id, work_schedule_id, work_basis:"1", event_id:"1" ("Joined"), effective_date` |
| custom fields | `PUT /api/employees/{n}/CustomFieldValues` | `[{section, values:[{custom_field_id, type, value, extra_data}]}]` |
| contact | `PATCH /api/employees/{n}` | `street1/2, city, country (code e.g. "JM"), province, emp_mobile, emp_work_email, emp_oth_email` |

Emergency contact / supervisor / work experience / education are **wizard
gate requirements only** (`POST employees/{n}/emergencyContacts|supervisors|
workExperience|education`) — optional server-side, never read by the sync.

## Auth (browser session, not the OAuth iClient)

The SPA fetches its own bearer token off the login session cookie:

```
GET /core/getLoggedInAccountToken   →  {token: {access_token, expires_in, ...}}
```

then sends `Authorization: Bearer <token>` on every `/api/*` call. No
`/oauth/issueToken` involved — so API-based creation adds zero traffic to the
endpoint OHRM rate-blocks.

**Gotcha (verified 2026-08-15):** the token endpoint only answers requests
made from inside the page — replaying it through Playwright's request context
with identical cookies AND identical headers still gets `401 Login Required`.
So the client mints the token via `page.evaluate(fetch(...))` once, and only
the `/api/*` calls go through `page.request` (those accept the Bearer fine).

## Payroll Name (the sync-routing custom field)

Job tab's "Job Details" save is `PATCH /api/employees/{n}/job` with an inline
`custom_fields` array — section **"4"** ("Other Job Details", screen
`job-standard`), field id **123** on the current instance:

```
GET /api/employees/{n}/CustomFieldValues?filter[screen]=job-standard&groupedBySection=true
→ data[].id (section), data[].values[].{lable, customFieldId, type, unmodifiedExtraData}
```

A standalone `PUT /api/employees/{n}/CustomFieldValues` with the same
`{section, values}` shape also works (the wizard uses it for sections 1/2/3).
`api/ohrm-employees.ts` resolves the field **by label** from that GET, so
instance rebuilds renumbering the ids don't matter on the API path.

## Master-data lookups (name → id)

| Table | Endpoint | name key / id key |
|---|---|---|
| gender | `GET /api/gender` | name/id (Male=1, Female=2, Non-Binary=3) |
| marital status | `GET /api/marital-statuses` | name/id |
| nationality | `GET /api/nationality` | name/id |
| locations | `GET /api/employees/locations` | name/id |
| job titles | `GET /api/job-titles?page[limit]=0` | **jobTitleName**/id |
| employment status | `GET /api/employmentStatus` | name/id |
| job categories | `GET /api/jobCategories` | name/id |
| work schedules | `GET /api/pim/workSchedules` | name/id |
| sub units | `GET /api/subunits?tree=true` | name/id |
| countries | `GET /api/countries` | **cou_name**/**cou_code** |

## Sync tab (read-only findings, for later)

```
GET /api/employeeCustomTabCustomFieldValues?emp_number={n}&tabId=397&withEmpty=true
```

returns the BizPay sync-information fields with labels ("Last Sync Date
(UTC)", "Last Sync Status", ...) — a label-based API read of the write-back
status is possible if IntegrationTabPage ever needs replacing. The custom-tab
SAVE endpoint was not captured (the run failed before that step).
