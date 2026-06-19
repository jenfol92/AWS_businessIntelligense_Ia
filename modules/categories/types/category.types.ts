/**
 * Tipos de la tabla `categorias` y su configuración dinámica (`campos_config`).
 */

export type CategoryFieldDefinition = {
  key: string;
  tipo: string;
  label: string;
  unidad?: string;
  requerido?: boolean;
  ayuda_ia?: string;
  opciones?: string[];
  placeholder?: string;
  validacion?: {
    min?: number;
    max?: number;
    pattern?: string;
    maxLength?: number;
  };
};

export type CategoryCamposConfig = {
  campos?: CategoryFieldDefinition[];
};

export type CategoryRow = {
  id: string;
  nombre: string;
  descripcion: string | null;
  slug: string | null;
  campos_config: CategoryCamposConfig | null;
  es_activa: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type CategoryListItem = {
  id: string;
  nombre: string;
  descripcion: string | null;
  slug: string | null;
  campos_config: CategoryCamposConfig | null;
};

export type CreateCategoryInput = {
  nombre: string;
  descripcion?: string | null;
  campos_config?: CategoryCamposConfig;
};
