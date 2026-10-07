/**
 * modules/policies-compliance/tests/policyAlertGrouping.test.mjs
 *
 * Unit tests for the groupPolicyAlerts() utility.
 * Verifies aggregation, marketplace dedup, and status resolution.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { groupPolicyAlerts, resolvePolicyAlertStatus } = await import("../utils/policyAlertGrouping.ts");

function makeAlert(overrides = {}) {
  return {
    id: "uuid-1",
    asin: "B0ABC12345",
    sku: "SKU-001",
    marketplace_id: "A1RKKUPIHCS9HS",
    country_code: "ES",
    category: "Seguridad de productos y alimentos",
    type: "PRODUCT_SAFETY_ISSUE",
    description: "Problema de seguridad",
    still_in_amazon: true,
    last_checked_at: null,
    created_at: "2026-09-01T10:00:00Z",
    resolved_at: null,
    product_title: "Producto Test",
    product_image_url: null,
    product_brand: null,
    source_event: null,
    ...overrides,
  };
}

test("groupPolicyAlerts: groups two marketplaces of same ASIN/category/type", () => {
  const alerts = [
    makeAlert({ id: "uuid-1", marketplace_id: "A1RKKUPIHCS9HS", country_code: "ES" }),
    makeAlert({ id: "uuid-2", marketplace_id: "A13V1IB3VIYZZH", country_code: "FR" }),
  ];

  const groups = groupPolicyAlerts(alerts);
  assert.equal(groups.length, 1);

  const group = groups[0];
  assert.equal(group.asin, "B0ABC12345");
  assert.equal(group.countries.length, 2);
  assert.ok(group.countries.includes("ES"));
  assert.ok(group.countries.includes("FR"));
  assert.equal(group.marketplace_statuses.length, 2);
});

test("groupPolicyAlerts: different types produce separate groups", () => {
  const alerts = [
    makeAlert({ id: "uuid-1", type: "PRODUCT_SAFETY_ISSUE" }),
    makeAlert({ id: "uuid-2", type: "COMPLIANCE_ISSUE" }),
  ];

  const groups = groupPolicyAlerts(alerts);
  assert.equal(groups.length, 2);
});

test("groupPolicyAlerts: different ASINs produce separate groups", () => {
  const alerts = [
    makeAlert({ id: "uuid-1", asin: "B0AAA11111" }),
    makeAlert({ id: "uuid-2", asin: "B0BBB22222" }),
  ];

  const groups = groupPolicyAlerts(alerts);
  assert.equal(groups.length, 2);
});

test("groupPolicyAlerts: marketplace_statuses carry correct status", () => {
  const alerts = [
    makeAlert({ id: "uuid-1", still_in_amazon: true, last_checked_at: "2026-09-22T06:00:00Z" }),
    makeAlert({
      id: "uuid-2",
      marketplace_id: "A13V1IB3VIYZZH",
      country_code: "FR",
      still_in_amazon: false,
      resolved_at: "2026-09-21T12:00:00Z",
    }),
  ];

  const groups = groupPolicyAlerts(alerts);
  assert.equal(groups.length, 1);

  const statuses = groups[0].marketplace_statuses;
  const es = statuses.find((s) => s.country_code === "ES");
  const fr = statuses.find((s) => s.country_code === "FR");

  assert.equal(es?.status, "active");
  assert.equal(fr?.status, "resolved");
});

test("groupPolicyAlerts: empty array returns empty array", () => {
  assert.deepEqual(groupPolicyAlerts([]), []);
});

test("groupPolicyAlerts: created_at is the earliest among the group", () => {
  const alerts = [
    makeAlert({ id: "uuid-1", created_at: "2026-09-10T00:00:00Z" }),
    makeAlert({
      id: "uuid-2",
      marketplace_id: "APJ6JRA9NG5V4",
      country_code: "IT",
      created_at: "2026-09-01T00:00:00Z",
    }),
  ];

  const groups = groupPolicyAlerts(alerts);
  assert.equal(groups[0].created_at, "2026-09-01T00:00:00Z");
});

// ─── resolvePolicyAlertStatus ─────────────────────────────────────────────────

test("resolvePolicyAlertStatus: active when still_in_amazon=true and last_checked_at set", () => {
  const status = resolvePolicyAlertStatus({
    still_in_amazon: true,
    last_checked_at: "2026-09-22T06:00:00Z",
    resolved_at: null,
  });
  assert.equal(status, "active");
});

test("resolvePolicyAlertStatus: pending_review when never checked", () => {
  const status = resolvePolicyAlertStatus({
    still_in_amazon: true,
    last_checked_at: null,
    resolved_at: null,
  });
  assert.equal(status, "pending_review");
});

test("resolvePolicyAlertStatus: resolved when still_in_amazon=false", () => {
  const status = resolvePolicyAlertStatus({
    still_in_amazon: false,
    last_checked_at: "2026-09-22T06:00:00Z",
    resolved_at: "2026-09-22T06:00:00Z",
  });
  assert.equal(status, "resolved");
});
