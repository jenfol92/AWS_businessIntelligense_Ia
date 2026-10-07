// shared/filters/GlobalFiltersProvider.tsx

"use client";

import { createContext, useCallback, useMemo, useState } from "react";
import type { GlobalFiltersContextValue, PeriodPreset } from "./types";
import { inclusiveDaysBetween, isIsoDate, localIsoDate } from "./periodDates";

export const GlobalFiltersContext =
  createContext<GlobalFiltersContextValue | null>(null);

const FIXED_WINDOWS: Record<"7" | "30" | "60" | "90", number> = {
  "7": 7,
  "30": 30,
  "60": 60,
  "90": 90,
};

export function GlobalFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [periodPreset, setPeriodPresetState] = useState<PeriodPreset>("30");
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [pais, setPais] = useState("ALL");
  const [canal, setCanal] = useState("ALL");

  const setPeriodPreset = useCallback((value: PeriodPreset) => {
    setPeriodPresetState(value);
    if (value === "custom") {
      // Rango inicial razonable: últimos 30 días hasta hoy.
      const today = localIsoDate();
      setCustomTo((prev) => prev ?? today);
      setCustomFrom((prev) => {
        if (prev) return prev;
        const d = new Date();
        d.setDate(d.getDate() - 29);
        return localIsoDate(d);
      });
    }
  }, []);

  const setCustomPeriod = useCallback((from: string, to: string) => {
    if (!isIsoDate(from) || !isIsoDate(to)) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    setCustomFrom(a);
    setCustomTo(b);
    setPeriodPresetState("custom");
  }, []);

  const setWindowDays = useCallback((value: number) => {
    const key = String(value) as keyof typeof FIXED_WINDOWS;
    setPeriodPresetState(key in FIXED_WINDOWS ? key : "30");
  }, []);

  const value = useMemo<GlobalFiltersContextValue>(() => {
    let windowDays = 30;
    let periodFrom: string | null = null;
    let periodTo: string | null = null;

    if (periodPreset === "today") {
      const today = localIsoDate();
      windowDays = 1;
      periodFrom = today;
      periodTo = today;
    } else if (periodPreset === "custom" && customFrom && customTo) {
      windowDays = inclusiveDaysBetween(customFrom, customTo);
      periodFrom = customFrom;
      periodTo = customTo;
    } else if (periodPreset !== "custom") {
      windowDays = FIXED_WINDOWS[periodPreset];
    }

    return {
      windowDays,
      periodPreset,
      periodFrom,
      periodTo,
      pais,
      canal,
      setWindowDays,
      setPeriodPreset,
      setCustomPeriod,
      setPais,
      setCanal,
      resetFilters: () => {
        setPeriodPresetState("30");
        setCustomFrom(null);
        setCustomTo(null);
        setPais("ALL");
        setCanal("ALL");
      },
    };
  }, [periodPreset, customFrom, customTo, pais, canal, setWindowDays, setPeriodPreset, setCustomPeriod]);

  return (
    <GlobalFiltersContext.Provider value={value}>
      {children}
    </GlobalFiltersContext.Provider>
  );
}
