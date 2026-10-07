import { createHash } from "node:crypto";
import { downloadBoundedReportDocument } from "./boundedReportDocument.ts";
import { LedgerEvidenceError, LEDGER_MAX_BYTES } from "../imports/amazon-fba-ledger-summary/strictLedgerDocument.ts";
import type { SpApiReportDocument } from "./types";

export const ledgerDigest=(text:string)=>createHash("sha256").update(text).digest("hex");
export async function downloadLedgerDocument(document:SpApiReportDocument,signal:AbortSignal,fetchDocument?:typeof fetch) {
  try { return await downloadBoundedReportDocument(document,{signal,maxBytes:LEDGER_MAX_BYTES,fetchDocument}); }
  catch(error) {
    const code=error instanceof Error?error.message:"";
    if (/TOO_LARGE|INVALID_DOCUMENT_URL|UNSUPPORTED_COMPRESSION|INVALID_BYTE_LIMIT/.test(code) ||
        (error as {code?:string})?.code==="ERR_BUFFER_TOO_LARGE" || error instanceof TypeError && /encoded data|encoding/i.test(code))
      throw new LedgerEvidenceError(code.includes("LARGE") || (error as {code?:string})?.code === "ERR_BUFFER_TOO_LARGE" ? "LEDGER_DOCUMENT_TOO_LARGE":"LEDGER_INVALID_DOCUMENT_ENCODING");
    if (/^Z_/.test((error as {code?:string})?.code ?? "")) throw new LedgerEvidenceError("LEDGER_INVALID_COMPRESSION");
    throw error;
  }
}
