import assert from "node:assert/strict";
import { EMPTY_PRODUCT_FORM } from "../constants";
import { buildProductCreatePayloads } from "./buildProductCreatePayloads";

const parentCore = {
  id: "parent-1",
  proveedor_id: "supplier-parent",
  stock_seguridad_minimo: 12,
  arancel_porcentaje: 4,
  especificaciones: {
    color: "rojo-padre",
    edad_minima_meses: 6,
    certificaciones: ["CE", "EN1888"],
    form_extensions_v1: {
      identifiers: {
        ean: "843-parent",
        referencia_fabricante: "REF-PARENT",
        codigo_proveedor: "SUP-PARENT",
      },
      notas_generales: "nota padre",
      metadata_funcional: { origen: "padre" },
    },
  },
};

const parentDetail = {
  id: "detail-parent",
  producto_id: "parent-1",
  categoria_id: "cat-1",
  categoria: "Carrito",
  marca: "Marca padre",
  descripcion_tecnica: "Descripcion heredable",
  color: "no-heredar-color",
};

const parentLogistics = {
  id: "log-parent",
  producto_id: "parent-1",
  unidades_por_caja: 2,
  pedido_minimo_unidades: 50,
  peso_kg_bruto: 9.5,
  largo_cm: 70,
  ancho_cm: 45,
  alto_cm: 30,
  cubicaje_unitario_m3: 0.0945,
};

const parentTechnicalSheet = {
  id: "tech-parent",
  producto_id: "parent-1",
  modelo: "Modelo padre",
  peso_neto_kg: 7.25,
  alto_abierto_cm: 105,
  ancho_abierto_cm: 55,
  fondo_abierto_cm: 80,
  alto_plegado_cm: 75,
  ancho_plegado_cm: 55,
  fondo_plegado_cm: 30,
  material_estructura: "Aluminio",
  material_tapizado: "Poliester",
  material_ruedas: "PU",
  edad_minima_aplicable: 0,
  edad_maxima_aplicable: 36,
};

const baseVariant = {
  ...EMPTY_PRODUCT_FORM,
  sku: "VAR-1",
  nombre: "Variante 1",
  parentId: "parent-1",
  heredarPrecio: true,
  heredarCosteUnitarioTotal: false,
};

const inherited = buildProductCreatePayloads(baseVariant, {
  core: parentCore,
  detail: parentDetail,
  logistics: parentLogistics,
  technicalSheet: parentTechnicalSheet,
});

assert.equal(
  (
    (inherited.corePayload.especificaciones as Record<string, unknown>)
      .form_extensions_v1 as { identifiers: { referencia_fabricante: string } }
  ).identifiers.referencia_fabricante,
  "REF-PARENT",
  "variante hereda referencia del fabricante",
);
assert.equal(
  inherited.detailPayload.categoria_id,
  "cat-1",
  "variante hereda categoria_id",
);
assert.deepEqual(
  (inherited.corePayload.especificaciones as Record<string, unknown>)
    .certificaciones,
  ["CE", "EN1888"],
  "variante hereda todas las especificaciones del padre",
);
assert.equal(
  inherited.technicalSheetPayload.material_estructura,
  "Aluminio",
  "variante hereda materiales",
);
assert.equal(
  inherited.technicalSheetPayload.peso_neto_kg,
  7.25,
  "variante hereda peso neto",
);
assert.equal(
  inherited.logisticsPayload.peso_kg_bruto,
  9.5,
  "variante hereda peso bruto",
);
assert.equal(
  inherited.logisticsPayload.largo_cm,
  70,
  "variante hereda medidas logisticas",
);
assert.equal(
  "id" in inherited.detailPayload,
  false,
  "no copia IDs primarios de registros relacionados",
);

const withOwnEdits = buildProductCreatePayloads(
  {
    ...baseVariant,
    ean: "843-variant",
    eanUpc: "843-variant-logistics",
    asin: "ASIN-VARIANT",
    amazonListingAsin: "ASIN-LISTING-VARIANT",
    amazonListingSku: "LISTING-SKU-VARIANT",
    color: "Azul",
    categoryDynamicFields: { color: "azul-dinamico" },
    categoryActiveFieldKeys: ["color"],
    imagenUrl: "https://example.test/variant.jpg",
    referenciaFabricante: "REF-VARIANT",
    categoriaId: "cat-own",
    categoria: "Categoria propia",
    materialEstructura: "Acero propio",
    pesoNetoKg: 8,
    pesoBrutoKg: 10,
    largoCajaCm: 72,
  },
  {
    core: parentCore,
    detail: parentDetail,
    logistics: parentLogistics,
    technicalSheet: parentTechnicalSheet,
  },
);

assert.equal(
  (
    (withOwnEdits.corePayload.especificaciones as Record<string, unknown>)
      .form_extensions_v1 as { identifiers: { referencia_fabricante: string } }
  ).identifiers.referencia_fabricante,
  "REF-PARENT",
  "referencia fabricante nace siempre heredada del padre",
);
assert.equal(
  withOwnEdits.detailPayload.categoria_id,
  "cat-1",
  "categoria de variante nace siempre heredada del padre",
);
assert.equal(
  withOwnEdits.technicalSheetPayload.material_estructura,
  "Aluminio",
  "material de variante nace siempre heredado del padre",
);
assert.equal(
  withOwnEdits.technicalSheetPayload.peso_neto_kg,
  7.25,
  "peso de variante nace siempre heredado del padre",
);
assert.equal(
  withOwnEdits.logisticsPayload.largo_cm,
  70,
  "medida logistica de variante nace siempre heredada del padre",
);
assert.equal(
  withOwnEdits.detailPayload.color,
  "Azul",
  "color de variante no se hereda del padre",
);
assert.equal(
  (withOwnEdits.corePayload.especificaciones as Record<string, unknown>).color,
  "azul-dinamico",
  "campo dinamico color de variante no se hereda del padre",
);
assert.equal(
  withOwnEdits.detailPayload.imagen_url,
  "https://example.test/variant.jpg",
  "imagen de variante no se hereda del padre",
);
assert.equal(
  withOwnEdits.logisticsPayload.ean_upc,
  "843-variant",
  "EAN de variante no se hereda del padre",
);
assert.equal(
  "cubicaje_unitario_m3" in withOwnEdits.logisticsPayload,
  false,
  "no escribe cubicaje generado por Supabase",
);

const specs = inherited.corePayload.especificaciones as Record<string, unknown>;
(specs.form_extensions_v1 as { identifiers: { referencia_fabricante: string } })
  .identifiers.referencia_fabricante = "REF-VARIANT-EDITED";
assert.equal(
  (
    parentCore.especificaciones.form_extensions_v1 as {
      identifiers: { referencia_fabricante: string };
    }
  ).identifiers.referencia_fabricante,
  "REF-PARENT",
  "modificar la variante despues no modifica el padre",
);

parentCore.especificaciones.form_extensions_v1.identifiers.referencia_fabricante =
  "REF-PARENT-EDITED-LATER";
assert.equal(
  (
    (withOwnEdits.corePayload.especificaciones as Record<string, unknown>)
      .form_extensions_v1 as { identifiers: { referencia_fabricante: string } }
  ).identifiers.referencia_fabricante,
  "REF-PARENT",
  "modificar el padre despues no sobrescribe una variante ya creada",
);
