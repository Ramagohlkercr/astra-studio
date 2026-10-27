# LaserHouse Studio — Software CAD/CAM de Etiquetas Láser

Aplicación industrial de diseño paramétrico, vectorización, distribución automática (nesting rectangular multi-tanda) y exportación en milímetros reales (`1:1 mm`) desarrollada para **LaserHouse**.

## 1. Equipamiento Objetivo

- **Computadora**: MacBook Pro Apple Silicon (`arm64`, macOS).
- **Máquina Láser**: Vank 9060 CO₂ (Área útil máxima: `900 × 600 mm`).
- **Controladora**: Ruida RDC8445S.
- **Software de Producción**: LightBurn Pro (vía SVG `1:1 mm`) y RDWorks V8 (vía DXF `AC1009` con `$INSUNITS = 4`).
- **Seguridad Operativa**: El software **no** se comunica directamente con la controladora Ruida ni inventa potencias o velocidades de corte. Genera archivos geométricamente exactos listos para revisión e importación en LightBurn o RDWorks.

---

## 2. Arquitectura Modular

1. **[`src/core/types.ts`](src/core/types.ts)**: Modelo de dominio unificado en milímetros reales (`Millimeters`).
2. **[`src/core/geometry/geometryEngine.ts`](src/core/geometry/geometryEngine.ts)** y **[`src/core/geometry/vectorFont.ts`](src/core/geometry/vectorFont.ts)**:
   - Generación de contornos cerrados exactos (`rectangle`, `square`, `rounded_rect`, `circle`, `oval`, `capsule`, `octagon_tag`, `custom_polygon`).
   - Perforaciones parametrizadas para costura o sujeción (`0`, `1`, `2`, `4` o personalizadas).
   - Compensación de Kerf (`kerfCompensationMm`) hacia afuera en contornos exteriores y hacia adentro en perforaciones internas.
   - Tipografía vectorial CNC paramétrica (independiente de fuentes del sistema operativo).
   - Auditoría geométrica (`validateLabelAndBatchGeometry`): verifica cierre de contornos (`Z`), `0` líneas duplicadas, `0` superposiciones y `0` piezas fuera de la mesa o márgenes.
3. **[`src/core/nesting/nestingEngine.ts`](src/core/nesting/nestingEngine.ts)**:
   - Distribución automática por cantidades (`1`, `25`, `50`, `100`, `200`, `300`, `500`, `1000+`).
   - Evaluación de orientación `0°` vs `90°` para maximizar capacidad por plancha/recorte.
   - División automática en tandas (`batches`) cuando la cantidad supera la capacidad de un recorte.
4. **[`src/core/materials/materialsCatalog.ts`](src/core/materials/materialsCatalog.ts)**:
   - Perfiles configurables para `ECOCUERO_SUELA`, `ACRILICO_TRANSPARENTE`, `ACRILICO_ESPEJO_PLATEADO`, `POLIAMIDA_BLANCA` (cinta 30 mm), `MDF_3MM` y `PAPEL_KRAFT`.
   - Advertencias de seguridad obligatorias para confirmar que todo ecocuero o material sintético sea libre de PVC/cloro antes de procesarse en láser CO₂.
5. **[`src/core/image/imageProcessor.ts`](src/core/image/imageProcessor.ts)** y **[`src/core/image/browserImageLoader.ts`](src/core/image/browserImageLoader.ts)**:
   - Importación de SVG, PNG y JPG/JPEG.
   - Procesamiento real de píxeles RGBA: detección de transparencia, eliminación de fondo, ajuste de brillo/contraste, umbral B/N (`threshold`), inversión y cálculo de DPI efectivo.
   - Vectorización real mediante **Marching Squares** + simplificación poligonal **Ramer-Douglas-Peucker (RDP)**.
6. **[`src/core/exporters/svgExporter.ts`](src/core/exporters/svgExporter.ts)**, **[`src/core/exporters/dxfExporter.ts`](src/core/exporters/dxfExporter.ts)** y **[`src/core/exporters/productionSummaryExporter.ts`](src/core/exporters/productionSummaryExporter.ts)**:
   - Exportación SVG (`width="...mm"`, `height="...mm"`, `viewBox="0 0 ... ..."`) y DXF (`AC1009`, `$INSUNITS=4`) generados a partir del **mismo modelo geométrico interno**.
7. **[`src/core/projects/projectManager.ts`](src/core/projects/projectManager.ts)**:
   - Guardado de pedidos y repetición instantánea con cambio de cantidad (ej. pasar un pedido de `200` a `500` unidades sin reconstruir el diseño).

---

## 3. Mapeo de Capas para LightBurn y RDWorks

| Operación | Capa LightBurn | Color Hex SVG | Capa DXF (RDWorks) | Color ACI DXF | Orden de Ejecución Recomendado |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Grabado (Logos / Texto)** | `00` | `#000000` (Negro) | `GRABADO` | `7` | 1° (Primero grabar antes de mover la pieza) |
| **Agujeros Internos** | `01` | `#0000FF` (Azul) | `AGUJEROS` | `5` | 2° (Cortar perforaciones antes de soltar la pieza) |
| **Corte Exterior** | `02` | `#FF0000` (Rojo) | `CORTE` | `1` | 3° (Corte perimetral final) |
| **Guías de Seguridad** | `T1` | `#F57900` (Naranja) | *(No se exporta)* | — | No productivo (sólo visual en editor) |

> **Nota importante sobre LightBurn**: Al importar el archivo `.svg` en LightBurn, asegúrese de que en `Settings -> File Settings -> SVG Import Settings` esté seleccionado `96 DPI` o detección de unidades físicas `mm` (el archivo declara explícitamente `width="900mm" height="600mm" viewBox="0 0 900 600"`). Importar un SVG asigna automáticamente los colores a las capas `00`, `01` y `02`, pero las velocidades (`mm/s`) y potencias (`%`) deben ser verificadas en el panel `Cuts / Layers` de LightBurn según el material.

---

## 4. Comandos de Ejecución y Verificación

```bash
# Ejecutar servidor de desarrollo interactivo
npm run dev

# Ejecutar suite completa de pruebas automatizadas (23 tests geométricos, de anidado, exportación e interfaz)
npm test

# Generar y auditar el lote reproducible de 200 etiquetas de 20x10 mm en exports/muestra_200_etiquetas_20x10mm/
npm run generate:sample200

# Compilar versión de producción
npm run build
```
