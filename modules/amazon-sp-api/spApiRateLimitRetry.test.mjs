import test from "node:test";
import assert from "node:assert/strict";
import { resolveRateLimitRetryCount, resolveSpApiRetryDelayMs } from "./spApiRetryPolicy.ts";
import { readFile } from "node:fs/promises";

test("Retry-After is honored but bounded",()=>{
  assert.equal(resolveSpApiRetryDelayMs({headers:{"retry-after":"60"}},0,1000,15000),15000);
});
test("missing Retry-After uses bounded exponential delay",()=>{
  assert.equal(resolveSpApiRetryDelayMs({headers:{}},0,1000,15000),1000);
  assert.equal(resolveSpApiRetryDelayMs({headers:{}},2,1000,15000),4000);
});
test("429 without Retry-After is never retried",()=>assert.equal(resolveRateLimitRetryCount({headers:{}},1),0));
test("429 with Retry-After permits at most one bounded retry",()=>assert.equal(resolveRateLimitRetryCount({headers:{"retry-after":"3"}},5),1));
test("generic 5xx responses are not retried by the shared client",async()=>{
  const source=await readFile(new URL("./spApiClient.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/status\s*>?=\s*500[\s\S]{0,300}(retry|sleep)/i);
});
