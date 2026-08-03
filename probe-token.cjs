// One-shot check: has OHRM's temporary auth block lapsed?
require('dotenv').config({ path: __dirname + '/.env' });

(async () => {
  const base = process.env.OHRM_URL.replace(/\/$/, '');
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
  console.log(
    new Date().toISOString(),
    res.status,
    res.ok ? 'TOKEN OK' : text.slice(0, 200),
  );
})();
