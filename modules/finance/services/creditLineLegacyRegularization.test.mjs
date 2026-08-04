import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";

const rootUrl=`${pathToFileURL(process.cwd()).href}/`;
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==="next/headers") return nextResolve("next/headers.js",context);
  if(specifier.startsWith("@/")) return {shortCircuit:true,url:pathToFileURL(`${process.cwd()}/${specifier.slice(2)}.ts`).href};
  if(context.parentURL?.startsWith(rootUrl)&&!context.parentURL.includes("/node_modules/")&&(specifier.startsWith("./")||specifier.startsWith("../"))&&!/\.[a-z]+$/i.test(specifier)) return {shortCircuit:true,url:new URL(`${specifier}.ts`,context.parentURL).href};
  return nextResolve(specifier,context);
}});

const {
  MAX_DISPOSITIONS, MAX_IDEMPOTENCY_KEY_LENGTH, MAX_MONEY_EXCLUSIVE,
  MAX_NOTES_LENGTH, MAX_REFERENCE_LENGTH, normalizeCreditLineLegacyRegularizationInput,
}=await import("./creditLineLegacyRegularizationValidation.ts");
const {createCreditLineLegacyRegularization}=await import("./creditLineLedgerService.ts");
const {addCivilDays,nextSuggestedDueDate}=await import("../utils/creditLineLegacyDates.ts");
const lineId="10000000-0000-4000-8000-000000000001";
const base={dispositions:[{principalEur:50,dispositionDate:"2026-01-31",contractualDueDate:"2026-05-31",reference:null,notes:null}],idempotencyKey:"legacy-1"};

test("validates an exact disposition-only payload",()=>{
  assert.equal(normalizeCreditLineLegacyRegularizationInput(lineId,base).dispositions[0].principalEur,50);
  for(const extra of [{derivedGap:50},{total:50},{unexplainedAmount:50},{amount:50}]) assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,...extra}));
});

test("rejects invalid monetary and date values",()=>{
  for(const principalEur of [0,-1,1.001,"50",NaN,Infinity]) assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],principalEur}]}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],contractualDueDate:"2026-01-30"}]}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],dispositionDate:"2999-01-01",contractualDueDate:"2999-05-01"}]}),/futura/);
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,idempotencyKey:"x".repeat(201)}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:Array.from({length:501},()=>base.dispositions[0])}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],reference:"x".repeat(251)}]}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],notes:"x".repeat(2001)}]}));
});

test("shared payload boundaries accept the maximum valid values and reject the first invalid values",()=>{
  assert.equal(MAX_DISPOSITIONS,500);
  assert.equal(MAX_IDEMPOTENCY_KEY_LENGTH,200);
  assert.equal(MAX_REFERENCE_LENGTH,250);
  assert.equal(MAX_NOTES_LENGTH,2000);
  assert.equal(MAX_MONEY_EXCLUSIVE,1_000_000_000_000);
  const boundary={...base,idempotencyKey:"k".repeat(200),dispositions:[{
    ...base.dispositions[0],principalEur:999_999_999_999.99,
    reference:"r".repeat(250),notes:"n".repeat(2000),
  }]};
  assert.equal(normalizeCreditLineLegacyRegularizationInput(lineId,boundary).dispositions[0].principalEur,999_999_999_999.99);
  assert.doesNotThrow(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:Array.from({length:500},()=>base.dispositions[0])}));
  assert.throws(()=>normalizeCreditLineLegacyRegularizationInput(lineId,{...base,dispositions:[{...base.dispositions[0],principalEur:1_000_000_000_000}]}));
});

function rpcErrorClient(code,message=`secret ${code} SQL table UUID`) {
  return {rpc:async()=>({data:null,error:{code,message,details:"secret details",hint:"secret hint"}})};
}

test("legacy RPC errors use only stable regularization messages",async()=>{
  const cases=[
    ["INVALID_AMOUNT","Los datos de la regularización no son válidos."],
    ["INVALID_DATE","Las fechas de las disposiciones no son válidas."],
    ["NO_LEGACY_GAP","La línea no tiene saldo inicial pendiente de explicar."],
    ["IDEMPOTENCY_PAYLOAD_MISMATCH","La clave de idempotencia pertenece a otro desglose."],
    ["CREDIT_LINE_DELETED","La línea de crédito está eliminada y no puede regularizarse."],
  ];
  for(const [code,message] of cases){
    await assert.rejects(createCreditLineLegacyRegularization(
      normalizeCreditLineLegacyRegularizationInput(lineId,base),rpcErrorClient(code),
    ),(error)=>error.code===code&&error.message===message&&!/devoluci[oó]n|fecha efectiva|repayment|SQL|tabla|UUID/i.test(error.message));
  }
  await assert.rejects(createCreditLineLegacyRegularization(
    normalizeCreditLineLegacyRegularizationInput(lineId,base),rpcErrorClient("42501"),
  ),(error)=>error.code==="ADMIN_OR_ACCOUNTING_REQUIRED"&&error.message==="Finance access denied");
  await assert.rejects(createCreditLineLegacyRegularization(
    normalizeCreditLineLegacyRegularizationInput(lineId,base),rpcErrorClient("XX000"),
  ),(error)=>error.code==="INTERNAL_ERROR"&&error.message==="No se pudo regularizar el saldo inicial.");
});

