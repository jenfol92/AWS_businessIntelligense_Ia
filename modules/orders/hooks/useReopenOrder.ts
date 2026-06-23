"use client";

import { useState } from "react";
import { reopenOrder } from "@/modules/orders/api/orderClient";

export type UseReopenOrderResult = {
  motivo:      string;
  setMotivo:   (v: string) => void;
  saving:      boolean;
  error:       string | null;
  handleReopen: () => Promise<void>;
};

/**
 * Gestiona la acción de reabrir una orden confirmada a borrador.
 * Encapsula el fetch a POST /api/orders/:id/reopen y el estado de UI.
 *
 * @param orderId    - ID de la orden a reabrir
 * @param onReopened - Callback tras reapertura exitosa (p.ej. refresh listado)
 */
export function useReopenOrder(
  orderId: string,
  onReopened: () => void,
): UseReopenOrderResult {
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function handleReopen() {
    setSaving(true);
    setError(null);
    try {
      await reopenOrder(orderId, motivo);
      onReopened();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  return { motivo, setMotivo, saving, error, handleReopen };
}
