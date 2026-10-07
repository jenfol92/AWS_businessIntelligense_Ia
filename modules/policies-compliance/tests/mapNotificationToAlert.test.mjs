/**
 * modules/policies-compliance/tests/mapNotificationToAlert.test.mjs
 *
 * Unit tests for the notification→alert mapping utility.
 * Pure functions; no external dependencies required.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Import the compiled TS via Node's experimental strip-types
const { mapNotificationToAlerts } = await import(
  "../utils/mapNotificationToAlert.ts"
);

// ─── LISTINGS_ITEM_ISSUES ─────────────────────────────────────────────────────

test("mapNotificationToAlerts: LISTINGS_ITEM_ISSUES produces one alert per issue", () => {
  const event = {
    notificationType: "LISTINGS_ITEM_ISSUES",
    payload: {
      itemIssues: {
        sku: "SKU-001",
        asin: "B0ABC12345",
        marketplaceId: "A1RKKUPIHCS9HS",
        issues: [
          {
            code: "PRODUCT_SAFETY_ISSUE",
            message: "Problema de seguridad del producto",
            severity: "ERROR",
            categories: ["Seguridad de productos y alimentos"],
          },
          {
            code: "COMPLIANCE_ISSUE",
            message: "Cumplimiento normativo",
            severity: "WARNING",
            categories: ["Cumplimiento normativo"],
          },
        ],
      },
    },
  };

  const alerts = mapNotificationToAlerts(event);
  assert.equal(alerts.length, 2);

  const first = alerts[0];
  assert.equal(first.asin, "B0ABC12345");
  assert.equal(first.sku, "SKU-001");
  assert.equal(first.marketplace_id, "A1RKKUPIHCS9HS");
  assert.equal(first.country_code, "ES");
  assert.equal(first.category, "Seguridad de productos y alimentos");
  assert.equal(first.type, "PRODUCT_SAFETY_ISSUE");
  assert.equal(first.description, "Problema de seguridad del producto");
  assert.equal(first.still_in_amazon, true);
  assert.equal(first.resolved_at, null);
});

// ─── LISTINGS_DEFECT_NOTIFICATIONS ────────────────────────────────────────────

test("mapNotificationToAlerts: LISTINGS_DEFECT_NOTIFICATIONS produces one alert", () => {
  const event = {
    notificationType: "LISTINGS_DEFECT_NOTIFICATIONS",
    payload: {
      listingDefect: {
        sku: "SKU-002",
        asin: "B0XYZ99999",
        marketplaceId: "A13V1IB3VIYZZH",
        defectType: "MISSING_ATTRIBUTE",
        defectDescription: "Falta atributo requerido",
        affectedCategory: "Juguetes infantiles",
      },
    },
  };

  const alerts = mapNotificationToAlerts(event);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].country_code, "FR");
  assert.equal(alerts[0].category, "Juguetes infantiles");
  assert.equal(alerts[0].type, "MISSING_ATTRIBUTE");
  assert.notEqual(alerts[0].source_event, null);
});

// ─── LISTINGS_QUALITY_NOTIFICATIONS ───────────────────────────────────────────

test("mapNotificationToAlerts: LISTINGS_QUALITY_NOTIFICATIONS produces one alert", () => {
  const event = {
    notificationType: "LISTINGS_QUALITY_NOTIFICATIONS",
    payload: {
      listingQuality: {
        sku: "SKU-003",
        asin: "B0DEF33333",
        marketplaceId: "A1PA6795UKMFR9",
        qualityType: "LOW_QUALITY_TITLE",
        qualityDescription: "Título con calidad baja",
        affectedCategory: "Electrónica",
      },
    },
  };

  const alerts = mapNotificationToAlerts(event);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].country_code, "DE");
  assert.equal(alerts[0].type, "LOW_QUALITY_TITLE");
});

// ─── Invalid / empty payloads ──────────────────────────────────────────────────

test("mapNotificationToAlerts: unknown notification type returns empty array", () => {
  const alerts = mapNotificationToAlerts({ notificationType: "ORDER_CHANGE" });
  assert.deepEqual(alerts, []);
});

test("mapNotificationToAlerts: null returns empty array", () => {
  assert.deepEqual(mapNotificationToAlerts(null), []);
});

test("mapNotificationToAlerts: missing required fields returns empty array", () => {
  const event = {
    notificationType: "LISTINGS_ITEM_ISSUES",
    payload: { itemIssues: { issues: [] } },
  };
  assert.deepEqual(mapNotificationToAlerts(event), []);
});

test("mapNotificationToAlerts: LISTINGS_ITEM_ISSUES with empty issues returns empty array", () => {
  const event = {
    notificationType: "LISTINGS_ITEM_ISSUES",
    payload: {
      itemIssues: {
        sku: "SKU-X",
        asin: "B0XXXXXX11",
        marketplaceId: "A1RKKUPIHCS9HS",
        issues: [],
      },
    },
  };
  assert.deepEqual(mapNotificationToAlerts(event), []);
});

// ─── source_event audit field ─────────────────────────────────────────────────

test("mapNotificationToAlerts: source_event carries original event for audit", () => {
  const event = {
    notificationType: "LISTINGS_DEFECT_NOTIFICATIONS",
    payload: {
      listingDefect: {
        sku: "SKU-AUDIT",
        asin: "B0AUDIT1234",
        marketplaceId: "APJ6JRA9NG5V4",
        defectType: "TEST",
        affectedCategory: "Test",
      },
    },
  };

  const alerts = mapNotificationToAlerts(event);
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].source_event, event);
});
