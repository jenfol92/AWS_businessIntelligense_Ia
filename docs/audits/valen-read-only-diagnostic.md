# VALEN: diagnosticos preparados, no ejecutados

> ARCHIVADO (2026-09-07): la ruta, el modulo y sus tests temporales fueron retirados
> tras validar FBM Reports. Las invocaciones y comandos siguientes son referencias
> historicas, ya no estan disponibles y no deben ejecutarse.
> Operacion vigente: [sincronizacion productiva FBM Reports](fbm-reports-production-sync.md).

Identidad fija: producto `53d02963-2e6e-4812-9adb-92ba05eecafd`, SKU `8436616610531`, ASIN `B0GS1VMRRN`, ES `A1RKKUPIHCS9HS`.

Ruta temporal disponible exclusivamente con `NODE_ENV=development` (production y cualquier otro entorno devuelven 404 antes de cargar configuracion).

Invocaciones manuales futuras, NO ejecutadas durante la preparacion:

- `GET /api/diagnostics/sp-api/valen?mode=catalog`: `getCatalogItem`, GET `/catalog/2022-04-01/items/B0GS1VMRRN`, `marketplaceIds=A1RKKUPIHCS9HS`, `includedData=summaries,productTypes`.
- `GET /api/diagnostics/sp-api/valen?mode=sku`: `searchListingsItems`, GET `/listings/2021-08-01/items/{sellerId}`, `identifiersType=SKU`, `identifiers=8436616610531`.
- `GET /api/diagnostics/sp-api/valen?mode=asin`: misma operacion con `identifiersType=ASIN`, `identifiers=B0GS1VMRRN`.

Las busquedas usan ES, `includedData=summaries`, `pageSize=20`, sin filtros de estado. El seller procede exclusivamente de `loadSpApiConfig`. Cada invocacion hace como maximo una peticion SP-API GET, sin reintentos, fallback ni paginacion. El cliente canonico puede obtener un token LWA para autenticar la futura consulta; esto no se ha ejecutado. Los tres modos son independientes: no existe ejecucion conjunta automatica.

Respuesta: operation, httpStatus (solo respuesta SP-API observada), amazonRequestId, sellerSku, asin, result, found, errorCode, errorMessage, complete, hasNextPage e informacion basica seleccionada. No se devuelven payloads completos, headers, tokens ni sellerId. SKU devuelto por Amazon se conserva como evidencia, sin sustituir el SKU consultado ni persistir aliases.

`FOUND` exige identidad coincidente. `NOT_FOUND` en discovery requiere una respuesta 200 valida y vacia, completa y sin pagina siguiente. Un error, 403, payload invalido o ausencia de coincidencia en pagina incompleta produce `UNKNOWN` y `found=null`. Catalog 404 con codigo Amazon `NotFound` indica ausencia en Catalog para esta consulta; no demuestra ausencia del listing. Ningun resultado cambia stock ni establece `NOT_LISTED`.

Fuentes oficiales consultadas:
- https://developer-docs.amazon/sp-api/lang-en_US/reference/getcatalogitem
- https://developer-docs.amazon/sp-api/lang-en_EN/reference/searchlistingsitems
- https://developer-docs.amazon/sp-api/lang-US/docs/search-for-listings-items-by-id

Validacion local: `node --experimental-strip-types --test modules/amazon-sp-api/valenReadOnlyDiagnostic.test.mjs`, `npx.cmd tsc --noEmit --incremental false`, `git diff --check`. Los tests inyectan transporte simulado y bloquean fetch real. Sin modificaciones del loader, sync, Supabase o configuracion existente.
