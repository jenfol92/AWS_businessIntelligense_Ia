import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { claimReportRequestJob, getReportJobById } from "./reportJobsRepository";
import { stableReportRequestKey } from "./reportRequestDedupPolicy";
import { createReport, getReport, getReportDocument, downloadReportDocument } from "./reportsClient";
import { safeSpApiErrorMetadata } from "./errors";
import { parseAndPersistFbaSalesReportDocument } from "./fbaForecastSpApiImportsService";
import { advanceFbaSalesSync, FBA_SALES_REPORT_TYPE } from "./fbaSalesSyncWorker";
import { splitInclusiveDateRange, type SalesSyncState, type SalesRange } from "./fbaSalesSyncPolicy";

const SOURCE = "fba_sales_coordinator";
type Input = SalesRange & { marketplaceIds?: string[]; reportType?: string; reportId?: string; jobId?: string; mode?: "import" | "syncOnly"; tipoCliente?: string };

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
function response(jobId: string, state: SalesSyncState, lastPublication?: unknown) {
  return { ok: state.status === "COMPLETED", status: state.status, jobId, summary: state, error: state.error,
    nextAttemptAt: state.nextAttemptAt, lastCommittedAt: state.lastCommittedAt, lastPublication:lastPublication ?? null };
}

export async function coordinateFbaSalesSync(input: Input) {
  const ranges = splitInclusiveDateRange(input.fromDate, input.toDate);
  if (ranges.length > 13) throw new Error("FBA_SALES_MAX_RANGE_390_DAYS");
  if (input.reportType && input.reportType !== FBA_SALES_REPORT_TYPE) throw new Error("UNSUPPORTED_SALES_REPORT_TYPE");
  if (input.reportId && ranges.length !== 1) throw new Error("EXISTING_REPORT_REQUIRES_SINGLE_CHUNK");
  if (input.marketplaceIds && (!Array.isArray(input.marketplaceIds) || input.marketplaceIds.some(v=>typeof v!=="string" || !v.trim()))) throw new Error("INVALID_MARKETPLACE_IDS");
  const marketplaceIds = Array.from(new Set(input.marketplaceIds?.length ? input.marketplaceIds.map(v=>v.trim()) : input.mode === "syncOnly" ? [] : loadSpApiConfig().marketplaceIds)).sort();
  if (!marketplaceIds.length) throw new Error("MISSING_MARKETPLACE_SCOPE");
  const initial: SalesSyncState = {
    version: 1, fromDate: input.fromDate, toDate: input.toDate, marketplaceIds, mode: input.mode ?? "import",
    tipoCliente: input.tipoCliente ?? "B2C", status: "PENDING", chunkIndex: 0, error: null,
    nextAttemptAt: null, lastCommittedAt: null,
    chunks: ranges.map(range=>({...range, phase: input.reportId ? "POLL" : "CREATE", attempts: 0, ...(input.reportId ? {reportId:input.reportId} : {})})),
  };
  let jobId = input.jobId;
  if (!jobId) {
    const requestKey = { fromDate:input.fromDate,toDate:input.toDate, mode:initial.mode,tipoCliente:initial.tipoCliente,reportId:input.reportId ?? null };
    const base = { reportType:FBA_SALES_REPORT_TYPE,marketplaceIds,requestKey };
    const compatibilityKey = stableReportRequestKey(base);
    // Equivalent work is resumed, including terminal failures (no automatic regeneration).
    const {data,error}=await supabaseAdmin.from("amazon_spapi_report_jobs").select("id")
      .eq("source",SOURCE).eq("raw->requestedCreateReportPayload->>salesCompatibilityKey",compatibilityKey)
      .not("status","in","(COMPLETED,FAILED,FATAL)").order("requested_at").limit(1);
    if(error) throw new Error(error.message);
    jobId=data?.[0]?.id;
    if(!jobId) {
      const {data:previous,error:previousError}=await supabaseAdmin.from("amazon_spapi_report_jobs").select("id,status")
        .eq("source",SOURCE).eq("raw->requestedCreateReportPayload->>salesCompatibilityKey",compatibilityKey)
        .order("requested_at",{ascending:false}).order("id",{ascending:false}).limit(1);
      if(previousError) throw new Error(previousError.message);
      const last=previous?.[0];
      if(last && last.status!=="COMPLETED") return resumeFbaSalesSync(last.id);
      try {
        const claim=await claimReportRequestJob({...base,source:SOURCE,now:new Date(0),
          requestKey:{...requestKey,previousCompletedJobId:last?.id ?? null},
          requestedCreateReportPayload:{...requestKey, salesInitial:initial, salesCompatibilityKey:compatibilityKey}});
        jobId=claim.job.id;
      } catch(error) {
        // The partial UNIQUE also covers concurrent callers observing different generations.
        const {data:active,error:lookupError}=await supabaseAdmin.from("amazon_spapi_report_jobs").select("id")
          .eq("source",SOURCE).eq("raw->requestedCreateReportPayload->>salesCompatibilityKey",compatibilityKey)
          .not("status","in","(COMPLETED,FAILED,FATAL)").maybeSingle();
        if(lookupError || !active) throw error;
        jobId=active.id;
      }
    }
  }
  return resumeFbaSalesSync(jobId,initial);
}