test("civil suggestions support 90 and 120 days without overwriting manual edits",()=>{
  assert.equal(addCivilDays("2026-01-31",90),"2026-05-01");
  assert.equal(addCivilDays("2026-01-31",120),"2026-05-31");
  assert.equal(nextSuggestedDueDate("2026-01-31",90,"",false),"2026-05-01");
  assert.equal(nextSuggestedDueDate("2026-02-01",90,"2026-06-15",true),"2026-06-15");
});

test("migration isolates legacy groups and canonicalizes fingerprint without bank names",async()=>{
  const source=await readFile(path.join(process.cwd(),"sql/migrations/20260804_03_credit_line_legacy_regularization.sql"),"utf8");
  assert.match(source,/length\('AND due_date = v_due_date'[\s\S]*<>1/);
  assert.match(source,/length\('AND p_movement_date BETWEEN period_start AND period_end'[\s\S]*<>1/);
  assert.match(source,/length\('credit_line_id, period_start, period_end, due_date,'[\s\S]*updated_at'\)<>2/);
  assert.match(source,/length\('0, 0, 0, ''open'', now\(\)'[\s\S]*RETURNING'\)<>2/);
  assert.match(source,/length\('updated_at, group_origin_type'\)<>2/);
  assert.match(source,/length\('now\(\), ''operational_cycle'''\)<>2/);
  assert.match(source,/v_definition LIKE '%amount, paid_amount, remaining_amount, status, updated_at'/);
  assert.match(source,/v_definition LIKE '%0, 0, 0, ''open'', now\(\)'/);
  assert.match(source,/DRAWDOWN_LEGACY_GROUP_FORBIDDEN/);
  assert.match(source,/ORDER BY \(x->>'contractualDueDate'\)::date,\(x->>'dispositionDate'\)::date/);
  const fingerprint=source.match(/v_fingerprint:=md5\(([\s\S]*?)\);/)?.[1]??"";
  assert.doesNotMatch(fingerprint,/idempotency/i);
  assert.doesNotMatch(source,/bank_name\s*=|CASE[\s\S]{0,80}bank_name/i);
  assert.match(source,/legacy_origin_fk[\s\S]*REFERENCES public\.finance_credit_line_legacy_regularizations\(id\) ON DELETE RESTRICT/);
  assert.match(source,/jsonb_array_length\(p_dispositions\)>500/);
  assert.match(source,/v_disposition_date>current_date/);
  assert.match(source,/lower\(btrim\(coalesce\(v_line\.status,''\)\)\) IN \('deleted','eliminada'\)[\s\S]*CREDIT_LINE_DELETED/);
});

test("all ordinary runtime group lookup paths select operational groups",async()=>{
  const repository=await readFile(path.join(process.cwd(),"modules/finance/repositories/creditLineLedgerRepository.ts"),"utf8");
  const lookup=repository.match(/export async function findOpenRepaymentGroupForDate[\s\S]*?^}/m)?.[0]??"";
  assert.match(lookup,/\.eq\("group_origin_type", "operational_cycle"\)/);
  assert.equal((repository.match(/findOpenRepaymentGroupForDate/g)??[]).length,1);
  assert.equal((lookup.match(/\.in\("status", \["open", "partially_paid"\]\)/g)??[]).length,1);
});

test("service publishes camelCase and sanitizes unknown regularization errors",async()=>{
  const service=await readFile(path.join(process.cwd(),"modules/finance/services/creditLineLedgerService.ts"),"utf8");
  const fn=service.match(/export async function createCreditLineLegacyRegularization[\s\S]*?\n}/)?.[0]??"";
  assert.match(fn,/regularizationId: result\.regularization_id/);
  assert.match(fn,/creditLineMovementId: item\.credit_line_movement_id/);
  assert.match(service,/function translateLegacyRegularizationRpcError/);
  assert.match(service,/No se pudo regularizar el saldo inicial\./);
});

test("UI sends dispositions and server-resolved management permission",async()=>{
  const ui=await readFile(path.join(process.cwd(),"modules/finance/components/CreditLineMaturitiesSection.tsx"),"utf8");
  const route=await readFile(path.join(process.cwd(),"app/api/finance/credit-lines/maturities/route.ts"),"utf8");
  const legacyRoute=await readFile(path.join(process.cwd(),"app/api/finance/credit-lines/[id]/legacy-opening-balance/route.ts"),"utf8");
  assert.match(ui,/body:\s*JSON\.stringify\(\{ dispositions, idempotencyKey \}\)/);
  assert.match(ui,/canManageCreditLineRegularizations/);
  assert.match(ui,/canExecuteCreditLineRepayments && maturity\.canRepay/);
  assert.match(ui,/items\.length >= MAX_DISPOSITIONS/);
  assert.match(ui,/amount < MAX_MONEY_EXCLUSIVE/);
  assert.match(ui,/maxLength=\{MAX_REFERENCE_LENGTH\}/);
  assert.match(ui,/maxLength=\{MAX_NOTES_LENGTH\}/);
  assert.match(ui,/onSaved=\{async \(message\) => \{\s*await load\(filter\);\s*await onRepaid\(message\);/);
  assert.doesNotMatch(ui,/body:\s*JSON\.stringify\([^)]*(derivedGap|unexplainedAmount|total)/);
  assert.match(route,/const canManage = access\.role === "admin" \|\| access\.role === "accounting"/);
  assert.match(route,/buildCreditLineMaturities\(query, canManage, canManage\)/);
  assert.match(legacyRoute,/CREDIT_LINE_DELETED[\s\S]*return 409/);
});
