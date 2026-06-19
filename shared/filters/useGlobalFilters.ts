// shared/filters/useGlobalFilters.ts

"use client";

import { useContext } from "react";
import { GlobalFiltersContext } from "./GlobalFiltersProvider";

export function useGlobalFilters() {
  const context = useContext(GlobalFiltersContext);

  if (!context) {
    throw new Error(
      "useGlobalFilters debe usarse dentro de GlobalFiltersProvider"
    );
  }

  return context;
}