# AUDITORÍA INTEGRAL CODEX — LaserHouse Studio

Fecha: 29 de octubre de 2026. Entorno: macOS 26.6 (25G72), ARM64, 24 GiB de RAM. Repositorio: `/Users/ramirogohlke/Documents/Astra Studio`.

## 1. Resumen ejecutivo

**No doy aprobación para producción comercial sin supervisión.** La versión inicial tenía errores reproducibles de centrado, proporción, importación, contornos, márgenes, exportación y recuperación de proyectos. Se corrigieron los problemas documentados abajo, se recompiló el bundle macOS y se verificó su arranque, reapertura de proyecto y exportación real local.

Las 77 pruebas originales pasan, pero no detectaban estos casos. La suite final tiene **106 pruebas aprobadas**: 77 originales y 29 nuevas. Contra una copia limpia de `493601f`, las 29 nuevas producen **28 fallos y 1 aprobación**; la aprobación corresponde a un caso corrupto que el código anterior ya rechazaba mediante una excepción incidental. Los registros permiten comparar antes y después.

La revisión independiente ejecutó 524 distribuciones (224 combinaciones fijas y 300 aleatorias con semilla), 60.928 piezas en la matriz fija y lectura de 14 archivos mediante un parser XML y un lector de pares DXF ajenos a los validadores del producto.

**No se validó LightBurn, RDWorks ni la máquina física.** Tampoco se ejecutó toda combinación posible de los casos solicitados. El apartado 15 delimita los casos no probados; esta auditoría no equivale a certificar ausencia de errores.

## 2. Estado real y trazabilidad

- Base confirmada: `493601f`, árbol Git inicialmente limpio; sin cambios del usuario que preservar.
- Correcciones y nuevas pruebas: commit `d0c7f77`.
- Rama existente `main`; se crearon commits locales por pedido del usuario. Sin push, merge, publicación ni conexión a la máquina.
- El bundle original declaraba 0.4.0 y NO mostraba selector mm/cm ni presets 40×20/60×40 presentes en la fuente base. Su comportamiento no correspondía al código revisado. No se puede atribuir ese binario a `493601f`.
- SHA256 original del ejecutable: `2d1beea066add3e5f974fb4337751bc1cd22c2c9f603c2806f86f8d472106c4f`.
- SHA256 final del ejecutable: `95b565c468216f0be89010e8deb0d21ab0e163c6122bc2a608fbc82c7cbc023d`.
- El ejecutable instalado en `dist_macos` coincide con el generado en `src-tauri/target/release/bundle/macos`; evidencia: `audit/bundle-hashes.txt`.
- Respaldo preservado: `dist_macos/LaserHouse Studio (Backup pre-Codex 2026-10-29).app`.

## 3. Inventario de módulos, dependencias y riesgos

El inventario completo de archivos fuente, tamaños y líneas está en `audit/source-inventory.json`. La inspección y correcciones se concentraron en las rutas que determinan geometría y archivos de fabricación.

| Módulo | Responsabilidad | Riesgo principal revisado |
|---|---|---|
| `src/App.tsx` | Asistente, estado, historial, archivos, catálogo | Estado desincronizado, importación, mensajes de validación |
| `LabelEditorCanvas.tsx` | SVG interactivo, arrastre, tamaño, rotación | Diferencia entre lienzo, contenido y corte |
| `ProductionBedPreview.tsx` | Símbolo maestro e instancias en mesa | Rotación, límites y conteo |
| `geometryEngine.ts` | Contornos, paths, centrado, ajuste, validación | Rotaciones, proporción, curvas, agujeros, márgenes |
| `vectorFont.ts` | Fuente vectorial interna | Cobertura de caracteres y tamaño real del texto |
| `imageProcessor.ts` | Máscara, eliminación de fondo, trazado, importación SVG | Pérdida de detalle y SVG parcialmente interpretado |
| `browserImageLoader.ts` | Decodificación/canvas y conservación del original | Resolución de trabajo y memoria |
| `nestingEngine.ts` | Grilla, rotación 0/90°, tandas | Conteo, separaciones, kerf y entradas extremas |
| `svgExporter.ts` | SVG mm, capas, imágenes incorporadas | Archivo incompleto o XML inválido |
| `dxfExporter.ts` | DXF R12, polilíneas y eje Y | Pérdida de raster y aproximación de curvas |
| `fileFormatValidator.ts` | Auditoría interna por expresiones regulares/pares DXF | No reemplaza parser CAD ni importación real |
| `projectManager.ts` | Catálogo, JSON, duplicación y localStorage | Corrupción, pérdida silenciosa y compatibilidad |
| `materialsCatalog.ts` | Perfiles visuales y parámetros | Parámetros físicos aún no validados |
| `productionSummaryExporter.ts`, `kerfCalibrationGenerator.ts` | Hoja de taller y patrón de calibración | Verificación física pendiente |
| `src-tauri` | WebView nativa, configuración y capacidades | Procedencia del bundle, CSP y permisos |

