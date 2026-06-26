/**
 * Módulo   : importar
 * Archivo  : app/[locale]/(dashboard)/importar/page.tsx
 * Qué hace : Importación manual de informes externos (Amazon FBA ledger, etc.).
 */

import { AmazonAllOrdersImportCard } from "@/modules/imports/components/AmazonAllOrdersImportCard";
import { AmazonFbaInventoryByCountryImportCard } from "@/modules/imports/components/AmazonFbaInventoryByCountryImportCard";
import { AmazonFbaLedgerImportCard } from "@/modules/imports/components/AmazonFbaLedgerImportCard";

export default function ImportarPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Importar datos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sube informes CSV exportados manualmente desde Amazon u otras fuentes.
        </p>
      </div>

      <AmazonAllOrdersImportCard />
      <AmazonFbaLedgerImportCard />
      <AmazonFbaInventoryByCountryImportCard />
    </div>
  );
}
