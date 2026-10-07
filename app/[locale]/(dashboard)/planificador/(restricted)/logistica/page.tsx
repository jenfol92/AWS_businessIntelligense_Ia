// app/[locale]/(dashboard)/planificador/logistica/page.tsx

"use client";

import { useLogisticsCalendar } from "@/modules/planning/hooks/useLogisticsCalendar";
import {
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Metric,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Title,
} from "@tremor/react";
import {
  AlertCircle,
  CalendarDays,
  Package,
  RefreshCw,
  Route,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";
import type { LogisticsCalendarEvent } from "@/modules/planning/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function CalendarEventMobileCard({ row }: { row: LogisticsCalendarEvent }) {
  return (
    <ResponsiveDataCard
      title={row.nombre ?? "—"}
      subtitle={row.tipo ?? "—"}
      badges={
        <>
          {row.afectaProduccion ? (
            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Producción
            </span>
          ) : null}
          {row.afectaTransporte ? (
            <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              Transporte
            </span>
          ) : null}
        </>
      }
      fields={[
        { label: "Inicio", value: formatDate(row.fechaInicio) },
        { label: "Fin", value: formatDate(row.fechaFin) },
        { label: "Impacto (días)", value: row.impactoDias ?? "—" },
        { label: "País", value: row.pais ?? "—" },
      ]}
      footer={row.descripcion ?? undefined}
    />
  );
}

function buildYearOptions(centerYear: number): number[] {
  const span = 5;
  return Array.from(
    { length: span * 2 + 1 },
    (_, i) => centerYear - span + i
  );
}

export default function LogisticaPlanificadorPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { events, loading, error, reload } = useLogisticsCalendar({ year });

  const yearOptions = useMemo(
    () => buildYearOptions(new Date().getFullYear()),
    []
  );

  const { totalEvents, productionCount, transportCount, totalImpactDays } =
    useMemo(() => {
      let productionCount = 0;
      let transportCount = 0;
      let totalImpactDays = 0;

      for (const e of events) {
        if (e.afectaProduccion) productionCount += 1;
        if (e.afectaTransporte) transportCount += 1;
        totalImpactDays += e.impactoDias ?? 0;
      }

      return {
        totalEvents: events.length,
        productionCount,
        transportCount,
        totalImpactDays,
      };
    }, [events]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Title>Calendario logístico</Title>
          <Text className="mt-1">
            Eventos que condicionan producción y transporte por año.
          </Text>
        </div>

        <Flex className="w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <div className="w-full min-w-[12rem] sm:w-44">
            <Text className="mb-1 text-tremor-content">Año</Text>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(Number(v))}
              placeholder="Año"
              disabled={loading}
            >
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {String(y)}
                </SelectItem>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => void reload()}
            loading={loading}
            className="shrink-0"
          >
            Actualizar
          </Button>
        </Flex>
      </div>

      {error ? (
        <Callout
          title="No se pudo cargar el calendario"
          icon={AlertCircle}
          color="rose"
        >
          {error}
        </Callout>
      ) : null}

      <Grid numItems={1} numItemsSm={2} numItemsLg={4} className="gap-4">
        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-slate-100 p-2 dark:bg-dark-tremor-background-subtle">
              <CalendarDays className="h-5 w-5 text-slate-600 dark:text-dark-tremor-content" />
            </div>
            <div>
              <Text>Total eventos</Text>
              <Metric className="mt-1">
                {loading ? "—" : totalEvents}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-amber-50 p-2 dark:bg-amber-950/40">
              <Package className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <Text>Afectan producción</Text>
              <Metric className="mt-1">
                {loading ? "—" : productionCount}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-sky-50 p-2 dark:bg-sky-950/40">
              <Route className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div>
              <Text>Afectan transporte</Text>
              <Metric className="mt-1">
                {loading ? "—" : transportCount}
              </Metric>
            </div>
          </Flex>
        </Card>

        <Card className="ring-1 ring-slate-100">
          <Flex justifyContent="start" className="space-x-3">
            <div className="rounded-tremor-small bg-violet-50 p-2 dark:bg-violet-950/40">
              <CalendarDays className="h-5 w-5 text-violet-700 dark:text-violet-300" />
            </div>
            <div>
              <Text>Impacto total (días)</Text>
              <Metric className="mt-1">
                {loading ? "—" : totalImpactDays}
              </Metric>
            </div>
          </Flex>
        </Card>
      </Grid>

      <Card className="overflow-hidden ring-1 ring-slate-100">
        <div className="border-b border-tremor-border px-4 py-3 dark:border-dark-tremor-border">
          <Title className="text-base">Eventos</Title>
          {loading ? (
            <Text className="mt-0.5">Cargando datos…</Text>
          ) : (
            <Text className="mt-0.5">
              {events.length === 0
                ? "No hay eventos para este año."
                : `${events.length} registro${events.length === 1 ? "" : "s"}`}
            </Text>
          )}
        </div>

        {loading ? (
          <div className="p-4">
            <Text>Cargando eventos…</Text>
          </div>
        ) : events.length === 0 ? (
          <div className="p-4">
            <Text>Sin eventos para el año seleccionado.</Text>
          </div>
        ) : (
          <ResponsiveTable
            desktop={
              <div className="overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Nombre</TableHeaderCell>
                      <TableHeaderCell>Tipo</TableHeaderCell>
                      <TableHeaderCell>Inicio</TableHeaderCell>
                      <TableHeaderCell>Fin</TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Impacto días
                      </TableHeaderCell>
                      <TableHeaderCell>País</TableHeaderCell>
                      <TableHeaderCell>Prod.</TableHeaderCell>
                      <TableHeaderCell>Transp.</TableHeaderCell>
                      <TableHeaderCell>Descripción</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {events.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-tremor-content-emphasis">
                          {row.nombre ?? "—"}
                        </TableCell>
                        <TableCell>{row.tipo ?? "—"}</TableCell>
                        <TableCell>{formatDate(row.fechaInicio)}</TableCell>
                        <TableCell>{formatDate(row.fechaFin)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.impactoDias ?? "—"}
                        </TableCell>
                        <TableCell>{row.pais ?? "—"}</TableCell>
                        <TableCell>{row.afectaProduccion ? "Sí" : "No"}</TableCell>
                        <TableCell>{row.afectaTransporte ? "Sí" : "No"}</TableCell>
                        <TableCell>
                          <span
                            className="line-clamp-2 max-w-xs text-tremor-content"
                            title={row.descripcion ?? undefined}
                          >
                            {row.descripcion ?? "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            }
            mobile={
              <div className="space-y-3 p-4">
                {events.map((row) => (
                  <CalendarEventMobileCard key={row.id} row={row} />
                ))}
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