Versiones instaladas verificadas: React 18.3.1, TypeScript 5.6.3, Vite 6.4.5, Vitest 2.1.9, API/CLI Tauri 2.12.4, Playwright Core 1.64.1. Cargo declara Tauri 2.12.5; la compilación resolvió las dependencias instaladas. Las versiones de producto siguen inconsistentes: package/Cargo 0.1.0, configuración nativa 0.4.0 y texto del generador SVG 0.2.0. Pendiente unificar metadatos.

No se hizo una auditoría de CVE ni de la cadena de suministro. No se actualizaron dependencias durante esta intervención.

## 4. Hallazgos reproducibles y estado

P0: no se reprodujo un fallo clasificable como P0 durante estas pruebas. Esto no demuestra su inexistencia.

| ID | Severidad | Módulo | Problema | Reproducción | Estado |
|---|---|---|---|---|---|
| C01 | P1 | Centrado | Ignoraba rotación del desplazamiento visible | Logo asimétrico 90°, 40×20: centro X=17 en vez de 20 | Corregido |
| C02 | P1 | Límites | Bounding box visible ignoraba rotación | Caja visible 6×4 debía ser 4×6 a 90° | Corregido |
| C03 | P1 | Ajuste | Deformaba el lienzo con márgenes transparentes asimétricos | Relación 2 pasaba a 2,66658 | Corregido |
| C04 | P1 | SVG entrada | Inventaba un rectángulo si no encontraba trazados | Importar `<svg><text>Hello</text></svg>` | Corregido: rechazo explícito |
| C05 | P1 | SVG entrada | Descartaba transformaciones de grupos | Rectángulo bajo `translate(50 0)` | Mitigado: rechazo explícito; soporte completo pendiente |
| C06 | P1 | Agujeros | Centro interior permitía radio que cruzaba borde curvo | Oval 40×20; agujero Ø4 en (7,4) | Corregido |
| C07 | P1 | Contorno | Rotar polígono personalizado no rotaba sus vértices | Triángulo asimétrico; comparar (H−y,x) | Corregido |
| C08 | P1 | DXF | Omitía silenciosamente el grabado raster | Logo raster + exportar DXF: sólo cortes | Corregido: rechaza; usar SVG o vectorizar |
| C09 | P1 | Curvas DXF | Unía controles Bézier en vez de puntos de la curva | Cúbica (0,0)-(0,100)-(100,100)-(100,0) | Corregido: muestreo compartido |
| C10 | P1 | Exportación | Permitía exportar geometría marcada inválida | Agujero Ø4 en (0,0), invocar exportador | Corregido: barrera en SVG/DXF |
| C11 | P1 | Anidado | Kerf invadía margen izquierdo/superior | Kerf 0,4, margen 5: corte comenzaba en 4,8 | Corregido |
| C12 | P1 | SVG límites | Extraía números como pares ignorando comandos | `M 60 20 h 30 v 20 h -30 Z` | Corregido |
| C13 | P1 | Proyectos | Admitía estructura inválida y números no finitos | `elements={}`, ancho `1e999`, tipo desconocido, viewBox inválido | Corregido en variantes ensayadas |
| C14 | P1 | Proyectos/UI | Archivo descargado sin recorrido para reabrirlo | Buscar control de importación del JSON guardado | Corregido |
| C15 | P2 | UI exportar | Declaraba listo aunque ninguna pieza cupiera | Etiqueta 900×600 con márgenes positivos | Corregido: muestra bloqueo |
| C16 | P1 | Anidado | Gap negativo: cálculo y colocación discrepaban | Gap X=−10 con 25 piezas | Corregido: entrada rechazada |
| C17 | P1 | Círculo | Forma circular de 40×20 generaba elipse | Compilar círculo con medidas distintas | Corregido; círculo exige medidas iguales al exportar |
| C18 | P1 | Área segura | Margen excedido era sólo advertencia exportable | Margen 5; logo 4×4 centrado en (3,10) | Corregido: bloquea exportación |
| C19 | P2 | Raster | Transparencia vacía se trataba como grabado fuera del corte | Lienzo 50×30 con contenido pequeño centrado | Corregido |
| C20 | P1 | Curvas | Círculo DXF grande se desviaba del SVG exacto | Ø200: desviación de cuerda 0,21415 mm | Corregido en regresión: <0,01 mm |
| C21 | P2 | XML | Nombre podía cerrar el comentario SVG | Nombre `logo --> <oops> <!--` | Corregido: escape XML |
| C22 | P1 | Guardado | Error de cuota local se ignoraba | `setItem` lanza QuotaExceededError | Corregido: fallo informado y descarga JSON preservada |
| C23 | P2 | Reapertura | Logo de otro proyecto no quedaba seleccionado | Abrir proyecto con ID de elemento distinto | Corregido; comprobado en bundle final |
| C24 | P1 | Distribución macOS | Binario publicado desactualizado | Comparar paso 2 original con fuente base | Corregido: bundle nuevo y hash registrado |

