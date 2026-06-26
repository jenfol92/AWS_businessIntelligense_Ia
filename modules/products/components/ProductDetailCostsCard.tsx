// modules/products/components/ProductDetailCostsCard.tsx



import { formatCurrency, formatDate, formatNumber } from "@/shared/utils/formatters";
import type { ProductDetailResponse } from "../types/product-detail.types";



type Props = {

  data: ProductDetailResponse;

};



function formatBaseCost(monto: unknown, moneda: unknown): string {

  const n = Number(monto);

  if (!Number.isFinite(n) || n <= 0) return "pendiente";

  const m = moneda ? String(moneda).toUpperCase() : "—";

  return `${n.toFixed(4).replace(/\.?0+$/, "")} ${m}`;

}



/**

 * Costes del producto.

 * Distingue coste propio, coste base efectivo y coste unitario total efectivo.

 */

export function ProductDetailCostsCard({ data }: Props) {

  const costos = data.costos ?? [];

  const costeActual = data.costeActual;

  const costeMedio = data.costeMedio;

  const ultimoCoste = costos[0];

  const efectivo = data.costeBaseEfectivo;



  const propioMonto = ultimoCoste?.costo_fabrica_monto;

  const propioMoneda = ultimoCoste?.costo_fabrica_moneda;



  const effectiveMonto = efectivo?.monto ?? null;

  const effectiveMoneda = efectivo?.moneda ?? null;

  const effectiveSource = efectivo?.source ?? "none";



  const costeUnitarioTotal = data.costeUnitarioTotal;
  const costeUnitarioTotalEur = costeUnitarioTotal?.valueEur ?? null;



  return (

    <div className="card h-100 border-0 shadow-sm">

      <div className="card-body">

        <h2 className="h5 mb-1">Costes</h2>

        <div className="text-muted small mb-3">

          Coste propio, coste base efectivo y coste unitario total.

        </div>



        <div className="row g-3 mb-3">

          <div className="col-md-4">

            <div className="border rounded p-2">

              <div className="text-muted small">Coste propio</div>

              <strong>{formatBaseCost(propioMonto, propioMoneda)}</strong>

            </div>

          </div>



          <div className="col-md-4">

            <div className="border rounded p-2">

              <div className="text-muted small">Coste fábrica base</div>

              <strong>{formatBaseCost(effectiveMonto, effectiveMoneda)}</strong>

              {effectiveSource === "parent" ? (

                <div className="text-primary small mt-1">Heredado del padre</div>

              ) : null}

            </div>

          </div>



          <div className="col-md-4">

            <div className="border rounded p-2">

              <div className="text-muted small">Coste unitario total</div>

              <strong>

                {costeUnitarioTotalEur != null && Number(costeUnitarioTotalEur) > 0

                  ? formatCurrency(costeUnitarioTotalEur)

                  : "Pendiente de orden/lote"}

              </strong>
              {costeUnitarioTotal?.inheritedFromParent ? (
                <div className="text-primary small mt-1">Heredado del padre</div>
              ) : costeUnitarioTotal?.inheritanceRequested ? (
                <div className="text-muted small mt-1">
                  Intenta heredar del padre, sin coste disponible
                </div>
              ) : null}

            </div>

          </div>

        </div>



        <div className="row g-3 mb-3">

          <div className="col-md-6">

            <div className="border rounded p-2">

              <div className="text-muted small">Coste medio ponderado</div>

              <strong>{formatCurrency(costeMedio?.coste_medio_eur)}</strong>

            </div>

          </div>

        </div>



        {costeMedio && (

          <dl className="row small mb-3">

            <dt className="col-6 text-muted">Nº lotes</dt>

            <dd className="col-6">{formatNumber(costeMedio.n_lotes)}</dd>



            <dt className="col-6 text-muted">Unidades compradas</dt>

            <dd className="col-6">

              {formatNumber(costeMedio.unidades_compradas_total)}

            </dd>



            <dt className="col-6 text-muted">Último lote</dt>

            <dd className="col-6">{costeMedio.ultimo_lote ?? "—"}</dd>

          </dl>

        )}



        {costos.length > 0 ? (

          <div className="table-responsive">

            <table className="table table-sm align-middle mb-0">

              <thead>

                <tr>

                  <th>Fecha</th>

                  <th>Lote</th>

                  <th>País</th>

                  <th className="text-end">Base</th>

                  <th className="text-end">Coste unitario total</th>

                </tr>

              </thead>



              <tbody>

                {costos.slice(0, 5).map((cost) => (

                  <tr key={cost.id}>

                    <td>{formatDate(cost.fecha)}</td>

                    <td>{cost.lote_producto ?? "—"}</td>

                    <td>{cost.pais_destino ?? "—"}</td>

                    <td className="text-end">

                      {formatBaseCost(

                        cost.costo_fabrica_monto,

                        cost.costo_fabrica_moneda,

                      )}

                    </td>

                    <td className="text-end">

                      {cost.costo_unitario_total_eur != null

                        ? formatCurrency(cost.costo_unitario_total_eur)

                        : cost.costo_fabrica_eur != null

                          ? formatCurrency(cost.costo_fabrica_eur)

                          : "—"}

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        ) : (

          <div className="text-muted small">

            No hay costes registrados para este producto.

          </div>

        )}

      </div>

    </div>

  );

}

