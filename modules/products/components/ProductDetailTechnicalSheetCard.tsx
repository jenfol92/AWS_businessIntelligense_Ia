// modules/products/components/ProductDetailTechnicalSheetCard.tsx

import { formatNumber } from "@/shared/utils/formatters";

type Props = {
  data: any;
};

/**
 * Muestra la ficha técnica.
 * De momento lo hacemos genérico para no depender de una categoría concreta.
 */
export function ProductDetailTechnicalSheetCard({ data }: Props) {
  const ficha = data.fichaTecnica;

  if (!ficha) {
    return (
      <div className="card h-100 border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h5 mb-1">Ficha técnica</h2>
          <div className="text-muted small">
            No hay ficha técnica registrada.
          </div>
        </div>
      </div>
    );
  }

  const fields = [
    ["Modelo", ficha.modelo],
    ["Peso neto", formatKg(ficha.peso_neto_kg)],
    ["Alto abierto", formatCm(ficha.alto_abierto_cm)],
    ["Ancho abierto", formatCm(ficha.ancho_abierto_cm)],
    ["Fondo abierto", formatCm(ficha.fondo_abierto_cm)],
    ["Alto plegado", formatCm(ficha.alto_plegado_cm)],
    ["Ancho plegado", formatCm(ficha.ancho_plegado_cm)],
    ["Fondo plegado", formatCm(ficha.fondo_plegado_cm)],
    ["Diámetro ruedas", formatCm(ficha.diametro_ruedas_cm)],
    ["Material estructura", ficha.material_estructura],
    ["Material tapizado", ficha.material_tapizado],
    ["Material ruedas", ficha.material_ruedas],
    ["Edad mínima", formatYears(ficha.edad_minima_aplicable)],
    ["Edad máxima", formatYears(ficha.edad_maxima_aplicable)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "—");

  return (
    <div className="card h-100 border-0 shadow-sm">
      <div className="card-body">
        <h2 className="h5 mb-1">Ficha técnica</h2>
        <div className="text-muted small mb-3">
          Datos técnicos y especificaciones del producto.
        </div>

        {fields.length > 0 ? (
          <dl className="row small mb-0">
            {fields.map(([label, value]) => (
              <div className="col-md-6" key={String(label)}>
                <dt className="text-muted">{label}</dt>
                <dd className="fw-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="text-muted small">
            La ficha técnica existe, pero no tiene campos completados.
          </div>
        )}
      </div>
    </div>
  );
}

function formatKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value, 2)} kg`;
}

function formatCm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value, 2)} cm`;
}

function formatYears(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value)} años`;
}
