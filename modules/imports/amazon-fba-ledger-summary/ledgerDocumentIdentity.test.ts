import assert from "node:assert/strict";
import { resolveLedgerDocumentIdentity } from "./ledgerCanonicalIdentity.ts";

const manualA = resolveLedgerDocumentIdentity({ text: "same bytes" });
const manualB = resolveLedgerDocumentIdentity({ text: "same bytes" });
assert.equal(manualA.documentIdentityType, "MANUAL_SHA256");
assert.equal(manualA.documentIdentity, manualB.documentIdentity);
assert.equal(manualA.manualDocumentHash?.length, 64);
assert.equal(manualA.reportDocumentId, null);

const api = resolveLedgerDocumentIdentity({
  text: "ignored for API identity",
  reportDocumentId: "amzn-document-1",
});
assert.equal(api.documentIdentityType, "REPORT_DOCUMENT_ID");
assert.equal(api.documentIdentity, "report:amzn-document-1");
assert.equal(api.reportDocumentId, "amzn-document-1");
assert.equal(api.manualDocumentHash, null);
