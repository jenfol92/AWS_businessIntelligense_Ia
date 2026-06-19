// modules/products/components/ProductInventoryCard.tsx

type ProductInventoryCardProps = {
    inventario: any;
    stockSugerido: any;
  };
  
  // Resumen de stock total y por país.
  export function ProductInventoryCard({
    inventario,
    stockSugerido,
  }: ProductInventoryCardProps) {
    const rows = inventario?.by_country ?? [];
  
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h5 mb-3">Inventario</h2>
  
          <div className="mb-3">
            <div className="small text-muted">Stock total</div>
            <div className="fw-semibold fs-5">{inventario?.stock_total ?? 0} uds</div>
          </div>
  
          <div className="row g-3 mb-3">
            <div className="col-6">
              <div className="border rounded p-2">
                <div className="small text-muted">FBA</div>
                <div className="fw-semibold">{inventario?.stock_fba ?? 0}</div>
              </div>
            </div>
  
            <div className="col-6">
              <div className="border rounded p-2">
                <div className="small text-muted">FBM</div>
                <div className="fw-semibold">{inventario?.stock_fbm ?? 0}</div>
              </div>
            </div>
          </div>
  
          <div className="small text-muted mb-2">Cobertura y reposición</div>
  
          <ul className="list-group list-group-flush mb-3">
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Días de cobertura</span>
              <strong>
                {inventario?.dias_cobertura != null
                  ? Math.round(Number(inventario.dias_cobertura))
                  : "—"}
              </strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Riesgo</span>
              <strong>{stockSugerido?.riesgo ?? inventario?.riesgo ?? "—"}</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Unidades a pedir</span>
              <strong>{stockSugerido?.unidades_a_pedir ?? 0}</strong>
            </li>
          </ul>
  
          <div className="small text-muted mb-2">Stock por país</div>
  
          {rows.length === 0 ? (
            <div className="text-muted small">No hay inventario por país.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>País</th>
                    <th className="text-end">FBA</th>
                    <th className="text-end">FBM</th>
                    <th className="text-end">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => (
                    <tr key={row.id ?? `${row.producto_id}-${row.pais}`}>
                      <td>{row.pais ?? "—"}</td>
                      <td className="text-end">{row.stock_fba ?? 0}</td>
                      <td className="text-end">{row.stock_fbm ?? 0}</td>
                      <td className="text-end">{row.stock_pais ?? 0}</td>
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