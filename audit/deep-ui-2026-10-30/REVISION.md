# Astra Studio: revisión visual y funcional
Fecha: 30 de octubre de 2026. Base: 75a62e6.

## Interfaz
- Campos de pedido y cliente identificados; navegación numerada sin confundir pasos visitados con validaciones.
- Encabezado del área de trabajo, medidas persistentes y lienzo adaptable al tamaño de ventana.
- Zoom visible con acercar, alejar y restablecer encuadre; muestra de logos en sección desplegable.
- Controles de grabado agrupados y rotación numérica con restablecimiento.
- Descargas centralizadas, selector explícito de tanda y explicación de SVG/DXF para imágenes.
- Errores visibles junto a las descargas, estados de error rojos y acciones bloqueadas cuando la geometría es inválida.
- Biblioteca de pedidos como diálogo modal, cierre con Escape y mensaje para búsquedas vacías.

## Correcciones funcionales
- Material incluido en Deshacer/Rehacer; historial inicial coherente con el modo bloques.
- Alineación basada en los límites visibles rotados, incluidos logos con margen transparente.
- Reprocesado de imágenes conserva posición, dimensiones y orientación. Se ignoran respuestas antiguas si cambió el diseño y se desactivan los controles durante el procesamiento.
- DPI calculado a partir de los píxeles procesados y el tamaño actual, sin reutilizar un valor desactualizado después de redimensionar.
- Selección de tanda se corrige al reducir cantidad; cantidad personalizada redondeada a unidades enteras.
- Guardar conserva la fecha original y el historial de exportaciones existente; material personalizado restaurado al iniciar.
- Atajos de deshacer respetan la edición de campos de texto. Nuevo pedido reinicia selección de logo y tanda.

## Comprobaciones realizadas
141 pruebas automatizadas aprobadas (11 nuevas), TypeScript, build Vite y bundle Tauri correctos.

| Apartado | Evidencia de esta revisión |
|---|---|
| Logo | Muestras PNG y SVG con huecos; inversión PNG y conservación de rotación de 45° |
| Medidas | Conversión cm/mm y entradas 3,5 × 2,5 cm = 35 × 25 mm |
| Orificios | Cuatro esquinas en interfaz y validaciones existentes de otros presets en tests |
| Grabado | Ajuste a zona segura, rotación numérica, zoom y arrastre de agarre; ancho 33,09 → 36,40 mm y restauración con Deshacer |
| Producción | Material y Deshacer; 500 etiquetas 40×20 mm en plancha 200×200 mm, 16 tandas |
| Exportación | Descarga real de SVG y DXF de tanda 16: 20 etiquetas; XML comprobado con 20 elementos de grabado, 80 orificios y 20 cortes; archivos en mm |
| Pedidos | Guardado JSON, búsqueda, estado vacío, Escape y reapertura con medidas y cantidad conservadas |
| Ventanas | Revisión visual en 1280×720, 1120×720 y aplicación nativa macOS |

La descarga DXF se verificó como archivo generado y se contabilizaron sus 200 polilíneas; no se abrió en RDWorks. No se realizó corte físico ni importación en LightBurn/RDWorks. Las pruebas de interfaz cubren recorridos representativos; no equivalen a garantizar todas las combinaciones de archivos, materiales o tamaños extremos. JPG y SVG no soportados se mantienen sujetos a las limitaciones documentadas en la auditoría previa.

## Instalación
Aplicación: dist_macos/Astra Studio.app.
Respaldo: dist_macos/Astra Studio (Backup visual 2026-10-30).app.
Comprobación nativa final: pedido de 30×15 mm, logo visible 11,33×11,09 mm y 50 unidades conservados. El pedido real no fue usado para las pruebas destructivas de diseño; estas se hicieron en el navegador de prueba.
