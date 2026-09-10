export async function planningRequest<T>(url: string, init: RequestInit = {}, timeoutMs = 45_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "No se pudo completar la solicitud financiera.");
      return body as T;
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(init.method === "POST"
          ? "Amazon no ha respondido dentro del tiempo de espera. La sincronización puede seguir en el servidor; no se confirma una actualización."
          : "La lectura de planificación ha superado el tiempo de espera. Se conservan los datos anteriores."));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } finally { clearTimeout(timer); }
}
