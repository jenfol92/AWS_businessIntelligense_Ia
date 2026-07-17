import { confirmOrderWithCurrentFactoryCostsRpc } from "@/modules/orders/repositories/orderConfirmRepository";
import type {
  ConfirmOrderInput,
  OrdenCompraRow,
} from "@/modules/orders/types/orderPersistence.types";
import { upsertConfirmedOrderCostSnapshots } from "@/modules/orders/repositories/orderConfirmedCostSnapshotRepository";

export type ConfirmOrderServiceResult = {
  orden: OrdenCompraRow;
  warnings: string[];
};

export async function confirmOrderService(
  orderId: string,
  input: ConfirmOrderInput,
): Promise<ConfirmOrderServiceResult> {
  const confirmedOrder = await confirmOrderWithCurrentFactoryCostsRpc(
    orderId,
    input,
  );
  const warnings: string[] = [];

  try {
    await upsertConfirmedOrderCostSnapshots(confirmedOrder);
  } catch (snapshotError) {
    console.error("upsertConfirmedOrderCostSnapshots:", snapshotError);
    warnings.push(
      "La orden se confirmo, pero no se pudo completar el snapshot de costes.",
    );
  }

  return { orden: confirmedOrder, warnings };
}
