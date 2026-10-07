// modules/inventory/components/detail/SalesByCountryModal.tsx
//
// Modal de ventas del producto por país (estilo Shopkeeper):
//  1) tabla de países con unidades, pedidos, importe y precios del periodo;
//  2) al pulsar un país: distribución de precios y listado de ventas.

"use client";

import { useEffect } from "react";
import { ArrowLeft, ChevronRight, Loader2, X } from "lucide-react";
import { useInventorySalesByCountry } from "../../hooks/useInventorySalesByCountry";
import type { InventorySalesByCountryRow } from "../../types/inventory.types";

const COUNTRY_NAMES: Record<string, string> = {
  ES: "España",
  FR: "Francia",
  DE: "Alemania",
  IT: "Italia",
  GB: "Reino Unido",
  BE: "Bélgica",
  NL: "Países Bajos",
  SE: "Suecia",
  PL: "Polonia",
  IE: "Irlanda",
  UNKNOWN: "Otros canales",
  AE: "Emiratos",
  SA: "Arabia Saudí",
};

function countryFlag(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...c.split("").map((ch) => 127397 + ch.charCodeAt(0)));
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return n.toLocaleString("es-ES", { style: "currency", currency, maximumFractionDigits: 2 });
  } catch {
    return `${fmtNum(n, 2)} ${currency}`;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-ES");
}

export type SalesByCountryModalProps = {
  open: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  canal?: string | null;
  pais?: string | null;
  /** Unidades del KPI (todas las fuentes de ventas) para comparar con el detalle FBA. */
  allSourcesUnits?: number | null;
};

