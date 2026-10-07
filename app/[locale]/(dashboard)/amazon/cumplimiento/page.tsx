import { PolicyAlertsTable } from "@/modules/policies-compliance/components/PolicyAlertsTable";

/**
 * Página de alertas de cumplimiento Amazon.
 * Solo monta la tabla; toda la lógica vive en el backend.
 */
export default function CumplimientoAmazonPage() {
  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">
          Cumplimiento Amazon
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Alertas de seguridad de productos, cumplimiento normativo y políticas
          de listado. Los estados y agrupaciones los calcula el backend.
        </p>
      </header>

      <PolicyAlertsTable />
    </main>
  );
}
