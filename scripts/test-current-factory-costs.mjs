import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function upsertCurrentFactoryCostByCurrency(rows, input) {
  const currency = String(input.currency || "USD").trim().toUpperCase();
  const currentIndex = rows.findIndex(
    (row) =>
      row.producto_id === input.productId &&
      row.costo_fabrica_moneda === currency &&
      row.contenedor_id == null &&
      row.lote_producto == null,
  );
  const nextRow = {
    id: currentIndex >= 0 ? rows[currentIndex].id : randomUUID(),
    producto_id: input.productId,
    costo_fabrica_monto: input.amount,
    costo_fabrica_moneda: currency,
    contenedor_id: null,
    lote_producto: null,
  };

  if (currentIndex >= 0) {
    rows[currentIndex] = { ...rows[currentIndex], ...nextRow };
  } else {
    rows.push(nextRow);
  }

  return nextRow;
}

function activeCurrentRows(rows, productId) {
  return rows.filter(
    (row) =>
      row.producto_id === productId &&
      row.contenedor_id == null &&
      row.lote_producto == null,
  );
}

function updateOrderItemCostsForConfirmation(orderItems, orderId, patch) {
  const item = orderItems.find(
    (row) => row.id === patch.item_id && row.orden_id === orderId,
  );
  if (!item) {
    throw new Error("item_id ajeno a la orden");
  }
  item.coste_unitario_moneda = patch.coste_unitario_moneda;
  return item;
}

function maybeWriteSnapshot(writeSnapshot) {
  try {
    writeSnapshot();
    return [];
  } catch {
    return ["snapshot optional failure"];
  }
}

const rows = [
  {
    id: "p-usd",
    producto_id: "product-1",
    costo_fabrica_monto: 10,
    costo_fabrica_moneda: "USD",
    contenedor_id: null,
    lote_producto: null,
  },
  {
    id: "p-cny",
    producto_id: "product-1",
    costo_fabrica_monto: 70,
    costo_fabrica_moneda: "CNY",
    contenedor_id: null,
    lote_producto: null,
  },
  {
    id: "p-cny-lote",
    producto_id: "product-1",
    costo_fabrica_monto: 66,
    costo_fabrica_moneda: "CNY",
    contenedor_id: "container-1",
    lote_producto: "lot-1",
  },
];

upsertCurrentFactoryCostByCurrency(rows, {
  productId: "product-1",
  currency: "CNY",
  amount: 75,
});
assert.equal(rows.find((row) => row.id === "p-cny").costo_fabrica_monto, 75);
assert.equal(rows.find((row) => row.id === "p-usd").costo_fabrica_monto, 10);
assert.equal(rows.find((row) => row.id === "p-cny-lote").costo_fabrica_monto, 66);

upsertCurrentFactoryCostByCurrency(rows, {
  productId: "product-1",
  currency: "USD",
  amount: 11,
});
assert.equal(rows.find((row) => row.id === "p-usd").costo_fabrica_monto, 11);
assert.equal(rows.find((row) => row.id === "p-cny").costo_fabrica_monto, 75);

assert.equal(
  activeCurrentRows(rows, "product-1").some(
    (row) => row.costo_fabrica_moneda === "GBP",
  ),
  false,
);

upsertCurrentFactoryCostByCurrency(rows, {
  productId: "product-1",
  currency: "CNY",
  amount: 75,
});
assert.equal(
  activeCurrentRows(rows, "product-1").filter(
    (row) => row.costo_fabrica_moneda === "CNY",
  ).length,
  1,
);

for (const row of activeCurrentRows(rows, "product-1")) {
  upsertCurrentFactoryCostByCurrency(rows, {
    productId: "variant-1",
    currency: row.costo_fabrica_moneda,
    amount: row.costo_fabrica_monto,
  });
}
assert.deepEqual(
  activeCurrentRows(rows, "variant-1")
    .map((row) => [row.costo_fabrica_moneda, row.costo_fabrica_monto])
    .sort(),
  [
    ["CNY", 75],
    ["USD", 11],
  ],
);

upsertCurrentFactoryCostByCurrency(rows, {
  productId: "variant-1",
  currency: "USD",
  amount: 12,
});
assert.equal(
  activeCurrentRows(rows, "variant-1").find(
    (row) => row.costo_fabrica_moneda === "CNY",
  ).costo_fabrica_monto,
  75,
);

upsertCurrentFactoryCostByCurrency(rows, {
  productId: "variant-1",
  currency: "CNY",
  amount: 80,
});
assert.equal(
  activeCurrentRows(rows, "product-1").find(
    (row) => row.costo_fabrica_moneda === "CNY",
  ).costo_fabrica_monto,
  75,
);

const orderItems = [
  {
    id: "item-1",
    orden_id: "order-1",
    producto_id: "variant-1",
    coste_unitario_moneda: 80,
  },
  {
    id: "item-sibling",
    orden_id: "order-1",
    producto_id: "variant-2",
    coste_unitario_moneda: 55,
  },
];
const confirmedItem = updateOrderItemCostsForConfirmation(orderItems, "order-1", {
  item_id: "item-1",
  coste_unitario_moneda: 82,
});
upsertCurrentFactoryCostByCurrency(rows, {
  productId: confirmedItem.producto_id,
  currency: "CNY",
  amount: confirmedItem.coste_unitario_moneda,
});
assert.equal(
  activeCurrentRows(rows, "variant-1").find(
    (row) => row.costo_fabrica_moneda === "CNY",
  ).costo_fabrica_monto,
  82,
);
assert.equal(activeCurrentRows(rows, "variant-2").length, 0);

assert.throws(
  () =>
    updateOrderItemCostsForConfirmation(orderItems, "order-1", {
      item_id: "item-other-order",
      coste_unitario_moneda: 90,
    }),
  /item_id ajeno/,
);

assert.deepEqual(
  maybeWriteSnapshot(() => {
    throw new Error("missing table");
  }),
  ["snapshot optional failure"],
);

console.log("current factory costs by currency: ok");
