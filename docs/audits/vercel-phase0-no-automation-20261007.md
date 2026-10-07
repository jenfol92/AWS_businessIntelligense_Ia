# Fase 0 Vercel: cero programación automática

## Alcance y checkpoint

Preparación local, sin deployment ni ejecución de endpoints. Rama `feature/finance-forecast`, HEAD `b81890ca`. El repositorio contenía 66 archivos tracked con cambios y numerosos untracked, incluidos pipelines anteriores y la política de visibilidad. Se guardó el checkpoint actual, no se comparó únicamente contra HEAD para atribuir cambios.

Evidencias: `outputs/vercel-phase0/{status,branch,head,stat}-before.txt`, copias de los dos archivos editados y hashes de 1.614 archivos preexistentes. Ningún reset, borrado, restore, commit o modificación de variables locales/remotas.

## A–B. vercel.json antes/después y crons retirados

Antes:

```json
{
  "crons": [
    { "path": "/api/cron/amazon/fbm-inventory-snapshot/generate", "schedule": "5 4 * * *" },
    { "path": "/api/cron/amazon/reports/run", "schedule": "0 * * * *" },
    { "path": "/api/cron/amazon-financial-planning", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/amazon-sp-api/reports/fba-sales/import", "schedule": "20 5 * * *" }
  ]
}
```

Después:

```json
{ "crons": [] }
```

| Ruta anterior | Frecuencia UTC | Qué ejecuta | Amazon | Escrituras posibles | Gate antes / ausente |
| --- | --- | --- | --- | --- | --- |
| `/api/cron/amazon/fbm-inventory-snapshot/generate` | Diaria 04:05 | Crea generación mediante owner FBM; la publicación pertenece al recovery | Sí | Jobs; snapshots al completar el flujo | Bearer CRON_SECRET y `AMAZON_FBM_REPORTS_SYNC_ENABLED === "true"`; ausente OFF |
| `/api/cron/amazon/reports/run` | Cada hora | Recovery Ledger/FBM, poll/preview/commit/requestDue legacy, resume ventas FBA | Sí | Jobs, Ledger/snapshots, `inventario_paises` por country commit, ventas FBA según job | Bearer CRON_SECRET; gate legacy antes default ON. Ledger/FBM tienen gates independientes |
| `/api/cron/amazon-financial-planning` | Cada 30 min | Proyección y observaciones financieras | Sí | Locks/runs, proyecciones y observaciones Finance | Bearer CRON_SECRET, sin flag de activación |
| `/api/cron/amazon-sp-api/reports/fba-sales/import` | Diaria 05:20 | Import Fulfilled Shipments, ventana diaria de 3 días mediante coordinador | Sí | Jobs, ventas FBA y capa legacy `ventas_diarias` | Bearer CRON_SECRET, sin flag de activación |

Todas las rutas `/api/cron/...` siguen existiendo. No se añade programación Orders, recovery, FBM, FBA, Ledger, stock por país, Finance, forecast, planner o sugerencias.

## C. Scheduler legacy

Único cambio en `app/api/cron/amazon/reports/run/route.ts`:

```ts
// Antes: undefined, vacío, TRUE y cualquier valor distinto de false habilitaban.
process.env.AMAZON_REPORT_SCHEDULER_ENABLED?.trim().toLowerCase() !== "false"
// Después: solo el literal exacto habilita.
process.env.AMAZON_REPORT_SCHEDULER_ENABLED === "true"
```

| Valor | Antes | Después |
| --- | --- | --- |
| undefined | ON | OFF |
| `""` | ON | OFF |
| `"false"` | OFF | OFF |
| `"true"` | ON | ON |
| `"TRUE"`, `" true "`, `"1"` | ON | OFF |

No cambian servicios internos, parámetros, autorización ni fases del scheduler. Importante: los calls a `recoverPendingLedgerSync` y `recoverPendingFbmSync` siguen **antes** del gate legacy y obedecen sus propios flags. Deshabilitar el scheduler legacy no equivale a apagar esos recoveries si el operador habilita sus flags. El cron vacío evita invocaciones programadas por esta configuración Vercel.

## D. Otros mecanismos

