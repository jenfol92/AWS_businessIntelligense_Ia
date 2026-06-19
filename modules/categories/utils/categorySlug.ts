/** Genera slug URL-safe desde el nombre de categoría. */
export function slugifyCategoryName(nombre: string): string {
  const slug = nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return slug || "categoria";
}
