import { assertProductionGeometry, compileLabelGeometry, roundMm } from '../geometry/geometryEngine';
import {
  LabelDesign,
  LIGHTBURN_LAYERS,
  NestingResult,
  Point2D,
} from '../types';

export interface DxfExportArtifact {
  dxfContent: string;
  filenameSuggested: string;
  widthMm: number;
  heightMm: number;
  batchNumber: number;
  totalBatches: number;
  pieceCount: number;
  engravePolylineCount: number;
  holeContourCount: number;
  cutContourCount: number;
}

/**
 * Exportador DXF R12 (AC1009) de alta compatibilidad con RDWorks V8 (Ruida RDC8445S) y LightBurn Pro.
 * Parte exactamente del MISMO modelo geométrico interno en milímetros (compileLabelGeometry).
 *
 * Garantías de compatibilidad con RDWorks V8:
 * 1. Coordenadas numéricas expresadas directamente en milímetros (1.0000 = 1 mm real), sin depender de que RDWorks lea $INSUNITS.
 * 2. También declara $INSUNITS = 4 y $MEASUREMENT = 1 en HEADER para visores CAD/LightBurn.
 * 3. En contornos cerrados (CORTE y AGUJEROS), establece flag 70 = 1 Y emite explícitamente el vértice final coincidente con el inicial (gap = 0.0000 mm) para máxima compatibilidad con "Auto-close curves" de RDWorks.
 * 4. Orientación cartesiana estándar: y_dxf = sheetHeightMm - y_svg.
 */
