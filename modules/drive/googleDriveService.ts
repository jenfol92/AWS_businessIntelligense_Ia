/**
 * Módulo   : drive
 * Archivo  : modules/drive/googleDriveService.ts
 * Qué hace : Servicio de alto nivel para operaciones con Google Drive.
 *            Portado y extendido desde bussines/lib/googleDrive.ts.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_DRIVE_FOLDER_ID         — ID de la carpeta raíz en Drive
 *   GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Estructura de carpetas para contenedores:
 *   {GOOGLE_DRIVE_FOLDER_ID}/
 *     Contenedores/
 *       MSCU1234567/          ← identificador_embarque
 *         BL.pdf
 *         Factura.pdf
 *         ...
 *     _Ordenes_sin_contenedor/
 *       ORDEN-2025-0001/
 *         proforma_firmada.pdf
 */

import type { DriveClient } from "./googleDriveOAuth";
import { getAdminDriveClient } from "./googleDriveOAuth";
import {
  getMissingDriveEnvVars,
  logDriveAuthError,
  logMissingDriveEnvVars,
  toDriveUserError,
} from "./googleDriveAuthDiagnostics";

// ─── Opciones de Drive Compartido ─────────────────────────────────────────────

const LIST_OPTS = { includeItemsFromAllDrives: true, supportsAllDrives: true } as const;
const MUT_OPTS  = { supportsAllDrives: true } as const;

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Devuelve el ID de la carpeta raíz desde la variable de entorno. */
export function getRootFolderId(): string {
  const id = (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!id) {
    logMissingDriveEnvVars("getRootFolderId");
    throw new Error("Falta GOOGLE_DRIVE_FOLDER_ID en .env.local");
  }
  return id;
}

/** Sanitiza un nombre para que sea válido en Drive/sistema de archivos. */
function sanitizeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 255);
}