| Mecanismo | Clasificación | Evidencia y decisión |
| --- | --- | --- |
| Hooks startup/instrumentation/consumidores de colas/workflows CI | NO APLICA: no encontrados en repo | Sin `instrumentation.*`, `.github` ni dependencias/owners BullMQ/node-cron identificados. package scripts: next dev/build/start/lint; next.config.js solo next-intl e imágenes |
| `scripts/run-fbm-worker.mjs` | MANUAL | Requiere invocación explícita `--serve`; no arranca al importar. Bucle de 60s invoca generation/recovery; no está conectado a build/start. No ejecutado |
| `scripts/run-fbm-recovery-once.cjs`, `run-ledger-recovery-once.cjs` y preflights | MANUAL | Scripts externos, no scripts de lifecycle npm; no ejecutados |
| Scheduler de schedules persistidos | SAFE/OFF BY DEFAULT tras patch | Se procesa cuando se invoca la ruta habilitada; no hay timer autónomo dentro del servicio |
| Recovery Ledger/FBM dentro de reports/run | SAFE/OFF BY DEFAULT en production sin flags | Sigue independiente del gate legacy; no se modifica |
| Finance cron, ventas FBA cron, FBA snapshot cron, compliance cron | UNSAFE/ON BY DEFAULT **ante una invocación autorizada** | Sin feature gate; no hay launcher autónomo encontrado. Se detiene cualquier endurecimiento adicional de estos mecanismos: solo se documentan, sus rutas no se cambian. Todos sin programación Vercel |
| LedgerSyncButton interval 15s / FbmSyncButton timeout recurrente 30s | NO APLICA a deploy automático | Montados solo en Inventario bloqueado; observan GET de estado, no generan ni ejecutan recovery; timers limpiados al desmontar |
| Finance amazon-refresh heartbeat 10s y timeout de autorización | MANUAL | Timer de logs/timeout dentro de POST, limpiado en finally; no launcher de sync |
| fbaLedgerExecutionLockCore interval | MANUAL/contexto de una operación | Renueva lease mientras existe ejecución; no crea job al importar; se limpia al finalizar |
| Delays SP-API/report polling/backoff | MANUAL/contexto de una operación | Solo esperan dentro de operaciones previamente invocadas; no son programación en segundo plano |
| Toasts/debounce/timeouts de UI y solicitudes | NO APLICA | No inician pipeline por deployment |
| SQL triggers presentes en migraciones | NO APLICA al deployment | Se ejecutan ante eventos de BD, no por cargar Next/Vercel; no se ejecuta SQL. No se encontró `pg_cron`/`cron.schedule` en SQL del repo |
| Automatizaciones/configuración externas | NO VERIFICABLE | No se consulta Vercel/Supabase/servidores/colas remotos; un worker externo existente podría seguir llamando endpoints |

La búsqueda en una ruta `.github` inexistente y en un glob de Windows produjo errores de ruta; se revalidó con inventario de archivos. No se interpretan como errores funcionales de la aplicación.

## E. Flags y configuración recomendada

Valores recomendados para un futuro Vercel; **no aplicados**. Los defaults son de código, no una lectura del entorno remoto.

| Flag/config | Default efectivo | Activa | Seguro Fase 0 | Recomendado |
| --- | --- | --- | --- | --- |
| `AMAZON_ORDERS_CANONICAL_ENABLED` | OFF | Runtime All Orders import/generation/recovery; literal true | Sí sin activar | `false` |
| `AMAZON_FBM_REPORTS_SYNC_ENABLED` | OFF | Generación diaria FBM y permite recovery | Sí sin activar | `false` |
| `AMAZON_FBM_MANUAL_SYNC_ENABLED` | OFF production; ON development si no es false | Creación manual FBM y recovery | Sí en production con false; desarrollo es distinto | `false` |
| `AMAZON_LEDGER_SYNC_ENABLED` | OFF | Owner Ledger manual/recovery | Sí sin activar | `false` |
| `AMAZON_LEDGER_SCHEDULE_ENABLED` | OFF; requiere también Ledger sync true | Enqueue diario desde recovery Ledger | Sí sin activar | `false` |
| `AMAZON_REPORT_SCHEDULER_ENABLED` | OFF después del patch | Scheduler legacy + resume ventas FBA | Sí sin activar; no controla Ledger/FBM independientes | `false` |
| `AMAZON_ORDERS_REIMPORT_DAYS` | 14 | Tamaño ventana, no activa nada | Sí | `14` o ausente |
| `FBM_WORKER_BASE_URL` | localhost:3000 | Target solo al ejecutar worker externo | No es feature gate | No iniciar worker/configurarlo en Fase 0 |
| `AMAZON_SP_API_USE_AWS_SIGV4` | false según parser de config | Firma AWS, no activa procesos | No usarlo como bloqueo de pipeline | Mantener configuración de firma cuando se autorice; no cambiar aquí |
| `CRON_SECRET` | Sin default secreto; ausente rechaza rutas cron | Autenticación, **no** interruptor de automatización | Nunca basta como gate de negocio | No inventado ni modificado |

No se encontraron gates independientes de habilitación para Finance sync, FBA snapshot, FBA sales legacy o compliance. `.env.example` conserva `AMAZON_FBM_MANUAL_SYNC_ENABLED=true` como ejemplo local: no copiarlo automáticamente al futuro production. No se modifica en esta fase.

## F. Botones/rutas manuales existentes

"Sí" en Amazon/escrituras indica capacidad al ejecutar con credenciales, permisos y gates válidos; no se ejecutó ninguna acción. Visible se refiere a política de módulo, no a permisos de usuario.

