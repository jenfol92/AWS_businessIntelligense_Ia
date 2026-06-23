"use client";

import { useRef, useState } from "react";
import { uploadOrderProforma } from "@/modules/orders/api/orderClient";

export type UseOrderProformaUploadResult = {
  uploading:        boolean;
  error:            string | null;
  inputRef:         React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
};

/**
 * Gestiona la subida de proforma firmada (PDF) para una orden confirmada.
 * Encapsula el fetch a POST /api/orders/:id/proforma-upload y el estado de UI.
 *
 * @param orderId    - ID de la orden confirmada
 * @param onUploaded - Callback que se llama tras subida exitosa (p.ej. refresh listado)
 */
export function useOrderProformaUpload(
  orderId: string,
  onUploaded: () => void,
): UseOrderProformaUploadResult {
  const inputRef  = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadOrderProforma(orderId, file);
      onUploaded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return { uploading, error, inputRef, handleFileChange };
}
