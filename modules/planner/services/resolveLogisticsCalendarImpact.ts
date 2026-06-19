import type { LogisticsCalendarRawRow } from "@/modules/planning/types/calendar.types";
import { addUtcDays } from "./simulateDailyReplenishment";

export type LogisticsCalendarEventInput = {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  impactDays: number;
  affectsProduction: boolean;
  affectsTransport: boolean;
  country?: string | null;
};

export type CalendarImpact = {
  delayDays: number;
  etaFinal: string;
  events: Array<{
    name: string;
    type: string;
    startDate: string;
    endDate: string;
    impactDays: number;
    affectsProduction: boolean;
    affectsTransport: boolean;
  }>;
  warnings: string[];
};

export function datesOverlap(
  rangeStart: string,
  rangeEnd: string,
  eventStart: string,
  eventEnd: string,
): boolean {
  return rangeStart.slice(0, 10) <= eventEnd.slice(0, 10) &&
    eventStart.slice(0, 10) <= rangeEnd.slice(0, 10);
}

function businessWarningForEvent(event: LogisticsCalendarEventInput): string {
  if (event.type === "chinese_new_year") {
    return `Año Nuevo Chino afecta producción/transporte: +${event.impactDays} días. Conviene adelantar pedido.`;
  }
  if (event.type === "golden_week") {
    return `Golden Week afecta producción/transporte: +${event.impactDays} días. Conviene adelantar pedido.`;
  }
  return `${event.name} afecta la logística: +${event.impactDays} días. Conviene adelantar pedido.`;
}

export function mapLogisticsCalendarRow(
  row: LogisticsCalendarRawRow,
): LogisticsCalendarEventInput {
  return {
    name: row.nombre,
    type: row.tipo,
    startDate: row.fecha_inicio,
    endDate: row.fecha_fin,
    impactDays: Math.max(0, row.impacto_dias ?? 0),
    affectsProduction: row.afecta_produccion === true,
    affectsTransport: row.afecta_transporte === true,
    country: row.pais,
  };
}

/**
 * Calcula retraso por calendario logístico entre orderDate y ETA base.
 * Recalcula una segunda vez si la nueva ETA entra en otro evento.
 */
export function resolveLogisticsCalendarImpact(params: {
  orderDate: string;
  productionDays: number;
  transitDays: number;
  customsDays: number;
  events: LogisticsCalendarEventInput[];
  originCountry?: string;
}): CalendarImpact {
  const originCountry = params.originCountry ?? "CN";
  const relevantEvents = params.events.filter(
    (event) =>
      event.impactDays > 0 &&
      (!event.country || event.country === originCountry),
  );

  const matchedEvents: CalendarImpact["events"] = [];
  const warnings: string[] = [];
  let totalDelay = 0;

  for (let pass = 0; pass < 2; pass += 1) {
    let passDelay = 0;
    const productionEnd = addUtcDays(
      params.orderDate,
      params.productionDays + totalDelay,
    );
    const transportStart = productionEnd;
    const transportEnd = addUtcDays(
      params.orderDate,
      params.productionDays + params.transitDays + totalDelay,
    );
    const etaBase = addUtcDays(
      params.orderDate,
      params.productionDays +
        params.transitDays +
        params.customsDays +
        totalDelay,
    );

    for (const event of relevantEvents) {
      if (!datesOverlap(params.orderDate, etaBase, event.startDate, event.endDate)) {
        continue;
      }

      const affectsProduction =
        event.affectsProduction &&
        datesOverlap(
          params.orderDate,
          productionEnd,
          event.startDate,
          event.endDate,
        );
      const affectsTransport =
        event.affectsTransport &&
        datesOverlap(
          transportStart,
          transportEnd,
          event.startDate,
          event.endDate,
        );

      if (!affectsProduction && !affectsTransport) continue;

      passDelay += event.impactDays;

      const alreadyMatched = matchedEvents.some(
        (m) => m.type === event.type && m.startDate === event.startDate,
      );
      if (!alreadyMatched) {
        matchedEvents.push({
          name: event.name,
          type: event.type,
          startDate: event.startDate,
          endDate: event.endDate,
          impactDays: event.impactDays,
          affectsProduction: event.affectsProduction,
          affectsTransport: event.affectsTransport,
        });
        const warning = businessWarningForEvent(event);
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }

    totalDelay += passDelay;
    if (passDelay === 0) break;
  }

  const etaFinal = addUtcDays(
    params.orderDate,
    params.productionDays +
      params.transitDays +
      params.customsDays +
      totalDelay,
  );

  return {
    delayDays: totalDelay,
    etaFinal,
    events: matchedEvents,
    warnings,
  };
}
