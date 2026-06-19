// shared/filters/GlobalFiltersProvider.tsx

"use client";

import { createContext, useMemo, useState } from "react";
import type { GlobalFiltersContextValue } from "./types";

export const GlobalFiltersContext =
  createContext<GlobalFiltersContextValue | null>(null);

export function GlobalFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [windowDays, setWindowDays] = useState(30);
  const [pais, setPais] = useState("ALL");
  const [canal, setCanal] = useState("ALL");

  const value = useMemo(
    () => ({
      windowDays,
      pais,
      canal,
      setWindowDays,
      setPais,
      setCanal,
      resetFilters: () => {
        setWindowDays(30);
        setPais("ALL");
        setCanal("ALL");
      },
    }),
    [windowDays, pais, canal]
  );

  return (
    <GlobalFiltersContext.Provider value={value}>
      {children}
    </GlobalFiltersContext.Provider>
  );
}