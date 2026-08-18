import test from "node:test";
import assert from "node:assert/strict";

import { mapUpstreamFetchError, safeSpApiErrorMetadata } from "./errors.ts";

function fetchFailure(cause) {
  const error = new TypeError("fetch failed");
  error.cause = cause;
  return error;
}

test("ENOTFOUND is safe, stage-aware and maps to 502", () => {
  const safe = safeSpApiErrorMetadata(mapUpstreamFetchError(fetchFailure({
    code: "ENOTFOUND",
    errno: -3008,
    syscall: "getaddrinfo",
    hostname: "sellingpartnerapi-eu.amazon.com",
    authorization: "Bearer secret",
  }), "SP_API", "https://sellingpartnerapi-eu.amazon.com/private?token=secret"));

  assert.equal(safe.httpStatus, 502);
  assert.equal(safe.code, "upstream_fetch_failed");
  assert.equal(safe.failureLayer, "SP_API");
  assert.equal(safe.network?.kind, "DNS");
  assert.equal(safe.network?.code, "ENOTFOUND");
  assert.equal(safe.network?.syscall, "getaddrinfo");
  assert.doesNotMatch(JSON.stringify(safe), /authorization|bearer|private|token|secret/i);
});

test("ECONNRESET and timeout-like failures retain only whitelisted fields", () => {
  const reset = safeSpApiErrorMetadata(mapUpstreamFetchError(fetchFailure({
    code: "ECONNRESET", address: "203.0.113.1", port: 443, client_secret: "secret",
  }), "SP_API", "https://sellingpartnerapi-eu.amazon.com"));
  const timeout = safeSpApiErrorMetadata(mapUpstreamFetchError(fetchFailure({
    code: "UND_ERR_CONNECT_TIMEOUT", refresh_token: "secret",
  }), "LWA", "https://api.amazon.com/auth/o2/token"));

  assert.equal(reset.network?.kind, "ECONNRESET");
  assert.equal(reset.network?.address, "203.0.113.1");
  assert.equal(reset.network?.port, 443);
  assert.equal(timeout.network?.kind, "TIMEOUT");
  assert.equal(timeout.failureLayer, "LWA");
  assert.doesNotMatch(JSON.stringify({ reset, timeout }), /client_secret|refresh_token|secret/i);
});
