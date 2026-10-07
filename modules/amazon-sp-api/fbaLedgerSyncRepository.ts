import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { reportClaimUuid } from "./reportRequestDedupPolicy";
import { LEDGER_OWNER, LEDGER_REPORT_TYPE, LEDGER_LEASE_MS, initialLedgerState, ledgerDate, type LedgerState } from "./fbaLedgerSyncPolicy";
import type { LedgerJob, LedgerOptions } from "./fbaLedgerSyncCoordinator";

const query = () => supabaseAdmin.from("amazon_spapi_report_jobs")
  .select("id,state:raw->ledger").eq("source",LEDGER_OWNER).eq("report_type",LEDGER_REPORT_TYPE);
function decode(row: unknown): LedgerJob {
  const job = row as LedgerJob;
  if (!job?.state || job.state.version !== 1 || job.state.owner !== LEDGER_OWNER ||
      job.state.scope !== initialLedgerState(job.state.date,job.state.marketplaceIds).scope) throw new Error("LEDGER_INVALID_JOB");
  return job;
}
export async function observeLedgerJob(jobId?: string): Promise<LedgerJob|null> {
  const {data,error} = jobId ? await query().eq("id",jobId).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
    : await query().order("requested_at",{ascending:false}).order("id").limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if (error) throw new Error("LEDGER_JOB_READ_FAILED");
  return data ? decode(data) : null;
}
export async function findLedgerJob(options: LedgerOptions): Promise<LedgerJob|null> {
  if (options.jobId) return observeLedgerJob(options.jobId);
  if (options.recoveryOnly) {
    const {data,error}=await query().in("status",["PENDING","PROCESSING","RATE_LIMITED"])
      .or(`raw->ledger->>nextAttemptAt.is.null,raw->ledger->>nextAttemptAt.lte.${new Date().toISOString()}`)
      .order("requested_at").limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
    if (error) throw new Error("LEDGER_JOB_READ_FAILED");
    return data?decode(data):null;
  }
  const config=loadSpApiConfig();
  if (config.region!=="EU") throw new Error("LEDGER_UNSUPPORTED_REGION");
  const state=initialLedgerState(ledgerDate(options.date),config.marketplaceIds);
  const id=reportClaimUuid({reportType:LEDGER_REPORT_TYPE,marketplaceIds:state.marketplaceIds,now:new Date(0),requestKey:{owner:LEDGER_OWNER,scope:state.scope}});
  const {error}=await supabaseAdmin.from("amazon_spapi_report_jobs").insert({id,source:LEDGER_OWNER,report_type:LEDGER_REPORT_TYPE,
    marketplace_ids:state.marketplaceIds,status:state.status,raw:{ledger:state}}).abortSignal(AbortSignal.timeout(8000));
  if (error && error.code!=="23505") throw new Error("LEDGER_JOB_CREATE_FAILED");
  return observeLedgerJob(id);
}
export async function acquireLedgerJob(job: LedgerJob): Promise<LedgerJob|null> {
  const now=Date.now();
  if (job.state.lease && Date.parse(job.state.lease.expiresAt)>now) return null;
  const state: LedgerState={...job.state,revision:job.state.revision+1,lease:{token:randomUUID(),expiresAt:new Date(now+LEDGER_LEASE_MS).toISOString()}};
  const {data,error}=await supabaseAdmin.from("amazon_spapi_report_jobs").update({raw:{ledger:state},updated_at:new Date(now).toISOString()})
    .eq("id",job.id).eq("source",LEDGER_OWNER).eq("report_type",LEDGER_REPORT_TYPE)
    .eq("raw->ledger->>revision",String(job.state.revision)).select("id").abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if(error) throw new Error("LEDGER_CLAIM_FAILED");
  return data?{id:job.id,state}:null;
}
export async function saveLedgerJob(job: LedgerJob,release=false): Promise<void> {
  const old=job.state,now=new Date().toISOString();
  if(!old.lease) throw new Error("LEDGER_LEASE_LOST");
  const next={...old,revision:old.revision+1,lease:release?null:old.lease};
  const {data,error}=await supabaseAdmin.from("amazon_spapi_report_jobs").update({raw:{ledger:next},status:next.status,
    report_id:next.reportId,report_document_id:next.documentId,error_message:next.error,updated_at:now})
    .eq("id",job.id).eq("source",LEDGER_OWNER).eq("report_type",LEDGER_REPORT_TYPE)
    .eq("raw->ledger->>revision",String(old.revision)).eq("raw->ledger->lease->>token",old.lease.token)
    .gt("raw->ledger->lease->>expiresAt",now).select("id").abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if(error) throw new Error("LEDGER_CHECKPOINT_FAILED");
  if(!data) throw new Error("LEDGER_LEASE_LOST");
  Object.assign(old,next);
}
