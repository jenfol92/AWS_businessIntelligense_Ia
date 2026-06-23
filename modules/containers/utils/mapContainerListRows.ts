function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function resolveContainerAgentLabel(ordenes: Record<string, unknown>[]): string | null {
  if (ordenes.length === 0) return null;

  const contacts = Array.from(
    new Set(
      ordenes
        .map((orden) => {
          const agente = firstRelation(
            orden["agentes_compra"] as { contacto?: string | null } | Array<{ contacto?: string | null }> | null,
          );
          return agente?.contacto?.trim() || null;
        })
        .filter((contacto): contacto is string => Boolean(contacto)),
    ),
  );

  if (contacts.length === 0) return null;
  if (contacts.length > 1) return "Varios agentes";
  return contacts[0];
}

type ContainerOrderLink = {
  contenedor_id: string;
  orden_id: string;
  ordenes_compra: Record<string, unknown> | Record<string, unknown>[] | null;
};

type ContainerOrderSearchItem = {
  orden_id: string;
  productos: Record<string, unknown> | Record<string, unknown>[] | null;
  proveedores: Record<string, unknown> | Record<string, unknown>[] | null;
};

export function mapContainerListRows(
  contenedores: Record<string, unknown>[],
  links: ContainerOrderLink[],
  searchItems: ContainerOrderSearchItem[] = [],
): Record<string, unknown>[] {
  const ordenesMap: Record<string, Record<string, unknown>[]> = {};
  const linkCountMap: Record<string, number> = {};
  const searchItemsByOrder: Record<string, Record<string, unknown>[]> = {};

  for (const item of searchItems) {
    const product = firstRelation(item.productos);
    const supplier = firstRelation(item.proveedores);
    const row = {
      sku: product?.["sku"] ?? null,
      nombre: product?.["nombre"] ?? null,
      proveedor_nombre: supplier?.["nombre"] ?? null,
    };
    if (!searchItemsByOrder[item.orden_id]) searchItemsByOrder[item.orden_id] = [];
    searchItemsByOrder[item.orden_id].push(row);
  }

  for (const link of links) {
    const cid = link.contenedor_id;
    linkCountMap[cid] = (linkCountMap[cid] ?? 0) + 1;
    if (!ordenesMap[cid]) ordenesMap[cid] = [];

    const joined = firstRelation(link.ordenes_compra);
    if (joined) {
      ordenesMap[cid].push(joined);
    } else if (link.orden_id) {
      ordenesMap[cid].push({
        id: link.orden_id,
        numero_orden: null,
        numero_pedido_agente: null,
        agente_id: null,
        destino: null,
        coste_total_eur: 0,
        cbm_total: 0,
      });
    }
  }

  return contenedores.map((c) => {
    const cid = c["id"] as string;
    const ordenes = ordenesMap[cid] ?? [];
    const ordenesCount = linkCountMap[cid] ?? ordenes.length;
    const coste_total_eur = ordenes.reduce((s, o) => s + Number(o["coste_total_eur"] ?? 0), 0);
    const cbm_total = ordenes.reduce((s, o) => s + Number(o["cbm_total"] ?? 0), 0);
    const primera = ordenes[0];
    const agente_contacto = resolveContainerAgentLabel(ordenes);

    return {
      ...c,
      puerto_salida:  c["puerto_salida"]  ?? primera?.["fob_puerto"] ?? null,
      puerto_llegada: c["puerto_llegada"] ?? primera?.["destino"]    ?? null,
      coste_total_eur,
      cbm_total,
      ordenes_count: ordenesCount,
      agente_contacto,
      ordenes: ordenes.map((o) => ({
        id:              o["id"],
        numero_orden:    o["numero_orden"],
        numero_pedido_agente: o["numero_pedido_agente"] ?? null,
        agente_id:       o["agente_id"],
        agente_contacto: resolveContainerAgentLabel([o]),
        destino:         o["destino"] ?? null,
        coste_total_eur: Number(o["coste_total_eur"] ?? 0),
        cbm_total:       Number(o["cbm_total"]       ?? 0),
        items:           searchItemsByOrder[String(o["id"])] ?? [],
      })),
    };
  });
}
