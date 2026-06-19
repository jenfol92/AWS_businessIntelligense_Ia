/**
 * Repositorio de categorías (`categorias`).
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  CategoryCamposConfig,
  CategoryListItem,
  CategoryRow,
  CreateCategoryInput,
} from "../types/category.types";
import { slugifyCategoryName } from "../utils/categorySlug";

const LIST_SELECT =
  "id, nombre, descripcion, slug, campos_config, es_activa, created_at, updated_at";

function mapRow(raw: Record<string, unknown>): CategoryRow {
  return {
    id: String(raw.id),
    nombre: String(raw.nombre ?? ""),
    descripcion: (raw.descripcion as string | null) ?? null,
    slug: (raw.slug as string | null) ?? null,
    campos_config: (raw.campos_config as CategoryCamposConfig | null) ?? null,
    es_activa: raw.es_activa !== false,
    created_at: (raw.created_at as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

function toListItem(row: CategoryRow): CategoryListItem {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    slug: row.slug,
    campos_config: row.campos_config,
  };
}

/** Categorías activas para selects y formularios. */
export async function listActiveCategories(): Promise<CategoryListItem[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("categorias")
    .select(LIST_SELECT)
    .eq("es_activa", true)
    .order("nombre", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) =>
    toListItem(mapRow(r as Record<string, unknown>)),
  );
}

async function findDuplicateCategory(
  nombre: string,
  slug: string,
): Promise<CategoryRow | null> {
  const supabase = createSupabaseRouteClient();

  const { data: bySlug, error: slugError } = await supabase
    .from("categorias")
    .select(LIST_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (slugError) throw new Error(slugError.message);
  if (bySlug) return mapRow(bySlug as Record<string, unknown>);

  const { data: byName, error: nameError } = await supabase
    .from("categorias")
    .select(LIST_SELECT)
    .ilike("nombre", nombre)
    .maybeSingle();

  if (nameError) throw new Error(nameError.message);
  if (byName) return mapRow(byName as Record<string, unknown>);

  return null;
}

/** Crea categoría con slug único y activa por defecto. */
export async function createCategory(
  input: CreateCategoryInput,
): Promise<CategoryListItem> {
  const nombre = input.nombre.trim();
  if (!nombre) {
    throw new Error("El nombre de la categoría es obligatorio.");
  }

  const slug = slugifyCategoryName(nombre);
  const dup = await findDuplicateCategory(nombre, slug);
  if (dup) {
    throw new Error(
      `Ya existe una categoría con el nombre «${dup.nombre}» o slug «${dup.slug}».`,
    );
  }

  const campos_config: CategoryCamposConfig =
    input.campos_config ?? { campos: [] };

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("categorias")
    .insert({
      nombre,
      descripcion: input.descripcion?.trim() || null,
      slug,
      campos_config,
      es_activa: true,
    })
    .select(LIST_SELECT)
    .single();

  if (error) throw new Error(error.message);

  return toListItem(mapRow(data as Record<string, unknown>));
}
