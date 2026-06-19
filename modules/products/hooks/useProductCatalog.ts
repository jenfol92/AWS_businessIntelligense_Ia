// modules/products/hooks/useProductCatalog.ts

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchProductCatalog,
  fetchProductCatalogOptions,
} from "../services/productCatalogClient";
import { PRODUCT_CATALOG_DEFAULT_LIMIT } from "../constants";
import type {
  ProductCatalogFilterOptions,
  ProductCatalogItem,
} from "../types/catalog.types";

const EMPTY_OPTIONS: ProductCatalogFilterOptions = {
  agentes: [],
  puertos: [],
  categorias: [],
  estados: [],
};

export function useProductCatalog() {
  const [rows, setRows] = useState<ProductCatalogItem[]>([]);
  const [search, setSearch] = useState("");

  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedPorts, setSelectedPorts] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const [options, setOptions] =
    useState<ProductCatalogFilterOptions>(EMPTY_OPTIONS);

  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      setLoadingOptions(true);
      const data = await fetchProductCatalogOptions();
      setOptions(data.options);
    } catch {
      setOptions(EMPTY_OPTIONS);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchProductCatalog({
        q: search,
        limit: PRODUCT_CATALOG_DEFAULT_LIMIT,
        offset: 0,
        agenteIds: selectedAgentIds,
        puertos: selectedPorts,
        categorias: selectedCategories,
        estados: selectedStates,
      });

      setRows(data.rows);
      setShowAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando catálogo");
    } finally {
      setLoading(false);
    }
  }, [
    search,
    selectedAgentIds,
    selectedPorts,
    selectedCategories,
    selectedStates,
  ]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadCatalog();
    }, 300);

    return () => clearTimeout(timeout);
  }, [loadCatalog]);

  return {
    rows,
    visibleRows: showAll ? rows : rows.slice(0, 12),
    hasHiddenRows: rows.length > 12,
    showAll,
    setShowAll,

    search,
    setSearch,

    selectedAgentIds,
    setSelectedAgentIds,
    selectedPorts,
    setSelectedPorts,
    selectedStates,
    setSelectedStates,
    selectedCategories,
    setSelectedCategories,

    options,
    loadingOptions,

    loading,
    error,
    reload: loadCatalog,
  };
}