Los IDs agrupan síntomas relacionados; no son un conteo de pruebas ni de vulnerabilidades independientes. Las evidencias `audit/regressions-*-before.txt`, `audit/final-regressions-on-base.txt` y las pruebas añadidas contienen los casos ejecutables.

## 5. Causas y correcciones técnicas

El centrado y la caja visible ahora aplican la rotación alrededor del centro del lienzo antes de calcular la envolvente. El ajuste usa un único factor sobre ancho y alto existentes; no confunde relación del contenido visible con relación del lienzo. El ajuste de texto escala también el espaciado. El reprocesamiento de una imagen conserva posición, dimensiones, rotación y flags del elemento existente.

El parser de límites SVG interpreta comandos relativos/H/V y curvas mediante el mismo transformador geométrico. Los SVG con transformaciones o elementos explícitamente no admitidos se rechazan en lugar de importar geometría alterada. Esto es una limitación funcional declarada, no soporte universal de SVG.

Las curvas C/S/Q/T se muestrean para compartir geometría SVG/DXF. Los arcos y contornos circulares tienen subdivisión adaptativa. Las polilíneas siguen siendo aproximaciones: la regresión circular mide error <0,01 mm, pero no prueba una cota universal para todos los SVG posibles.

La comprobación de agujeros mide distancia a segmentos del contorno, además de comprobar el centro. La compensación de kerf coloca el origen nominal a medio kerf dentro de la envolvente reservada. Los exportadores bloquean tandas inexistentes y geometría inválida; el DXF rechaza imágenes raster para evitar archivos parciales.

La reapertura restaura diseño, material, selección, tanda e historial inicial. Se validan estructura y valores principales; versiones futuras se rechazan explícitamente. El formato v1 y los objetos históricos sin envoltorio siguen usando el mismo recorrido. No se certifica compatibilidad con versiones antiguas de las que no se dispuso de archivos.

## 6. Archivos modificados y pruebas nuevas

Commit `d0c7f77`: `src/App.tsx`, `src/core/geometry/geometryEngine.ts`, `src/core/image/imageProcessor.ts`, `src/core/nesting/nestingEngine.ts`, `src/core/projects/projectManager.ts`, `src/core/exporters/svgExporter.ts`, `src/core/exporters/dxfExporter.ts`.

Añadidos: `src/core/__tests__/codexAudit.test.ts`, `src/__tests__/CodexUI.test.tsx`, `scripts/codex-independent-audit.ts`. No se alteraron las aserciones de las 77 pruebas originales para hacerlas pasar.

Los registros y fixtures se guardan bajo `audit/`. El informe y evidencias se incorporan en un segundo commit documental.

## 7. Pruebas efectivamente ejecutadas

