# Auditoría AVAILABLE / consolidado Amazon — 10 de septiembre de 2026

## Verificado en producción

Dos consultas de diagnóstico contra el proyecto esperado, con `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, verificación de `transaction_read_only=on` y `ROLLBACK`. No se ejecutaron sincronizaciones, llamadas Amazon, pagos, migraciones ni escrituras. No se repitió la investigación de firmas RPC, RLS ni locks.

Lectura de datos: 10/09/2026 08:52:38 UTC. Última observación: 08:36:35.874 UTC; último éxito: 08:37:50.865 UTC; contador `written=2015`. Se encontraron exactamente 2.015 snapshots con ese instante. Las cifras siguientes son de ese corte, no una lectura permanente del saldo Amazon.

| Conjunto | AVAILABLE | DEFERRED | PENDING_BANK | Total |
|---|---:|---:|---:|---:|
| Snapshots leídos | 40 | 3.612 | 5 | 3.657 |
| Tras selección actual por source_key | 25 | 3.594 | 4 | 3.623 |
| Con instante de la última sincronización | 13 | 1.999 | 3 | 2.015 |
| Seleccionados que proceden de agosto | 12 | 1.595 | 1 | 1.608 |

Hay 208 snapshots con `amount_eur=NULL`; quedan 193 tras seleccionar por `source_key`. De estos, 23 corresponden al último instante y 170 al histórico. Ningún registro leído carece de moneda o importe original estructurado. Hay siete snapshots con EUR cero; todos tienen importe original cero. No se encontró ningún original distinto de cero convertido en cero en los datos leídos.

La selección local se reprodujo con el mismo orden de entrada del repositorio y el mismo algoritmo de `buildFinancialPlanning`, invocando la función real `buildMarketplaceCashCards`. No se lanzó la página autenticada: los valores de pantalla se deducen de su código, no de una captura posterior a esta consulta. Fechas SQL `date` serializadas por pg se interpretaron como fechas locales; no se considera su representación UTC una divergencia de evidencia.

## Traza de ejemplos reales

Identificadores de auditoría derivados de hashes, sin identificadores Amazon originales. Todos son AVAILABLE. `realized_amount_eur` es NULL en estos casos: AVAILABLE no equivale a un ingreso bancario realizado. El origen persistido es el flujo SP-API Finances; la respuesta RAW no está guardada entre los datos encontrados. Por tanto, el tramo anterior a la transformación se reconstruye del código y de la evidencia de clasificación, **no de una respuesta Amazon RAW que podamos cotejar**.

| Caso | Origen/clasificación conservada | original_currency / original_amount | FX | amount_eur | official_amount_eur | realized_amount_eur |
|---|---|---|---|---:|---:|---:|
| `8657779a`, BE, septiembre | Grupo Open; 22 transacciones; señal BE | EUR / 356,76 | EUR_IDENTITY, tasa 1 | 356,76 | 356,76 | NULL |
| `92964d89`, ES, septiembre | Grupo Open; 1 transacción; señal ES | EUR / 0 | EUR_IDENTITY, tasa 1 | 0 | 0 | NULL |
| `affb16ed`, PL, septiembre | Grupo Open; 1 transacción; señal PL | PLN / 0 | ECB, 0,2317335991 EUR/PLN | 0 | NULL | NULL |
| `365eb87f`, SE, septiembre | Grupo Open; 5 transacciones; señal SE | SEK / 89,54 | ECB, 0,0896901206 EUR/SEK | 8,03 | NULL | NULL |
| `a0233d29`, UNRESOLVED, septiembre | Grupo Open; 3 transacciones; ninguna señal reconocida | AED / 776,31 | UNAVAILABLE | NULL | NULL | NULL |
| `7bb34467`, UNRESOLVED, septiembre | Grupo Open; 2 transacciones; ninguna señal reconocida | SAR / 369,75 | UNAVAILABLE | NULL | NULL | NULL |
| `e445cdbb`, SE, agosto | Grupo Open; 7 transacciones; señal SE | SEK / 5.317,28 | unavailable histórico | NULL | NULL | NULL |

Transformación de grupos: `OriginalTotal.CurrencyCode` → moneda; `Number(OriginalTotal.CurrencyAmount)` → importe; `valueAmazonAmountEur` prioriza ConvertedTotal EUR, luego identidad EUR, luego ECB, y finalmente NULL. La tasa ECB se expresa en EUR por unidad extranjera y se multiplica; no se cambió esta convención. En moneda extranjera valorada por ECB, `official=NULL` es correcto: el valor es estimado, no una conversión oficial Amazon.

Del snapshot a la tarjeta:

- BE `8657779a`: permanece por su source_key y aporta 356,76 EUR. Otro source_key de agosto aporta 322,15: país y consolidado suman 678,91.
- ES `92964d89`: su cero se conserva, pero otro source_key de agosto aporta 14.290,64 EUR; la tarjeta ES sigue mostrando esa cantidad.
- PL `affb16ed`: cero original × tasa positiva = cero EUR. Reemplaza en la selección un snapshot de otra fecha del mismo source_key que tenía FX ausente. No es prueba de conflicto sobre la misma observation_key.
- SE `365eb87f`: los 8,03 EUR están persistidos correctamente. El source_key distinto de `e445cdbb` sobrevive junto a él. La tarjeta recibe `[NULL, 8,03]` y devuelve `availablePositiveEur=NULL`; la UI muestra `EUR unavailable`. Europa elimina el NULL antes de llamar a la función y sí incorpora 8,03 EUR.
- AED/SAR: los NULL sobreviven al mapeo y a la tarjeta UNRESOLVED; después la UI usa `??0`, muestra 0 EUR y «Sin importes pendientes de asignar». Ambos quedan excluidos del resumen superior y Europa.

No se puede identificar una observation_key observada varias veces con la evidencia disponible: hay cero claves duplicadas almacenadas, un índice único, y no hay contador de observaciones ni historial de cada intento. Cero duplicados no demuestra que no hubiera reobservaciones.

## Causa de AVAILABLE=0

1. **Ceros persistidos:** los cinco AVAILABLE cero del último instante son ES/EUR, NL/EUR, PL/PLN, UNRESOLVED/TRY y UNRESOLVED/EUR. Todos tienen original cero. EUR conserva ese cero; PLN y TRY lo multiplican por una tasa ECB positiva. No hay evidencia de que FX haya reducido un original positivo a cero.
2. **No se puede certificar “Amazon realmente devolvió 0”:** `Number(null)` y `Number("")` producen cero; el RAW original no se conservó. El dato estructurado demuestra cero después de transformar, no distingue cero real de esos inputs. `undefined` produce NaN y se rechaza; no todos los faltantes se convierten en cero.
3. **Cero por semántica de disponible positivo:** DE tiene -10.415,58 EUR acumulados y `availablePositiveEur=0` porque se filtran originales <=0. No es fallo FX. El nombre de la cifra debe distinguir saldo firmado y cantidad positiva susceptible de solicitar.
4. **Cero por agregación/UI:** `totalEconomicEur` devuelve 0 si una sola valoración es NULL; UNRESOLVED convierte subtotales NULL en cero. Ambos fallos están reproducidos.
5. **ConvertedTotal incompleto:** la función actual acepta `{CurrencyCode:'EUR', CurrencyAmount:null}` como cero oficial y realizado. Reproducido con test, pero no atribuido a producción: los ejemplos observados no prueban ese input.
6. **ON CONFLICT:** no hay una pérdida monetaria concreta atribuible a él con la evidencia retenida; véase apartado siguiente.

## Causa de EUR NULL

| Categoría tras selección actual | Filas | Importe original sin EUR |
|---|---:|---|
| Última sincronización, AVAILABLE AED/SAR | 2 | 776,31 AED; 369,75 SAR |
| Última sincronización, DEFERRED AED/SAR | 21 | 3.633,81 AED; 4.060,93 SAR |
| Histórico GB, AVAILABLE | 2 | -370,76 GBP y +74,26 GBP |
| Histórico SE, AVAILABLE | 1 | 5.317,28 SEK |
| Histórico GB, DEFERRED | 159 | 6.345,20 GBP |
| Histórico SE, DEFERRED | 2 | 1.022,83 SEK |
| Histórico UNRESOLVED, AVAILABLE | 2 | 0 AED; -1,80 SAR |
| Histórico UNRESOLVED, DEFERRED | 4 | 409,96 AED; 166,43 SAR |

Los 23 NULL actuales tienen `fx_source=UNAVAILABLE`, sin tasa ni conversión oficial. Son funcionalmente válidos como **importe conocido en divisa pendiente de valoración**, no como deuda/saldo cero. No hay moneda desconocida en las filas leídas. El proveedor ECB utilizado no aporta aquí valoración AED/SAR; no se deben inventar tasas.

Los 170 históricos conservan `fx_source=unavailable`. Los GBP/SEK actuales sí se valoran con ECB: el problema observable es que los históricos sin valoración continúan entrando. No es prueba de que la cotización faltase en el mercado, ni de una segunda valoración descartada por ON CONFLICT. Todos los EUR NULL leídos se corresponden con FX ausente; no se encontró NULL causado únicamente por ser UNRESOLVED o por el estado económico. UNRESOLVED/TRY demuestra que asignación y FX son independientes: tiene ECB y EUR cero.

`official_amount_eur=NULL` y `realized_amount_eur=NULL` no se deben confundir con `amount_eur=NULL`: una estimación ECB puede tener importe EUR válido y esos otros dos campos NULL.

## Impacto real de ON CONFLICT evidence-only

La definición desplegada consultada conserva `DO UPDATE SET evidence=excluded.evidence`. Las columnas monetarias, FX, snapshot_at y otras columnas estructuradas no se enriquecen por esa vía.

En las 3.657 evidencias inspeccionadas solo aparecen referencias de grupo/transacción, estados, fechas de transferencia/simulación, señales de marketplace y número de transacciones. **Ninguna contiene OriginalTotal, ConvertedTotal, moneda/importe posterior ni tasa posterior.** No se encontró una tabla RAW financiera mediante el inventario de nombres inspeccionado; esto no demuestra que no exista un registro externo en otro sistema.

| Medida solicitada | Resultado verificable |
|---|---|
| Snapshots con evidencia monetaria suficiente que contradiga columnas | 0 casos demostrables |
| Marketplaces con ese conflicto demostrado | Ninguno demostrado |
| AVAILABLE con ese conflicto demostrado | 0 casos demostrables |
| EUR perdido por evidence-only | No cuantificable; no equivale a 0 EUR de impacto |
| Misma observation_key observada varias veces | No verificable con el historial retenido |

Existe un riesgo concreto en código: la clave incluye día, importe, moneda, marketplace y estado, pero no ConvertedTotal ni la tasa ECB. Una segunda valoración del mismo material en el mismo día puede conservar la misma clave y no actualizar las columnas. Esto justifica diseñar el enriquecimiento y su prueba, **no afirmar que explica los NULL/ceros de este corte**. Los source_key históricos distintos que influyen en el resumen constituyen un mecanismo independiente y demostrado.

## Impacto de UNRESOLVED

Significa que el resolvedor encontró cero o más de una señal de país reconocida. Su catálogo actual reconoce diez marketplaces europeos. Todos los UNRESOLVED leídos tienen cero señales reconocidas; no se encontró un caso de señales múltiples. Con transacciones presentes, no se puede distinguir “campo ausente” de “identificador no contemplado” porque solo se guarda la lista de señales reconocidas. Con cero transacciones no hay evidencia de país de la que inferirlo. La moneda AED/SAR no se debe utilizar como identidad de marketplace.

Son observaciones de importes procedentes del flujo financiero, con cantidades positivas reales en las columnas originales; no son ceros ni simples avisos. Esto tampoco certifica dinero en banco o saldo actual completo. Pueden resolverse después si llega identidad fiable; el marketplace forma parte del material de la clave y un nuevo material puede generar otra observación. Haría falta preservar el mismo identificador económico para no sumar ambas asignaciones.

En el último instante hay 25 UNRESOLVED: cuatro AVAILABLE y 21 DEFERRED. Los AVAILABLE positivos no valorados son 776,31 AED y 369,75 SAR. En la selección con histórico hay 31 UNRESOLVED, 29 sin EUR. La función suma sus originales sin separar moneda: `availableOriginal=1144,26` mezcla AED+SAR+TRY+EUR y le asigna la moneda de la primera fila. Es un agregado inválido, aunque esa cifra original no se muestra actualmente en el recuadro especial.

Actualmente se excluyen del resumen superior y de Europa; el recuadro especial oculta su falta de valoración. Un GLOBAL de todo el ámbito consultado debería incluir los valores EUR conocidos sin país y contar los no valorados, siempre con deduplicación económica y estados separados. Una tarjeta Europa puede excluir registros cuya pertenencia geográfica no está demostrada, pero debe declarar su alcance y mostrar aparte los no asignados.

## Cálculo actual por marketplace

Datos de todas las observaciones seleccionadas por el código, incluidos históricos. “EUR disponible” es `availablePositiveEur`, el campo mostrado por la tarjeta país; no el saldo neto firmado.

| País | Original AVAILABLE acumulado | EUR disponible mostrado | Aporte positivo EUR del último instante |
|---|---:|---:|---:|
| BE | 678,91 EUR | 678,91 | 356,76 |
| DE | -10.415,58 EUR | 0 | 0 |
| ES | 14.290,64 EUR | 14.290,64 | 0 |
| FR | 2.212,61 EUR | 2.212,61 | 484,90 |
| GB | -5.304,03 GBP | EUR unavailable | 0 |
| IE | 246,75 EUR | 246,75 | 200,06 |
| IT | 478,04 EUR | 478,04 | Sin AVAILABLE observado en ese instante |
| NL | 0 EUR | 0 | 0 |
| PL | 0 PLN | 0 | 0 |
| SE | 5.406,82 SEK | EUR unavailable | 8,03 |

La función agrupa por marketplace, selecciona por identidad/precedencia y suma. Un NULL invalida el subtotal EUR del estado, y cualquier NULL invalida `totalEconomicEur` convirtiéndolo en cero. El experimento solicitado `[100 EUR, 200 EUR, NULL EUR]`, con identidades distintas, produce `availableEur=NULL`, `availablePositiveEur=NULL`, `totalEconomicEur=0`; no proporciona el subtotal conocido de 300 ni el contador pendiente.

## Cálculo actual GLOBAL

En esta UI hay un resumen superior “Amazon disponible para solicitar” y una tarjeta “Europa · equivalente EUR estimado”; no son un GLOBAL completo de todos los países.

- Resumen superior: selecciona AVAILABLE, elimina UNRESOLVED y NULL, conserva originales positivos y suma EUR. Resultado reproducido: **17.914,98 EUR**.
- Europa: filtra los diez países; **elimina las filas sin EUR antes de construir la tarjeta**. Resultado AVAILABLE positivo: **17.914,98 EUR**; saldo AVAILABLE firmado conocido: 1.669,78 EUR. El mismo ejemplo `[100,200,NULL]` aquí da 300, sin informar de la fila eliminada.
- De los 17.914,98 EUR positivos, **16.865,23 EUR vienen de agosto** y 1.049,75 EUR del último instante. El histórico aporta FR 1.727,71 + IT 478,04 + ES 14.290,64 + BE 322,15 + IE 46,69.
- Tras deduplicar siguen 164 filas europeas sin EUR: tres AVAILABLE y 161 DEFERRED. El consolidado no indica esta cobertura incompleta. La tarjeta SE oculta sus 8,03 conocidos mientras Europa los incorpora: ambas aplican criterios distintos.

**1.049,75 EUR no se propone como saldo correcto definitivo.** Es el subtotal positivo conocido de la última observación, no una certificación de cobertura completa del origen. Ausencia de un grupo en la última consulta no permite borrarlo o darlo por liquidado sin un contrato de cobertura y reconciliación. Lo demostrado es que la UI combina fechas y no presenta ese límite.

## Cálculo funcionalmente correcto propuesto

Separar por estado y ámbito: saldo original firmado por moneda, EUR conocido, EUR oficial/estimado, filas sin valoración y sus cantidades por moneda; además fecha/cobertura de observación. Para disponibilidad positiva, definir la unidad sobre la que se puede solicitar —grupo o cuenta de liquidación— antes de compensar negativos entre grupos o países. No sumar AVAILABLE, DEFERRED y PENDING_BANK como si todo fuera solicitables hoy.

Contrato propuesto por estado: `knownEur`, `unvaluedCount`, `unvaluedOriginalByCurrency`, `isComplete`, `staleCount`, `observedAt` y ámbito. Para `[100,200,NULL]`: **300 EUR conocidos + 1 partida pendiente de valoración**; `isComplete=false`. Para Suecia en el conjunto actual: **8,03 EUR conocidos + 5.317,28 SEK históricos pendientes de valoración**. Esta presentación no certifica vigencia del histórico.

El consolidado debe usar el mismo contrato que los países, sumar los conocidos y sumar los contadores/monedas pendientes. UNRESOLVED debe aparecer como una dimensión de asignación pendiente; NULL debe mantener su significado de desconocido. No mezclar monedas originales ni transformar una falta de valoración en ausencia de dinero.

## Bugs demostrados y cambios necesarios

| Capa | Hallazgo / cambio propuesto | Evidencia / límite |
|---|---|---|
| Persistencia y selección | Definir pertenencia a una ejecución completa, última observación y reconciliación de estados; separar históricos no revalidados. No basta con “última fila por source_key” para saldo actual. | 1.608 filas de agosto siguen entrando; 16.865,23 EUR AVAILABLE positivos. No se demuestra que todas estén liquidadas. |
| Persistencia | Diseñar enriquecimiento coherente en conflicto, con procedencia/versiones y preservación de valores oficiales; guardar trazabilidad mínima de observación/valoración. | Riesgo de misma clave sin FX en material; pérdida monetaria real no cuantificable. No modificar ON CONFLICT a ciegas. |
| FX | Validar presencia/tipo numérico antes de Number; conservar ausencias. Mantener NULL cuando no haya tasa; una fuente adicional necesitaría procedencia explícita. | ConvertedTotal NULL → cero oficial reproducido; no probado como causa de los ceros leídos. |
| Agregación | Retornar subtotal conocido y cobertura, quitar cero sustituto de NULL y no eliminar silenciosamente filas no valoradas en Europa. | Pruebas `[100,200,NULL]` y caso SE real. |
| Agregación | Agrupar originales por moneda en UNRESOLVED y mantener identidad económica al resolver país/cambiar estado. | Suma multimoneda inválida reproducida. No se encontró mismo grupo AVAILABLE/PENDING_BANK simultáneo en la selección real: ese doble conteo no se declara bug de producción. |
| UI | Mostrar conocidos + pendientes, saldo firmado frente a positivo solicitables, ámbito y antigüedad. Sustituir «Sin importes pendientes» cuando existan no valorados. | 776,31 AED y 369,75 SAR actuales ocultos por fallback a cero. |

Archivos de implementación a revisar en la siguiente fase: `modules/finance/services/amazonTreasuryObservations.ts`, `ecbFxService.ts`, `buildFinancialPlanning.ts`, `amazonCashForecast.ts`, `modules/finance/repositories/financialPlanningRepository.ts`, `modules/finance/types/planning.types.ts`, `modules/finance/components/FinancialPlanningPage.tsx`; cualquier cambio SQL de persistencia debe prepararse y revisarse por separado, sin aplicarlo en esta auditoría. No se propone tocar FX de pedidos ni otras RPC financieras.

## Pruebas ejecutadas y regresiones necesarias

Se añadió `modules/finance/services/availableAudit.characterization.test.mjs` con fixture real anonimizada `fixtures/available-audit-20260910.json`. Son **tests de caracterización del comportamiento actual, incluidos sus defectos**, no una certificación de que el cálculo sea correcto. Prueban subtotal NULL, filtro Europa, Suecia real, arrastre histórico real, UNRESOLVED real, ceros persistidos, negativos DE y ConvertedTotal NULL. Se ejecutó además la suite existente `amazonCashForecast.test.mjs`.

Comando: `node --experimental-strip-types --test modules/finance/services/availableAudit.characterization.test.mjs modules/finance/services/amazonCashForecast.test.mjs`.

Resultado final: **19 pruebas aprobadas, 0 fallidas** (8 nuevas + 11 existentes). La primera ejecución tuvo una aserción demasiado estricta sobre precisión binaria de JavaScript (1049,7499999999998 frente a 1049,75); se ajustó el test a céntimos y se repitió correctamente. No se cambió el cálculo de ejecución para hacer pasar pruebas. El replay local de las 3.657 filas terminó correctamente. No se ejecutó TypeScript global ni pruebas de escritura en producción.

Regresiones para una futura corrección: los ocho casos deben pasar a expectativas funcionales correctas; añadir integración de dos observaciones misma clave con FX posterior y preservación de conversión oficial, atomicidad/fallo parcial de ejecución, reaparición/ausencia de grupos con cobertura, resolución UNRESOLVED sin duplicación, transición de estado, varias monedas, negativos por unidad de liquidación y sumas país/consolidado con cobertura idéntica. La prueba de conflicto deberá ejecutarse en una base local aislada, nunca mediante escrituras de diagnóstico en producción.

## Archivos añadidos y riesgos abiertos

Añadidos por esta auditoría: este informe; el test de caracterización; su fixture; diagnósticos y replay locales `.codex-work/available-audit-*` y `.codex-work/replay-available-audit.mjs`. No se modificó código de ejecución, SQL funcional ni el error TypeScript de inventario. Los cambios previos del árbol de trabajo se conservaron.

Abiertos: diferencia entre cero RAW y coerción anterior al snapshot; reobservaciones de la misma clave; importe perdido por evidence-only; cobertura completa del origen y vigencia de grupos históricos; comparación directa con la pantalla Amazon. No se inventó precisión donde no se retuvo evidencia. Para cerrar estos puntos hace falta evidencia RAW mínima y trazabilidad de ejecuciones/valoraciones, o una captura futura específicamente autorizada; no repetir la sincronización como supuesto arreglo.

Antes de desplegar: acordar alcance GLOBAL y semántica de positivos, revisar una propuesta de cambios separada, verificar cobertura/reconciliación y ejecutar regresiones de persistencia en entorno aislado. Esta auditoría no contiene cambios para desplegar ni autoriza migraciones.
