# Prueba temporal Reports FBM ES

> ARCHIVADO (2026-09-07): el CLI, el modulo y sus tests temporales fueron retirados
> tras validar FBM Reports. Los comandos y observaciones siguientes describen la
> preparacion historica; los ejecutables ya no estan disponibles.
> Operacion vigente: [sincronizacion productiva FBM Reports](fbm-reports-production-sync.md).

Preparación local; no se ha ejecutado Amazon desde Codex. No demuestra todavía que
Reports pueda sustituir Listings Items ni valida semántica de `quantity`.

## Revisión del código existente

- `modules/amazon-sp-api/reportsClient.ts`: existen `createReport`, `getReport`,
  `getReportDocument` y `downloadReportDocument`, con soporte GZIP.
- Los wrappers no exponen `retryExpiredAccessToken: false`. La descarga usa `fetch`
  sin timeout, sin límite de bytes y asume UTF-8. No se modifican esos consumidores.
- `spApiReportImportUtils.ts` contiene `parseReportRows`, pero permite CSV como
  fallback y no rechaza errores de PapaParse; `getField` recorta valores.
- El diagnóstico reutiliza `loadSpApiConfig`, `spApiRequest` (y su owner LWA),
  PapaParse y zlib existentes. Usa un parser TSV estricto que conserva las celdas
  y un descargador limitado, aislados de importadores, jobs, Supabase y sync.

## Ejecución manual desde PowerShell

Requiere Node 24 y dependencias ya instaladas. No necesita servidor Next.js.
Carga las variables del entorno y `.env.development.local`/`.env.local` mediante
`@next/env`; las credenciales pertenecen al owner de configuración existente.

```powershell
Set-Location -LiteralPath 'C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA'
$env:NODE_ENV = 'development'
node --experimental-strip-types .\scripts\fbm-reports-diagnostic.mjs --run
```

Sin `--run` o fuera de development, no carga configuración ni inicia transporte.
El harness no cambia NODE_ENV a development automáticamente. Bloquea SigV4 legacy
para evitar llamadas STS adicionales; no modifica la configuración si está activo.

Cada invocación autorizada con `--run` solicita **un nuevo informe**:

```json
{"reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","marketplaceIds":["A1RKKUPIHCS9HS"]}
```

Máximo: 1 createReport + 12 getReport + 1 getReportDocument + 1 descarga,
además de hasta 1 petición LWA. Polling cada 15 s, incluyendo la primera consulta.
30 s por petición, presupuesto de flujo 300 s y watchdog CLI de 305 s.
Sin retry de HTTP, token caducado, red, descarga, paginación ni recreación automática.
Si termina el presupuesto, devuelve `PENDING_LIMIT_REACHED` con el reportId;
no cancela el informe remoto ni continúa en segundo plano.
`CANCELLED`/`FATAL` detienen el flujo, incluso si existe documento de error.
Solo `DONE` permite descargar después de verificar reportId, tipo, marketplace
y reportDocumentId. Errores de transporte producen `UNKNOWN`, nunca stock cero.

La descarga admite HTTPS Amazon S3/CloudFront, sin redirects ni headers de LWA.
GZIP o texto, charset declarado (UTF-8 por defecto), BOM UTF-8, hasta 20 MiB
descargados y descomprimidos, 200.000 filas y 100 coincidencias por SKU.
No persiste documento, URL firmada ni respuesta completa. Solo imprime JSON seguro.

## Evidencia de los controles

| Control | Seller SKU exacto | Referencia del usuario en Seller Central |
| --- | --- | --- |
| ALAIA | 8436616610104 | 721 |
| VALEN | 8436616610531 | 0 |
| Agotado | 8436616610128 | 0 |

Las cifras de referencia no se inyectan en resultados ni se usan para dar PASS.
`evidence.controls[].matches` incluye sellerSku, asin, quantity (string), campos
raw relevantes y de fulfillment presentes, con sus nombres originales.
No recorta SKU, no normaliza alias, no filtra FBA/FBM, no suma duplicados.
`matches: []` significa ausencia del SKU en este documento, no cantidad cero.
Celda vacía permanece `""`; columna ausente es `null`; cero literal es `"0"`.
Headers desconocidos de SKU, ambiguos o TSV inválido detienen el diagnóstico.
No se infiere ASIN a partir de `product-id`. Se ocultan secretos conocidos y URLs
en la proyección de evidencia; nunca se serializan excepciones de transporte.

## Validación sin red

```powershell
node --experimental-strip-types --test .\modules\amazon-sp-api\fbmReportsReadOnlyDiagnostic.test.mjs
node .\node_modules\typescript\bin\tsc --noEmit --incremental false
git diff --check
```

Los tests bloquean fetch real y prueban además el CLI completo con el cliente
canónico y LWA mediante un preload con fetch totalmente simulado.

## Referencias oficiales consultadas

- [Inventory Reports / All Listings Report](https://developer-docs.amazon/sp-api/docs/report-type-values-inventory): tipo TSV, columnas, BOM y limitación a un marketplace. La documentación advierte que los headers pueden variar de locale por caché.
- [Verificación del procesamiento](https://developer-docs.amazon/sp-api/docs/verify-that-report-processing-is-complete): estados terminales y polling.
- [Recuperación del informe](https://developer-docs.amazon/sp-api/docs/retrieve-a-report): documento firmado, compresión y descarga en memoria.
