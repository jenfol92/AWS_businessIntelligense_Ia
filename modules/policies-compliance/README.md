# policies-compliance — Módulo de alertas de cumplimiento Amazon SP-API

## Resumen

El módulo contiene un flujo heredado de alertas. En Fase 0 se bloquea la resolución sin evidencia y se incorpora un diagnóstico de Listings Issues. Los issues observados no acreditan cumplimiento legal.

## Fase 0 — diagnóstico read-only

`GET /api/diagnostics/sp-api/listing-issues?productoId=<UUID_ERP>&marketplaceId=<ID_ASIGNADO>`

Solo disponible fuera de producción, con sesión Supabase existente. En una pestaña local autenticada:

```js
const query = new URLSearchParams({ productoId: "<UUID_ERP>", marketplaceId: "<ID_ASIGNADO>" });
const response = await fetch(`/api/diagnostics/sp-api/listing-issues?${query}`, { cache: "no-store" });
console.log(await response.json());
```

Sustituir ambos placeholders por una relación real antes de ejecutar; no hay fallback de marketplace ni SKU.
Lee `productos`, `producto_marketplaces`, `amazon_marketplaces`, `paises` y una muestra acotada del ledger del producto. Usa exclusivamente `external_sku` para consultar Amazon. Reporta discrepancias con el maestro/ledger sin corregirlas. El ASIN devuelto es el configurado: `includedData=issues` no lo verifica (`asinVerifiedByAmazon=false`).

Máximo un GET de Listings por solicitud; sin replay por token expirado ni retry 429 en este diagnóstico. Timeout de 20 segundos mediante el `AbortSignal` existente. No escribe BD, payloads, alertas ni jobs. No devuelve raw, cabeceras ni mensajes de excepción sin filtrar. `amazonResponses` cuenta respuestas observadas, no intentos de red sin respuesta.

`getListingIssues()` vive en el cliente existente. Devuelve `SUCCESS`, `LISTING_NOT_FOUND`, `RATE_LIMITED`, `UNAUTHORIZED`, `QUERY_FAILED`, `INVALID_RESPONSE` o `UNKNOWN`. `checkedAt` en un fallo es fecha del intento, nunca verificación exitosa ni escritura en BD.

Una respuesta con SKU coincidente y array explícito `issues: []` puede ser `SUCCESS`; campo omitido, payload erróneo o issue mal formado es `INVALID_RESPONSE`. Se conservan `code`, `message`, `severity`, `categories`, `attributeNames`, `marketplaceIds` y `enforcements.actions/exemption` cuando están presentes, sin taxonomía ERP.

Contrato: [modelo oficial Listings Items, definiciones Item/ItemIssues/Issue](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json).

La identidad/procedencia de alertas heredadas sigue pendiente de validación: **no se cierra ninguna automáticamente**, ni siquiera ante un array vacío válido. La resolución manual también queda bloqueada; no se modifica el UNIQUE ni se crean migraciones. La ingesta heredada descrita más abajo no constituye una integración validada de Notifications y no se amplía en esta fase. El cron existente no se activa ni se ejecuta.

---

## Estructura de carpetas

```
modules/policies-compliance/
  types/
    policyCompliance.types.ts        ← Tipos canónicos: PolicyAlert, GroupedPolicyAlert, PolicyIssueEvent, etc.
  repositories/
    policyAlertsRepository.ts        ← Acceso a BD (product_policy_alerts); upserts idempotentes
  services/
    policyComplianceService.ts       ← Orquestación: registerAlert, sync, get, resolve
    catalogItemsClient.ts            ← SP-API Catalog Items v2022; enriquece título/imagen/marca
  utils/
    mapNotificationToAlert.ts        ← Mapeo SP-API notification → PolicyAlertInsert
    policyAlertGrouping.ts           ← Agrupación por (asin, sku, category, type) × marketplaces
  tests/
    mapNotificationToAlert.test.mjs
    policyAlertGrouping.test.mjs

app/api/policies/
  alerts/
    route.ts                         ← GET /api/policies/alerts | POST (notification ingestion)
    [asin]/route.ts                  ← GET /api/policies/alerts/:asin
    sync/route.ts                    ← POST /api/policies/alerts/sync (manual trigger)

app/api/cron/
  policies-compliance/route.ts       ← Cron diario (GET + POST)

sql/migrations/
  20260922_03_product_policy_alerts.sql
```

---

## Cómo funciona el módulo

### 1. Ingesta de notificaciones SP-API

Amazon envía notificaciones de tipo:

| Tipo | Descripción |
|---|---|
| `LISTINGS_ITEM_ISSUES` | Problemas detectados en un listado: seguridad, compliance, calidad |
| `LISTINGS_DEFECT_NOTIFICATIONS` | Defecto específico en un campo del listado |
| `LISTINGS_QUALITY_NOTIFICATIONS` | Problema de calidad del listado |

Estas notificaciones llegan a `POST /api/policies/alerts` (con `Authorization: Bearer $CRON_SECRET` desde tu servidor intermediario, o desde una sesión autenticada de usuario).

El endpoint:
1. Llama a `registerAlert(event)`.
2. `registerAlert` llama a `mapNotificationToAlerts(event)` → devuelve un array de `PolicyAlertInsert`.
3. Cada registro se upserta idempotentemente en `product_policy_alerts` usando la clave única `(asin, sku, marketplace_id, category, type)`.

### 2. Consulta de alertas

```
GET /api/policies/alerts          → todas las alertas agrupadas por causalidad
GET /api/policies/alerts/:asin    → alertas de un ASIN concreto
```