export function exportProductionDxf(
  design: LabelDesign,
  nesting: NestingResult,
  batchIndex = 0
): DxfExportArtifact {
  if (design.elements.some(el => el.visible && el.type === 'logo_raster' &&
    (el.processing.mode !== 'vector' || el.vectorizedPathsNormalized.length === 0))) {
    throw new Error('DXF R12 no admite grabado raster. Exporte SVG o vectorice el logo antes de exportar DXF.');
  }
  assertProductionGeometry(design, nesting, batchIndex);
  const batch = nesting.batches[batchIndex] || nesting.batches[0];
  const sheetW = roundMm(nesting.config.sheetWidthMm);
  const sheetH = roundMm(nesting.config.sheetHeightMm);

  const dxfLines: string[] = [];
  const pushPair = (code: number, value: string | number) => {
    dxfLines.push(String(code));
    dxfLines.push(String(value));
  };

  // 1. HEADER SECTION
  pushPair(0, 'SECTION');
  pushPair(2, 'HEADER');
  pushPair(9, '$ACADVER');
  pushPair(1, 'AC1009');
  pushPair(9, '$INSUNITS');
  pushPair(70, 4); // 4 = Millimeters
  pushPair(9, '$MEASUREMENT');
  pushPair(70, 1); // 1 = Metric
  pushPair(9, '$EXTMIN');
  pushPair(10, 0.0);
  pushPair(20, 0.0);
  pushPair(30, 0.0);
  pushPair(9, '$EXTMAX');
  pushPair(10, sheetW);
  pushPair(20, sheetH);
  pushPair(30, 0.0);
  pushPair(0, 'ENDSEC');

  // 2. TABLES SECTION (LTYPE & LAYER)
  pushPair(0, 'SECTION');
  pushPair(2, 'TABLES');

  pushPair(0, 'TABLE');
  pushPair(2, 'LTYPE');
  pushPair(70, 1);
  pushPair(0, 'LTYPE');
  pushPair(2, 'CONTINUOUS');
  pushPair(70, 0);
  pushPair(3, 'Solid line');
  pushPair(72, 65);
  pushPair(73, 0);
  pushPair(40, 0.0);
  pushPair(0, 'ENDTAB');

  pushPair(0, 'TABLE');
  pushPair(2, 'LAYER');
  pushPair(70, 3);

  const layers = [
    LIGHTBURN_LAYERS.ENGRAVE,
    LIGHTBURN_LAYERS.HOLES,
    LIGHTBURN_LAYERS.CUT,
  ];
  for (const lyr of layers) {
    pushPair(0, 'LAYER');
    pushPair(2, lyr.name);
    pushPair(70, 0);
    pushPair(62, lyr.dxfColorIndex);
    pushPair(6, 'CONTINUOUS');
  }
  pushPair(0, 'ENDTAB');
  pushPair(0, 'ENDSEC');

  // 3. ENTITIES SECTION
  pushPair(0, 'SECTION');
  pushPair(2, 'ENTITIES');

  const emitPolyline = (
    layerName: string,
    colorIndex: number,
    pts: Point2D[],
    closed: boolean
  ) => {
    if (pts.length < 2) return;
    pushPair(0, 'POLYLINE');
    pushPair(8, layerName);
    pushPair(62, colorIndex);
    pushPair(66, 1); // Entities follow
    pushPair(10, 0.0);
    pushPair(20, 0.0);
    pushPair(30, 0.0);
    pushPair(70, closed ? 1 : 0);

    // Quantize before removing coincident consecutive vertices.
    const verticesToEmit = pts.map(p=>({x:roundMm(p.x,4),y:roundMm(p.y,4)})).filter((p,i,all)=>i===0 || p.x!==all[i-1].x || p.y!==all[i-1].y);
    if (closed && verticesToEmit.length >= 3) {
      const first = verticesToEmit[0];
      const last = verticesToEmit[verticesToEmit.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) > 0.0001) {
        verticesToEmit.push({ x: first.x, y: first.y });
      }
    }

    for (const pt of verticesToEmit) {
      pushPair(0, 'VERTEX');
      pushPair(8, layerName);
      pushPair(10, roundMm(pt.x, 4));
      pushPair(20, roundMm(sheetH - pt.y, 4));
      pushPair(30, 0.0);
    }

    pushPair(0, 'SEQEND');
    pushPair(8, layerName);
  };

  let engravePolylineCount = 0;
  let holeContourCount = 0;
  let cutContourCount = 0;

  if (batch && batch.placedInstances.length > 0) {
    for (const inst of batch.placedInstances) {
      const compiled = compileLabelGeometry(design, {
        offsetXMm: inst.xMm,
        offsetYMm: inst.yMm,
        rotated90: inst.rotated90,
        instanceIdPrefix: `pieza_${inst.instanceIndex}`,
      });

      // Capa GRABADO
      for (const eng of compiled.engravingItems) {
        if (eng.polylines && eng.polylines.length > 0) {
          for (const pl of eng.polylines) {
            if (pl.points.length >= 2) {
              engravePolylineCount++;
              emitPolyline(
                LIGHTBURN_LAYERS.ENGRAVE.name,
                LIGHTBURN_LAYERS.ENGRAVE.dxfColorIndex,
                pl.points,
                pl.closed
              );
            }
          }
        }
      }

      // Capa AGUJEROS
      for (const hole of compiled.holeContours) {
        holeContourCount++;
        emitPolyline(
          LIGHTBURN_LAYERS.HOLES.name,
          LIGHTBURN_LAYERS.HOLES.dxfColorIndex,
          hole.points,
          true
        );
      }

      // Capa CORTE EXTERIOR
      cutContourCount++;
      emitPolyline(
        LIGHTBURN_LAYERS.CUT.name,
        LIGHTBURN_LAYERS.CUT.dxfColorIndex,
        compiled.outerCutContour.points,
        true
      );
    }
  }

  pushPair(0, 'ENDSEC');
  pushPair(0, 'EOF');

  const batchNum = batch ? batch.batchNumber : 1;
  const totalBatches = batch ? batch.totalBatches : 0;
  const pieceCount = batch ? batch.count : 0;
  const cleanName =
    design.name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Etiqueta_Astra';

  return {
    dxfContent: dxfLines.join('\n') + '\n',
    filenameSuggested: `${cleanName}_${design.widthMm}x${design.heightMm}mm_${pieceCount}u_Tanda${batchNum}de${totalBatches}_RDWORKS.dxf`,
    widthMm: sheetW,
    heightMm: sheetH,
    batchNumber: batchNum,
    totalBatches,
    pieceCount,
    engravePolylineCount,
    holeContourCount,
    cutContourCount,
  };
}
