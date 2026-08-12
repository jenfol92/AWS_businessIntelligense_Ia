import type { PlannedMaturityInput, PlannedMaturityPatchInput } from "../types/creditLinePlannedMaturities.types";

const MAX_MONEY_EXCLUSIVE = 1_000_000_000_000;
const isUuid = (value:unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function isRealIsoDate(value:unknown): value is string { if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T00:00:00Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value; }

export class PlannedMaturityError extends Error {
  readonly code:string;readonly status:number;
  constructor(code:string,message:string,status=422){super(message);this.code=code;this.status=status;this.name="PlannedMaturityError";}
}
function money(value: unknown, field: string, positive=false): number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||(positive&&value<=0)||value>=MAX_MONEY_EXCLUSIVE||Math.abs(value*100-Math.round(value*100))>1e-6) throw new PlannedMaturityError("INVALID_AMOUNT",`${field} no es valido.`);
  return Math.round(value*100)/100;
}
function text(value:unknown,field:string,max:number,required=false){
  if(value==null||value===""){if(required)throw new PlannedMaturityError("INVALID_TEXT",`${field} es obligatorio.`);return null;}
  if(typeof value!=="string"||value.trim().length>max||(!value.trim()&&required))throw new PlannedMaturityError("INVALID_TEXT",`${field} no es valido.`);
  return value.trim()||null;
}
export function normalizePlannedMaturityInput(payload:Record<string,unknown>):PlannedMaturityInput{
  const allowed=new Set(["creditLineId","dueDate","plannedPrincipalEur","expectedInterestEur","expectedFeesEur","concept","reference","notes","idempotencyKey"]);
  if(!payload||Array.isArray(payload)||Object.keys(payload).some(k=>!allowed.has(k)))throw new PlannedMaturityError("INVALID_PAYLOAD","Payload no valido.");
  if(!isUuid(payload.creditLineId))throw new PlannedMaturityError("INVALID_UUID","creditLineId no es valido.");
  if(!isRealIsoDate(payload.dueDate))throw new PlannedMaturityError("INVALID_DATE","dueDate no es valida.");
  return {creditLineId:payload.creditLineId.trim(),dueDate:payload.dueDate,plannedPrincipalEur:money(payload.plannedPrincipalEur,"plannedPrincipalEur",true),expectedInterestEur:money(payload.expectedInterestEur??0,"expectedInterestEur"),expectedFeesEur:money(payload.expectedFeesEur??0,"expectedFeesEur"),concept:text(payload.concept,"concept",250,true)!,reference:text(payload.reference,"reference",250),notes:text(payload.notes,"notes",2000),idempotencyKey:text(payload.idempotencyKey,"idempotencyKey",200,true)!};
}
export function normalizePlannedMaturityPatchInput(payload:Record<string,unknown>):PlannedMaturityPatchInput{
  const allowed=new Set(["dueDate","plannedPrincipalEur","expectedInterestEur","expectedFeesEur","concept","reference","notes"]);
  if(!payload||Array.isArray(payload)||Object.keys(payload).some(k=>!allowed.has(k)))throw new PlannedMaturityError("INVALID_PAYLOAD","Payload no valido.");
  if(!isRealIsoDate(payload.dueDate))throw new PlannedMaturityError("INVALID_DATE","dueDate no es valida.");
  return {dueDate:payload.dueDate,plannedPrincipalEur:money(payload.plannedPrincipalEur,"plannedPrincipalEur",true),expectedInterestEur:money(payload.expectedInterestEur??0,"expectedInterestEur"),expectedFeesEur:money(payload.expectedFeesEur??0,"expectedFeesEur"),concept:text(payload.concept,"concept",250,true)!,reference:text(payload.reference,"reference",250),notes:text(payload.notes,"notes",2000)};
}
export function plannedMaturityError(error:unknown){
  if(error instanceof PlannedMaturityError)return {status:error.status,code:error.code,error:error.message};
  const raw=error&&typeof error==="object"&&"code" in error?String(error.code):"";
  const msg=error instanceof Error?error.message:""; const code=(msg.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0])??raw;
  if(raw==="42501"||code==="ADMIN_OR_ACCOUNTING_REQUIRED")return {status:403,code:"FINANCE_ACCESS_DENIED",error:"Finance access denied"};
  if(code==="NOT_FOUND"||code==="CREDIT_LINE_NOT_FOUND")return {status:404,code,error:"Resource not found"};
  if(code==="IDEMPOTENCY_PAYLOAD_MISMATCH"||code==="PLANNED_MATURITY_IMMUTABLE")return {status:409,code,error:"Planned maturity conflicts with the current state"};
  if(code.startsWith("INVALID_"))return {status:422,code,error:"Invalid planned maturity"};
  return {status:500,code:"INTERNAL_ERROR",error:"Unexpected finance error"};
}