/** Busca una carpeta por nombre dentro de un padre. Devuelve el ID o null. */
async function findFolder(
  drive:    DriveClient,
  name:     string,
  parentId: string,
): Promise<string | null> {
  const safeName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [
    `name = '${safeName}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `'${parentId}' in parents`,
    `trashed = false`,
  ].join(" and ");

  const { data } = await drive.files.list({ q, fields: "files(id)", pageSize: 1, spaces: "drive", ...LIST_OPTS });
  return data.files?.[0]?.id ?? null;
}

/** Obtiene o crea una carpeta dentro de un padre. Devuelve el ID. */
async function getOrCreateFolder(
  drive:    DriveClient,
  name:     string,
  parentId: string,
): Promise<string> {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;

  const { data } = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    ...MUT_OPTS,
  });
  if (!data.id) throw new Error(`No se pudo crear la carpeta "${name}"`);
  return data.id;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Resultado de una subida de archivo a Drive. */
export type DriveUploadResult = {
  drive_id:      string;
  url_drive:     string;
  web_view_link: string;
};

/**
 * Verifica que las variables de entorno necesarias para Drive están presentes.
 * Devuelve true si Drive está configurado, false en caso contrario.
 */
export function isDriveConfigured(): boolean {
  return getMissingDriveEnvVars().length === 0;
}

/** Cliente admin de Drive con diagnóstico seguro en fallos OAuth. */
async function getAdminDriveClientSafe() {
  if (!isDriveConfigured()) {
    logMissingDriveEnvVars("getAdminDriveClient");
    throw new Error("Google Drive no está configurado.");
  }

  try {
    return await getAdminDriveClient();
  } catch (error) {
    logDriveAuthError("getAdminDriveClient", error);
    throw toDriveUserError(error);
  }
}

/**
 * Obtiene o crea la carpeta de un contenedor en Drive.
 * Estructura: {root}/Contenedores/{identificador_embarque}
 *
 * @param identificadorEmbarque — Número del contenedor (ej. MSCU1234567)
 * @returns ID de la carpeta del contenedor en Drive
 */
export async function getOrCreateContainerFolder(
  identificadorEmbarque: string,
): Promise<string> {
  const { drive }    = await getAdminDriveClientSafe();
  const rootId       = getRootFolderId();
  const sanitized    = sanitizeName(identificadorEmbarque);

  // {root}/Contenedores/
  const contenedoresId = await getOrCreateFolder(drive, "Contenedores", rootId);

  // {root}/Contenedores/{identificadorEmbarque}/
  return getOrCreateFolder(drive, sanitized, contenedoresId);
}

/**
 * Obtiene o crea la carpeta de "órdenes sin contenedor" en Drive.
 * Estructura: {root}/_Ordenes_sin_contenedor/{numeroOrden}
 */
export async function getOrCreateOrdenSinContenedorFolder(
  numeroOrden: string,
): Promise<string> {
  const { drive }  = await getAdminDriveClientSafe();
  const rootId     = getRootFolderId();
  const sanitized  = sanitizeName(numeroOrden);

  const parentId = await getOrCreateFolder(drive, "_Ordenes_sin_contenedor", rootId);
  return getOrCreateFolder(drive, sanitized, parentId);
}

/**
 * Sube un archivo a Drive dentro de una carpeta específica.
 * Hace el archivo público (role reader / anyone) para generar URL de visualización.
 *
 * @param folderId    — ID de la carpeta destino en Drive
 * @param fileName    — Nombre del archivo
 * @param buffer      — Contenido del archivo
 * @param mimeType    — Tipo MIME del archivo
 * @returns { drive_id, url_drive, web_view_link }
 */
export async function uploadFileToDriveFolder(
  folderId:  string,
  fileName:  string,
  buffer:    Buffer,
  mimeType:  string,
): Promise<DriveUploadResult> {
  const { drive } = await getAdminDriveClientSafe();

  const { Readable } = await import("stream");
  const stream       = Readable.from(buffer);

  const { data } = await drive.files.create({
    requestBody: {
      name:    sanitizeName(fileName),
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id, webViewLink",
    ...MUT_OPTS,
  });

  if (!data.id) throw new Error("No se recibió ID del archivo subido a Drive");

  // Hacer el archivo público para obtener URL de visualización directa
  await drive.permissions.create({
    fileId: data.id,
    requestBody: { role: "reader", type: "anyone" },
    ...MUT_OPTS,
  });

  // URL directa de descarga (vista pública)
  const url_drive     = `https://drive.google.com/uc?export=view&id=${data.id}`;
  const web_view_link = data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`;

  return { drive_id: data.id, url_drive, web_view_link };
}

/**
 * Sube un documento de contenedor a Drive.
 * Crea automáticamente la carpeta del contenedor si no existe.
 *
 * @param identificadorEmbarque — Número del contenedor
 * @param fileName              — Nombre del archivo
 * @param buffer                — Contenido
 * @param mimeType              — Tipo MIME
 */
export async function uploadContainerDocument(
  identificadorEmbarque: string,
  fileName:              string,
  buffer:                Buffer,
  mimeType:              string,
): Promise<DriveUploadResult> {
  const folderId = await getOrCreateContainerFolder(identificadorEmbarque);
  return uploadFileToDriveFolder(folderId, fileName, buffer, mimeType);
}

/**
 * Obtiene o crea la carpeta de un shipment Amazon inbound.
 * Estructura: {root}/Amazon Inbound Shipments/{shipmentId}
 */
export async function getOrCreateAmazonInboundShipmentFolder(
  shipmentId: string,
): Promise<string> {
  const { drive } = await getAdminDriveClientSafe();
  const rootId = getRootFolderId();
  const parentId = await getOrCreateFolder(drive, "Amazon Inbound Shipments", rootId);
  return getOrCreateFolder(drive, sanitizeName(shipmentId), parentId);
}

/**
 * Sube un documento de shipment Amazon inbound a Drive.
 */
export async function uploadAmazonInboundShipmentDocument(
  shipmentId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<DriveUploadResult> {
  const folderId = await getOrCreateAmazonInboundShipmentFolder(shipmentId);
  return uploadFileToDriveFolder(folderId, fileName, buffer, mimeType);
}

/**
 * Sube la proforma firmada de una orden a Drive.
 * Si la orden tiene contenedor, va dentro de la carpeta del contenedor.
 * Si no tiene contenedor, va en _Ordenes_sin_contenedor/{numeroOrden}.
 *
 * @param numeroOrden              — Número de la orden
 * @param fileName                 — Nombre del archivo PDF
 * @param buffer                   — Contenido del PDF
 * @param identificadorEmbarque    — Opcional: número del contenedor asociado
 */
export async function uploadProformaFirmada(
  numeroOrden:             string,
  fileName:                string,
  buffer:                  Buffer,
  identificadorEmbarque?:  string | null,
): Promise<DriveUploadResult> {
  let folderId: string;

  if (identificadorEmbarque?.trim()) {
    folderId = await getOrCreateContainerFolder(identificadorEmbarque.trim());
  } else {
    folderId = await getOrCreateOrdenSinContenedorFolder(numeroOrden);
  }

  return uploadFileToDriveFolder(folderId, fileName, buffer, "application/pdf");
}

// ─── Productos ────────────────────────────────────────────────────────────────

/** Carpeta de producto: {root}/Productos/{SKU - nombre}/ */
export async function getOrCreateProductFolder(
  sku: string,
  nombre: string,
): Promise<string> {
  const { drive } = await getAdminDriveClientSafe();
  const rootId = getRootFolderId();
  const productosId = await getOrCreateFolder(drive, "Productos", rootId);
  const folderName = sanitizeName(`${sku.trim()} - ${nombre.trim()}`.slice(0, 200));
  return getOrCreateFolder(drive, folderName || sku.trim(), productosId);
}

/** Carpeta individual de variante: .../{parentFolder}/{SKU variante}/ */
export async function getOrCreateProductVariantFolder(
  sku: string,
  nombre: string,
  parentSku: string,
  parentNombre: string,
): Promise<string> {
  const parentFolderId = await getOrCreateProductFolder(parentSku, parentNombre);
  const { drive } = await getAdminDriveClientSafe();
  const variantName = sanitizeName(`${sku.trim()} - ${nombre.trim()}`.slice(0, 200));
  return getOrCreateFolder(drive, variantName || sku.trim(), parentFolderId);
}

/**
 * Sube documento de producto a Google Drive.
 * @param scope shared = carpeta padre; individual = subcarpeta de variante
 */
export async function uploadProductDocument(
  params: {
    sku: string;
    nombre: string;
    parentSku?: string | null;
    parentNombre?: string | null;
    scope?: "shared" | "individual";
  },
  fileName: string,
  buffer: Buffer,
  mimeType: string,
): Promise<DriveUploadResult> {
  const scope = params.scope ?? "shared";
  let folderId: string;

  if (
    scope === "individual" &&
    params.parentSku?.trim() &&
    params.parentNombre?.trim()
  ) {
    folderId = await getOrCreateProductVariantFolder(
      params.sku,
      params.nombre,
      params.parentSku,
      params.parentNombre,
    );
  } else {
    folderId = await getOrCreateProductFolder(params.sku, params.nombre);
  }

  return uploadFileToDriveFolder(folderId, fileName, buffer, mimeType);
}

/** Elimina archivo de Drive por ID. Ignora 404. */
export async function deleteDriveFile(driveId: string): Promise<void> {
  const { drive } = await getAdminDriveClientSafe();
  try {
    await drive.files.delete({ fileId: driveId, ...MUT_OPTS });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("404") && !msg.includes("notFound")) throw e;
  }
}

/** Descarga binario de Drive. */
export async function downloadDriveFile(driveId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}> {
  const { drive } = await getAdminDriveClientSafe();

  const meta = await drive.files.get({
    fileId: driveId,
    fields: "name,mimeType",
    ...MUT_OPTS,
  });

  const res = await drive.files.get(
    { fileId: driveId, alt: "media", ...MUT_OPTS },
    { responseType: "arraybuffer" },
  );

  const buffer = Buffer.from(res.data as ArrayBuffer);
  return {
    buffer,
    mimeType: meta.data.mimeType ?? "application/octet-stream",
    fileName: meta.data.name ?? "documento",
  };
}