export async function resumeFbaSalesSync(jobId: string, initial?: SalesSyncState) {
  const job=await getReportJobById(jobId);
  if(!job || job.source!==SOURCE) throw new Error("INVALID_SALES_JOB");
  const payload=job.raw?.requestedCreateReportPayload as {salesInitial?:SalesSyncState} | undefined;
  const claimed=await rpc("claim_fba_sales_sync",{p_job_id:jobId,p_initial:payload?.salesInitial ?? initial ?? null}) as {state:SalesSyncState;runId:string|null};
  if(!claimed.runId) return response(jobId,claimed.state,job.raw?.lastPublication);
  const runId=claimed.runId;
  const save=(state:SalesSyncState)=>rpc("checkpoint_fba_sales_sync",{p_job_id:jobId,p_run_id:runId,p_state:state}).then(()=>undefined);
  const state=claimed.state;
  let finalStatus=state.status;
  try {
    await advanceFbaSalesSync(state,{
      now:()=>Date.now(),save,
      create:async chunk=>(await createReport({reportType:FBA_SALES_REPORT_TYPE,marketplaceIds:state.marketplaceIds,
        dataStartTime:`${chunk.fromDate}T00:00:00Z`,dataEndTime:`${chunk.toDate}T23:59:59Z`},
        {signal:AbortSignal.timeout(15000),rateLimitRetry:{maxRetries:0}})).reportId,
      poll:reportId=>getReport(reportId,{signal:AbortSignal.timeout(15000),rateLimitRetry:{maxRetries:0}}),
      publish:async(chunk)=>{
        const commit=(rows:Record<string,unknown>[],marketplaceIds:string[])=>rpc("commit_fba_sales_chunk",{
          p_job_id:jobId,p_run_id:runId,p_rows:rows,p_marketplace_ids:marketplaceIds,
        }) as Promise<Record<string,unknown>>;
        if(state.mode==="syncOnly") {await commit([],state.marketplaceIds);return;}
        const signal=AbortSignal.timeout(20000);
        const document=await getReportDocument(chunk.documentId!,{signal,rateLimitRetry:{maxRetries:0}});
        const text=await downloadReportDocument(document,{signal,maxBytes:20*1024*1024});
        await parseAndPersistFbaSalesReportDocument({reportId:chunk.reportId!,reportType:FBA_SALES_REPORT_TYPE,
          marketplaceIds:state.marketplaceIds,fromDate:chunk.fromDate,toDate:chunk.toDate,documentText:text,
          status:"DONE",processingStatus:"DONE",commit});
      },
      errorInfo:error=>{
        const info=safeSpApiErrorMetadata(error);
        return {rateLimited:info.httpStatus===429 || info.code==="rate_limited",retryAfter:info.retryAfter,message:info.amazonMessage};
      },
    });
    // Read the database checkpoint, including a commit whose response may have been lost.
    const persisted=await getReportJobById(jobId);
    finalStatus=(persisted!.raw!.fbaSalesSync as SalesSyncState).status;
    return response(jobId,persisted!.raw!.fbaSalesSync as SalesSyncState,persisted!.raw!.lastPublication);
  } catch(error) {
    const persisted=await getReportJobById(jobId);
    const current=persisted?.raw?.fbaSalesSync as SalesSyncState | undefined;
    if(current) finalStatus=current.status;
    if(current && (current.chunkIndex>state.chunkIndex || current.status==="COMPLETED")) return response(jobId,current,persisted?.raw?.lastPublication);
    throw error;
  } finally {
    // Releasing one execution lease is not a successful sales synchronization.
    const terminal=["COMPLETED","FAILED","FATAL"].includes(finalStatus);
    const {error}=await supabaseAdmin.from("amazon_report_sync_runs").update({
      status:finalStatus==="COMPLETED"?"SUCCESS":terminal?"ERROR":"RUNNING",
      lock_expires_at:new Date().toISOString(),finished_at:terminal?new Date().toISOString():null,
      summary:{executionStepFinished:true,salesStatus:finalStatus},
    })
      .eq("id",runId).eq("status","RUNNING").gt("lock_expires_at",new Date().toISOString());
    if(error) throw new Error(error.message);
  }
}

/** The hourly scheduler advances only the oldest unfinished job, with bounded work. */
export async function resumeDueFbaSalesSync() {
  const {data,error}=await supabaseAdmin.from("amazon_spapi_report_jobs").select("id")
    .eq("source",SOURCE).not("status","in","(COMPLETED,FAILED,FATAL)").order("requested_at").order("id").limit(1);
  if(error) throw new Error(error.message);
  return data?.[0] ? resumeFbaSalesSync(data[0].id) : null;
}
