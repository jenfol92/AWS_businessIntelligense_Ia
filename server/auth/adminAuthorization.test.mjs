import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageUnlinkedObligations,
  canReadTreasury,
  canReadUnlinkedObligationDetails,
  getAppRole,
  isAdminUser,
} from "./adminAuthorization.ts";

const user = (role, extra = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  app_metadata: role === undefined ? undefined : { role },
  ...extra,
});

test("getAppRole accepts only the normalized canonical roles", () => {
  assert.equal(getAppRole(user("admin")), "admin");
  assert.equal(getAppRole(user("accounting")), "accounting");
  assert.equal(getAppRole(user("logistics")), "logistics");
  assert.equal(getAppRole(user("  AcCoUnTiNg  ")), "accounting");
  assert.equal(getAppRole(null), null);
  assert.equal(getAppRole(undefined), null);
  assert.equal(getAppRole(user(undefined)), null);
  assert.equal(getAppRole({}), null);
  assert.equal(getAppRole(user("")), null);
  assert.equal(getAppRole(user("administrator")), null);
  assert.equal(getAppRole(user("superadmin")), null);
  assert.equal(getAppRole(user("unknown")), null);
});

test("aliases, user_metadata, and email never grant a role", () => {
  const rejected = [
    { app_metadata: { rol: "admin" } },
    { app_metadata: { roles: ["admin"] } },
    { app_metadata: { is_admin: true } },
    { app_metadata: { admin: true } },
    { user_metadata: { role: "admin" } },
    { email: "admin@example.com" },
  ];
  for (const candidate of rejected) {
    assert.equal(getAppRole(candidate), null);
    assert.equal(isAdminUser(candidate), false);
    assert.equal(canReadTreasury(candidate), false);
    assert.equal(canReadUnlinkedObligationDetails(candidate), false);
    assert.equal(canManageUnlinkedObligations(candidate), false);
  }
});

test("capabilities follow the confirmed role matrix", () => {
  for (const role of ["admin", "accounting", "logistics"]) {
    assert.equal(canReadTreasury(user(role)), true);
  }
  assert.equal(isAdminUser(user("admin")), true);
  assert.equal(isAdminUser(user("accounting")), false);
  assert.equal(isAdminUser(user("logistics")), false);

  for (const role of ["admin", "accounting"]) {
    assert.equal(canReadUnlinkedObligationDetails(user(role)), true);
    assert.equal(canManageUnlinkedObligations(user(role)), true);
  }
  assert.equal(canReadUnlinkedObligationDetails(user("logistics")), false);
  assert.equal(canManageUnlinkedObligations(user("logistics")), false);
});

test("missing sessions never grant capabilities", () => {
  for (const missingUser of [null, undefined]) {
    assert.equal(isAdminUser(missingUser), false);
    assert.equal(canReadTreasury(missingUser), false);
    assert.equal(canReadUnlinkedObligationDetails(missingUser), false);
    assert.equal(canManageUnlinkedObligations(missingUser), false);
  }
});
