# Guardado por carpetas — Astra Studio

La aplicación de macOS guarda en Documentos/ASTRA LOGOS/<nombre>.
El botón Descargar grabado y corte (SVG) solicita el nombre y guarda dos SVG: Grabado_Tanda_N y Corte_Tanda_N, con el nombre elegido como prefijo. El corte incluye los orificios. La descarga corresponde a la tanda seleccionada.
Los proyectos JSON, DXF, hojas de taller y calibraciones usan el mismo diálogo y carpeta.
Las descargas repetidas agregan un número de versión sin sobrescribir archivos anteriores. Se validan los nombres y se muestran los errores de escritura para reintentar.
En navegador se descarga un ZIP con la misma estructura, dado que no dispone del guardado nativo de Tauri.

## Validación
- 144 pruebas de frontend aprobadas.
- 2 pruebas Rust aprobadas, incluyendo escritura de ambos archivos y conservación de versiones anteriores.
- TypeScript, compilación web y bundle macOS correctos.
- ZIP verificado con Python zipfile: rutas, Unicode, contenidos y CRC correctos.
- Aplicación actualizada en dist_macos/Astra Studio.app; respaldo previo en Astra Studio (Backup carpetas 2026-11-04).app.
- No se pudo completar la comprobación interactiva nativa: la ventana de la versión anterior dejó de responder a la herramienta de control. La instancia abierta requiere cerrarse y abrirse para usar la actualización. No se forzó su cierre para evitar perder trabajo abierto.
- No se verificó grabado físico ni importación en software de máquina en esta revisión.

## Corrección verificada en la aplicación
Destino actualizado a Escritorio/Astra grabados logo/<nombre>. Se cerró la instancia anterior y se abrió el bundle actualizado, conservando el pedido de 40×20 mm y 100 unidades. Se verificó el diálogo de nombre y el guardado nativo de dos SVG en Prueba Astra. Ambos XML válidos. Se verificaron en UI 5 columnas × 10 filas y 10 columnas × 5 filas, con dos tandas de 50 para 100 unidades. Se agregaron opciones explícitas 5×10, 10×5 y 5×5, manteniendo modo automático y ancho de plancha. 147 pruebas frontend y 2 Rust aprobadas; TypeScript y bundle macOS correctos. Esta comprobación resuelve la limitación de la revisión anterior.
