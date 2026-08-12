// shared/filters/types.ts

export type GlobalFilters = {
    windowDays: number;
    periodFrom?: string | null;
    periodTo?: string | null;
    pais: string;
    canal: string;
  };
  
  export type GlobalFiltersContextValue = GlobalFilters & {
    setWindowDays: (value: number) => void;
    setPais: (value: string) => void;
    setCanal: (value: string) => void;
    resetFilters: () => void;
  };