| Área | Verificado | Límite |
|---|---|---|
| Base | 77/77 pruebas existentes | Emiten avisos de navegación no implementada de jsdom |
| Suite final | 106/106 en seis archivos | No implica cobertura total |
| Regresión contra base | 28 fallan, 1 pasa de 29 nuevas | Logs completos conservados |
| Medidas | 10×10,20×10,40×20,35×15,27,5×12,5,60×40,17,125×9,75 | Matriz de motor; no cada combinación en GUI |
| Unidades UI | 40×20 → 4×2 cm → 2,75×1,25 → 27,5×12,5 mm | E2E web de producción |
| Imágenes UI | PNG transparente/blanco, JPG, baja resolución, anillo, detalle fino | Fixtures sintéticos; no inspección de cada píxel exportado |
| SVG UI | Muestras hexágono/huecos; rechazo de transformado | No parser general de todo SVG |
| Errores UI | PNG dañado, SVG no admitido, proyecto diferente | No corpus exhaustivo de archivos hostiles |
| Producción UI | 1,25,50,100,200,300,500,1000 | Cantidad y tandas observadas |
| Producción motor | 224 casos fijos + 300 aleatorios | Grilla rectangular; sin mezcla de orientaciones |
| Persistencia | Roundtrip exacto, recarga web, abrir JSON web/nativo | No apagado forzado ni recuperación de disco |
| Exportación | XML y pares DXF independientes, escala y dimensiones | Importación en CAD destino pendiente |
| macOS | Arranque, seis pasos originales; reapertura/centrado/exportación en final | Ver apartado 11 |

Los tests existentes cubren además agujeros 0/1/2/4/custom, formas, kerf, undo/redo y trazado con huecos. Se ejecutaron de nuevo; no se sustituyeron por afirmaciones del informe anterior.

## 8. Caso crítico de centrado

Fixture real generado: `audit/fixtures/asymmetric-transparent.png`, 200×120 píxeles; contenido desplazado y hueco interior. Etiqueta 40×20 mm, dos agujeros laterales.

El JSON descargado conserva `originalDataUrl`, `processedDataUrl`, dimensiones, agujeros y contenido normalizado. Cálculo independiente del centro visible en ese archivo: **(20,00034; 10,0002239) mm**, error <0,001 mm por eje. Evidencia: `audit/e2e-file-results.json` y `audit/fixtures/critical-project.lhstudio.json`.

La regresión de 90° contrasta el centro contra la geometría compilada; la versión base se desplazaba 3 mm en X. La acción CENTRAR LOGO no aplica corrección óptica: traslada el centro geométrico de la envolvente visible. Los micromovimientos siguen siendo decisiones manuales del operador.

Se comprobó recarga y reapertura del proyecto; no se probó en UI toda la secuencia solicitada de cambiar forma, rotar por arrastre, escalar y reabrir en cada combinación. Esas combinaciones no deben darse por certificadas por este caso.

## 9. SVG/DXF: resultados y diferencias

El script independiente no importa `fileFormatValidator.ts`. Usa JSDOM para XML y un lector propio de entidades/puntos DXF. Comprueba 14 archivos, siete dimensiones, 25 piezas por archivo, milímetros, viewBox, cierre, cantidad, tamaño y correspondencia de vértices tras invertir Y. Las verificaciones de equivalencia son de etiquetas rectangulares sin grabado; las curvas tienen regresiones específicas adicionales.

SVG raster descargado en navegador: **238 elementos image incorporados**; base64 decodificable como PNG. SVG raster descargado del bundle final: **200 imágenes incorporadas**, dimensiones 900×600 mm. Ninguno depende de un archivo de imagen externo en estos casos. Evidencias: `audit/e2e-file-results.json`, `audit/native-file-results.json`.

DXF R12 contiene contornos y grabado vectorial. **No soporta raster**: ahora rechaza esa exportación e indica usar SVG o vectorizar. La vectorización cambia la representación y debe revisarse visualmente. SVG puede conservar curvas y raster; DXF usa polilíneas aproximadas y eje Y cartesiano.

No se garantiza asignación final de capas, rellenos, huecos, orden de corte, unidades o precisión al importar en LightBurn/RDWorks hasta ejecutar esa importación. Los comentarios históricos del exportador prometían compatibilidad que esta auditoría no considera demostrada.

## 10. Rendimiento

La matriz independiente completa final tardó aproximadamente **76 ms** en una ejecución y usó aproximadamente **189 MiB RSS** en el proceso Node/JSDOM. Incluye generación/comprobación de distribuciones y parsers del script; **no es una medición del rendimiento gráfico ni un pico de memoria**. En los registros Vitest hay casos de 500 piezas de cientos de milisegundos, que incluyen validación/exportación.

Se recorrieron cantidades hasta 1000 en la interfaz sin observar bloqueo durante las acciones. No se midieron FPS, latencia sostenida ni fugas tras horas de uso.

