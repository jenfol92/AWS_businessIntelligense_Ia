// Explicitly invoked only AFTER migration review and authorization for real Amazon calls.
const {loadEnvConfig}=require('@next/env');
loadEnvConfig(process.cwd(),true,{info(){},error(){}});
if(!process.argv.includes('--allow-amazon')) throw new Error('EXPLICIT_AMAZON_AUTHORIZATION_REQUIRED');
if(process.env.AMAZON_LEDGER_SYNC_ENABLED!=='true')throw new Error('LEDGER_DISABLED');
if(!process.env.CRON_SECRET?.trim())throw new Error('CRON_SECRET_MISSING');
fetch('http://localhost:3000/api/cron/amazon/fba-ledger/recover',{
 method:'POST',headers:{authorization:`Bearer ${process.env.CRON_SECRET.trim()}`},signal:AbortSignal.timeout(60000),
}).then(async response=>{console.log(JSON.stringify(await response.json()));if(!response.ok)process.exitCode=1;})
 .catch(()=>{console.error('LEDGER_RECOVERY_HTTP_FAILED');process.exitCode=1;});
