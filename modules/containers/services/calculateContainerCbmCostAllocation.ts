import {
  fetchContainerForStock,
  fetchOrderItemsForContainer,
} from "../repositories/containerStockRepository";
import type {
  ContainerCbmCostAllocation,
  ContainerRowForStock,
  CbmCostAllocationLine,
  OrdenItemForContainerRow,
} from "../types/containerStock.types";

function resolveContainerCost(
  modern: number | null | undefined,
  legacy: number | null | undefined,
): number {
  if (modern != null && modern > 0) return modern;
  if (legacy != null && legacy > 0) return legacy;
  return 0;
}

function roundUnit(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function calculateCbmCostAllocationFromData(input: {
  container: ContainerRowForStock;
  orderItems: OrdenItemForContainerRow[];
}): ContainerCbmCostAllocation {
  const { container, orderItems } = input;

  const cbmTotalContenedor = orderItems.reduce(
    (sum, item) => sum + Math.max(0, item.cbm_total ?? 0),
    0,
  );

  const costeFleteTotal = resolveContainerCost(
    container.costo_flete_total_eur,
    container.flete,
  );
  const costePuertoTotal = resolveContainerCost(
    container.gastos_llegada_puerto_eur,
    container.gastos_llegada_puerto,
  );
  const costeTransitoTotal = container.costo_transito_total_eur ?? 0;
  const costeBancoTotal = container.comision_bancaria_eur ?? 0;

  const lineas: CbmCostAllocationLine[] = orderItems.map((item) => {
    const cbmTotal = Math.max(0, item.cbm_total ?? 0);
    const cantidad = Math.max(1, item.cantidad);
    const pesoCbm =
      cbmTotalContenedor > 0 ? cbmTotal / cbmTotalContenedor : 0;

    const costeFleteLinea = costeFleteTotal * pesoCbm;
    const costePuertoLinea = costePuertoTotal * pesoCbm;
    const costeTransitoLinea = costeTransitoTotal * pesoCbm;
    const costeBancoLinea = costeBancoTotal * pesoCbm;

    const costeFleteUnitario = roundUnit(costeFleteLinea / cantidad);
    const costePuertoUnitario = roundUnit(costePuertoLinea / cantidad);
    const costeTransitoUnitario = roundUnit(costeTransitoLinea / cantidad);
    const costeBancoUnitario = roundUnit(costeBancoLinea / cantidad);

    return {
      ordenItemId: item.id,
      productoId: item.producto_id,
      cantidad: item.cantidad,
      cbmTotal,
      costeFleteUnitario,
      costePuertoUnitario,
      costeTransitoUnitario,
      costeBancoUnitario,
      costeLogisticoUnitarioTotal: roundUnit(
        costeFleteUnitario +
          costePuertoUnitario +
          costeTransitoUnitario +
          costeBancoUnitario,
      ),
    };
  });

  return { cbmTotalContenedor, lineas };
}

export async function calculateContainerCbmCostAllocation(
  contenedorId: string,
): Promise<ContainerCbmCostAllocation | null> {
  const container = await fetchContainerForStock(contenedorId);
  if (!container) return null;

  const orderItems = await fetchOrderItemsForContainer(contenedorId);
  return calculateCbmCostAllocationFromData({ container, orderItems });
}
