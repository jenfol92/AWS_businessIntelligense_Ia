// One scheduler tick, FBM only. Does NOT create a job or call any FBA pipeline.
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.CRON_SECRET?.trim()) throw new Error('CRON_SECRET_MISSING');
fetch('http://localhost:3000/api/cron/amazon/fbm-inventory-snapshot/recover', {
  method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET.trim()}` }, signal: AbortSignal.timeout(60000),
}).then(async response => {
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
  if (!response.ok) process.exitCode = 1;
}).catch(() => { console.error('FBM_RECOVERY_HTTP_FAILED'); process.exitCode = 1; });
