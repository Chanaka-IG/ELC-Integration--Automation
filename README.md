# bizpay-sync-tests

Playwright (TypeScript) automation framework for the **OrangeHRM → BizPay
employee sync** ([JN] [BIZPAY] [4.0] [QA] Celigo integration).

Covers the full pipeline:

```
OHRM UI (add employee)  →  RabbitMQ consumer (sysadmin UI)  →  change report
   →  Celigo flow "[OHRM -> BIZPAY] | Sync Employees"  →  BizPay sandbox
```

## Layout

| Path | Purpose |
|---|---|
| `oracle/ohrm-to-bizpay.ts` | **Single source of truth**: field mappings + transformations + validation rules, reconstructed from the Celigo configs |
| `pages/ohrm/` | Page objects: login, PIM add-employee, integration custom tab, sysadmin RabbitMQ trigger |
| `api/` | API clients: OHRM change report, Celigo (run flow / poll jobs / errors), BizPay verification |
| `factories/employee.ts` | Unique, traceable test employees (`QA-ADD-<runId>`) |
| `utils/` | Polling (no sleeps) and oracle-driven field diffing |
| `tests/e2e/` | Happy-path end-to-end specs (add / insert path, update path) |
| `tests/negative/` | Negative case matrix (README lists the plan) |

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in URLs, credentials, tokens
npm test
```

## Design rules

1. **Serial execution** (`workers: 1`): the OHRM delta cursor and the 5-minute
   Celigo schedule are shared state; parallel sync tests would consume each
   other's change events.
2. **Schedule-immune assertions**: tests accept whichever flow run (manual or
   scheduled) consumed the event and locate their record by employee id /
   trace key (`<empNumber>_<employeeId>`).
3. **No sleeps** — `pollUntil` for the two async hops (event recorded, job
   completed).
4. **Celigo is never modified** by this framework — it only triggers runs and
   reads jobs/errors.
5. **Teardown must set Skip-sync before deleting** test employees, so cleanup
   doesn't generate new sync events.
6. **Master data and custom-field ids are instance state, not constants.**
   Rebuilding the OHRM QA instance renumbers every custom field and replaces
   every dropdown list, which breaks the suite quietly. After a rebuild, re-derive
   both instead of editing selectors by hand:
   - `node explore/dump-custom-field-ids.cjs <empNumber>` → the ids for
     `pages/ohrm/customFields.ts`
   - `node explore/dump-job-tab.cjs` → OHRM's Job-tab dropdown values; intersect
     them with the BizPay lookup tables before setting the defaults in
     `factories/employee.ts` (sub unit / job title / employment status are
     resolved by exact NAME, and two of the three fail silently on a miss)

## Status / TODO

- [x] Framework scaffold, mapping oracle, API clients, e2e spec
- [x] Update-path spec (`tests/e2e/update-employee.spec.ts`): edit an
      already-synced employee, verify the UPDATE leg — in-place PUT, no
      duplicate, unchanged fields untouched, Unique Id stable
- [ ] Live-UI exploration pass: confirm selectors in `pages/ohrm/*` (needs QA
      instance URL + admin & sysadmin credentials)
- [ ] `SysAdminPage.runRabbitMqConsumer()` — instance-specific trigger
- [ ] `IntegrationTabPage` — custom tab name + field selectors
- [ ] Confirm OHRM/Celigo/BizPay auth schemes once tokens are provided
- [ ] Replace `SET-ME-*` master-data defaults in `factories/employee.ts` with
      values confirmed to exist in both systems
- [ ] BizPay UI page objects for frontend verification (phase 2)
- [ ] Implement negative case matrix (`tests/negative/README.md`)
