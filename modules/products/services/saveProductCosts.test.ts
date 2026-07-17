import assert from "node:assert/strict";
import { EMPTY_PRODUCT_FORM } from "../constants";
import {
  buildFactoryCostPayload,
  readCostSourceFromRow,
  readCostSourceFromValues,
} from "./saveProductCosts";

const parentCost = readCostSourceFromRow({
  producto_id: "parent-1",
  proveedor_id: "supplier-parent",
  costo_fabrica_monto: 12.5,
  costo_fabrica_moneda: "USD",
  costo_unitario_total_eur: 44,
  arancel_porcentaje: 4,
});

assert.deepEqual(
  parentCost,
  {
    monto: 12.5,
    moneda: "USD",
    proveedorId: "supplier-parent",
    arancelPorcentaje: 4,
  },
  "lee coste de fabrica actual del padre",
);

assert(parentCost);
const variantPayload = buildFactoryCostPayload("variant-1", parentCost);
assert.equal(
  variantPayload.costo_fabrica_monto,
  12.5,
  "variante hereda coste fabrica inicial",
);
assert.equal(
  variantPayload.costo_fabrica_moneda,
  "USD",
  "variante hereda moneda del coste fabrica inicial",
);
assert.equal(
  "precio_venta_objetivo" in variantPayload,
  false,
  "propagacion no toca precios",
);
assert.equal(
  "costo_unitario_total_eur" in variantPayload,
  false,
  "propagacion no toca landed cost ni historico de orden/lote",
);

const explicitVariantCost = readCostSourceFromValues({
  ...EMPTY_PRODUCT_FORM,
  parentId: "parent-1",
  costoFabricaMonto: 15,
  costoFabricaMoneda: "EUR",
  proveedorId: "supplier-variant",
  arancelPorcentaje: 6,
});

assert.deepEqual(
  explicitVariantCost,
  {
    monto: 15,
    moneda: "EUR",
    proveedorId: "supplier-variant",
    arancelPorcentaje: 6,
  },
  "coste explicito distinto de variante puede persistirse aparte",
);
