"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import CreateContainerFromOrderModal from "@/modules/containers/components/CreateContainerFromOrderModal";

type Props = {
  onCreated: (contenedorId: string) => void;
};

/**
 * Botón + modal de creación de contenedor.
 * Lee ?ordenId= de la URL y abre el modal con la orden preseleccionada.
 */
export function LogisticaCreateContainerTrigger({ onCreated }: Props) {
  const searchParams = useSearchParams();
  const initialOrdenId = searchParams.get("ordenId");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (initialOrdenId) setOpen(true);
  }, [initialOrdenId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition shadow-sm"
      >
        <Plus className="h-4 w-4" />
        Nuevo contenedor
      </button>

      {open ? (
        <CreateContainerFromOrderModal
          initialOrdenId={initialOrdenId}
          onClose={() => setOpen(false)}
          onCreated={(cid) => {
            setOpen(false);
            onCreated(cid);
          }}
        />
      ) : null}
    </>
  );
}
