import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveOperationalAmazonIdentity } from "./amazonInventoryIdentityResolver.ts";

const identities = [
  { sellerSku: "ZB-2L3J-3AND", productoId: "p-zb", skuLimpio: "8436616610159", asin: "B0DS629RZV" },
  { sellerSku: "AZ-LS26-BGCN", productoId: "p-az", skuLimpio: "8436616610166", asin: "B0DS62575K" },
  { sellerSku: "Amazon.Found.B0DJBQGKBT", productoId: "p-alaia", skuLimpio: "8436616610104", asin: "B0DJBQGKBT" },
  { sellerSku: "second-arbitrary-alias", productoId: "p-alaia", skuLimpio: "8436616610104", asin: "B0DJBQGKBT" },
];

test("un ASIN admite multiples Seller SKU confirmados y cualquier alias arbitrario gana al limpiador", () => {
  assert.equal(resolveOperationalAmazonIdentity("Amazon.Found.B0DJBQGKBT", "B0DJBQGKBT", identities).status, "IDENTITY_RESOLVED_BY_ALIAS");
  assert.equal(resolveOperationalAmazonIdentity("second-arbitrary-alias", "B0DJBQGKBT", identities).productoId, "p-alaia");
});

for (const [sellerSku, asin] of [["ZB-2L3J-3AND", "B0DS629RZV"], ["AZ-LS26-BGCN", "B0DS62575K"], ["Amazon.Found.B0DJBQGKBT", "B0DJBQGKBT"]]) {
  test(`${sellerSku} resuelve exclusivamente por identidad confirmada`, () => {
    assert.equal(resolveOperationalAmazonIdentity(sellerSku, asin, identities).status, "IDENTITY_RESOLVED_BY_ALIAS");
  });
}

test("Seller SKU desconocido con ASIN unico crea candidato revisable", () => {
  const result = resolveOperationalAmazonIdentity("BI-8C7K-ROVA", "B0DJBQGKBT", identities);
  assert.equal(result.status, "IDENTITY_RESOLVED_BY_ASIN");
  assert.equal(result.aliasStatus, "ALIAS_CANDIDATE_BY_ASIN");
  assert.equal(result.resolutionSource, "AMAZON_ASIN_UNIQUE");
});

test("ASIN ambiguo no elige producto", () => {
  const result = resolveOperationalAmazonIdentity("XS-BZOH-TJQQ", "AMBIGUOUS", [
    ...identities,
    { sellerSku: "a", productoId: "p1", skuLimpio: "1", asin: "AMBIGUOUS" },
    { sellerSku: "b", productoId: "p2", skuLimpio: "2", asin: "AMBIGUOUS" },
  ]);
  assert.equal(result.status, "IDENTITY_AMBIGUOUS");
  assert.equal(result.productoId, null);
});

test("alias confirmado con ASIN Amazon distinto falla cerrado", () => {
  assert.equal(resolveOperationalAmazonIdentity("ZB-2L3J-3AND", "B0DJBQGKBT", identities).status, "ASIN_IDENTITY_CONFLICT");
});

test("ASIN desconocido queda UNRESOLVED para que solo entonces opere fallback legacy", () => {
  assert.equal(resolveOperationalAmazonIdentity("8436616610104", "UNKNOWN", identities).status, "UNRESOLVED");
});

test("no existen reglas hardcodeadas para aliases o prefijos concretos", async () => {
  const source = await readFile("modules/amazon-sp-api/amazonInventoryIdentityResolver.ts", "utf8");
  for (const forbidden of ["ZB-2L3J-3AND", "AZ-LS26-BGCN", "Amazon.Found.B0DJBQGKBT", "BI-8C7K-ROVA", "XS-BZOH-TJQQ"]) assert.doesNotMatch(source, new RegExp(forbidden.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /startsWith\(["'](?:ZB-|AZ-|BI-|XS-|Amazon\.Found)/);
});
