# Editor y distribución de etiquetas

Repositorio utilizado: /Users/ramirogohlke/Documents/Astra Studio (el proyecto existente de esta conversación).

## Correcciones

- Conversión de coordenadas mediante getScreenCTM().inverse(): respeta escala SVG y bandas de preserveAspectRatio.
- Cuatro agarres sobre el contenido visible, con rectángulo de selección y controles rotados juntos.
- Escala proporcional que responde a ambos ejes del mouse, sin deformación ni inversión de dimensiones.
- Esquina opuesta del contenido visible fija durante el resize, incluso con transparencia y rotación.
- Eliminación del hover:scale de los agarres, que desplazaba el blanco de interacción.
- Pointer capture, cancelación y conservación de selección durante la manipulación.
- Deshacer/Rehacer: un arrastre genera un único estado del historial, en lugar de uno por movimiento.
- Rotación relativa a la posición inicial del mouse: evita saltos al comenzar el giro.
- Entradas de ancho/alto visible convierten correctamente a dimensiones del lienzo y conservan el centro visible al editar.

## Distribución

Modo predeterminado en la interfaz: bloques. Hasta 25 unidades usa cinco columnas; desde 26 usa diez. Así 25 => 5x5 y 50 => 10x5. Cantidades mayores continúan hacia abajo (100 => 10x10, dos grupos de cinco filas), y generan tandas cuando se agota el material. Cantidades incompletas no generan etiquetas de más. Si el material no admite cinco/diez columnas, se usa el espacio físicamente disponible.

Se conserva el modo de aprovechar todo el ancho mediante un selector explícito. El modo se guarda dentro de nestingConfig.layoutMode. El motor mantiene el comportamiento anterior para consumidores históricos que no especifiquen el modo; la interfaz utiliza bloques para proyectos que aún no lo tengan configurado. Vista y exportadores consumen las mismas instancias del motor.

## Verificación

130 pruebas aprobadas (24 nuevas). TypeScript, Vite y Tauri ARM64 exitosos. Las pruebas nuevas cubren cuatro esquinas por cuatro rotaciones, transparencia asimétrica, arrastre vertical, reducción extrema, 25/50/100/200 unidades, recortes pequeños y edición de dimensiones visibles.

Prueba nativa mediante mouse: logo real del pedido abierto, tamaño visible 17.18x16.81 -> 21.63x21.16 mm mediante agarre inferior derecho; un solo Deshacer restaura 17.18x16.81. La validación advierte al invadir el contorno; no reduce automáticamente el ajuste manual. Producción con 50 piezas mostró 10 columnas x 5 filas en la aplicación real.

Se guardó/descargó el pedido abierto antes de reiniciar. Se dejó respaldo del bundle anterior en dist_macos/LaserHouse Studio (Backup antes de agarres y bloques).app. Bundle final actualizado en dist_macos/LaserHouse Studio.app. La prueba de arrastre corresponde al build previo a los últimos ajustes de campos numéricos y rectángulo de selección; esos últimos ajustes se verificaron con suite y recompilación final.

No se probó fabricación física ni importación en LightBurn/RDWorks durante este cambio.