La capa de agrupación (`groupPolicyAlerts`) combina todas las instancias de un mismo problema en distintos marketplaces en un único `GroupedPolicyAlert`:

```ts
{
  asin: "B0ABC12345",
  sku: "SKU-001",
  category: "Seguridad de productos y alimentos",
  type: "PRODUCT_SAFETY_ISSUE",
  countries: ["ES", "FR", "IT"],
  marketplaces: ["A1RKKUPIHCS9HS", "A13V1IB3VIYZZH", "APJ6JRA9NG5V4"],
  marketplace_statuses: [
    { country_code: "ES", status: "active", ... },
    { country_code: "FR", status: "resolved", ... },
    { country_code: "IT", status: "active", ... },
  ],
  ...
}
```

La UI solo renderiza esta estructura; nunca calcula agregaciones.

### 3. Contención de la sincronización existente

El cron `/api/cron/policies-compliance` llama a `syncWithAmazon()`:

1. Carga todas las alertas con `still_in_amazon = true`.
2. Para cada alerta, llama a `GET /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...&includedData=issues`.
3. Solo una observación válida con coincidencia positiva actualiza `last_checked_at`; conserva la alerta activa.
4. Ausencia, 404, 429, 401/403, 5xx, red, timeout y payload inválido no cierran ni actualizan esa fecha.
5. Se mantiene la espera preexistente de 500 ms; no es un limitador global. El retry acotado pertenece al cliente SP-API común.
6. `checked` cuenta observaciones correctas, `errors` consultas no correctas y `unconfirmed` ausencias sin identidad validada. `resolved` es cero en Fase 0.

### 4. Enriquecimiento de producto

`fetchAndEnrichCatalogData(asin, marketplaceIds)` llama a `GET /catalog/2022-04-01/items/{asin}` y guarda `product_title`, `product_image_url`, `product_brand` en todas las filas del ASIN. La UI lo usa para la columna de imagen y nombre.

---

## Cómo se integran las notificaciones SP-API

### Opción A: webhook directo (recomendado)

1. Configura un destino de notificaciones SP-API en Seller Central.
2. El endpoint de recepción en tu servidor apunta a `POST /api/policies/alerts`.
3. Incluye `Authorization: Bearer $CRON_SECRET` en la cabecera.

### Opción B: polling manual / ingesta desde reporte

1. Obtén el payload de notificación desde el mecanismo de suscripción SP-API.
2. Llama a `POST /api/policies/alerts` con el cuerpo `{ event: <notification_payload> }`.

---

## Cómo se usa desde la UI

### Listado principal

```ts
// Cliente
const res = await fetch("/api/policies/alerts");
const { data } = await res.json();
// data: GroupedPolicyAlert[]
```

Cada elemento tiene:
- `product_image_url` — imagen del producto
- `product_title` — nombre
- `asin`, `sku`
- `category`, `type` — concepto y motivo
- `countries` — e.g. `["ES", "FR"]`
- `marketplace_statuses` — estado por país (`active | resolved | pending_review`)
- `created_at` — fecha del primer evento

### Por ASIN

```ts
const res = await fetch(`/api/policies/alerts/${asin}`);
```

### Sincronización manual

```ts
await fetch("/api/policies/alerts/sync", { method: "POST" });
```

### Marcar como resuelta (manual)

Bloqueada en Fase 0: `markAsResolved(alertId)` rechaza la operación con `POLICY_RESOLUTION_REQUIRES_AMAZON_EVIDENCE`. No se implementa una ruta de resolución ni un workflow nuevo.

---

## Tabla de base de datos

```sql
product_policy_alerts (
  id              UUID PK,
  asin            VARCHAR(20),
  sku             VARCHAR(50),
  marketplace_id  VARCHAR(20),
  country_code    VARCHAR(5),
  category        TEXT,
  type            TEXT,
  description     TEXT,
  still_in_amazon BOOLEAN,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  product_title   TEXT,
  product_image_url TEXT,
  product_brand   TEXT,
  source_event    JSONB,           -- audit: raw SP-API payload
  UNIQUE(asin, sku, marketplace_id, category, type)
)
```

---

## Guardrails de cumplimiento aplicados

| Guardrail | Aplicación |
|---|---|
| §2.1 Data minimization | Solo almacena campos de alertas; sin PII del cliente |
| §3 Throttling | Delay 500 ms en sync loop; retry bounded a 1 en Catalog Items |
| §4 Credentials | `loadSpApiConfig()` server-side; nunca en cliente |
| §9 Data origin | `source_event` guarda el payload original para auditoría |
| §13 No coercion | Eventos inválidos → `[]`; errores Amazon → no marcar resuelta |
| §18 Idempotency | Upsert sobre `(asin, sku, marketplace_id, category, type)` |
| BFF boundary | Todas las llamadas SP-API permanecen server-side |

---

## Ejecutar tests

```powershell
node --experimental-strip-types --test `
  modules/policies-compliance/tests/mapNotificationToAlert.test.mjs `
  modules/policies-compliance/tests/policyAlertGrouping.test.mjs
```

---

## Cron (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/cron/policies-compliance",
      "schedule": "0 6 * * *"
    }
  ]
}
```

---

## Próximos pasos sugeridos

1. Aplicar la migración SQL en Supabase.
2. Configurar el destino de notificaciones SP-API en Seller Central.
3. Integrar `fetchAndEnrichCatalogData` en el flujo de ingesta (llamar tras `registerAlert`).
4. Implementar `PATCH /api/policies/alerts/:id/resolve` para resolución manual desde UI.
5. Añadir componente React `PoliciesCompliancePage` que consuma `GET /api/policies/alerts`.
