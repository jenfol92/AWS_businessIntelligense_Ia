// modules/products/components/ProductLogisticsCard.tsx

type ProductLogisticsCardProps = {
    logistica: any;
    fichaTecnica: any;
    proveedor: any;
    logisticaResumen: any;
  };
  
  // Resumen físico y operativo.
  // Mezcla datos de logística, ficha técnica y proveedor, pero solo para mostrar.
  export function ProductLogisticsCard({
    logistica,
    fichaTecnica,
    proveedor,
    logisticaResumen,
  }: ProductLogisticsCardProps) {
    const largoCm = logistica?.largo_cm ?? fichaTecnica?.largo_caja_cm ?? 0;
    const anchoCm = logistica?.ancho_cm ?? fichaTecnica?.ancho_caja_cm ?? 0;
    const altoCm = logistica?.alto_cm ?? fichaTecnica?.alto_caja_cm ?? 0;
    const pesoBrutoKg = logistica?.peso_kg_bruto ?? fichaTecnica?.peso_bruto_kg ?? "—";

    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h5 mb-3">Logística</h2>
  
          <ul className="list-group list-group-flush mb-3">
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Medidas</span>
              <strong>
                {largoCm} × {anchoCm} × {altoCm} cm
              </strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Cubicaje unitario</span>
              <strong>{logistica?.cubicaje_unitario_m3 ?? "—"} m³</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Unidades por caja</span>
              <strong>{logistica?.unidades_por_caja ?? "—"}</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Peso bruto</span>
              <strong>{pesoBrutoKg} kg</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Pedido mínimo</span>
              <strong>{logistica?.pedido_minimo_unidades ?? "—"} uds</strong>
            </li>
          </ul>
  
          <div className="small text-muted mb-2">Lead time</div>
          <div className="row g-2 mb-3">
            <div className="col-6">
              <div className="border rounded p-2">
                <div className="small text-muted">Producción</div>
                <div className="fw-semibold">
                  {proveedor?.dias_produccion_estandar ?? 0} días
                </div>
              </div>
            </div>
            <div className="col-6">
              <div className="border rounded p-2">
                <div className="small text-muted">Tránsito</div>
                <div className="fw-semibold">
                  {proveedor?.dias_transito_estandar ?? 0} días
                </div>
              </div>
            </div>
          </div>
  
          <ul className="list-group list-group-flush mb-3">
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Lead time total</span>
              <strong>{logisticaResumen?.lead_time_dias ?? "—"} días</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Buffer</span>
              <strong>{logisticaResumen?.buffer_dias ?? "—"} días</strong>
            </li>
            <li className="list-group-item px-0 d-flex justify-content-between">
              <span>Pedido recomendado</span>
              <strong>{logisticaResumen?.pedido_recomendado ?? "—"} uds</strong>
            </li>
          </ul>
  
          {fichaTecnica && (
            <>
              <div className="small text-muted mb-2">Ficha técnica</div>
              <div className="small">
                <div><strong>Modelo:</strong> {fichaTecnica?.modelo ?? "—"}</div>
                <div><strong>Peso neto:</strong> {fichaTecnica?.peso_neto_kg ?? "—"} kg</div>
                <div><strong>Material estructura:</strong> {fichaTecnica?.material_estructura ?? "—"}</div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }