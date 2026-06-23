"use client";

import { useEffect, useRef, useState } from "react";
import { searchOrderProducts } from "@/modules/orders/api/orderClient";
import type { ProductoSearch } from "@/modules/orders/types/orderProductSearch.types";

export type UseOrderProductSearchResult = {
  searchQ:           string;
  setSearchQ:        (q: string) => void;
  searchResults:     ProductoSearch[];
  searchLoading:     boolean;
  showDropdown:      boolean;
  setShowDropdown:   React.Dispatch<React.SetStateAction<boolean>>;
  selectedForAdd:    Set<string>;
  setSelectedForAdd: React.Dispatch<React.SetStateAction<Set<string>>>;
  dropdownRef:       React.RefObject<HTMLDivElement>;
};

/**
 * Gestiona la búsqueda de productos con debounce 300ms para añadir a órdenes.
 * Encapsula: estado de búsqueda, resultados, dropdown y selección múltiple.
 * El componente retiene la lógica de añadir los productos seleccionados a los ítems.
 */
export function useOrderProductSearch(): UseOrderProductSearchResult {
  const [searchQ,        setSearchQ]        = useState("");
  const [searchResults,  setSearchResults]  = useState<ProductoSearch[]>([]);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const [showDropdown,   setShowDropdown]   = useState(false);
  const [selectedForAdd, setSelectedForAdd] = useState<Set<string>>(new Set());

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef   = useRef<HTMLDivElement>(null);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Cerrar dropdown al pulsar Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDropdown(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Búsqueda con debounce 300ms
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!searchQ.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      setSelectedForAdd(new Set());
      return;
    }
    setSearchLoading(true);
    setSelectedForAdd(new Set());
    searchTimeout.current = setTimeout(async () => {
      try {
        const rows = await searchOrderProducts(searchQ);
        setSearchResults(rows);
        setShowDropdown(true);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, [searchQ]);

  return {
    searchQ,
    setSearchQ,
    searchResults,
    searchLoading,
    showDropdown,
    setShowDropdown,
    selectedForAdd,
    setSelectedForAdd,
    dropdownRef,
  };
}
