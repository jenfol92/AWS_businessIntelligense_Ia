export async function readJsonSafe<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();

  if (!text || text.trim() === "") {
    throw new Error(`La API devolvió una respuesta vacía. Status: ${res.status}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `La API no devolvió JSON válido. Status: ${res.status}. Respuesta: ${text.slice(0, 500)}`,
    );
  }
}
