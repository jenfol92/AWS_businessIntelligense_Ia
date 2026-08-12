import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  deepMergeParentWithOverrides,
  resolveProductVariantInheritance,
} from "./resolveProductVariantInheritance.ts";

const parent = {
  core: { id: "p", especificaciones: { capacidad: 10, nested: { a: 1, b: 2 }, form_extensions_v1: { identifiers: { referencia_fabricante: "REF-P" } } } },
  detail: { producto_id: "p", categoria_id: "cat-p" },
  logistics: { producto_id: "p", unidades_por_caja: 4, pedido_minimo_unidades: 20, peso_kg_bruto: 9, largo_cm: 70, ancho_cm: 40, alto_cm: 30 },
  technicalSheet: { producto_id: "p", peso_neto_kg: 7, material_estructura: "Aluminio", alto_abierto_cm: 100 },
};

test("new variant dynamically inherits every requested block without own rows", () => {
  const result = resolveProductVariantInheritance({
    productId: "v",
    child: { core: { id: "v", parent_id: "p", especificaciones: {} }, detail: null, logistics: null, technicalSheet: null },
    parent,
  });
  assert.equal(result.detail.categoria_id, "cat-p");
  assert.equal(result.logistics.unidades_por_caja, 4);
  assert.equal(result.logistics.pedido_minimo_unidades, 20);
  assert.equal(result.logistics.peso_kg_bruto, 9);
  assert.equal(result.technicalSheet.peso_neto_kg, 7);
  assert.equal(result.technicalSheet.material_estructura, "Aluminio");
  assert.equal(result.technicalSheet.alto_abierto_cm, 100);
  assert.equal(result.core.especificaciones.form_extensions_v1.identifiers.referencia_fabricante, "REF-P");
});

test("later parent changes flow through without override", () => {
  const changed = structuredClone(parent);
  changed.logistics.unidades_por_caja = 8;
  const result = resolveProductVariantInheritance({ productId: "v", child: { core: { id: "v", especificaciones: {} }, detail: null, logistics: null, technicalSheet: null }, parent: changed });
  assert.equal(result.logistics.unidades_por_caja, 8);
});

test("own override wins and removing it restores current parent", () => {
  const child = { core: { id: "v", especificaciones: {} }, detail: null, logistics: { producto_id: "v", unidades_por_caja: 6 }, technicalSheet: null };
  assert.equal(resolveProductVariantInheritance({ productId: "v", child, parent }).logistics.unidades_por_caja, 6);
  child.logistics.unidades_por_caja = null;
  const changed = structuredClone(parent);
  changed.logistics.unidades_por_caja = 9;
  assert.equal(resolveProductVariantInheritance({ productId: "v", child, parent: changed }).logistics.unidades_por_caja, 9);
});

test("specifications deep merge by key", () => {
  assert.deepEqual(deepMergeParentWithOverrides({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 3 }, b: 4 }), { a: 1, nested: { x: 1, y: 3 }, b: 4 });
});

test("detail and form use the same shared resolver and persistence omits inherited copies", () => {
  const detail = fs.readFileSync(new URL("./applyProductInheritance.ts", import.meta.url), "utf8");
  const form = fs.readFileSync(new URL("./getProductForm.ts", import.meta.url), "utf8");
  const create = fs.readFileSync(new URL("./buildProductCreatePayloads.ts", import.meta.url), "utf8");
  assert.match(detail, /resolveProductVariantInheritance/);
  assert.match(form, /resolveProductVariantInheritance/);
  assert.match(create, /inheritedLogistics\[column\] = null/);
  assert.match(create, /delete identifiers\.referencia_fabricante/);
  assert.doesNotMatch(create, /cubicaje_unitario_m3\s*=/);
});