Muestra puntual del bundle final: proceso nativo ~109 MiB RSS y WebContent ~107 MiB. Son dos procesos, no una medición de pico ni un perfil de memoria completo. Los datos se conservan en `audit/native-process-memory.txt`.

Se agregó un límite explícito de recursos de 100.000 unidades por cálculo y rechazo de cantidades no enteras/no finitas. No altera las cantidades solicitadas de 1 a 1000. No se recomienda usar ese límite como objetivo de producción sin benchmark adicional.

## 11. Aplicación macOS

Se operó el ejecutable real mediante herramientas de interfaz, mouse y teclado. El original recorrió los seis pasos y descargó un SVG. El final abrió un proyecto JSON mediante diálogo nativo, restauró logo/medidas/agujeros, mostró controles del logo, lo centró y descargó otro SVG local verificado.

Se cerró y reinició la aplicación varias veces durante la validación. Se conservó el bundle anterior antes de compilar. El final está en `dist_macos/LaserHouse Studio.app`; no se instaló en `/Applications` ni se publicó.

La página nativa fue `tauri://localhost`, no una pestaña de Vite. El bundle incluye frontend de producción. Existía un servidor Vite del usuario durante la sesión: no se lo terminó. Por ello no afirmo una prueba explícita con TODOS los servidores detenidos ni con la red físicamente desconectada.

Inspección `otool -L`: dependencias del sistema macOS, sin ruta a una biblioteca del workspace en el binario inspeccionado. El original tenía firma ad hoc, sin TeamIdentifier. No se efectuó notarización ni firma de distribución.

No probados: inicio desde Dock/Finder específicamente, todas las carpetas y permisos, ventanas de múltiples tamaños en la aplicación nativa, otros monitores/Retina, recuperación tras crash, Gatekeeper en otro Mac, conectividad completamente deshabilitada y captura exhaustiva de consola nativa.

## 12. Seguridad y entradas no confiables

La capacidad Tauri declarada es `core:default`; Rust inicia la WebView y activa log en debug. No se encontraron comandos propios de shell/archivos expuestos en el código Rust inspeccionado. `csp` sigue siendo `null`: endurecimiento pendiente, sin afirmar un exploit reproducido.

Se mitigaron importación SVG silenciosamente incompleta, XML generado a partir de nombres y variantes de JSON corrupto. No se hizo fuzzing completo de XML, imágenes comprimidas, polígonos auto-intersectados ni estructura JSON arbitraria. La validación de proyectos se fortaleció pero no es una especificación formal de todo el esquema.

No se accedió a cookies, credenciales ni sesiones privadas. No se conectó ni operó el láser. Las pruebas se hicieron con fixtures sintéticos y proyectos de muestra.

## 13. Comandos y resultados

`npm` no estaba en el PATH del shell. Se usó el Node suministrado por el entorno y los ejecutables ya instalados en `node_modules`; no se reinstalaron paquetes.

```sh
export PATH='/Users/ramirogohlke/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':/Users/ramirogohlke/.cargo/bin:$PATH
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node node_modules/tsx/dist/cli.mjs scripts/codex-independent-audit.ts
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4177 --strictPort
node node_modules/@tauri-apps/cli/tauri.js build --bundles app --config '{"build":{"beforeBuildCommand":""}}'
cargo test --manifest-path src-tauri/Cargo.toml --offline
git diff --check
```

| Verificación | Resultado | Evidencia |
|---|---|---|
| Vitest final | 106 aprobadas | `audit/tests-after.txt` |
| TypeScript | Salida 0, sin diagnósticos | `audit/typecheck.txt` (vacío por éxito) |
| Vite producción | Éxito | `audit/build.txt` |
| Auditoría independiente | Asserts completados | `audit/independent-results.json` |
| E2E UI | Recorrido ejecutado, resultados anteriores | `audit/e2e-session.md` y capturas |
| Tauri release ARM64 | Éxito, bundle app | `audit/tauri-build.txt` |
| Rust | Éxito; **0 tests definidos** | `audit/rust-tests.txt` |
| Diff whitespace | Sin errores | Comando ejecutado |

El override Tauri sólo omite su `beforeBuildCommand: npm run build`, porque el frontend acababa de compilarse con tsc/Vite y npm no estaba disponible. No se cambió la configuración persistida para eludir el build.

## 14. Problemas pendientes y riesgos de producción

