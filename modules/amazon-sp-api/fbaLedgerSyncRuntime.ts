import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { createReport,getReport,getReportDocument } from "./reportsClient";
import { safeSpApiErrorMetadata } from "./errors";
import { fbaLedgerUtcDayBounds } from "./fbaLedgerSchedulePolicy";
import { LEDGER_REPORT_TYPE,LEDGER_STEP_MS,LEDGER_OWNER,type LedgerManifest } from "./fbaLedgerSyncPolicy";
import { findLedgerJob,acquireLedgerJob,saveLedgerJob,observeLedgerJob } from "./fbaLedgerSyncRepository";
import { ledgerDigest,downloadLedgerDocument } from "./fbaLedgerDocument";
import { LedgerEvidenceError } from "../imports/amazon-fba-ledger-summary/strictLedgerDocument";
import { parseAmazonFbaLedgerSummaryText } from "../imports/amazon-fba-ledger-summary/parser";
import { loadProductIdsBySkuAndAsin,loadLedgerLocationEvidence,mapLedgerRowsToDbPayload } from "../imports/amazon-fba-ledger-summary/repository";
import { dedupeLedgerRowsForUpsert,ledgerCanonicalKey } from "../imports/amazon-fba-ledger-summary/ledgerCanonicalIdentity";
import type { LedgerDependencies } from "./fbaLedgerSyncCoordinator";

