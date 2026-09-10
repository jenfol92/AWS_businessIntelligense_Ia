import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { syncAmazonFbmInventoryFromReports as sync } from "./amazonFbmReportsSyncService.ts";
import { buildFbmProductIdentities } from "./fbmProductIdentityRepository.ts";
import { parseFbmListingsReport, normalizeFbmReportSnapshot, FBM_REPORT_TYPE, FBM_REPORT_MARKETPLACE, FBM_REPORT_LIMITS } from "./fbmReportsSnapshot.ts";
import { commitCompleteFbmReportSnapshot } from "./fbmReportsCommit.ts";
import { handleFbmReportsSync } from "./fbmReportsEntrypoint.ts";
import { downloadBoundedReportDocument } from "./boundedReportDocument.ts";

let realFetchCalls = 0;
globalThis.fetch = async () => { realFetchCalls++; throw new Error("REAL_AMAZON_AND_SUPABASE_FETCH_FORBIDDEN"); };
test.after(() => assert.equal(realFetchCalls, 0));
const products = [
  { id: "00000000-0000-0000-0000-000000000001", sku: "8436616610104", asin: "B0DJBQGKBT", estado: "activo" },
  { id: "00000000-0000-0000-0000-000000000002", sku: "8436616610531", asin: "B0GS1VMRRN", estado: "activo" },
  { id: "00000000-0000-0000-0000-000000000003", sku: "8436616610128", asin: "B0DNZD6BHS", estado: "activo" },
];
const identities = buildFbmProductIdentities(products);
const HEAD = "seller-sku\tasin1\tquantity\tfulfillment-channel\tstatus";
const rows = ["8436616610104\tB0DJBQGKBT\t696\tDEFAULT\tActive", "8436616610531\tB0GS1VMRRN\t0\tDEFAULT\tInactive", "8436616610128\tB0DNZD6BHS\t0\tDEFAULT\tInactive"];
const config = { region: "EU", endpoint: "https://sellingpartnerapi-eu.amazon.com", useAwsSigV4: false, marketplaceIds: [FBM_REPORT_MARKETPLACE], lwaClientId: "PRIVATE_CLIENT", lwaClientSecret: "PRIVATE_SECRET", lwaRefreshToken: "PRIVATE_REFRESH", sellerId: "PRIVATE_SELLER" };
const at = "2026-09-07T10:00:00.000Z";
function fixture(options = {}) {
  const calls = [], commits = [], waits = [], downloads = [];
  let polls = 0, loads = 0;
  const deps = {
    now: () => Date.parse(at) + 1000,
    loadConfig: () => config,
    loadIdentities: async () => { loads++; return options.identities ?? identities; },
    sleep: async ms => { waits.push(ms); },
    request: async input => {
      calls.push(input);
      input.onResponseMetadata({ operation: input.operation, status: options.failAt === input.operation ? 403 : input.operation === "createReport" ? 202 : 200, requestId: "request-123" });
      if (options.failAt === input.operation) throw new Error("PRIVATE_SECRET https://signed.example/PRIVATE_REFRESH");
      switch (input.operation) {
        case "createReport": return { reportId: "123456" };
        case "getReport": {
          const statuses = options.statuses ?? ["IN_QUEUE", "DONE"];
          return { reportId: "123456", reportType: FBM_REPORT_TYPE, marketplaceIds: [FBM_REPORT_MARKETPLACE], processingStatus: statuses[Math.min(polls++, statuses.length - 1)], reportDocumentId: "DOC-1", createdTime: at, ...options.reportOverrides };
        }
        case "getReportDocument": return { reportDocumentId: "DOC-1", url: "https://example.s3.amazonaws.com/data?signature=PRIVATE_URL", compressionAlgorithm: "GZIP" };
        default: throw new Error("UNEXPECTED_OPERATION");
      }
    },
    fetchDocument: async (url, init) => {
      downloads.push({ url, init });
      if (options.failAt === "download") throw new Error("PRIVATE_URL");
      return new Response(gzipSync(options.text ?? [HEAD, ...rows].join("\n")), { headers: { "content-type": "text/plain; charset=UTF-8" } });
    },
    commit: async args => { commits.push(args); return options.commitResponse ?? { data: args.p_rows.length, error: null }; },
  };
  return { deps, calls, commits, waits, downloads, loads: () => loads };
}
test("production reports flow commits complete 696/0/0 snapshot exactly once with ES identity and pool", async () => {
  const f = fixture(); const result = await sync(f.deps);
  assert.equal(result.status, "SUCCESS"); assert.equal(result.commitOutcome, "CONFIRMED");
  assert.equal(result.operationalPool, "OWN_ES"); assert.equal(result.fulfillment, "FBM");
  assert.equal(result.expectedIdentityCount, products.length); assert.equal(result.matchedIdentityCount, products.length);
  assert.equal(result.zeroCount, 2); assert.equal(result.positiveCount, 1); assert.equal(result.unknownCount, 0);
  assert.equal(f.commits.length, 1); assert.equal(f.loads(), 2);
  assert.deepEqual(f.commits[0].p_rows.map(r => r.available_quantity), [696, 0, 0]);
  assert.deepEqual(f.commits[0].p_rows.map(r => r.producto_id), products.map(p => p.id));
  assert.deepEqual(f.commits[0].p_rows.map(r => r.seller_sku), products.map(p => p.sku));
  assert.equal(f.commits[0].p_observed_at, at);
  assert.equal(f.commits[0].p_marketplace_id, FBM_REPORT_MARKETPLACE);
  assert.equal(f.commits[0].p_expected_identity_count, f.commits[0].p_rows.length);
  assert.equal(f.commits[0].p_completed_identity_count, f.commits[0].p_rows.length);
  assert.equal(f.commits[0].p_capture_complete, true);
  assert.deepEqual(f.calls[0].body, { reportType: FBM_REPORT_TYPE, marketplaceIds: [FBM_REPORT_MARKETPLACE] });
  for (const call of f.calls) {
    assert.equal(call.method, call.operation === "createReport" ? "POST" : "GET");
    assert.deepEqual(call.rateLimitRetry, { maxRetries: 0 }); assert.equal(call.retryExpiredAccessToken, false);
    assert.ok(call.signal); assert.equal(call.query, undefined);
  }
  assert.ok(f.waits.every(ms => ms === 15000));
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].init.headers, undefined); assert.equal(f.downloads[0].init.redirect, "error");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|https:|sellerId|quantity":|p_rows/);
});
test("DEFAULT + FBA for same SKU takes only single DEFAULT; unrelated rows are not imported", async () => {
  const f = fixture({ text: [HEAD, ...rows, rows[0].replace("DEFAULT", "AMAZON_EU"), "UNEXPECTED\tB0DJBQGKBT\t999\tDEFAULT\tActive"].join("\n") });
  assert.equal((await sync(f.deps)).status, "SUCCESS"); assert.equal(f.commits[0].p_rows.length, 3);
  assert.equal(f.commits[0].p_rows[0].available_quantity, 696);
});
test("Inactive status alone never implies zero; quantity is the only stock evidence", async () => {
  const f = fixture({ text: [HEAD, rows[0].replace("Active", "Inactive"), rows[1].replace("Inactive", "Active"), rows[2]].join("\n") });
  assert.equal((await sync(f.deps)).status, "SUCCESS");
  assert.deepEqual(f.commits[0].p_rows.map(r => r.available_quantity), [696, 0, 0]);
});
for (const channel of ["AMAZON_EU", "FBA", "AFN", "", " DEFAULT"]) test(`expected SKU with only ${channel || "empty"} channel aborts coverage, no artificial zero`, async () => {
  const f = fixture({ text: [HEAD, rows[0].replace("DEFAULT", channel), ...rows.slice(1)].join("\n") });
  const r = await sync(f.deps); assert.equal(r.status, "REPORT_COVERAGE_ERROR"); assert.equal(r.missingCount, 1); assert.equal(f.commits.length, 0);
});
test("missing SKU and exact-match whitespace mismatch are coverage failures", async () => {
  for (const text of [[HEAD, ...rows.slice(1)].join("\n"), [HEAD, rows[0].replace("8436616610104", "8436616610104 "), ...rows.slice(1)].join("\n")]) {
    const f = fixture({ text }); assert.equal((await sync(f.deps)).status, "REPORT_COVERAGE_ERROR"); assert.equal(f.commits.length, 0);
  }
});
for (const quantity of ["", "-1", "1.5", "NaN", "abc", " 0", "+0", "00", "9007199254740992", "2147483648"]) test(`quantity ${JSON.stringify(quantity)} is UNKNOWN/error and never partially committed`, async () => {
  const f = fixture({ text: [HEAD, rows[0].replace("696", quantity), ...rows.slice(1)].join("\n") });
  const r = await sync(f.deps); assert.equal(r.status, "REPORT_QUANTITY_ERROR"); assert.equal(r.quantityErrorCount, 1); assert.equal(r.unknownCount, 1); assert.equal(f.commits.length, 0);
});
test("ambiguous DEFAULT duplicates abort even if identical, never sum", async () => {
  const f = fixture({ text: [HEAD, ...rows, rows[0]].join("\n") });
  const r = await sync(f.deps); assert.equal(r.status, "REPORT_DUPLICATE_ERROR"); assert.equal(r.duplicateCount, 1); assert.equal(f.commits.length, 0);
});
for (const status of ["CANCELLED", "FATAL", "IN_PROGRESS"]) test(`${status} produces zero writes and zero downloads`, async () => {
  const f = fixture({ statuses: [status] }); const r = await sync(f.deps);
  assert.equal(r.status, status === "IN_PROGRESS" ? "REPORT_PENDING_TIMEOUT" : `REPORT_${status}`);
  assert.equal(f.commits.length, 0); assert.equal(f.downloads.length, 0);
  assert.equal(r.calls.getReport, status === "IN_PROGRESS" ? FBM_REPORT_LIMITS.maxPolls : 1);
  assert.equal(r.calls.createReport, 1);
});
for (const [failAt, status] of [["createReport", "REPORT_CREATE_ERROR"], ["getReport", "REPORT_STATUS_ERROR"], ["getReportDocument", "REPORT_DOCUMENT_ERROR"], ["download", "REPORT_DOWNLOAD_ERROR"]]) test(`${failAt} failure stops without any commit and leaks no secrets`, async () => {
  const f = fixture({ failAt }); const r = await sync(f.deps);
  assert.equal(r.status, status); assert.equal(f.commits.length, 0); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|https:/);
});
for (const text of ["", "seller-sku\tquantity\nSKU\t0", "seller-sku\tquantity\tfulfillment-channel\tquantity\na\t0\tDEFAULT\t0", `${HEAD}\nwrong\twidth`, `${HEAD}\n"unclosed`]) test(`parser fail closed: ${JSON.stringify(text).slice(0, 35)}`, async () => {
  const f = fixture({ text }); assert.equal((await sync(f.deps)).status, "REPORT_PARSE_ERROR"); assert.equal(f.commits.length, 0);
});
test("TSV BOM, quoted tabs/newlines and raw strings are retained, ASIN not identity", async () => {
  const text = "\uFEFF" + [HEAD + "\titem-name", ...rows.map((r, i) => r.replace(products[i].asin, "B0OTHER001") + '\t"text\tinside\nline"')].join("\n");
  const f = fixture({ text }); assert.equal((await sync(f.deps)).status, "SUCCESS");
  assert.equal(f.commits[0].p_rows[0].asin, "B0OTHER001");
  const noAsin = fixture({ text: "seller-sku\tquantity\tfulfillment-channel\n" + products.map((p, i) => `${p.sku}\t${i ? 0 : 696}\tDEFAULT`).join("\n") });
  assert.equal((await sync(noAsin.deps)).status, "SUCCESS"); assert.ok(noAsin.commits[0].p_rows.every(r => r.asin === null));
});
test("commit RPC error or uncertain response is never SUCCESS, no retry", async () => {
  for (const commitResponse of [{ data: null, error: { message: "PRIVATE_SECRET" } }, { data: 1, error: null }]) {
    const f = fixture({ commitResponse }); const r = await sync(f.deps);
    assert.equal(r.status, "COMMIT_ERROR"); assert.equal(r.commitOutcome, "UNKNOWN"); assert.equal(r.rowsCommitted, 0); assert.equal(f.commits.length, 1);
  }
});
test("commit boundary independently blocks partial snapshots", async () => {
  let writes = 0;
  await assert.rejects(commitCompleteFbmReportSnapshot("id", at, 3, [], AbortSignal.timeout(1000), async () => { writes++; return { data: 0, error: null }; }));
  assert.equal(writes, 0);
});
test("dynamic activation excludes missing/invalid ASIN and state; future product enters without fixed count", async () => {
  const inactive = [{ id: "no-asin", sku: "NOASIN", asin: null, estado: "activo" }, { id: "bad-asin", sku: "BAD", asin: "broken", estado: "activo" }, { id: "not-active", sku: "DRAFT", asin: "B0DJBQGKBT", estado: "borrador" }, { id: "no-state", sku: "UNKNOWN", asin: "B0DJBQGKBT" }];
  assert.equal(buildFbmProductIdentities([...products, ...inactive]).length, products.length);
  const future = { id: "00000000-0000-0000-0000-000000000004", sku: "FUTURE", asin: "B0DJBQGKBT", estado: "activo" };
  const f = fixture({ identities: buildFbmProductIdentities([...products, future]), text: [HEAD, ...rows, "FUTURE\tB0DJBQGKBT\t7\tDEFAULT\tActive"].join("\n") });
  assert.equal((await sync(f.deps)).status, "SUCCESS"); assert.equal(f.commits[0].p_rows.length, products.length + 1);
});
test("universe changes during report generation block commit", async () => {
  const f = fixture(); let loads = 0;
  f.deps.loadIdentities = async () => ++loads === 1 ? identities : identities.slice(1);
  assert.equal((await sync(f.deps)).status, "REPORT_COVERAGE_ERROR"); assert.equal(f.commits.length, 0);
});
test("empty or duplicate identity universe makes zero Amazon calls and writes", async () => {
  for (const input of [[], [identities[0], identities[0]]]) {
    const f = fixture({ identities: input }); assert.equal((await sync(f.deps)).status, "IDENTITY_ERROR"); assert.equal(f.calls.length, 0); assert.equal(f.commits.length, 0);
  }
});
test("wrong report scope and missing document cannot publish", async () => {
  for (const reportOverrides of [{ marketplaceIds: ["FR"] }, { reportType: "OTHER" }, { reportId: "other" }, { reportDocumentId: undefined }]) {
    const f = fixture({ reportOverrides }); assert.notEqual((await sync(f.deps)).status, "SUCCESS"); assert.equal(f.commits.length, 0); assert.equal(f.downloads.length, 0);
  }
});
test("runtime limit prevents further requests", async () => {
  const f = fixture(); let time = Date.parse(at);
  f.deps.now = () => time; f.deps.sleep = async () => { time += FBM_REPORT_LIMITS.runtimeMs; };
  assert.equal((await sync(f.deps)).status, "REPORT_PENDING_TIMEOUT"); assert.equal(f.calls.length, 1); assert.equal(f.commits.length, 0);
});
test("bounded downloader rejects redirects/URL, oversize GZIP and unsupported compression", async () => {
  const doc = { url: "https://example.s3.amazonaws.com/data", reportDocumentId: "doc" };
  const options = { signal: AbortSignal.timeout(1000), maxBytes: 100, fetchDocument: async () => new Response(gzipSync(Buffer.alloc(101))) };
  await assert.rejects(downloadBoundedReportDocument({ ...doc, compressionAlgorithm: "GZIP" }, options));
  await assert.rejects(downloadBoundedReportDocument({ ...doc, compressionAlgorithm: "ZIP" }, options));
  await assert.rejects(downloadBoundedReportDocument({ ...doc, url: "http://localhost" }, options));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadBoundedReportDocument(doc, { ...options, signal: controller.signal }));
});
test("protected POST checks secret, opt-in, method and concurrent invocation before executing", async () => {
  const previous = { secret: process.env.CRON_SECRET, enabled: process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED };
  let calls = 0;
  const run = async () => { calls++; return { status: "SUCCESS" }; };
  const request = (token = "test-secret", method = "POST") => new Request("http://localhost/api/cron/amazon/fbm-inventory-snapshot", { method, headers: { authorization: `Bearer ${token}` } });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await handleFbmReportsSync(request(), run)).status, 503);
    process.env.CRON_SECRET = "test-secret";
    assert.equal((await handleFbmReportsSync(request("wrong"), run)).status, 401);
    assert.equal((await handleFbmReportsSync(request("test-secret", "GET"), run)).status, 405);
    process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED = "false";
    assert.equal((await handleFbmReportsSync(request(), run)).status, 503); assert.equal(calls, 0);
    process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED = "true";
    let release; const promise = handleFbmReportsSync(request(), () => new Promise(resolve => { release = resolve; }));
    assert.equal((await handleFbmReportsSync(request(), run)).status, 409);
    release({ status: "SUCCESS" }); assert.equal((await promise).status, 200);
    assert.equal((await handleFbmReportsSync(request(), run)).status, 200); assert.equal(calls, 1);
  } finally {
    for (const [key, value] of [["CRON_SECRET", previous.secret], ["AMAZON_FBM_REPORTS_SYNC_ENABLED", previous.enabled]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
test("production graph never imports temporary controls, FBA identity or fixed universe counts", async () => {
  for (const file of ["amazonFbmReportsSyncService.ts", "fbmReportsSnapshot.ts", "fbmReportsCommit.ts", "fbmProductIdentityRepository.ts"]) {
    const source = await readFile(`modules/amazon-sp-api/${file}`, "utf8");
    assert.doesNotMatch(source, /amazon_fba_inventory|msku_aliases|fbaLedger|fbmReportsReadOnlyDiagnostic|CONTROL_SKUS|\b(?:68|69|76)\b/);
  }
});
