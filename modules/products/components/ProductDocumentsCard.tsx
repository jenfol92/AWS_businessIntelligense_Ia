// modules/products/components/ProductDocumentsCard.tsx
//
// Listado de documentos en ficha de producto (solo lectura + descarga).

"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { productDocumentTypeLabel } from "../constants/productDocumentTypes";
import { productDocumentDownloadUrl } from "../services/productDocumentClient";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";

type ProductDocumentRow = {
  id: string;
  tipo?: string | null;
  mercado?: string | null;
  esta_verificado?: boolean | null;
  fecha_expiracion?: string | null;
  documentos?: {
    nombre_archivo?: string | null;
    drive_id?: string | null;
    fecha_expiracion?: string | null;
  } | null;
};

type ProductDocumentsCardProps = {
  productId: string;
  documentos: ProductDocumentRow[];
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES");
}

export function ProductDocumentsCard({
  productId,
  documentos,
}: ProductDocumentsCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-900">Documentos</h2>
        <Link
          href={`/productos/${productId}/edit?tab=documentacion`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Gestionar documentación
        </Link>
      </div>

      {documentos.length === 0 ? (
        <p className="text-sm text-slate-500">No hay documentos vinculados.</p>
      ) : (
        <ResponsiveTable
          desktop={
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Archivo</th>
                    <th className="py-2 pr-3">Mercado</th>
                    <th className="py-2 pr-3">Verificado</th>
                    <th className="py-2 pr-3">Expiración</th>
                    <th className="py-2 pr-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc) => {
                    const driveId = doc.documentos?.drive_id ?? "";
                    const exp =
                      doc.fecha_expiracion ?? doc.documentos?.fecha_expiracion;
                    return (
                      <tr key={doc.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3">
                          {productDocumentTypeLabel(doc.tipo)}
                        </td>
                        <td className="py-2 pr-3">
                          {doc.documentos?.nombre_archivo ?? "—"}
                        </td>
                        <td className="py-2 pr-3">{doc.mercado ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {doc.esta_verificado ? "Sí" : "No"}
                        </td>
                        <td className="py-2 pr-3">{fmtDate(exp)}</td>
                        <td className="py-2 pr-3 text-right">
                          {driveId ? (
                            <a
                              href={productDocumentDownloadUrl(productId, driveId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Ver
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobile={
            <div className="space-y-3">
              {documentos.map((doc) => {
                const driveId = doc.documentos?.drive_id ?? "";
                const exp =
                  doc.fecha_expiracion ?? doc.documentos?.fecha_expiracion;
                return (
                  <ResponsiveDataCard
                    key={doc.id}
                    title={doc.documentos?.nombre_archivo ?? "Documento"}
                    subtitle={productDocumentTypeLabel(doc.tipo)}
                    fields={[
                      { label: "Mercado", value: doc.mercado ?? "—" },
                      {
                        label: "Verificado",
                        value: doc.esta_verificado ? "Sí" : "No",
                      },
                      { label: "Expiración", value: fmtDate(exp) },
                    ]}
                    actions={
                      driveId ? (
                        <a
                          href={productDocumentDownloadUrl(productId, driveId)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver / descargar
                        </a>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          }
        />
      )}
    </div>
  );
}