export async function ledgerDependencies():Promise<LedgerDependencies> {
  const signal=AbortSignal.timeout(LEDGER_STEP_MS);
  const options=()=>({signal,retryExpiredAccessToken:false,rateLimitRetry:{maxRetries:0}});
  return {
    now:Date.now,find:findLedgerJob,acquire:acquireLedgerJob,save:saveLedgerJob,
    async create(job) {
      const config=loadSpApiConfig();
      if(config.region!=="EU" || config.endpoint!=="https://sellingpartnerapi-eu.amazon.com") throw new LedgerEvidenceError("LEDGER_UNSUPPORTED_CONFIG");
      const result=await createReport({reportType:LEDGER_REPORT_TYPE,marketplaceIds:job.state.marketplaceIds,
        ...fbaLedgerUtcDayBounds(job.state.date),reportOptions:{aggregateByLocation:"COUNTRY",aggregatedByTimePeriod:"DAILY"}},options());
      if(!/^[A-Za-z0-9._:-]{1,500}$/.test(result.reportId??"")) throw new LedgerEvidenceError("LEDGER_INVALID_REPORT_ID");
      return result.reportId;
    },
    async poll(job) {
      const s=job.state,r=await getReport(s.reportId!,options()),bounds=fbaLedgerUtcDayBounds(s.date);
      if(r.reportId!==s.reportId || r.reportType!==LEDGER_REPORT_TYPE ||
        JSON.stringify([...(r.marketplaceIds??[])].sort())!==JSON.stringify(s.marketplaceIds) ||
        Date.parse(r.dataStartTime??"")!==Date.parse(bounds.dataStartTime) || Date.parse(r.dataEndTime??"")!==Date.parse(bounds.dataEndTime))
        throw new LedgerEvidenceError("LEDGER_REPORT_SCOPE_MISMATCH");
      if(r.processingStatus==="DONE" && (!/^[A-Za-z0-9._:-]{1,500}$/.test(r.reportDocumentId??"") ||
        !r.createdTime || !Number.isFinite(Date.parse(r.createdTime)))) throw new LedgerEvidenceError("LEDGER_INVALID_REPORT_METADATA");
      return {status:r.processingStatus,documentId:r.reportDocumentId,createdAt:r.createdTime};
    },
    async reconcile(job) {
      const persisted=await observeLedgerJob(job.id);
      const receipt=persisted?.state.receipt;
      if(!receipt) return null;
      if(receipt.documentId!==job.state.documentId || receipt.digest!==job.state.manifest?.digest || persisted.state.status!=="COMPLETED")
        throw new LedgerEvidenceError("LEDGER_PUBLICATION_MISMATCH");
      job.state.manifest=persisted.state.manifest;
      return receipt;
    },
    async publish(job,checkpoint) {
      const s=job.state;
      const document=await getReportDocument(s.documentId!,options());
      if(document.reportDocumentId!==s.documentId) throw new LedgerEvidenceError("LEDGER_DOCUMENT_ID_MISMATCH");
      const text=await downloadLedgerDocument(document,signal);
      const parsed=await parseAmazonFbaLedgerSummaryText(text);
      if(parsed.warnings.length || parsed.skippedRows || parsed.skippedNonTwinlyRows || parsed.validRows.some(r=>r.snapshotDate!==s.date))
        throw new LedgerEvidenceError("LEDGER_INVALID_DOCUMENT_COVERAGE");
      const matches=await loadProductIdsBySkuAndAsin({skus:parsed.validRows.flatMap(r=>[r.skuLimpio,...r.mskuAliases]),
        asins:parsed.validRows.map(r=>r.asin),fnskus:parsed.validRows.map(r=>r.fnsku),signal});
      const mapped=mapLedgerRowsToDbPayload({rows:parsed.validRows,productoBySku:matches.bySku,productoByAsin:matches.byAsin,
        productoByFnsku:matches.byFnsku,productoByExistingAlias:matches.byExistingAlias,skuByProductId:matches.skuByProductId,
        ambiguousAsins:matches.ambiguousAsins,ambiguousFnskus:matches.ambiguousFnskus,ambiguousAliases:matches.ambiguousAliases,
        conditionByIdentity:new Map(),source:LEDGER_OWNER,sourceFileName:null,reportDocumentId:s.documentId,manualDocumentHash:null,
        documentIdentityType:"REPORT_DOCUMENT_ID",documentIdentity:`report:${s.documentId}`,locationEvidence:await loadLedgerLocationEvidence(signal)});
      if(mapped.conflictRows) throw new LedgerEvidenceError("LEDGER_IDENTITY_CONFLICT");
      const rows=dedupeLedgerRowsForUpsert(mapped.dbRows).map(r=>({...r,duplicate_provenance:[],updated_at:s.reportCreatedAt!})).sort((a,b)=>ledgerCanonicalKey(a).localeCompare(ledgerCanonicalKey(b)));
      const payload=JSON.stringify(rows),digest=ledgerDigest(payload);
      const unlinkedRows=rows.filter(r=>!r.producto_id).length,unclassifiedLocations=rows.filter(r=>!r.physical_country).length;
      const unknownConditionRows=rows.filter(r=>r.condition_type==="UNKNOWN").length;
      const manifest:LedgerManifest={version:1 as const,reportType:LEDGER_REPORT_TYPE,fromDate:s.date,toDate:s.date,marketplaceIds:s.marketplaceIds,
        aggregateByLocation:"COUNTRY" as const,aggregatedByTimePeriod:"DAILY" as const,reportId:s.reportId!,documentId:s.documentId!,digest,
        documentDigest:ledgerDigest(text),parsedRows:parsed.totalRows,canonicalRows:rows.length,linkedRows:rows.length-unlinkedRows,unlinkedRows,
        unclassifiedLocations,unknownConditionRows,duplicateRows:parsed.totalRows-rows.length,
        warnings:[...(unlinkedRows?["UNLINKED_PRODUCTS"]:[]),...(unclassifiedLocations?["UNKNOWN_LOCATION"]:[]),...(unknownConditionRows?["UNKNOWN_CONDITION"]:[])],
        errors:[],coverageValid:unlinkedRows===0 && unclassifiedLocations===0,publishedAt:null};
      if(s.manifest && (s.manifest.digest!==digest || s.manifest.documentDigest!==manifest.documentDigest)) throw new LedgerEvidenceError("LEDGER_PUBLICATION_MISMATCH");
      s.manifest=manifest;await checkpoint();signal.throwIfAborted();
      const {data,error}=await supabaseAdmin.rpc("commit_fba_ledger_publication",{p_job_id:job.id,p_revision:s.revision,
        p_lease_token:s.lease!.token,p_rows_text:payload,p_manifest:manifest}).abortSignal(signal);
      if(error) throw new Error(error.code==="P0001"?"LEDGER_INVALID_PUBLICATION":"LEDGER_COMMIT_UNCONFIRMED");
      return data;
    },
    errorInfo(error) {
      const info=safeSpApiErrorMetadata(error),message=error instanceof Error?error.message:"";
      const permanent=error instanceof LedgerEvidenceError || /^LEDGER_(INVALID_|IDENTITY_|DOCUMENT_CONFLICT|PUBLICATION_MISMATCH|REPORT_SCOPE_)/.test(message);
      return {rateLimited:info.httpStatus===429,temporary:!permanent && (info.httpStatus==null || info.httpStatus>=500 || info.httpStatus===408 || info.httpStatus===429),
        retryAfter:info.retryAfter,code:permanent?message.split(":")[0]:info.httpStatus?`LEDGER_UPSTREAM_HTTP_${info.httpStatus}`:"LEDGER_TEMPORARY_FAILURE"};
    },
  };
}