export function SalesByCountryModal(props: SalesByCountryModalProps) {
  const { open, onClose } = props;
  const sales = useInventorySalesByCountry(
    open
      ? {
          productId: props.productId,
          fromDate: props.periodFrom,
          toDate: props.periodTo,
          canal: props.canal,
          pais: props.pais,
        }
      : null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div className="min-w-0">
            {sales.selectedCountry ? (
              <button
                type="button"
                onClick={sales.backToCountries}
                className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Todos los países
              </button>
            ) : null}
            <h2 className="truncate text-base font-semibold text-slate-900">
              {sales.selectedCountry
                ? `${countryFlag(sales.selectedCountry)} Ventas en ${COUNTRY_NAMES[sales.selectedCountry] ?? sales.selectedCountry}`
                : "Ventas por país"}
              <span className="font-normal text-slate-500"> · {props.productName}</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {props.periodLabel} ({fmtDate(props.periodFrom)} – {fmtDate(props.periodTo)}) · País
              = marketplace de venta ·{" "}
              {(sales.summary?.source ?? sales.detail?.source) === "fba_shipments"
                ? "solo envíos FBA, por fecha de envío"
                : "pedidos FBA + FBM por fecha de compra, incluidos pendientes (sin cancelados)"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-auto p-4">
          {sales.selectedCountry ? (
            <CountryDetailView sales={sales} />
          ) : (
            <CountriesView sales={sales} allSourcesUnits={props.allSourcesUnits ?? null} />
          )}
        </div>
      </div>
    </div>
  );
}

type SalesState = ReturnType<typeof useInventorySalesByCountry>;

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function CountriesView({
  sales,
  allSourcesUnits,
}: {
  sales: SalesState;
  allSourcesUnits: number | null;
}) {
  if (sales.summaryLoading) return <Loading label="Cargando ventas…" />;
  if (sales.summaryError) return <p className="text-sm text-rose-700">{sales.summaryError}</p>;
  const data = sales.summary;
  if (!data) return null;

  if (data.priceDetailUnavailable) {
    return (
      <p className="text-sm text-slate-600">
        Con el filtro de canal FBM no hay detalle de ventas por país con precio: Amazon solo
        envía ese detalle para ventas FBA. Cambia el canal a «Todos» o «FBA».
      </p>
    );
  }

  const isOrders = data.source !== "fba_shipments";
  const differs =
    !isOrders && allSourcesUnits != null && allSourcesUnits !== data.totals.units;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox
          label={isOrders ? "Unidades" : "Unidades FBA"}
          value={
            isOrders && s
              ? `${fmtNum(data.totals.units)} (FBA ${fmtNum(s.unitsFba)} · FBM ${fmtNum(s.unitsFbm)})`
              : fmtNum(data.totals.units)
          }
        />
        <StatBox
          label="Pedidos"
          value={
            isOrders && s && s.unitsPending > 0
              ? `${fmtNum(data.totals.orders)} · ${fmtNum(s.unitsPending)} uds pend.`
              : fmtNum(data.totals.orders)
          }
        />
        <StatBox label="Países" value={fmtNum(data.countries.length)} />
        <StatBox
          label="Importe"
          value={
            data.totals.amountByCurrency.length === 0
              ? "—"
              : data.totals.amountByCurrency.map((a) => fmtMoney(a.amount, a.currency)).join(" · ")
          }
        />
      </div>

      {isOrders && s?.lastImportedAt ? (
        <p className="text-[11px] text-slate-500">
          Pedidos importados de Amazon hasta {new Date(s.lastImportedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.
          Los pedidos pendientes pueden no tener precio todavía.
        </p>
      ) : null}
      {!isOrders ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Aún no hay pedidos por fecha de compra (falta aplicar la migración de pedidos o
          importarlos con «Actualizar pedidos Amazon»). Se muestran los envíos FBA.
        </p>
      ) : null}
      {differs ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          El KPI de ventas del periodo suma {fmtNum(allSourcesUnits)} uds de todas las fuentes
          (FBA + FBM, agrupadas por país de entrega). Este detalle muestra solo ventas FBA de
          Amazon agrupadas por marketplace, que son las que incluyen precio.
        </p>
      ) : null}

      {data.countries.length === 0 ? (
        <p className="text-sm text-slate-500">Sin ventas en este periodo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3">País</th>
                <th className="py-2 pr-3 text-right">Uds</th>
                <th className="py-2 pr-3 text-right">FBA</th>
                <th className="py-2 pr-3 text-right">FBM</th>
                <th className="py-2 pr-3 text-right">%</th>
                <th className="py-2 pr-3 text-right">Pedidos</th>
                <th className="py-2 pr-3 text-right">Importe</th>
                <th className="py-2 pr-3 text-right">Precio medio</th>
                <th className="py-2 pr-3 text-right">Precio mín – máx</th>
                <th className="py-2 pr-3">Última venta</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {data.countries.map((row) => (
                <CountryRow key={row.country} row={row} onOpen={() => sales.openCountry(row.country)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CountryRow({ row, onOpen }: { row: InventorySalesByCountryRow; onOpen: () => void }) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
      title="Ver ventas y precios de este país"
    >
      <td className="py-2 pr-3 font-medium text-slate-800">
        <span className="mr-2 text-base leading-none">{countryFlag(row.country)}</span>
        {COUNTRY_NAMES[row.country] ?? row.country}
        <span className="ml-1 text-xs font-normal text-slate-400">{row.salesChannel ?? ""}</span>
      </td>
      <td className="py-2 pr-3 text-right font-semibold">
        {fmtNum(row.units)}
        {(row.unitsPending ?? 0) > 0 ? (
          <span className="ml-1 text-[10px] font-normal text-amber-700">
            ({fmtNum(row.unitsPending)} pend.)
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right text-slate-600">{fmtNum(row.unitsFba ?? row.units)}</td>
      <td className="py-2 pr-3 text-right text-slate-600">{fmtNum(row.unitsFbm ?? 0)}</td>
      <td className="py-2 pr-3 text-right text-slate-500">{fmtNum(row.shareUnits, 1)}%</td>
      <td className="py-2 pr-3 text-right">{fmtNum(row.orders)}</td>
      <td className="py-2 pr-3 text-right">{fmtMoney(row.grossAmount, row.currency)}</td>
      <td className="py-2 pr-3 text-right">{fmtMoney(row.avgUnitPrice, row.currency)}</td>
      <td className="py-2 pr-3 text-right text-slate-600">
        {row.minUnitPrice == null
          ? "—"
          : row.minUnitPrice === row.maxUnitPrice
            ? fmtMoney(row.minUnitPrice, row.currency)
            : `${fmtMoney(row.minUnitPrice, row.currency)} – ${fmtMoney(row.maxUnitPrice, row.currency)}`}
      </td>
      <td className="py-2 pr-3 text-slate-600">{fmtDate(row.lastSaleDate)}</td>
      <td className="py-2 text-slate-400">
        <ChevronRight className="h-4 w-4" />
      </td>
    </tr>
  );
}

function CountryDetailView({ sales }: { sales: SalesState }) {
  if (sales.detailLoading) return <Loading label="Cargando ventas del país…" />;
  if (sales.detailError) return <p className="text-sm text-rose-700">{sales.detailError}</p>;
  const data = sales.detail;
  if (!data) return null;
  if (!data.summary) return <p className="text-sm text-slate-500">Sin ventas en este país en el periodo.</p>;

  const s = data.summary;
  const isOrders = data.source !== "fba_shipments";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Unidades" value={fmtNum(s.units)} />
        <StatBox label="Pedidos" value={fmtNum(s.orders)} />
        <StatBox label="Importe" value={fmtMoney(s.grossAmount, s.currency)} />
        <StatBox label="Precio medio" value={fmtMoney(s.avgUnitPrice, s.currency)} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Precios de venta</h3>
        {data.prices.length === 0 ? (
          <p className="text-xs text-slate-500">Las ventas de este país no traen precio.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 text-right">Precio ud.</th>
                  <th className="py-2 pr-3 text-right">Uds</th>
                  <th className="py-2 pr-3 text-right">%</th>
                  <th className="py-2 pr-3 text-right">Pedidos</th>
                  <th className="py-2 pr-3 text-right">Importe</th>
                  <th className="py-2 pr-3">Primera venta</th>
                  <th className="py-2 pr-3">Última venta</th>
                </tr>
              </thead>
              <tbody>
                {data.prices.map((p) => (
                  <tr key={`${p.currency}-${p.unitPrice}`} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 text-right font-medium">{fmtMoney(p.unitPrice, p.currency)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(p.units)}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{fmtNum(p.shareUnits, 1)}%</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(p.orders)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtMoney(p.grossAmount, p.currency)}</td>
                    <td className="py-1.5 pr-3">{fmtDate(p.firstSaleDate)}</td>
                    <td className="py-1.5 pr-3">{fmtDate(p.lastSaleDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">
          Ventas ({fmtNum(data.lines.length)}
          {data.linesTruncated ? "+, se muestran las 500 más recientes" : ""})
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3">{isOrders ? "Compra" : "Envío"}</th>
                {isOrders ? (
                  <>
                    <th className="py-2 pr-3">Canal</th>
                    <th className="py-2 pr-3">Estado</th>
                  </>
                ) : (
                  <th className="py-2 pr-3">Compra</th>
                )}
                <th className="py-2 pr-3">Pedido</th>
                <th className="py-2 pr-3 text-right">Uds</th>
                <th className="py-2 pr-3 text-right">Precio ud.</th>
                <th className="py-2 pr-3 text-right">Importe</th>
                <th className="py-2 pr-3">Entrega</th>
                {isOrders ? null : <th className="py-2 pr-3">Centro</th>}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={`${l.amazonOrderId ?? "x"}-${l.saleDate}-${i}`} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3">{fmtDate(l.saleDate)}</td>
                  {isOrders ? (
                    <>
                      <td className="py-1.5 pr-3">{l.fulfillmentChannel ?? "—"}</td>
                      <td className={`py-1.5 pr-3 ${l.pending ? "text-amber-700" : "text-slate-600"}`}>
                        {l.orderStatus ?? "—"}
                      </td>
                    </>
                  ) : (
                    <td className="py-1.5 pr-3 text-slate-500">{fmtDate(l.purchaseDate)}</td>
                  )}
                  <td className="py-1.5 pr-3 font-mono text-[11px]">{l.amazonOrderId ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtNum(l.units)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtMoney(l.unitPrice, l.currency)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtMoney(l.grossAmount, l.currency)}</td>
                  <td className="py-1.5 pr-3">
                    {l.shipCountry ? `${countryFlag(l.shipCountry)} ${l.shipCountry}` : "—"}
                  </td>
                  {isOrders ? null : (
                    <td className="py-1.5 pr-3 text-slate-500">{l.fulfillmentCenter ?? "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
