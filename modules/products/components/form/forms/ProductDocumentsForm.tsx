"use client";

import { useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import type { useProductForm } from "../../../hooks/useProductForm";
import {
  PRODUCT_DOCUMENT_TYPES,
  productDocumentTypeLabel,
} from "../../../constants/productDocumentTypes";
import {
  productDocumentDownloadUrl,
} from "../../../services/productDocumentClient";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
} from "../productFormUi";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES");
}

/** Documentación en Google Drive vinculada al producto. */
export function ProductDocumentsForm({ form }: Props) {
  const {
    productId,
    documents,
    loadingDocuments,
    documentsError,
    uploadProductDocument,
    deleteProductDocument,
    isVariant,
  } = form;

  const fileRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState("ficha_tecnica");
  const [scope, setScope] = useState<"shared" | "individual">("shared");
  const [fechaExpiracion, setFechaExpiracion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgError, setMsgError] = useState(false);

  if (!productId) {
    return (
      <section className={pfCard}>
        <div className={pfCardBody}>
          <p className="text-sm text-slate-600">
            Guarda primero el producto para poder subir documentación.
          </p>
        </div>
      </section>
    );
  }

  async function onUpload(file: File) {
    setUploading(true);
    setMsg(null);
    setMsgError(false);
    try {
      await uploadProductDocument(file, {
        tipo,
        scope,
        fechaExpiracion: fechaExpiracion.trim() || null,
      });
      setMsg("Documento subido correctamente.");
      setFechaExpiracion("");
    } catch (e) {
      setMsgError(true);
      setMsg(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Subir documento</h2>
          <p className="mt-1 text-xs text-slate-500">
            Google Drive · carpeta Productos/&#123;SKU - nombre&#125; · máx. 30 MB
          </p>
        </div>
        <div className={pfCardBody}>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel}>Tipo</label>
              <select
                className={pfFieldClass(false)}
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
              >
                {PRODUCT_DOCUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={pfLabel}>Expiración (opcional)</label>
              <input
                type="date"
                className={pfFieldClass(false)}
                value={fechaExpiracion}
                onChange={(e) => setFechaExpiracion(e.target.value)}
              />
            </div>
            {isVariant ? (
              <div>
                <label className={pfLabel}>Ámbito</label>
                <select
                  className={pfFieldClass(false)}
                  value={scope}
                  onChange={(e) =>
                    setScope(e.target.value as "shared" | "individual")
                  }
                >
                  <option value="shared">Compartido (carpeta padre)</option>
                  <option value="individual">Solo esta variante</option>
                </select>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Subiendo…" : "Seleccionar archivo"}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.gif,.svg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onUpload(f);
                }}
              />
            </div>
          </div>
          {msg ? (
            <p
              className={`mt-3 text-sm ${msgError ? "text-red-600" : "text-emerald-700"}`}
            >
              {msg}
            </p>
          ) : null}
          {documentsError ? (
            <p className="mt-3 text-sm text-red-600">{documentsError}</p>
          ) : null}
        </div>
      </section>

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Documentos del producto</h2>
        </div>
        <div className={pfCardBody}>
          {loadingDocuments ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-slate-500">Sin documentos vinculados.</p>
          ) : (
            <ResponsiveTable
              desktop={
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                        <th className="py-2 pr-3">Archivo</th>
                        <th className="py-2 pr-3">Tipo</th>
                        <th className="py-2 pr-3">Subido</th>
                        <th className="py-2 pr-3">Expira</th>
                        <th className="py-2 pr-3">Verificado</th>
                        <th className="py-2 pr-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.relId} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-medium text-slate-800">
                            {doc.nombreArchivo ?? "—"}
                          </td>
                          <td className="py-2 pr-3">
                            {productDocumentTypeLabel(doc.tipo)}
                          </td>
                          <td className="py-2 pr-3">{fmtDate(doc.createdAt)}</td>
                          <td className="py-2 pr-3">
                            {fmtDate(doc.fechaExpiracion)}
                          </td>
                          <td className="py-2 pr-3">
                            {doc.estaVerificado ? "Sí" : "No"}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex justify-end gap-2">
                              <a
                                href={productDocumentDownloadUrl(
                                  productId,
                                  doc.driveId,
                                )}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Ver
                              </a>
                              <button
                                type="button"
                                onClick={() => void deleteProductDocument(doc.relId)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobile={
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <ResponsiveDataCard
                      key={doc.relId}
                      title={doc.nombreArchivo ?? "Documento"}
                      subtitle={productDocumentTypeLabel(doc.tipo)}
                      fields={[
                        { label: "Subido", value: fmtDate(doc.createdAt) },
                        { label: "Expira", value: fmtDate(doc.fechaExpiracion) },
                        {
                          label: "Verificado",
                          value: doc.estaVerificado ? "Sí" : "No",
                        },
                      ]}
                      actions={
                        <>
                          <a
                            href={productDocumentDownloadUrl(
                              productId,
                              doc.driveId,
                            )}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ver / descargar
                          </a>
                          <button
                            type="button"
                            onClick={() => void deleteProductDocument(doc.relId)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700"
                          >
                            Eliminar
                          </button>
                        </>
                      }
                    />
                  ))}
                </div>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
