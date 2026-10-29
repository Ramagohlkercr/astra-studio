# Limpieza visual de LaserHouse Studio

Fecha: 2026-10-29. Base: fe4d21b.

- Cabecera simplificada y navegación con un único paso destacado; indicador accesible aria-current.
- Panel lateral con desplazamiento independiente y navegación inferior siempre visible. Al cambiar de paso, el contenido comienza arriba.
- Jerarquía tipográfica, separación entre secciones, campos y botones consistentes; foco visible por teclado y respeto a movimiento reducido.
- Selector de material compacto, con nombre, color y espesor. Se mantienen todos los materiales del catálogo.
- Barra de vista de producción simplificada (lote, plancha, mesa completa), estado inferior compacto y rótulo de tanda más discreto.
- Sin cambios en geometría, dimensiones, exportadores ni motor de distribución.

Verificación: 130 tests aprobados, TypeScript, Vite y bundle Tauri compilados correctamente. Se actualizaron tres expectativas de textos/controles en los tests existentes para reflejar los nuevos títulos, selector de material y paso activo.

Revisión nativa macOS de importación, grabado y producción con el pedido guardado: etiqueta 30×30 mm, logo visible 17.18×16.81 mm, 50 piezas en 10×5. No se modificó el diseño durante esa revisión. Capturas en los outputs del chat. Reglas de adaptación a ventanas pequeñas añadidas, sin una revisión visual exhaustiva de cada tamaño.

Aplicación actualizada: dist_macos/LaserHouse Studio.app.
Respaldo: dist_macos/LaserHouse Studio (Backup antes de limpieza visual).app.
