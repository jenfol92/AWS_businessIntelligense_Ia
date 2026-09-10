# Sincronización FBM ES mediante Reports

## Auditoría antes de editar (2026-09-07)

PostgreSQL consultado con `DATABASE_URL` del proyecto, en `BEGIN TRANSACTION READ ONLY`,
finalizado con `ROLLBACK`. Baseline: **0 runs, 0 rows, 0 latest rows**.
No se ejecutaron llamadas Amazon ni escrituras en esa inspección.

Inspeccionados: servicio Listings FBM, repositorio de identidad, constructor canónico,
cliente Reports, utilidades de importación, SQL local, tests, columnas desplegadas,
definición desplegada del RPC y vista latest. Los 29 tests FBM relacionados pasaban
antes de editar. No se detectaron fallos preexistentes en esa batería.

El RPC desplegado `commit_amazon_fbm_inventory_snapshot_run` inserta el run y sus
filas en la misma transacción. Valida captura completa, marketplace, cantidades,
timestamp y duplicados. `asin` es nullable. Su validación permite menos filas que
identidades completadas: el nuevo commit de Reports endurece esto a igualdad exacta
antes de invocar el RPC. No se requiere ni se aplica migración.

La vista `v_latest_amazon_fbm_inventory_by_product` selecciona el último run
COMPLETE/publication_ready por marketplace. El lector de Inventory existente suma
resultados por producto entre marketplaces. Por ello este servicio solo publica ES:
el marketplace identifica la fuente; el pool físico sigue siendo **OWN_ES / FBM**.
No se abre un loop por marketplaces ni se replica stock físico. El lector existente
no se modifica en este cambio.

## Arquitectura y decisiones

- **Anterior, conservado:** `amazonFbmInventorySyncService.ts` consulta Listings por
  identidad. Puede omitir respuestas válidas sin DEFAULT. No es el entrypoint de Reports.
- **Transporte:** `reportsClient.ts` reutilizado, con opciones opcionales de señal,
  metadata, transporte inyectable y no retry. Los defaults de los otros consumidores
  se conservan. `spApiClient.ts` y `lwaClient.ts` propagan cancelación opcional.
- **Descarga:** `boundedReportDocument.ts`, seleccionada mediante opciones del cliente
  Reports. Memoria, HTTPS S3/CloudFront, sin redirects ni headers de autenticación,
  límite comprimido/descomprimido, GZIP, charset declarado y UTF-8 por defecto.
- **Parser y normalización:** `fbmReportsSnapshot.ts`. PapaParse TSV sin dynamic typing,
  BOM, campos entrecomillados, anchura exacta, headers críticos únicos:
  `seller-sku`, `quantity`, `fulfillment-channel`. Headers desconocidos/localizados
  fallan cerrado; no se convierten mediante alias no demostrados. `asin1` y `status`
  son opcionales y no deciden identidad/cantidad.
- **Orquestación:** `amazonFbmReportsSyncService.ts`, productiva y sin importar temporales.
- **Commit único:** `fbmReportsCommit.ts`, mismo RPC, una sola invocación, sin retry.
- **Entrada:** POST `/api/cron/amazon/fbm-inventory-snapshot`, `CRON_SECRET` Bearer,
  comparación constante, opt-in `AMAZON_FBM_REPORTS_SYNC_ENABLED=true`, no-store.

Universo dinámico: productos con `estado === 'activo'`, SKU string no vacío,
sin espacios exteriores ni caracteres de control, y ASIN válido de 10 caracteres
alfanuméricos mayúsculos (solo activación). La identidad es `productos.id + productos.sku`
y se conserva el SKU exacto. No se añaden prefijos, ni se consultan Ledger, FNSKU o aliases.
Los campos nulos de compatibilidad del tipo de identidad anterior no intervienen.
Lectura paginada por id; el tope de 100.000 registros es un límite de seguridad que
aborta, nunca un tamaño esperado del universo. Relectura antes de commit; si cambió
la pertenencia/id/SKU, no se publica. No sustituye a un bloqueo transaccional del maestro.

