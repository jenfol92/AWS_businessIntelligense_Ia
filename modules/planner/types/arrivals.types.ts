export type ArrivalDateSource =
  | "container_eta"
  | "order_eta"
  | "estimated_from_etd"
  | "estimated_from_order_date"
  | "supplier_lead_time"
  | "unknown";

export type ArrivalOrderStatus =
  | "borrador"
  | "preparando"
  | "en_puerto_salida"
  | "en_transito"
  | "en_puerto_destino"
  | "entregado"
  | "confirmado"
  | "pendiente_eta";

export type ArrivalProductLine = {
  label: string;
  quantity: number | null;
};

export type ArrivalOrder = {
  orderId: string;
  numeroOrden: string | null;
  numeroPedidoAgente: string | null;
  displayCode: string;
  productSummary: string;
  productLines: ArrivalProductLine[];
  destination: string | null;
  destinationBadge: string;
  destinationCountry: string | null;
  destinationChannel: string | null;
  etaVisible: string;
  estimatedMonthDate: string | null;
  hasDefinedEta: boolean;
  dateLabel: string;
  dateSource: ArrivalDateSource;
  status: ArrivalOrderStatus;
  isDelivered: boolean;
  isDelayed: boolean;
  containerId: string | null;
  containerNumber: string | null;
  logisticsUrl: string | null;
  /** 0 si el contenedor aparece sin orden vinculada. */
  ordenesCount?: number;
};

export type ArrivalMonth = {
  month: string;
  label: string;
  total: number;
  confirmedEtaOrders: ArrivalOrder[];
  estimatedOrders: ArrivalOrder[];
  pendingDateOrders: ArrivalOrder[];
};

export type ArrivalsTimelineSummary = {
  totalOrders: number;
  byDestination: Record<string, number>;
  byMonth: Array<{ month: string; total: number }>;
};

export type ArrivalsTimelineResponse = {
  ok: true;
  summary: ArrivalsTimelineSummary;
  months: ArrivalMonth[];
};

export type ArrivalsTimelineParams = {
  fromMonth?: string | null;
  months?: number | null;
  status?: string | null;
  destination?: string | null;
};

export const ARRIVAL_LOGISTIC_STATUS_OPTIONS: Array<{
  value: ArrivalOrderStatus | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Todos" },
  { value: "borrador", label: "Borrador" },
  { value: "preparando", label: "Preparando" },
  { value: "en_puerto_salida", label: "En puerto salida" },
  { value: "en_transito", label: "En tránsito" },
  { value: "en_puerto_destino", label: "En puerto destino" },
  { value: "entregado", label: "Entregado" },
];
