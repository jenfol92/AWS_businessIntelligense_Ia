// modules/products/components/ProductDetailKpis.tsx

type ProductDetailKpisProps = {
  inventario: any;
  ventas: any;
  rentabilidad: any;
  stockSugerido: any;
  logisticaResumen: any;
};

// KPIs principales de la ficha.
// Solo muestra métricas resumidas.
export function ProductDetailKpis({
  inventario,
  ventas,
  rentabilidad,
  stockSugerido,
  logisticaResumen,
}: ProductDetailKpisProps) {
  const margin =
    rentabilidad?.margen_bruto_porcentaje != null
      ? `${(Number(rentabilidad.margen_bruto_porcentaje) * 100).toFixed(1)}%`
      : "—";

  const diasCobertura =
    inventario?.dias_cobertura != null
      ? `${Math.round(Number(inventario.dias_cobertura))} días`
      : "—";

  const riesgo = stockSugerido?.riesgo ?? inventario?.riesgo ?? "—";

  const pedidoRecomendado =
    logisticaResumen?.pedido_recomendado != null
      ? `${Number(logisticaResumen.pedido_recomendado)} uds`
      : "—";

  const cards = [
    {
      title: "Stock total",
      value: `${inventario?.stock_total ?? 0} uds`,
      hint: `FBA ${inventario?.stock_fba ?? 0} · FBM ${inventario?.stock_fbm ?? 0}`,
    },
    {
      title: "Ventas",
      value: `${ventas?.unidades_total ?? 0} uds`,
      hint: `${ventas?.media_diaria_unidades?.toFixed?.(2) ?? "0.00"} uds/día`,
    },
    {
      title: "Margen",
      value: margin,
      hint:
        rentabilidad?.precio_venta_objetivo != null
          ? `PVP objetivo ${Number(rentabilidad.precio_venta_objetivo).toFixed(2)} €`
          : "Sin precio objetivo",
    },
    {
      title: "Cobertura",
      value: diasCobertura,
      hint: `Riesgo: ${riesgo}`,
    },
    {
      title: "Pedido recomendado",
      value: pedidoRecomendado,
      hint:
        logisticaResumen?.lead_time_dias != null
          ? `Lead time ${Number(logisticaResumen.lead_time_dias)} días`
          : "Sin lead time",
    },
  ];

  return (
    <div className="row g-3">
      {cards.map((card) => (
        <div className="col-md-6 col-xl" key={card.title}>
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <div className="text-muted small mb-1">{card.title}</div>
              <div className="h4 mb-1">{card.value}</div>
              <div className="small text-muted">{card.hint}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}