Report solicitado: `GET_MERCHANT_LISTINGS_ALL_DATA`, marketplaceIds exclusivamente
`["A1RKKUPIHCS9HS"]`. No se solicitan informes alternativos.

Para cada SKU esperado se exige **exactamente una fila DEFAULT**. Las filas no DEFAULT
no cuentan como FBM. Un DEFAULT y un FBA del mismo SKU permiten usar solo DEFAULT;
varios DEFAULT, incluso idénticos, abortan sin sumar. SKU ausente o solo FBA produce
`REPORT_COVERAGE_ERROR`; no se publican ceros artificiales ni un snapshot parcial.

Quantity conserva primero su texto raw. Se exige `/^\d+$/`, entero seguro y rango
PostgreSQL int4. Para cero se exige el literal `"0"` (se rechazan `00`, `+0`, espacios,
vacío, negativos, decimales y texto). `Inactive` no implica cero. ASIN distinto o ausente
en la fila no cambia la identidad; ASIN inválido se conserva como null en snapshot.

La documentación del [All Listings Report](https://developer-docs.amazon/sp-api/docs/report-type-values-inventory)
describe un informe detallado TSV y sus columnas, pero no establece ausencia de SKU
como evidencia de cantidad cero. La evidencia real aportada por el usuario confirma
696/0/0 con DEFAULT para los tres controles; no demuestra semántica de ausencia.
Por ello se adopta cobertura completa fail-closed.

## Límites y observabilidad

Una creación, hasta 12 consultas getReport separadas por 15 s (también antes de la
primera), un getReportDocument y una descarga solo después de DONE y scope válido.
Sin retry HTTP/token caducado, fallback, paginación Reports ni cancelación automática.
Límite 300 s del flujo, 30 s por operación de red, documento 20 MiB y 200.000 filas.
SigV4 legacy se rechaza antes de Amazon para evitar una ruta STS adicional no cubierta.
La configuración existente no se reescribe.

El resultado distingue SUCCESS, REPORT_CREATE_ERROR, REPORT_PENDING_TIMEOUT,
REPORT_STATUS_ERROR, REPORT_CANCELLED, REPORT_FATAL, REPORT_DOCUMENT_ERROR,
REPORT_DOWNLOAD_ERROR, REPORT_PARSE_ERROR, REPORT_COVERAGE_ERROR,
REPORT_DUPLICATE_ERROR, REPORT_QUANTITY_ERROR, COMMIT_ERROR, IDENTITY_ERROR y CONFIG_ERROR.
Logs/JSON incluyen reportId, runId, estado, marketplace, pool, counts, tiempos y requestIds.
No contienen secretos, sellerId, URL firmada ni filas/documento completo.

`observed_at` usa `report.createdTime`, no la hora de finalizar el commit, para que
un informe anterior lento no se presente como observación posterior. Es la hora de
creación del reporte; no garantiza que Amazon no haya reutilizado contenido en caché.
Un fallo conserva la publicación previa: no la convierte en cero ni la declara actualizada.

SUCCESS requiere confirmación del número exacto de filas por RPC. Ante fallo o respuesta
de commit incierta, `commitOutcome=UNKNOWN`, nunca SUCCESS ni retry automático.
La transacción garantiza todo-o-nada; una pérdida de respuesta podría ocultar un commit
completo, por lo que se debe verificar el runId antes de repetir.

La entrada evita simultaneidad dentro del proceso. No es un lock distribuido; configurar
un único scheduler para esta ruta. No se instala horario ni se despliega en esta fase.
La plataforma de backend debe permitir 360 s; una interrupción antes del commit no publica.

## Una prueba real local (NO ejecutada por Codex)

Se requieren las credenciales canónicas SP-API/Supabase y `CRON_SECRET` en `.env.local`
(o el entorno de ambas terminales). No imprimir/copiar secretos en comandos de consulta.

Terminal 1: arrancar/reiniciar el servidor local con el entrypoint habilitado.

```powershell
Set-Location -LiteralPath 'C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA'
$env:AMAZON_FBM_REPORTS_SYNC_ENABLED = 'true'
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Terminal 2, una sola vez:

```powershell
Set-Location -LiteralPath 'C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA'
node .\scripts\run-fbm-reports-sync.mjs --run-once
```

El helper lee CRON_SECRET sin imprimirlo y hace exactamente un POST autenticado a
localhost:3000. No llama Amazon directamente ni reintenta. El backend es independiente
de PowerShell y el scheduler de producción podrá invocar la misma ruta protegida.
Cada ejecución vuelve a solicitar un informe; no repetir automáticamente ante errores.

Éxito esperado: SUCCESS, commitOutcome CONFIRMED, matched=expected=rowsCommitted,
unknownCount=0 y un run nuevo. Las cantidades reales pueden haber cambiado desde
696/0/0. Después se debe inspeccionar el run y sus filas; no se fija ningún conteo de
productos ni valores esperados de stock en producción.

## Tests y límites de la validación

Tests simulados de stock/cobertura/duplicados, errores y estados terminales, atomicidad,
universo dinámico, auth y concurrencia, cancelación LWA/SP-API y recorrido productivo
completo con catálogo de más de una página y un único RPC simulado. Fetch real bloqueado.
Los tests no escriben en Supabase real. La atomicidad SQL se apoya en la definición
desplegada inspeccionada; no se ha ejecutado un commit real para probarla en esta fase.

No se modifican FBA, sales, inbound, stock de `inventario_paises`, loaders de Inventory,
migraciones ni configuración del despliegue. No commit/push.

## Retirada de diagnosticos temporales (2026-09-07)

Tras el postcheck satisfactorio del run `12e57322-3a24-4570-ad9a-c815972371ea`,
se retiraron exclusivamente las siguientes rutas, modulos y tests temporales.
Esta lista es historica: sus archivos ya no estan disponibles.

- `app/api/controlled-fbm-capture/route.ts`
- `app/api/controlled-fbm-capture/route.test.mjs`
- `app/api/controlled-fbm-diagnostic/route.ts`
- `app/api/controlled-fbm-diagnostic/route.test.mjs`
- `app/api/diagnostics/sp-api/valen/route.ts`
- `modules/amazon-sp-api/valenReadOnlyDiagnostic.ts`
- `modules/amazon-sp-api/valenReadOnlyDiagnostic.test.mjs`
- `scripts/fbm-reports-diagnostic.mjs`
- `modules/amazon-sp-api/fbmReportsReadOnlyDiagnostic.ts`
- `modules/amazon-sp-api/fbmReportsReadOnlyDiagnostic.test.mjs`

Se conservan como documentos archivados [el diagnostico VALEN](valen-read-only-diagnostic.md)
y [la prueba temporal Reports](fbm-reports-read-only-diagnostic.md).
La implementacion productiva Reports, sus tests, identidad, limites y commit permanecen intactos.

El servicio FBM Listings, sus tests/clientes y la ruta generica `listings-item-fbm`
se conservan; no forman parte de esta retirada de diagnosticos especificos.

## Archivos de este cambio

Modificados (5):

- `modules/amazon-sp-api/reportsClient.ts`
- `modules/amazon-sp-api/spApiClient.ts`
- `modules/amazon-sp-api/lwaClient.ts`
- `modules/amazon-sp-api/fbmProductIdentityRepository.ts`
- `modules/amazon-sp-api/fbmProductIdentityRepository.test.mjs`

Nuevos (10):

- `modules/amazon-sp-api/boundedReportDocument.ts`
- `modules/amazon-sp-api/fbmReportsSnapshot.ts`
- `modules/amazon-sp-api/fbmReportsCommit.ts`
- `modules/amazon-sp-api/amazonFbmReportsSyncService.ts`
- `modules/amazon-sp-api/fbmReportsEntrypoint.ts`
- `modules/amazon-sp-api/amazonFbmReportsSyncService.test.mjs`
- `modules/amazon-sp-api/fbmReportsTransport.test.mjs`
- `app/api/cron/amazon/fbm-inventory-snapshot/route.ts`
- `scripts/run-fbm-reports-sync.mjs`
- `docs/audits/fbm-reports-production-sync.md`