| UI / endpoint | Acción | Amazon | Escrituras | Módulo visible production |
| --- | --- | --- | --- | --- |
| Finanzas / `POST /api/finance/amazon-refresh` | Actualizar saldos/observaciones; acceso Finance admin/accounting | Sí | Sí | Sí |
| Cumplimiento / `POST /api/policies/alerts/sync` | Botón general e individual sincronizan alertas | Sí | Sí | Sí |
| Cumplimiento / `PATCH /api/policies/alerts/[alertId]/resolve` | Marcar resuelta manualmente | No | Sí | Sí |
| Amazon Envíos / `POST /api/amazon/inbound-shipments/sync` | Sync inbound operativo | Sí | Sí | Sí |
| Amazon Envíos / `POST /api/amazon/inbound-shipments/[shipmentId]/enrich-v2024` | Enriquecer envío seleccionado | Sí | Sí | Sí |
| Inventario / `POST /api/amazon/inventory/fba-snapshot/import` | Actualizar snapshot FBA | Sí | Sí | No |
| Inventario / `POST /api/amazon/inventory/fbm-snapshot/import` | Crear generación FBM; production OFF sin flag | Sí | Sí | No |
| Inventario / `POST /api/amazon/sp-api/reports/fba-ledger/run` | Enqueue Ledger; requiere flag | Sí durante recovery, POST enqueue no llama Amazon | Sí | No |
| Inventario / `POST /api/amazon/reports/all-orders/import` | Importar/reanudar Orders; OFF por defecto | Sí | Sí | No |
| Inventario / `POST /api/amazon/reports/fba-sales/import` | Actualizar ventas FBA legacy | Sí | Sí | No |
| Productos / `GET /api/products/amazon-marketplaces` | Leer catálogo de marketplaces de BD | No | No | No |
| GET de listas en Envíos/Cumplimiento y planificación Finance | Leer datos guardados al montar UI | No en los owners inspeccionados | No en esos handlers | Sí |
| `POST /api/amazon/sp-api/finances/settlements/import` | Importar settlements; autenticación Finance | Sí | Sí | Endpoint conservado; no botón encontrado en UI examinada |
| `/api/amazon/sp-api/reports/fba-country/request` | Request explícito de report de país, requiere admin | Sí | Sí (job) | Sin botón encontrado en módulos permitidos; endpoint conservado |
| `/api/amazon/sp-api/reports/[jobId]/status`, `/preview`, `/commit` | Poll/preview/commit explícito de report de país | Sí en poll/preview, no en commit | Sí; commit puede escribir `inventario_paises` | Ya responden 404 en production; no se cambia ese gate |

Las APIs de diagnostics/SP-API/health también pueden consultar Amazon mediante peticiones explícitas; no son automatización de arranque y no se modifican. La ausencia de cron no bloquea acceso manual/API. No se prueban sus permisos en remoto.

## G–J. Archivos y validación

Archivos runtime modificados: `vercel.json` (cuatro cron retirados) y `app/api/cron/amazon/reports/run/route.ts` (una expresión del gate). Creados: `config/vercelPhase0.test.mjs`, este informe y evidencias locales `outputs/vercel-phase0/`.

- Tests nuevos: 12/12 PASS. Config JSON sin cron/rutas presentes, gate real undefined/vacío/false/true y variantes, autenticación intacta, Orders runtime OFF sin dependencies, FBM generation/manual/recovery OFF production, Ledger OFF.
- Tests de visibilidad previos: 20/20 PASS. No se modifica ningún archivo de esa política.
- Typecheck: `npx.cmd tsc --noEmit --incremental false` PASS.
- ESLint focal con configuración aislada previa: route y nuevo test PASS (0 errores/warnings).
- Node avisa del package type al importar TS; warning preexistente, no se cambia package.json.
- Tests ejecutan código real con dependencias offline/mocks, incluyendo el caso flag true. No invocan scheduler, Amazon ni Supabase reales.
- Comparación SHA-256 de 1.614 archivos: solo cambian `vercel.json` y la ruta del gate; cero cambios inesperados. Política de visibilidad, pipelines, migraciones y datos preservados. `git diff --check` focal PASS.
- Estado final y diff global (incluyen trabajo anterior): `outputs/vercel-phase0/status-after.txt`, `stat-after.txt`. Diff exclusivo de esta fase: `outputs/vercel-phase0/task.diff`.

## K. Riesgos pendientes y STOP

El repo no programa cron, pero no demuestra el estado de automatizaciones/variables remotas. Antes del deployment autorizado debe revisarse externamente que no haya workers/schedules activos y aplicar los flags false recomendados; no se hace aquí.

No se bloquean botones manuales. Finance, Compliance y Envíos permanecen visibles y pueden llamar Amazon/escribir mediante acciones explícitas autorizadas. Las rutas sin gates de negocio y los recoveries independientes requieren revisión futura si se busca un bloqueo total de ejecución más allá de cero cron.

No deployment, Amazon calls, migraciones, Supabase writes ni escrituras de datos de negocio. Ningún cron activado. Orders y FBM production permanecen OFF por defecto; FBA sales legacy, stock por país y Finance/forecast quedan sin programación Vercel. No se altera lógica funcional ni la política de visibilidad. STOP.
