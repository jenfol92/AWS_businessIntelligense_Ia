/**
 * Módulo   : orders
 * Archivo  : app/[locale]/(dashboard)/pedidos/page.tsx
 * Qué hace : Vista principal del histórico de órdenes de compra.
 *            Lista, filtra y permite ejecutar acciones sobre cada orden
 *            según su estado (borrador/confirmado).
 *
 * Acciones por estado:
 *   borrador   → Editar | Confirmar
 *   confirmado → Ver | Crear contenedor | Reabrir | Proforma (subir/ver)
 *
 * Datos desde hooks:
 *   useOrdersList      → GET /api/orders + GET /api/logistics/ports
 *   useOrderSuggestions → GET /api/orders/suggestions + GET /api/planner/summary
 */

"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  CheckCircle,
  Eye,
  Package,
  Undo2,
  FileText,
  Upload,
  Download,
  X,
  AlertCircle,
  ShoppingCart,
  TrendingDown,
} from "lucide-react";

import OrderFormModal                from "@/modules/orders/components/OrderFormModal";
import type { PreloadedItem }        from "@/modules/orders/types/orderForm.types";
import OrderDraftBasket              from "@/modules/orders/components/OrderDraftBasket";
import { useOrderDraftBasket }       from "@/modules/orders/hooks/useOrderDraftBasket";
import { sugerenciaToBasketItem }    from "@/modules/orders/utils/sugerenciaBasketMapper";
import ContainerOptimizationCard     from "@/modules/planner/components/ContainerOptimizationCard";
import { containerGroupToBasketItems } from "@/modules/planner/utils/plannerBasketMappers";
import ConfirmOrderModal             from "@/modules/orders/components/ConfirmOrderModal";
import { OrderContainerActions }     from "@/modules/orders/components/OrderContainerSummary";
import { OrderContainerSummary }     from "@/modules/orders/components/OrderContainerSummary";
import { PedidosCreateContainerFlow } from "@/modules/orders/components/PedidosCreateContainerFlow";
import type { OrderListRow }         from "@/modules/orders/types/orderList.types";
import type { OrdenCompraRow }       from "@/modules/orders/types/orderPersistence.types";
import type { SugerenciaRow }        from "@/modules/orders/types/orderSuggestions.types";
import { useOrdersList }             from "@/modules/orders/hooks/useOrdersList";
import type { EstadoFiltro }         from "@/modules/orders/hooks/useOrdersList";
import { useOrderSuggestions }       from "@/modules/orders/hooks/useOrderSuggestions";
import { useOrderProformaUpload }    from "@/modules/orders/hooks/useOrderProformaUpload";
import { useReopenOrder }            from "@/modules/orders/hooks/useReopenOrder";
import { suggestionToPreloadedItem } from "@/modules/orders/utils/suggestionToPreloadedItem";
import { DEFAULT_LOCALE, isLocale }  from "@/config/i18n";
import { ResponsiveDataCard }        from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable }           from "@/shared/ui/ResponsiveTable";
import { formatCurrency, formatEur } from "@/shared/utils/currency";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Pestaña activa de la página de pedidos. */
type TabPedidos = "historial" | "sugerencias";

// ─── Configuracion de badges ──────────────────────────────────────────────────

const BADGE: Record<string, { bg: string; text: string; label: string }> = {
  borrador:   { bg: "bg-amber-50",   text: "text-amber-700",   label: "Borrador"   },
  confirmado: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Confirmado" },
  cancelado:  { bg: "bg-red-50",     text: "text-red-600",     label: "Cancelado"  },
  recibido:   { bg: "bg-blue-50",    text: "text-blue-700",    label: "Recibido"   },
};

// ─── Subcomponente: badge de estado ──────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const cfg = BADGE[estado] ?? BADGE.borrador;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

function tipoEnvioLabel(tipoEnvio: string | null | undefined): string {
  return tipoEnvio === "amazon_agl" ? "Amazon AGL" : "Envio propio";
}

function amazonInboundRouteLabel(value: string | null | undefined): string {
  switch (value) {
    case "fabrica_a_amazon":
    case "proveedor_a_amazon":
      return "Fábrica → Amazon";
    case "almacen_a_amazon":
      return "Almacén → Amazon";
    default:
      return "Amazon inbound";
  }
}

function amazonInboundTransportLabel(value: string | null | undefined): string | null {
  switch (value) {
    case "amazon_agl":
      return "Amazon AGL";
    case "propio":
    case "fabrica":
    case "transitario":
    case "desconocido":
      return "Logística propia";
    default:
      return null;
  }
}

