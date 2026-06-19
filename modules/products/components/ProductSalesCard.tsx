// modules/products/components/ProductSalesCard.tsx

type ProductSalesCardProps = {
    ventas: any;
    windowDays: number;
  };
  
  // Resumen comercial del periodo seleccionado.
  // De momento lo dejamos en tabla ligera, sin meter gráficos todavía.
  export function ProductSalesCard({
    ventas,
    windowDays,
  }: ProductSalesCardProps) {
    const series = ventas?.series ?? [];
  
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h2 className="h5 mb-1">Rendimiento de ventas</h2>
              <div className="small text-muted">Últimos {windowDays} días</div>
            </div>
          </div>
  
          <div className="row g-3 mb-4">
            <div className="col-md-3">
              <div className="border rounded p-3 h-100">
                <div className="small text-muted">Unidades</div>
                <div className="fw-semibold fs-5">{ventas?.unidades_total ?? 0}</div>
              </div>
            </div>
  
            <div className="col-md-3">
              <div className="border rounded p-3 h-100">
                <div className="small text-muted">Beneficio neto</div>
                <div className="fw-semibold fs-5">
                  {Number(ventas?.beneficio_neto_total ?? 0).toFixed(2)} €
                </div>
              </div>
            </div>
  
            <div className="col-md-3">
              <div className="border rounded p-3 h-100">
                <div className="small text-muted">Ingresos brutos</div>
                <div className="fw-semibold fs-5">
                  {Number(ventas?.ingresos_brutos_total ?? 0).toFixed(2)} €
                </div>
              </div>
            </div>
  
            <div className="col-md-3">
              <div className="border rounded p-3 h-100">
                <div className="small text-muted">ACOS</div>
                <div className="fw-semibold fs-5">
                  {ventas?.acos != null
                    ? `${(Number(ventas.acos) * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            </div>
          </div>
  
          {series.length === 0 ? (
            <div className="text-muted small">
              No hay ventas registradas en el rango seleccionado.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="text-end">Unidades</th>
                    <th className="text-end">Ingresos</th>
                    <th className="text-end">Beneficio</th>
                    <th className="text-end">Ads</th>
                  </tr>
                </thead>
                <tbody>
                  {series.slice(-15).map((row: any) => (
                    <tr key={row.fecha}>
                      <td>{row.fecha}</td>
                      <td className="text-end">{row.unidades ?? 0}</td>
                      <td className="text-end">
                        {Number(row.ingresos_brutos ?? 0).toFixed(2)} €
                      </td>
                      <td className="text-end">
                        {Number(row.beneficio_neto ?? 0).toFixed(2)} €
                      </td>
                      <td className="text-end">
                        {Number(row.publicidad_gasto_ads ?? 0).toFixed(2)} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }