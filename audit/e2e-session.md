# Registro E2E ejecutado mediante Computer Use

Fecha: 2026-10-29, America/New_York.

## Bundle original
- Abrir dist_macos/LaserHouse Studio.app; URL tauri://localhost.
- Navegar 1 Logo, 2 Medidas, 3 Orificios, 4 Grabado, 5 Producción, 6 Exportar.
- Selector mm/cm ausente en el bundle original, presente en fuente 493601f.
- Descargar SVG de 200 piezas; archivo creado en Downloads.

## Compilación web de producción (Vite preview 127.0.0.1:4177)
- SVG Huecos; 40x20 mm; cambiar a cm (4 y 2); ingresar 2,75 y 1,25; volver a mm (27.5 y 12.5).
- Importar asymmetric-transparent.png (200x120); luego 40x20 mm; 2 agujeros laterales; CENTRAR LOGO.
- Guardar JSON, recargar página, conservar diseño y abrir el JSON descargado mediante Abrir archivo.
- Cantidades 1/25/50/100/200/300/500/1000: las ocho mostraron conteo esperado.
- Material 600x400; 1000 piezas divididas en 5 tandas, 238 en la primera.
- Descargar SVG raster: 238 imágenes data:image/png;base64; comprobar mediante ElementTree y decodificación PNG.
- Intentar DXF raster: mensaje explícito de incompatibilidad, sin archivo parcial.
- Importar white-background.png, asymmetric.jpg, low-resolution.png, circular-hole.png, fine-detail.png: los cinco nombres aparecieron en la interfaz, sin errores de consola capturados.
- Importar transformed.svg: error recuperable de SVG no compatible.
- Importar corrupt.png: error No se pudo decodificar el archivo de imagen; conserva el logo anterior.
- Algunos selectores de comprobación iniciales agotaron su espera porque el nombre no lleva extensión y el error PNG empieza con No se pudo; se corrigieron los selectores y se verificaron los resultados. No fueron fallos de la aplicación.

## Bundle final
- Arranque tauri://localhost; abrir critical-project JSON por el diálogo nativo.
- 40x20 mm, dos agujeros, logo raster visible y seleccionado con controles de procesamiento.
- CENTRAR LOGO: centro físico (20,10); captura Nativo-final-centrado.png.
- Exportar SVG: toast de éxito y archivo local real; ElementTree verifica 200 imágenes incorporadas.
- Cierres y reinicios realizados durante la sustitución del bundle; respaldo original preservado.

Estas acciones E2E se ejecutaron de forma interactiva por herramientas de UI, no mediante un runner Playwright guardado. El script codex-independent-audit.ts reproduce la matriz geométrica/exportaciones, no reemplaza este recorrido UI.
