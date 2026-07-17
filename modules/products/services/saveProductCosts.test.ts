import assert from "node:assert/strict";
import { EMPTY_PRODUCT_FORM } from "../constants";
import {
  buildFactoryCostOnlyPayload,
  propagateFactoryCostToVariantRows,
  readCostSourceFromRow,
  readCostSourceFromValues,
  type CostSource,
} from "./saveProductCosts";

const parent100Usd = readCostSourceFromRow({
  producto_id: "parent-1",
  proveedor_id: "supplier-parent",
  costo_fabrica_monto: 100,
  costo_fabrica_moneda: "USD",
  costo_fabrica_eur: 91,
  costo_unitario_total_eur: 144,
  transito_eur_unit: 3,
  gastos_llegada_puerto_eur_unit: 2,
  costo_flete_unit_eur: 5,
  arancel_porcentaje: 4,
});

assert.deepEqual(
  parent100Usd,
  {
    monto: 100,
    moneda: "USD",
  },
  "lee solo coste de fabrica y moneda actual del padre",
);

assert(parent100Usd);
const createdVariantPayload = buildFactoryCostOnlyPayload(
  "variant-1",
  parent100Usd,
);
assert.equal(
  createdVariantPayload.costo_fabrica_monto,
  100,
  "caso 1: crear variante copia coste propio 100 USD",
);
assert.equal(createdVariantPayload.costo_fabrica_moneda, "USD");
assert.equal(
  "costo_fabrica_eur" in createdVariantPayload,
  false,
  "no escribe coste fabrica EUR derivado",
);
assert.equal(
  "costo_unitario_total_eur" in createdVariantPayload,
  false,
  "no copia landed cost ni coste total historico",
);
assert.equal(
  "transito_eur_unit" in createdVariantPayload,
  false,
  "no copia coste logistico de lote/contenedor",
);
assert.equal(
  "arancel_porcentaje" in createdVariantPayload,
  false,
  "caso 7: la propagacion de coste no modifica arancel",
);
assert.equal(
  "precio_venta_objetivo" in createdVariantPayload,
  false,
  "caso 7: la propagacion de coste no modifica precios de venta",
);
assert.equal(
  "orden_item_id" in createdVariantPayload || "lote_producto" in createdVariantPayload,
  false,
  "caso 7: la propagacion no toca lotes ni ordenes",
);

const parent110NoPropagation = readCostSourceFromValues({
  ...EMPTY_PRODUCT_FORM,
  costoFabricaMonto: 110,
  costoFabricaMoneda: "USD",
});
const variantStill100 = createdVariantPayload;
assert.equal(parent110NoPropagation?.monto, 110);
assert.equal(
  variantStill100.costo_fabrica_monto,
  100,
  "caso 2: padre 110 USD sin propagacion no cambia variante 100 USD",
);

const parent120: CostSource = {
  monto: 120,
  moneda: "USD",
};

async function runAsyncAssertions() {
  const propagated120 = await propagateFactoryCostToVariantRows(
    "parent-1",
    parent120,
    [{ id: "variant-1" }],
    async (_productId, payload) => payload,
  );
  assert.deepEqual(propagated120.updated, ["variant-1"]);
  assert.equal(
    propagated120.errors.length,
    0,
    "caso 3: padre 120 USD con propagacion actualiza variantes",
  );

  const variantOwn125 = buildFactoryCostOnlyPayload("variant-1", {
    monto: 125,
    moneda: "USD",
  });
  const parent130NoPropagation = readCostSourceFromValues({
    ...EMPTY_PRODUCT_FORM,
    costoFabricaMonto: 130,
    costoFabricaMoneda: "USD",
  });
  assert.equal(parent130NoPropagation?.monto, 130);
  assert.equal(
    variantOwn125.costo_fabrica_monto,
    125,
    "caso 4: variante con coste propio 125 USD permanece si padre cambia sin propagacion",
  );

  const propagated140Payloads: Record<string, unknown>[] = [];
  const propagated140 = await propagateFactoryCostToVariantRows(
    "parent-1",
    { monto: 140, moneda: "USD" },
    [{ id: "variant-1" }],
    async (_productId, payload) => {
      propagated140Payloads.push(payload);
      return payload;
    },
  );
  assert.deepEqual(propagated140.updated, ["variant-1"]);
  assert.equal(
    propagated140Payloads[0]?.costo_fabrica_monto,
    140,
    "caso 5: padre 140 USD con propagacion pisa coste de fabrica de variante",
  );

  const partialFailure = await propagateFactoryCostToVariantRows(
    "parent-1",
    { monto: 150, moneda: "USD" },
    [{ id: "variant-ok" }, { id: "variant-fail" }],
    async (productId, payload) => {
      if (productId === "variant-fail") throw new Error("fallo simulado");
      return payload;
    },
  );
  assert.deepEqual(partialFailure.updated, ["variant-ok"]);
  assert.deepEqual(
    partialFailure.errors.map((e) => e.productId),
    ["variant-fail"],
    "caso 6: fallo parcial queda en respuesta para warning sin invalidar padre guardado",
  );
  assert.equal(partialFailure.totalVariants, 2);
}

void runAsyncAssertions();
