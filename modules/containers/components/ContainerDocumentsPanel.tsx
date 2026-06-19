/**
 * Módulo   : containers
 * Archivo  : modules/containers/components/ContainerDocumentsPanel.tsx
 * Qué hace : Panel de documentación de un contenedor.
 *   - Lista documentos actuales (GET /api/containers/[id]/documentos)
 *   - Permite subir nuevos documentos (POST /api/containers/[id]/documentos)
 *   - Abre documentos en Google Drive usando el drive_id
 *
 * Esquema real (tabla documentos):
 *   id, nombre_archivo, drive_id (NOT NULL), fecha_expiracion, created_at
 *
 * La subida requiere Google Drive configurado. Si no lo está, se muestra aviso.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, RefreshCw, AlertCircle, ExternalLink, X } from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Fila de documento según el esquema real de Supabase. */
type DocumentoRow = {
  id:               string;
  documento_id:     string;
  nombre_archivo:   string | null;
  /** ID del archivo en Google Drive. Es NOT NULL en BD. */
  drive_id:         string;
  tipo_documento:   string | null;
  fecha_expiracion: string | null;
  created_at:       string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPOS_DOCUMENTO = [
  "BL",
  "Factura",
  "Packing List",
  "Certificado de origen",
  "Seguro",
  "Otro",
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContainerDocumentsPanelProps {
  /** ID del contenedor (UUID). */
  contenedorId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Construye la URL de visualización de Google Drive a partir del drive_id. */
function driveViewUrl(driveId: string): string {
  return `https://drive.google.com/file/d/${driveId}/view`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}

// ─── Componente ───────────────────────────────────────────────────────────────

/**
 * Panel embebido que muestra y gestiona los documentos de un contenedor.
 * Se usa dentro del panel de detalle expandido de LogisticaPage.
 */
export default function ContainerDocumentsPanel({ contenedorId }: ContainerDocumentsPanelProps) {
  const [docs,    setDocs]    = useState<DocumentoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Estado del formulario de subida
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState<string | null>(null);
  const [uploadInfo,   setUploadInfo]   = useState<string | null>(null);
  const [showUpload,   setShowUpload]   = useState(false);
  const [tipoSelected, setTipoSelected] = useState<string>("Otro");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Carga de documentos ──────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/containers/${contenedorId}/documentos`)
      .then((r) => r.json())
      .then((j: { ok: boolean; rows?: DocumentoRow[]; error?: string }) => {
        if (!j.ok) throw new Error(j.error ?? "Error al cargar documentos");
        setDocs(j.rows ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [contenedorId]);

  useEffect(() => { load(); }, [load]);

  // ── Subida de documento ──────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadInfo(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo_documento", tipoSelected);

      const res  = await fetch(`/api/containers/${contenedorId}/documentos`, { method: "POST", body: fd });
      const json = await res.json() as {
        ok:              boolean;
        error?:          string;
        drive_required?: boolean;
        storage_backend?: string;
        drive_view_link?: string;
      };

      if (!json.ok) {
        if (json.drive_required) {
          setUploadError("Google Drive no está configurado. Contacta al administrador para configurarlo.");
        } else {
          setUploadError(json.error ?? "Error al subir");
        }
        return;
      }

      setShowUpload(false);
      setUploadInfo("Guardado en Google Drive ✓");
      load();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
          Documentos ({docs.length})
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            title="Actualizar documentos"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => { setShowUpload((v) => !v); setUploadError(null); setUploadInfo(null); }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-medium transition"
          >
            <Upload className="h-3 w-3" />
            Subir documento
          </button>
        </div>
      </div>

      {/* Mensaje de confirmación de subida */}
      {uploadInfo && !showUpload && (
        <div className="flex items-center gap-2 text-emerald-700 text-xs bg-emerald-50 rounded-lg px-3 py-2">
          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          {uploadInfo}
        </div>
      )}

      {/* Formulario de subida */}
      {showUpload && (
        <div className="bg-blue-50 rounded-lg border border-blue-100 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-blue-700">Subir documento a Google Drive</span>
            <button onClick={() => setShowUpload(false)} className="text-blue-400 hover:text-blue-600 transition">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] uppercase text-slate-500">Tipo:</label>
            <select
              value={tipoSelected}
              onChange={(e) => setTipoSelected(e.target.value)}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TIPOS_DOCUMENTO.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition ${uploading ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
              <Upload className="h-3 w-3" />
              {uploading ? "Subiendo a Drive…" : "Seleccionar archivo"}
              <input
                ref={fileInputRef}
                type="file"
                disabled={uploading}
                onChange={handleUpload}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-[10px] text-blue-600">
            El archivo se guardará en Google Drive dentro de la carpeta del contenedor.
          </p>
          {uploadError && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-md px-2 py-1.5">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Error de carga */}
      {error && !loading && (
        <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Cargando */}
      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Cargando documentos…
        </div>
      )}

      {/* Sin documentos */}
      {!loading && !error && docs.length === 0 && (
        <p className="text-xs text-slate-400">
          Sin documentos adjuntos.{" "}
          <button onClick={() => setShowUpload(true)} className="text-blue-500 hover:underline">
            Subir el primero
          </button>
        </p>
      )}

      {/* Lista de documentos */}
      {docs.length > 0 && !loading && (
        <div className="space-y-1">
          {docs.map((d) => (
            <div
              key={d.documento_id || d.id}
              className="flex items-center gap-2 bg-white rounded-lg border border-slate-100 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                {/* Enlace a Drive con el drive_id */}
                {d.drive_id ? (
                  <a
                    href={driveViewUrl(d.drive_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate"
                  >
                    {d.nombre_archivo ?? "Documento"}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                ) : (
                  <span className="text-xs text-slate-500 truncate block">
                    {d.nombre_archivo ?? "Documento sin enlace"}
                  </span>
                )}
                {/* Metadatos */}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {d.tipo_documento && (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                      {d.tipo_documento}
                    </span>
                  )}
                  {/* Indicador Drive */}
                  {d.drive_id && (
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                      <ExternalLink className="h-2.5 w-2.5" />
                      Google Drive
                    </span>
                  )}
                  {d.fecha_expiracion && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                      Expira: {fmtDate(d.fecha_expiracion)}
                    </span>
                  )}
                  {d.created_at && (
                    <span className="text-[10px] text-slate-400">{fmtDate(d.created_at)}</span>
                  )}
                </div>
              </div>
              {/* Botón Abrir en Drive */}
              {d.drive_id && (
                <a
                  href={driveViewUrl(d.drive_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir en Drive"
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition flex-shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