function amazonInboundLogisticsLabel(
  inbound: OrderListRow["amazon_inbound"],
  tipoEnvioOrden?: string | null,
): string {
  if (!inbound) return "Amazon inbound";
  const route = amazonInboundRouteLabel(inbound.logistics_flow);
  const transport =
    amazonInboundTransportLabel(inbound.transport_provider) ??
    (tipoEnvioOrden === "amazon_agl" ? "Amazon AGL" : null);
  return transport ? `${route} · ${transport}` : route;
}

// ─── Subcomponente: celda de proforma inline ─────────────────────────────────

/**
 * ProformaCell
 * Si la orden ya tiene proforma firmada → botón de ver/descargar.
 * Si no la tiene → botón de subir PDF (abre input oculto).
 */
function orderPaymentCurrency(orden: OrderListRow): string {
  return (orden.moneda_compra ?? "USD").trim().toUpperCase() || "USD";
}

function orderOriginalTotal(orden: OrderListRow): number | null {
  const total = Number(orden.coste_total_moneda ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const currency = orderPaymentCurrency(orden);
  if (currency === "EUR") return Number(orden.coste_total_eur ?? 0);
  return null;
}

function CosteProveedorCell({ orden }: { orden: OrderListRow }) {
  const currency = orderPaymentCurrency(orden);
  const totalOriginal = orderOriginalTotal(orden);
  const totalEur = Number(orden.coste_total_eur ?? 0);

  if (currency === "EUR") {
    return (
      <span className="font-semibold text-slate-800">
        {formatEur(totalOriginal ?? totalEur)}
      </span>
    );
  }

  return (
    <div className="space-y-0.5">
      <p className="font-semibold text-slate-800">
        {totalOriginal != null ? formatCurrency(totalOriginal, currency) : "—"}
      </p>
      <p className="text-[11px] font-medium text-slate-500">
        EUR previsto: {formatEur(totalEur)}
      </p>
    </div>
  );
}
function OrderLogisticsSummary({
  orden,
  locale,
  compact,
}: {
  orden: OrderListRow;
  locale: string;
  compact?: boolean;
}) {
  if (orden.amazon_inbound) {
    const inbound = orden.amazon_inbound;
    return (
      <div className="text-xs text-slate-700">
        <p className="font-mono font-semibold text-blue-700">{inbound.shipment_id}</p>
        {!compact ? (
          <p className="text-slate-500">
            {amazonInboundLogisticsLabel(inbound, orden.tipo_envio)} · {inbound.estado_amazon ?? "Sin estado"} ·{" "}
            {inbound.destination_center ?? "Sin centro"}
          </p>
        ) : null}
        {!compact ? (
          <p className="text-slate-500">
            ETA Amazon {inbound.eta_estimada ?? "—"} · Tracking{" "}
            {inbound.tracking_number ??
              inbound.agl_tracking_number ??
              inbound.amazon_container_number ??
              "—"}
          </p>
        ) : null}
        {!compact ? (
          <p className="text-slate-400">
            Docs {inbound.documents_count} · Costes {inbound.costs_count}
          </p>
        ) : null}
      </div>
    );
  }

  if (orden.tipo_envio === "amazon_agl") {
    return <span className="text-purple-600">Amazon AGL pendiente vínculo</span>;
  }

  if (orden.contenedor) {
    return (
      <OrderContainerSummary
        contenedor={orden.contenedor}
        locale={locale}
        compact={compact}
      />
    );
  }

  return <span className="text-slate-300">—</span>;
}

function ProformaCell({
  orden,
  onUploaded,
}: {
  orden: OrderListRow;
  onUploaded: () => void;
}) {
  const { uploading, error, inputRef, handleFileChange } =
    useOrderProformaUpload(orden.id, onUploaded);

  if (orden.proforma_firmada_url) {
    return (
      <a
        href={orden.proforma_firmada_url}
        target="_blank"
        rel="noopener noreferrer"
        title="Ver / Descargar proforma firmada"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title={uploading ? "Subiendo…" : "Subir proforma firmada (PDF)"}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 transition"
      >
        {uploading ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
      </button>
      {error && (
        <span className="text-[10px] text-red-500 ml-1 max-w-[120px] truncate" title={error}>
          {error}
        </span>
      )}
    </>
  );
}

function etaTextClass(eta: string | null, refDate: Date): string {
  if (!eta) return "text-slate-300";
  const diff = (new Date(eta).getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return "text-red-500 font-medium";
  if (diff <= 14) return "text-amber-600 font-medium";
  return "text-slate-600";
}

function OrdenAcciones({
  orden,
  locale,
  mobile = false,
  onEditDraft,
  onConfirm,
  onView,
  onCreateContainer,
  onReopen,
  onProformaUploaded,
}: {
  orden: OrderListRow;
  locale: string;
  mobile?: boolean;
  onEditDraft: () => void;
  onConfirm: () => void;
  onView: () => void;
  onCreateContainer: () => void;
  onReopen: () => void;
  onProformaUploaded: () => void;
}) {
  const textBtn = mobile
    ? "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition"
    : "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition";
  const iconBtn = mobile
    ? "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg transition"
    : "inline-flex items-center justify-center w-7 h-7 rounded-md transition";

  if (orden.estado === "borrador") {
    return (
      <div className={mobile ? "flex flex-wrap gap-2" : "inline-flex items-center justify-end gap-1"}>
        <button
          type="button"
          onClick={onEditDraft}
          title="Editar borrador"
          className={`${textBtn} bg-slate-100 text-slate-600 hover:bg-slate-200`}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          title="Confirmar orden"
          className={`${textBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          <CheckCircle className="h-3.5 w-3.5" />
          Confirmar
        </button>
      </div>
    );
  }

  if (orden.estado === "confirmado") {
    return (
      <div className={mobile ? "flex flex-wrap gap-2" : "inline-flex items-center justify-end gap-1"}>
        <button
          type="button"
          onClick={onView}
          title="Ver orden"
          aria-label="Ver orden"
          className={`${iconBtn} bg-slate-100 text-slate-500 hover:bg-slate-200`}
        >
          <Eye className="h-3.5 w-3.5" />
          {mobile ? <span className="sr-only">Ver</span> : null}
        </button>
        {orden.amazon_inbound ? (
          <a
            href={`/${locale}/amazon/envios?shipmentId=${encodeURIComponent(orden.amazon_inbound.shipment_id)}`}
            title="Abrir Amazon Envíos"
            className={`${iconBtn} bg-blue-50 text-blue-600 hover:bg-blue-100`}
          >
            <Package className="h-3.5 w-3.5" />
          </a>
        ) : orden.tipo_envio === "amazon_agl" ? (
          <span
            title="Amazon AGL: se vinculara desde Amazon Envios"
            className={`${iconBtn} bg-purple-50 text-purple-600`}
          >
            <Package className="h-3.5 w-3.5" />
          </span>
        ) : (
          <OrderContainerActions
            contenedor={orden.contenedor}
            locale={locale}
            mobile={mobile}
            onCreateContainer={onCreateContainer}
          />
        )}
        <button
          type="button"
          onClick={onReopen}
          title="Reabrir a borrador"
          aria-label="Reabrir a borrador"
          className={`${iconBtn} bg-amber-50 text-amber-600 hover:bg-amber-100`}
        >
          <Undo2 className="h-3.5 w-3.5" />
          {mobile ? <span className="sr-only">Reabrir</span> : null}
        </button>
        {orden.proforma_firmada_url ? (
          <a
            href={orden.proforma_firmada_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver proforma firmada"
            aria-label="Ver proforma firmada"
            className={`${iconBtn} bg-emerald-50 text-emerald-600 hover:bg-emerald-100`}
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
        ) : (
          <ProformaCell orden={orden} onUploaded={onProformaUploaded} />
        )}
      </div>
    );
  }

  return null;
}

function OrdenMobileCard({
  orden,
  locale,
  hoy,
  fmtDate,
  onEditDraft,
  onConfirm,
  onView,
  onCreateContainer,
  onReopen,
  onProformaUploaded,
}: {
  orden: OrderListRow;
  locale: string;
  hoy: Date;
  fmtDate: (d: string | null) => string;
  onEditDraft: () => void;
  onConfirm: () => void;
  onView: () => void;
  onCreateContainer: () => void;
  onReopen: () => void;
  onProformaUploaded: () => void;
}) {
  return (
    <ResponsiveDataCard
      title={
        <span className="font-mono">{orden.numero_orden}</span>
      }
      subtitle={orden.numero_pedido_agente ?? undefined}
      badges={<EstadoBadge estado={orden.estado} />}
      fields={[
        { label: "Fecha", value: fmtDate(orden.fecha_orden) },
        { label: "Puerto FOB", value: orden.fob_puerto ?? "—" },
        { label: "Tipo envio", value: tipoEnvioLabel(orden.tipo_envio) },
        { label: "Destino", value: orden.destino ?? "—" },
        {
          label: "ETA",
          value: orden.eta ? (
            <span className={etaTextClass(orden.eta, hoy)}>{fmtDate(orden.eta)}</span>
          ) : (
            "—"
          ),
        },
        { label: "CBM", value: Number(orden.cbm_total).toFixed(2) },
        {
          label: "Coste proveedor",
          value: <CosteProveedorCell orden={orden} />,
        },
        ...(orden.contenedor || orden.amazon_inbound || orden.tipo_envio === "amazon_agl"
          ? [{
              label: "Logistica vinculada",
              value: <OrderLogisticsSummary orden={orden} locale={locale} compact />,
              className: "col-span-2",
            }]
          : []),
      ]}
      actions={
        <OrdenAcciones
          orden={orden}
          locale={locale}
          mobile
          onEditDraft={onEditDraft}
          onConfirm={onConfirm}
          onView={onView}
          onCreateContainer={onCreateContainer}
          onReopen={onReopen}
          onProformaUploaded={onProformaUploaded}
        />
      }
    />
  );
}

// ─── Modal de reabrir con motivo ──────────────────────────────────────────────

function ReopenModal({
  orden,
  onClose,
  onReopened,
}: {
  orden: OrderListRow;
  onClose: () => void;
  onReopened: (orden: OrdenCompraRow) => void;
}) {
  const { motivo, setMotivo, saving, error, handleReopen } =
    useReopenOrder(orden.id, onReopened);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-800">Reabrir a borrador</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            La orden <span className="font-semibold">{orden.numero_orden}</span> volverá
            a estado <span className="font-semibold text-amber-600">borrador</span>.
            Esta acción queda registrada en las notas.
          </p>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">
              Motivo (opcional)
            </label>
            <textarea
              disabled={saving}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Ej: Cambio en precio de proveedor, revisión de cantidades…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleReopen}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 transition"
          >
            <Undo2 className="h-4 w-4" />
            {saving ? "Reabriendo…" : "Reabrir orden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

function SugerenciaToggleButton({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  if (selected) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 transition"
      >
        <Check className="h-3.5 w-3.5" />
        Añadido
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 text-xs font-medium transition"
    >
      <Plus className="h-3.5 w-3.5" />
      Añadir
    </button>
  );
}

/**
 * PedidosPage
 *
 * Vista del histórico de órdenes de compra con KPIs, filtros y tabla de acciones.
 */
export default function PedidosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params       = useParams();
  const locale       = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

  // ── Pestaña activa ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabPedidos>("historial");

  // ── Datos de órdenes, filtros y puertos ─────────────────────────────────
  const ordersList = useOrdersList();

  // ── Sugerencias de compra y grupos planner ──────────────────────────────
  const suggestions = useOrderSuggestions(activeTab === "sugerencias");

  // ── Basket de borrador ──────────────────────────────────────────────────
  const basket = useOrderDraftBasket();

  // ── Notificación flotante ───────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);

  // ── Estado de modales ───────────────────────────────────────────────────
  const [showForm,       setShowForm]       = useState(false);
  const [editOrden,      setEditOrden]      = useState<OrderListRow | null>(null);
  const [readonlyOrden,  setReadonlyOrden]  = useState<OrderListRow | null>(null);
  const [confirmOrden,   setConfirmOrden]   = useState<OrderListRow | null>(null);
  const [reopenOrden,    setReopenOrden]    = useState<OrderListRow | null>(null);
  const [containerOrden, setContainerOrden] = useState<OrderListRow | null>(null);
  /** Ítems precargados al abrir OrderFormModal desde sugerencias. */
  const [modalItems,     setModalItems]     = useState<PreloadedItem[] | undefined>(undefined);

  const orderIdFromUrl = searchParams.get("orderId");

  function clearOrderIdFromUrl() {
    if (!orderIdFromUrl) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("orderId");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  // Permite abrir una orden desde enlaces externos (p.ej. cronograma de llegadas).
  useEffect(() => {
    if (!orderIdFromUrl || ordersList.ordenes.length === 0) return;
    if (readonlyOrden?.id === orderIdFromUrl || editOrden?.id === orderIdFromUrl) return;

    const order = ordersList.ordenes.find((o) => o.id === orderIdFromUrl);
    if (!order) return;

    setReadonlyOrden(order);
    setEditOrden(null);
    setShowForm(true);
  }, [editOrden?.id, orderIdFromUrl, ordersList.ordenes, readonlyOrden?.id]);

  // ── Toast helper ────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  /**
   * Abre OrderFormModal con el/los producto(s) sugerido(s) precargado(s).
   * origin_port_name siempre es nombre legible, nunca UUID.
   */
  function handleAnadirAOrden(items: SugerenciaRow[]) {
    setModalItems(items.map(suggestionToPreloadedItem));
    setEditOrden(null);
    setReadonlyOrden(null);
    setShowForm(true);
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpiTotal       = ordersList.ordenes.length;
  const kpiBorradores  = ordersList.ordenes.filter((o) => o.estado === "borrador").length;
  const kpiConfirmados = ordersList.ordenes.filter((o) => o.estado === "confirmado").length;
  const kpiCbm         = ordersList.ordenes.reduce((s, o) => s + Number(o.cbm_total ?? 0), 0);
  const kpiEurTotal    = ordersList.ordenes.reduce((s, o) => s + Number(o.coste_total_eur ?? 0), 0);
  const hoy            = new Date();
  const kpiProxEta     = ordersList.ordenes.filter((o) => {
    if (!o.eta) return false;
    const diff = (new Date(o.eta).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  }).length;

  // ── Formateo ────────────────────────────────────────────────────────────
  function fmtDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
  }

  return (
    <div className="max-w-screen-xl mx-auto space-y-5 p-4 pb-10">

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-800 text-white text-sm rounded-xl px-4 py-3 shadow-xl">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          {toast}
        </div>
      )}

      {/* ── Encabezado ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Órdenes de compra</h1>
          <p className="text-sm text-slate-500 mt-0.5">Histórico de pedidos a proveedor</p>
        </div>
        <button
          onClick={() => { setEditOrden(null); setReadonlyOrden(null); setShowForm(true); }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("historial")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "historial"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileText className="h-4 w-4" />
          Historial
        </button>
        <button
          onClick={() => setActiveTab("sugerencias")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "sugerencias"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <TrendingDown className="h-4 w-4" />
          Sugerencias de compra
          {suggestions.sugerencias.length > 0 && (
            <span className="ml-1 bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {suggestions.sugerencias.length}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── PESTAÑA HISTORIAL ── */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      {activeTab === "historial" && (<>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total",        value: kpiTotal,                         color: "text-slate-700" },
          { label: "Borradores",   value: kpiBorradores,                    color: "text-amber-600" },
          { label: "Confirmados",  value: kpiConfirmados,                   color: "text-emerald-600" },
          { label: "CBM total",    value: `${kpiCbm.toFixed(1)} m³`,        color: "text-slate-700" },
          { label: "EUR previsto", value: formatEur(kpiEurTotal), color: "text-blue-700" },
          { label: "ETA ≤30d",     value: kpiProxEta,                       color: "text-violet-600" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{k.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {/* Estado */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Estado</label>
          <select
            value={ordersList.filterEstado}
            onChange={(e) => ordersList.setFilterEstado(e.target.value as EstadoFiltro)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="confirmado">Confirmado</option>
            <option value="cancelado">Cancelado</option>
            <option value="recibido">Recibido</option>
          </select>
        </div>


        {/* Búsqueda */}
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Buscar</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={ordersList.filterQ}
              onChange={(e) => ordersList.setFilterQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ordersList.refresh()}
              placeholder="Nº orden, agente, SKU o producto…"
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {[
          ["Creada desde", ordersList.filterCreatedFrom, ordersList.setFilterCreatedFrom],
          ["Creada hasta", ordersList.filterCreatedTo, ordersList.setFilterCreatedTo],
          ["ETD desde", ordersList.filterEtdFrom, ordersList.setFilterEtdFrom],
          ["ETD hasta", ordersList.filterEtdTo, ordersList.setFilterEtdTo],
          ["ETA desde", ordersList.filterEtaFrom, ordersList.setFilterEtaFrom],
          ["ETA hasta", ordersList.filterEtaTo, ordersList.setFilterEtaTo],
        ].map(([label, value, setter]) => (
          <div key={String(label)} className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">
              {String(label)}
            </label>
            <input
              type="date"
              value={String(value)}
              onChange={(e) => (setter as (next: string) => void)(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}

        <button
          onClick={ordersList.refresh}
          disabled={ordersList.loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition self-end"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${ordersList.loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* ── Tabla ── */}
      {ordersList.loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : ordersList.error ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {ordersList.error}
        </div>
      ) : ordersList.ordenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-20 text-center text-slate-400">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay órdenes con los filtros actuales.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <ResponsiveTable
            desktop={
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Nº Orden</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Estado</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Logistica vinculada</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tipo envio</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fecha</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Puerto FOB</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Destino</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">ETA</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">CBM</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Coste proveedor</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ordersList.ordenes.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-mono font-semibold text-slate-800 text-[13px]">{o.numero_orden}</p>
                          {o.numero_pedido_agente && (
                            <p className="text-[11px] text-slate-400">{o.numero_pedido_agente}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <EstadoBadge estado={o.estado} />
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <OrderLogisticsSummary orden={o} locale={locale} compact />
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 text-xs">
                          {tipoEnvioLabel(o.tipo_envio)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap text-xs">
                          {fmtDate(o.fecha_orden)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 text-xs">
                          {o.fob_puerto ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 text-xs">
                          {o.destino ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs whitespace-nowrap">
                          {o.eta ? (
                            <span className={etaTextClass(o.eta, hoy)}>{fmtDate(o.eta)}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700 text-xs font-medium tabular-nums">
                          {Number(o.cbm_total).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                          <CosteProveedorCell orden={o} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <OrdenAcciones
                            orden={o}
                            locale={locale}
                            onEditDraft={() => { setEditOrden(o); setReadonlyOrden(null); setShowForm(true); }}
                            onConfirm={() => setConfirmOrden(o)}
                            onView={() => { setReadonlyOrden(o); setEditOrden(null); setShowForm(true); }}
                            onCreateContainer={() => setContainerOrden(o)}
                            onReopen={() => setReopenOrden(o)}
                            onProformaUploaded={() => {
                              showToast("Proforma subida correctamente.");
                              ordersList.refresh();
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
            mobile={
              <div className="space-y-3 p-4">
                {ordersList.ordenes.map((o) => (
                  <OrdenMobileCard
                    key={o.id}
                    orden={o}
                    locale={locale}
                    hoy={hoy}
                    fmtDate={fmtDate}
                    onEditDraft={() => { setEditOrden(o); setReadonlyOrden(null); setShowForm(true); }}
                    onConfirm={() => setConfirmOrden(o)}
                    onView={() => { setReadonlyOrden(o); setEditOrden(null); setShowForm(true); }}
                    onCreateContainer={() => setContainerOrden(o)}
                    onReopen={() => setReopenOrden(o)}
                    onProformaUploaded={() => {
                      showToast("Proforma subida correctamente.");
                      ordersList.refresh();
                    }}
                  />
                ))}
              </div>
            }
          />

          {/* Pie de tabla */}
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400">
            {ordersList.ordenes.length} orden{ordersList.ordenes.length !== 1 ? "es" : ""}
            {ordersList.filterEstado !== "ALL"
              || ordersList.filterQ
              || ordersList.filterCreatedFrom
              || ordersList.filterCreatedTo
              || ordersList.filterEtdFrom
              || ordersList.filterEtdTo
              || ordersList.filterEtaFrom
              || ordersList.filterEtaTo
              ? " (filtrado)"
              : ""}
          </div>
        </div>
      )}

      {/* Cierre del bloque historial */}
      </>)}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── PESTAÑA SUGERENCIAS ── */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      {activeTab === "sugerencias" && (
        <div className="space-y-4">

          {/* ── Cabecera sugerencias ── */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600">
                Optimice contenedores de 65 m³ con los grupos sugeridos y cree un borrador de orden.
                La lista individual es solo referencia; la acción principal es <strong>Crear borrador desde grupo</strong>.
              </p>
            </div>
            <button
              onClick={() => suggestions.refresh()}
              disabled={suggestions.loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${suggestions.loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>

          {/* ── Estado de carga ── */}
          {suggestions.loading && (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Cargando sugerencias…
            </div>
          )}

          {suggestions.error && !suggestions.loading && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3 border border-red-100">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {suggestions.error}
            </div>
          )}

          {/* ── Empty state ── */}
          {!suggestions.loading && !suggestions.error && suggestions.loaded && suggestions.sugerencias.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No hay sugerencias de compra en este momento.</p>
              <p className="text-xs mt-1">Todos los productos tienen cobertura suficiente.</p>
            </div>
          )}

          {/* ── Grupos de contenedor (planner) ── */}
          {!suggestions.loading && suggestions.containerGroups.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Grupos sugeridos para optimizar contenedor ({suggestions.containerGroups.length})
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {suggestions.containerGroups.map((g) => (
                  <ContainerOptimizationCard
                    key={g.groupId}
                    group={g}
                    onAddGroupToBasket={(grp) => {
                      basket.addMany(containerGroupToBasketItems(grp));
                      showToast(`Grupo añadido al borrador (${grp.totalProducts} productos)`);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Tabla de sugerencias ── */}
          {!suggestions.loading && suggestions.sugerencias.length > 0 && (() => {
            const sugerencias    = suggestions.sugerencias;
            const esFuentePlanner = sugerencias.some((s) => s.fuente === "planner");

            return (
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Indicador de fuente */}
                {esFuentePlanner && (
                  <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-[11px] text-blue-700">
                    <TrendingDown className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Fuente: <strong>Planner anual</strong> — reposición calculada por el forecast de demanda</span>
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Producto</th>
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Proveedor / Agente</th>
                      <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Estado</th>
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Stock</th>
                      {esFuentePlanner ? (
                        <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Fecha pedido / ETA</th>
                      ) : (
                        <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Cobertura</th>
                      )}
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Unid. sugeridas</th>
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                        {esFuentePlanner ? "CBM / Peso" : "CBM total"}
                      </th>
                      {!esFuentePlanner && (
                        <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Lead time</th>
                      )}
                      <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sugerencias.map((s) => (
                      <tr key={s.producto_id} className="hover:bg-slate-50/70 transition-colors">

                        {/* ── Producto ── */}
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-800 text-xs leading-snug">{s.nombre}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] text-slate-400 font-mono">{s.sku}</span>
                            {s.consolidation_eligible && (
                              <span title="Consolidable en contenedor compartido"
                                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            )}
                          </div>
                        </td>

                        {/* ── Proveedor / Agente ── */}
                        <td className="px-4 py-2.5">
                          <div className="text-xs text-slate-600">{s.proveedor_nombre ?? "—"}</div>
                          {s.agente_nombre && (
                            <div className="text-[11px] text-slate-400">{s.agente_nombre}</div>
                          )}
                          {/* Puerto de origen: usar nombre resuelto (nunca UUID) */}
                          {(s.origin_port_name ?? s.puerto_preferido) && (
                            <div className="text-[11px] text-slate-400">
                              {s.origin_port_name ?? s.puerto_preferido}
                            </div>
                          )}
                        </td>

                        {/* ── Estado (riesgo + timing) ── */}
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {s.riesgo === "critico" ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">
                                Crítico
                              </span>
                            ) : s.riesgo === "bajo" ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600">
                                Bajo
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                            {s.order_timing_status === "OVERDUE" && (
                              <span className="text-[10px] text-red-500 font-medium">
                                {s.days_late && s.days_late > 0 ? `+${s.days_late}d vencido` : "Vencido"}
                              </span>
                            )}
                            {s.order_timing_status === "DUE_NOW" && (
                              <span className="text-[10px] text-amber-500 font-medium">Pedir ya</span>
                            )}
                          </div>
                        </td>

                        {/* ── Stock ── */}
                        <td className="px-4 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                          <div>{s.stock_actual.toLocaleString("es-ES")}</div>
                          {(s.stock_fba > 0 || s.stock_fbm > 0) && (
                            <div className="text-[10px] text-slate-400">
                              FBA {s.stock_fba} / FBM {s.stock_fbm}
                            </div>
                          )}
                        </td>

                        {/* ── Fecha pedido / ETA (planner) o Cobertura (stock) ── */}
                        {esFuentePlanner ? (
                          <td className="px-4 py-2.5">
                            <div className="text-xs text-slate-700">
                              {s.recommended_order_date
                                ? <span className="font-mono">{s.recommended_order_date}</span>
                                : <span className="text-slate-300">—</span>
                              }
                            </div>
                            {s.estimated_arrival_date && (
                              <div className="text-[11px] text-slate-400 font-mono">
                                ETA {s.estimated_arrival_date}
                              </div>
                            )}
                          </td>
                        ) : (
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {s.dias_cobertura !== null ? (
                              <span className={`text-xs font-semibold ${
                                s.dias_cobertura <= 0  ? "text-red-600" :
                                s.dias_cobertura <= 14 ? "text-red-500" :
                                s.dias_cobertura <= 30 ? "text-amber-500" :
                                "text-emerald-600"
                              }`}>
                                {s.dias_cobertura}d
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        )}

                        {/* ── Unidades sugeridas ── */}
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-slate-800 tabular-nums">
                          {s.unidades_sugeridas.toLocaleString("es-ES")}
                        </td>

                        {/* ── CBM / Peso ── */}
                        <td className="px-4 py-2.5 text-right text-xs text-slate-600 tabular-nums">
                          <div>{s.cbm_total_sugerido.toFixed(2)} m³</div>
                          {esFuentePlanner && s.peso_kg_total != null && (
                            <div className="text-[11px] text-slate-400">{s.peso_kg_total.toFixed(1)} kg</div>
                          )}
                        </td>

                        {/* ── Lead time (solo fuente stock) ── */}
                        {!esFuentePlanner && (
                          <td className="px-4 py-2.5 text-right text-xs text-slate-600 tabular-nums">
                            {s.lead_time_total > 0 ? `${s.lead_time_total}d` : "—"}
                          </td>
                        )}

                        {/* ── Acción ── */}
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => handleAnadirAOrden([s])}
                            title="Añadir solo este producto a un borrador manual"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium transition"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Añadir manual
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    {sugerencias.length} producto{sugerencias.length !== 1 ? "s" : ""} con necesidad de reposición
                  </span>
                  <span className={esFuentePlanner ? "text-blue-500" : "text-slate-400"}>
                    {esFuentePlanner ? "Planner anual" : "Stock de seguridad"}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── MODAL FORMULARIO (crear / editar / ver) ── */}
      {showForm && (
        <OrderFormModal
          initialOrden={
            (editOrden ?? readonlyOrden) as Parameters<typeof OrderFormModal>[0]["initialOrden"]
          }
          initialItems={modalItems}
          onClose={() => {
            setShowForm(false);
            setEditOrden(null);
            setReadonlyOrden(null);
            setModalItems(undefined);
            clearOrderIdFromUrl();
          }}
          onSaved={(orden) => {
            if (orden?.id) {
              ordersList.patchOrder(orden as Partial<OrderListRow> & { id: string });
            }
            setShowForm(false);
            setEditOrden(null);
            setReadonlyOrden(null);
            setModalItems(undefined);
            clearOrderIdFromUrl();
            showToast("Orden guardada correctamente.");
            ordersList.refresh();
          }}
        />
      )}

      {/* ── MODAL CONFIRMAR ── */}
      {confirmOrden && (
        <ConfirmOrderModal
          orden={confirmOrden}
          onClose={() => setConfirmOrden(null)}
          onOrderRefreshed={(orden) => {
            ordersList.patchOrder({
              ...(orden as Partial<OrderListRow>),
              id: orden.id,
            });
            ordersList.refresh();
          }}
          onConfirmed={({ orden, warnings }) => {
            ordersList.patchOrder({
              ...(orden as Partial<OrderListRow>),
              id: orden.id,
            });
            setConfirmOrden(null);
            showToast(
              warnings.length > 0
                ? "La orden se confirmó, pero quedó pendiente completar una operación secundaria."
                : `Orden ${confirmOrden.numero_orden} confirmada.`,
            );
            ordersList.refresh();
          }}
        />
      )}

      {/* ── MODAL REABRIR ── */}
      {reopenOrden && (
        <ReopenModal
          orden={reopenOrden}
          onClose={() => setReopenOrden(null)}
          onReopened={(orden) => {
            ordersList.patchOrder({
              ...orden,
              estado: "borrador" as const,
            });
            setReopenOrden(null);
            showToast(`Orden ${reopenOrden.numero_orden} reabierta a borrador.`);
            ordersList.refresh();
          }}
        />
      )}

      {/* ── MODAL CREAR CONTENEDOR ── */}
      {/* El modal carga sus propios puertos desde /api/logistics/ports (puerto_china + puertos_pais) */}
      <PedidosCreateContainerFlow
        orden={containerOrden}
        onClose={() => setContainerOrden(null)}
        onCreated={(cid) => {
          setContainerOrden(null);
          showToast(`Contenedor creado (ID: ${cid.slice(0, 8)}…).`);
          ordersList.refresh();
        }}
      />

      {/* Basket de borrador (sugerencias) */}
      <OrderDraftBasket
        basket={basket}
        onDraftSaved={() => ordersList.refresh()}
      />
    </div>
  );
}
