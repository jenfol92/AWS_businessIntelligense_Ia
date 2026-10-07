import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./splitOrderItemsByCbm.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { splitOrderItemsByCbm: split, mergeSplitOrderItems: merge } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const line = (key, cantidad, cbm) => ({ _key: key, cantidad, cbm_unitario: cbm, coste: 12, lote: "ABC" });

test("una línea se divide en todas las órdenes necesarias conservando unidades y datos", () => {
  const original = [line("a", 100, 2)];
  const groups = split(original, 65);
  assert.deepEqual(groups.map((group) => group[0].cantidad), [32, 32, 32, 4]);
  assert.deepEqual(merge(groups.flat()), original);
  assert.equal(original[0].cantidad, 100);
  for (const group of groups) assert.ok(group.reduce((sum, item) => sum + item.cantidad * item.cbm_unitario, 0) <= 65);
});

test("combina productos para aprovechar los huecos y maneja límites decimales", () => {
  const original = [line("a", 3, 6), line("b", 4, 2)];
  const groups = split(original, 10);
  assert.deepEqual(groups.map((group) => group.reduce((sum, item) => sum + item.cantidad * item.cbm_unitario, 0)), [10, 10, 6]);
  assert.deepEqual(merge(groups.flat()), original);
  assert.equal(split([line("a", 10, 0.1)], 0.3).length, 4);
  assert.equal(split([line("a", 5, 2)], 10).length, 1);
});

test("rechaza datos que impiden un reparto fiable", () => {
  for (const limit of [0, -1, NaN, Infinity]) assert.throws(() => split([line("a", 1, 2)], limit));
  for (const cbm of [0, -1, NaN, Infinity, 11]) assert.throws(() => split([line("a", 1, cbm)], 10));
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => split([line("a", quantity, 1)], 10));
});

test("múltiples repartos preservan cantidades y límites", () => {
  for (let count = 1; count <= 100; count++) {
    const original = [line("a", count, 0.07), line("b", 101 - count, 0.13)];
    const groups = split(original, 1);
    assert.deepEqual(merge(groups.flat()), original);
    for (const group of groups) {
      assert.ok(group.length > 0);
      assert.ok(group.reduce((sum, item) => sum + item.cantidad * item.cbm_unitario, 0) <= 1 + 1e-12);
    }
  }
});
