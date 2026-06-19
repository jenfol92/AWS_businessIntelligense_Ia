"use client";



import { Copy, Pencil, Trash2 } from "lucide-react";

import type { SupplierEnriched } from "../types/supplier.types";

import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";

import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";



type SupplierTableProps = {

  rows: SupplierEnriched[];

  loading: boolean;

  onEdit: (supplier: SupplierEnriched) => void;

  onDelete: (supplier: SupplierEnriched) => void;

};



function formatLocation(row: SupplierEnriched): string {

  return [row.pais, row.provincia, row.ciudad].filter(Boolean).join(" · ") || "—";

}



function formatPayment(row: SupplierEnriched): string {

  const dep = row.deposito_porcentaje ?? 30;

  const bal = row.balance_dias_antes_eta ?? 10;

  return `${dep}% dep. · balance ${bal}d antes ETA`;

}



function formatCoords(row: SupplierEnriched): string {

  if (row.latitud == null || row.longitud == null) return "—";

  return `${row.latitud}, ${row.longitud}`;

}



async function copyCoords(row: SupplierEnriched) {

  if (row.latitud == null || row.longitud == null) return;

  const text = `${row.latitud}, ${row.longitud}`;

  try {

    await navigator.clipboard.writeText(text);

  } catch {

    /* ignorar */

  }

}



function SupplierActions({

  row,

  onEdit,

  onDelete,

  mobile = false,

}: {

  row: SupplierEnriched;

  onEdit: (supplier: SupplierEnriched) => void;

  onDelete: (supplier: SupplierEnriched) => void;

  mobile?: boolean;

}) {

  const btnClass = mobile

    ? "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition"

    : "rounded p-1.5 transition";



  return (

    <div className={mobile ? "flex flex-wrap gap-2" : "flex items-center justify-end gap-1"}>

      {row.latitud != null && row.longitud != null ? (

        <button

          type="button"

          onClick={() => void copyCoords(row)}

          className={[

            btnClass,

            mobile

              ? "border border-slate-200 text-slate-600 hover:bg-slate-50"

              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600",

          ].join(" ")}

          title="Copiar coordenadas"

          aria-label="Copiar coordenadas"

        >

          <Copy className="h-4 w-4" />

          {mobile ? "Copiar coords" : null}

        </button>

      ) : null}

      <button

        type="button"

        onClick={() => onEdit(row)}

        className={[

          btnClass,

          mobile

            ? "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"

            : "text-slate-400 hover:bg-blue-50 hover:text-blue-600",

        ].join(" ")}

        title="Editar"

        aria-label="Editar proveedor"

      >

        <Pencil className="h-4 w-4" />

        {mobile ? "Editar" : null}

      </button>

      <button

        type="button"

        onClick={() => onDelete(row)}

        className={[

          btnClass,

          mobile

            ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"

            : "text-slate-400 hover:bg-red-50 hover:text-red-600",

        ].join(" ")}

        title="Eliminar"

        aria-label="Eliminar proveedor"

      >

        <Trash2 className="h-4 w-4" />

        {mobile ? "Eliminar" : null}

      </button>

    </div>

  );

}



function SupplierMobileCard({

  row,

  onEdit,

  onDelete,

}: {

  row: SupplierEnriched;

  onEdit: (supplier: SupplierEnriched) => void;

  onDelete: (supplier: SupplierEnriched) => void;

}) {

  return (

    <ResponsiveDataCard

      title={row.nombre}

      badges={

        row.incompleto ? (

          <span

            className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"

            title={row.incompleto_motivos.join(", ")}

          >

            Incompleto

          </span>

        ) : null

      }

      fields={[

        { label: "Ubicación", value: formatLocation(row) },

        { label: "Puerto", value: row.puerto_preferido_nombre ?? "—" },

        { label: "Agente", value: row.agente_contacto ?? "—" },

        { label: "Prod. (días)", value: row.dias_produccion_estandar ?? "—" },

        { label: "Tráns. (días)", value: row.dias_transito_estandar ?? "—" },

        { label: "Pago", value: formatPayment(row) },

        { label: "Coordenadas", value: formatCoords(row), className: "col-span-2" },

      ]}

      footer={

        row.incompleto ? (

          <span className="text-amber-600">{row.incompleto_motivos.join(" · ")}</span>

        ) : undefined

      }

      actions={<SupplierActions row={row} onEdit={onEdit} onDelete={onDelete} mobile />}

    />

  );

}



export function SupplierTable({

  rows,

  loading,

  onEdit,

  onDelete,

}: SupplierTableProps) {

  if (loading) {

    return (

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-400 shadow-sm">

        Cargando proveedores…

      </div>

    );

  }



  if (rows.length === 0) {

    return (

      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500 shadow-sm">

        No hay proveedores que coincidan con los filtros.

      </div>

    );

  }



  return (

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      <ResponsiveTable

        desktop={

          <div className="overflow-x-auto">

            <table className="min-w-[1100px] w-full text-sm">

              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">

                <tr>

                  <th className="px-4 py-3 text-left font-medium">Proveedor</th>

                  <th className="px-4 py-3 text-left font-medium">Ubicación</th>

                  <th className="px-4 py-3 text-left font-medium">Puerto preferido</th>

                  <th className="px-4 py-3 text-left font-medium">Agente</th>

                  <th className="px-4 py-3 text-center font-medium">Prod.</th>

                  <th className="px-4 py-3 text-center font-medium">Tráns.</th>

                  <th className="px-4 py-3 text-left font-medium">Condiciones pago</th>

                  <th className="px-4 py-3 text-left font-medium">Coordenadas</th>

                  <th className="px-4 py-3 text-right font-medium w-28">Acciones</th>

                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {rows.map((row) => (

                  <tr key={row.id} className="hover:bg-slate-50/80 transition">

                    <td className="px-4 py-3">

                      <div className="flex flex-wrap items-center gap-2">

                        <p className="font-semibold text-slate-800">{row.nombre}</p>

                        {row.incompleto ? (

                          <span

                            className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"

                            title={row.incompleto_motivos.join(", ")}

                          >

                            Incompleto

                          </span>

                        ) : null}

                      </div>

                      {row.incompleto ? (

                        <p className="mt-0.5 text-xs text-amber-600">

                          {row.incompleto_motivos.join(" · ")}

                        </p>

                      ) : null}

                    </td>

                    <td className="px-4 py-3 text-slate-600">{formatLocation(row)}</td>

                    <td className="px-4 py-3 text-slate-700">

                      {row.puerto_preferido_nombre ?? "—"}

                    </td>

                    <td className="px-4 py-3 text-slate-700">{row.agente_contacto ?? "—"}</td>

                    <td className="px-4 py-3 text-center tabular-nums text-slate-700">

                      {row.dias_produccion_estandar ?? "—"}

                    </td>

                    <td className="px-4 py-3 text-center tabular-nums text-slate-700">

                      {row.dias_transito_estandar ?? "—"}

                    </td>

                    <td className="px-4 py-3 text-xs text-slate-600">{formatPayment(row)}</td>

                    <td className="px-4 py-3">

                      <span className="font-mono text-xs text-slate-600">{formatCoords(row)}</span>

                    </td>

                    <td className="px-4 py-3">

                      <SupplierActions row={row} onEdit={onEdit} onDelete={onDelete} />

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        }

        mobile={

          <div className="space-y-3 p-4">

            {rows.map((row) => (

              <SupplierMobileCard

                key={row.id}

                row={row}

                onEdit={onEdit}

                onDelete={onDelete}

              />

            ))}

          </div>

        }

      />

    </div>

  );

}

