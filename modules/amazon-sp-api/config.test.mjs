import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const configPath = path.join(process.cwd(), "modules/amazon-sp-api/config.ts");
const source = fs.readFileSync(configPath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: configPath,
}).outputText;
const configModule = { exports: {} };
new Function("module", "exports", "process", output)(
  configModule,
  configModule.exports,
  process,
);

const { getMissingSpApiEnvKeys, loadSpApiConfig } = configModule.exports;
const originalEnv = { ...process.env };

try {
  process.env.AMAZON_LWA_CLIENT_ID = "client-id";
  process.env.AMAZON_LWA_CLIENT_SECRET = "client-secret";
  process.env.AMAZON_LWA_REFRESH_TOKEN = "refresh-token";
  process.env.AMAZON_MARKETPLACE_ES = "A1RKKUPIHCS9HS";

  process.env.AMAZON_SELLER_ID = "  seller-id  ";
  assert.equal(loadSpApiConfig().sellerId, "seller-id");

  delete process.env.AMAZON_SELLER_ID;
  assert.equal(loadSpApiConfig().sellerId, undefined);
  assert.deepEqual(getMissingSpApiEnvKeys(), []);
} finally {
  process.env = originalEnv;
}

console.log("PASS optional AMAZON_SELLER_ID config");
