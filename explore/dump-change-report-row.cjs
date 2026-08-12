/**
 * Read-only: print the full changed-employee-report row for one test employee —
 * the exact payload the Celigo export reads. Use it to see which fields Celigo
 * actually receives (e.g. whether the Payroll Name custom field reaches it at
 * all after an instance rebuild renumbers custom fields).
 *
 *   node explore/dump-change-report-row.cjs <employeeId> [hoursBack]
 */
require('dotenv').config();

const base = process.env.OHRM_URL.replace(/\/+$/, '');
const EMPLOYEE_ID = process.argv[2];
const HOURS = Number(process.argv[3] || 3);
if (!EMPLOYEE_ID) {
  console.error('usage: node explore/dump-change-report-row.cjs <employeeId> [hoursBack]');
  process.exit(1);
}

const ts = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
};

(async () => {
  let token = process.env.OHRM_ACCESS_TOKEN;
  if (!token) {
    const res = await fetch(`${base}/oauth/issueToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.OHRM_CLIENT_ID,
        client_secret: process.env.OHRM_CLIENT_SECRET,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`token request failed: ${res.status} ${text.slice(0, 200)}`);
      process.exit(1);
    }
    token = JSON.parse(text).access_token;
  }

  const params = new URLSearchParams({
    'filter[report_type]': '3',
    'filter[event_recorded_date_time_from]': ts(new Date(Date.now() - HOURS * 3600_000)),
    'filter[event_recorded_date_time_to]': ts(new Date(Date.now() + 60_000)),
    'filter[separate_emps_by_change_event]': '1',
    'filter[include_fields_changed]': '1',
    'page[offset]': '0',
    'page[limit]': '200',
  });
  const res = await fetch(
    `${base}/api/reports/Changed_Employee_Information_Export_Report?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  if (!res.ok) {
    console.error(`report failed: ${res.status} ${text.slice(0, 300)}`);
    process.exit(1);
  }
  const rows = JSON.parse(text).data ?? [];
  console.log(`report returned ${rows.length} rows over the last ${HOURS}h`);

  const mine = rows.filter((r) => String(r.employeeId) === EMPLOYEE_ID);
  if (!mine.length) {
    console.log(`\n!! no row for employeeId ${EMPLOYEE_ID}`);
    console.log('employeeIds present:', rows.map((r) => r.employeeId).slice(0, 40).join(', '));
    return;
  }
  for (const row of mine) {
    console.log(`\n===== row for ${EMPLOYEE_ID} (${row.async_event_display_name}) =====`);
    for (const [k, v] of Object.entries(row)) {
      console.log(`  ${k.padEnd(38)} ${JSON.stringify(v)}`);
    }
  }
  // which keys look like they carry the payroll routing value?
  const payrollish = Object.keys(mine[0]).filter((k) => /payroll|cust/i.test(k));
  console.log(`\npayroll/cust-looking keys: ${payrollish.join(', ') || '(none)'}`);
})();