- Soporte SVG general pendiente: transforms, estilos, textos, referencias, máscaras y efectos no se convierten integralmente. Algunos se rechazan; no se certifica toda variante estilizada o malformada.
- La zona segura utiliza envolventes conservadoras y aproximaciones poligonales. No hay demostración formal de contención para todo polígono cóncavo, stroke, rotación y agujero personalizado. No asumir que cualquier contorno arbitrario es producible porque pase un caso simple.
- El motor distribuye una grilla de orientación uniforme. No optimiza mezclas de orientaciones ni nesting irregular real; puede desperdiciar material. No se agregó una funcionalidad nueva de packing.
- El loader limita trabajo a 640 píxeles raster y 280 al vectorizar. La fidelidad de detalles de archivos mucho mayores y el DPI presentado frente a esa reducción requieren ensayo específico.
- Fuente vectorial interna: cobertura de caracteres, acentos, sustituciones y tipos de letra requieren pruebas adicionales con texto de clientes.
- Historial durante arrastre prolongado y carreras de reprocesamiento asíncrono no se sometieron a stress sostenido.
- localStorage tiene cuota; ahora se informa fallo, pero el respaldo JSON descargado sigue siendo esencial. No se implementó recuperación transaccional ni migraciones de esquemas desconocidos.
- Metadatos de versión inconsistentes y CSP sin endurecer. No se certificó distribución firmada/notarizada.
- Los perfiles de material tienen parámetros físicos pendientes y no fueron calibrados en esta sesión.

## 15. No probado / bloqueado por herramientas

**Bloqueado por herramientas o entorno de destino:** importación en LightBurn (no instalado), RDWorks no disponible para validar aquí, y validación física Vank excluida expresamente del trabajo autorizado.

**No probado, sin atribuirlo a falta de herramientas:** corpus de logos reales de clientes, archivos muy grandes y bombas de descompresión; todas las transformaciones/estilos SVG; cada secuencia de forma/agujeros/rotación/resize/reapertura; sesiones largas; todos los permisos y tamaños de ventana; restauración de versiones históricas no aportadas; pérdida de energía; comparar cada capa curva con un segundo motor CAD; exhaustividad del parser y seguridad.

Esto distingue limitaciones del alcance de los fallos corregidos. No presento los puntos no probados como aprobados ni como errores reproducidos.

## 16. Validación pendiente en LightBurn y RDWorks

Importar las parejas SVG/DXF de `audit/fixtures/rectangle-*.{svg,dxf}`. Medir ancho/alto real, verificar unidades, invertir eje sin espejar arte, separar capas, comprobar cierre y ausencia de doble pasada. Importar el SVG raster nativo y verificar las imágenes y transparencia. Después ensayar un caso curvo, otro girado, logo con huecos y varias tandas; comparar todas las piezas, no sólo la primera.

Configurar operaciones de grabado/corte y revisar el orden en el software destino. La existencia de colores/capas en el archivo no demuestra por sí sola que el programa destino asigne las operaciones esperadas.

## 17. Validación pendiente en Vank 9060

El operador debe realizar la validación física autorizada por separado: material conocido y perfil confirmado, muestra de dimensiones conocidas, calibración de kerf, agujeros y márgenes, revisión de encuadre y medición de la pieza terminada. Esta auditoría no aporta velocidades/potencias certificadas ni afirma compatibilidad física con la Ruida RDC8445S.

## 18. Commits y entregables

- `d0c7f77`: correcciones, regresiones y script independiente.
- Segundo commit documental: este informe y `audit/`; consultar `git log -2 --oneline` para su ID (el documento no puede incluir su propio hash sin cambiarlo).
- Informe: `AUDITORIA_INTEGRAL_CODEX.md` en el repositorio y copia en outputs del chat.
- Evidencias: logs, fixtures, JSON de resultados y capturas. Las capturas distinguen original, E2E web y bundle final.
- Bundle actualizado y respaldo: rutas del apartado 2. Ningún push ni publicación.

## 19. Decisión y próximos pasos

La versión corregida puede pasar a **validación controlada de archivos y muestras**, con las limitaciones descritas. No debe tratarse como un sistema plenamente certificado para pedidos de clientes.

Prioridad siguiente: importar los archivos en LightBurn/RDWorks y cerrar la validación física. Después ampliar el corpus de SVG/contornos y realizar stress de imágenes grandes/persistencia. Antes de distribución a terceros, unificar versiones, endurecer CSP, revisar esquemas y firmar/notarizar el bundle.
