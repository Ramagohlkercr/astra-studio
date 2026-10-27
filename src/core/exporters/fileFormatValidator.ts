import { computeBoundingBox, roundMm } from '../geometry/geometryEngine';
import { BoundingBox, Point2D } from '../types';

export interface SvgAuditReport {
  isValid: boolean;
  hasExplicitMmWidth: boolean;
  hasExplicitMmHeight: boolean;
  widthMm: number;
  heightMm: number;
  viewBoxMatchesMm1To1: boolean;
  hasInvalidNumbersOrNaN: boolean;
  hasNonProductiveGuides: boolean;
  engraveLayerCount: number;
  holesLayerCount: number;
  cutLayerCount: number;
  allCutAndHolePathsClosed: boolean;
  measuredCutBoundsMm: BoundingBox | null;
  errors: string[];
}

export interface DxfParsedPolyline {
  layer: string;
  colorIndex: number;
  closedFlag: boolean;
  explicitlyClosedLoop: boolean;
  vertices: Point2D[];
  boundingBox: BoundingBox;
}

export interface DxfAuditReport {
  isValid: boolean;
  acadVer: string;
  insUnits: number;
  extMin: Point2D;
  extMax: Point2D;
  layersDefined: string[];
  totalPolylines: number;
  engravePolylinesCount: number;
  holePolylinesCount: number;
  cutPolylinesCount: number;
  allCutAndHolesClosedFlag: boolean;
  allCutAndHolesZeroGapLoop: boolean;
  hasInvalidNumbersOrNaN: boolean;
  firstCutPieceSizeMm: { width: number; height: number } | null;
  measuredCutBoundsDxfMm: BoundingBox | null;
  errors: string[];
}

/**
 * Analizador independiente de archivos SVG exportados para validar el cumplimiento estricto
 * de importación en LightBurn Pro (escala 1:1 mm, colores de capas, cierre de contornos y ausencia de NaN).
 */
export function parseAndAuditLightBurnSvg(svgContent: string): SvgAuditReport {
  const errors: string[] = [];

  const hasInvalidNumbersOrNaN = /\b(NaN|Infinity|undefined)\b/.test(svgContent);
  if (hasInvalidNumbersOrNaN) {
    errors.push('El contenido SVG contiene valores numéricos inválidos (NaN, Infinity o undefined).');
  }

  const widthMatch = svgContent.match(/\bwidth="([\d.]+)mm"/);
  const heightMatch = svgContent.match(/\bheight="([\d.]+)mm"/);
  const viewBoxMatch = svgContent.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);

  const hasExplicitMmWidth = Boolean(widthMatch);
  const hasExplicitMmHeight = Boolean(heightMatch);

  const widthMm = widthMatch ? parseFloat(widthMatch[1]) : 0;
  const heightMm = heightMatch ? parseFloat(heightMatch[1]) : 0;
  const vbW = viewBoxMatch ? parseFloat(viewBoxMatch[1]) : -1;
  const vbH = viewBoxMatch ? parseFloat(viewBoxMatch[2]) : -1;

  const viewBoxMatchesMm1To1 =
    hasExplicitMmWidth &&
    hasExplicitMmHeight &&
    Math.abs(widthMm - vbW) < 0.001 &&
    Math.abs(heightMm - vbH) < 0.001;

  if (!viewBoxMatchesMm1To1) {
    errors.push(
      `Discrepancia de escala 1:1 en SVG: width="${widthMm}mm" height="${heightMm}mm" vs viewBox="0 0 ${vbW} ${vbH}".`
    );
  }

  const hasNonProductiveGuides =
    svgContent.includes('data-layer="GUIDE"') || svgContent.includes('#F57900');
  if (hasNonProductiveGuides) {
    errors.push('El SVG de producción contiene guías no productivas (#F57900 / GUIDE).');
  }

  // Extraer bloques por capa
  const extractGroupBlock = (groupId: string): string => {
    const regex = new RegExp(`<g\\b[^>]*id="${groupId}"[^>]*>([\\s\\S]*?)<\\/g>`, 'i');
    return svgContent.match(regex)?.[1] || '';
  };

  const engraveBlock = extractGroupBlock('CAPA_00_GRABADO');
  const holesBlock = extractGroupBlock('CAPA_01_AGUJEROS');
  const cutBlock = extractGroupBlock('CAPA_02_CORTE');

  const countElementsInBlock = (block: string) => {
    if (!block) return 0;
    const matches = block.match(/<(path|image)\b/gi);
    return matches ? matches.length : 0;
  };

  const engraveLayerCount = countElementsInBlock(engraveBlock);
  const holesLayerCount = countElementsInBlock(holesBlock);
  const cutLayerCount = countElementsInBlock(cutBlock);

  // Verificar que todos los paths en CAPA_01_AGUJEROS y CAPA_02_CORTE sean cerrados (terminen en Z) y tengan el color exacto
  let allCutAndHolePathsClosed = true;
  const cutCoords: Point2D[] = [];

  const auditClosedPathsBlock = (block: string, expectedStrokeHex: string, layerLabel: string) => {
    if (!block) return;
    const pathRegex = /<path\b([^>]+)\/>/gi;
    let m: RegExpExecArray | null;
    while ((m = pathRegex.exec(block)) !== null) {
      const attrs = m[1];
      const d = attrs.match(/\bd="([^"]+)"/)?.[1] || '';
      const stroke = attrs.match(/\bstroke="([^"]+)"/)?.[1] || '';
      if (!/Z\s*$/i.test(d.trim())) {
        allCutAndHolePathsClosed = false;
        errors.push(`Un trazado en ${layerLabel} no está cerrado con 'Z'.`);
      }
      if (stroke.toUpperCase() !== expectedStrokeHex.toUpperCase()) {
        errors.push(
          `Color de capa incorrecto en ${layerLabel}: esperado ${expectedStrokeHex}, encontrado ${stroke}.`
        );
      }

      if (layerLabel === 'CAPA_02_CORTE') {
        // Extraer coordenadas M x y / L x y para medir caja envolvente real
        const cmdRegex = /\b[ML]\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)/gi;
        let cm: RegExpExecArray | null;
        while ((cm = cmdRegex.exec(d)) !== null) {
          cutCoords.push({ x: parseFloat(cm[1]), y: parseFloat(cm[2]) });
        }
      }
    }
  };

  auditClosedPathsBlock(holesBlock, '#0000FF', 'CAPA_01_AGUJEROS');
  auditClosedPathsBlock(cutBlock, '#FF0000', 'CAPA_02_CORTE');

  const measuredCutBoundsMm = cutCoords.length > 0 ? computeBoundingBox(cutCoords) : null;
  if (measuredCutBoundsMm) {
    if (
      measuredCutBoundsMm.minX < -0.01 ||
      measuredCutBoundsMm.minY < -0.01 ||
      measuredCutBoundsMm.maxX > widthMm + 0.01 ||
      measuredCutBoundsMm.maxY > heightMm + 0.01
    ) {
      errors.push(
        `Trayectorias de corte fuera de los límites del lienzo SVG (${widthMm}×${heightMm} mm).`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    hasExplicitMmWidth,
    hasExplicitMmHeight,
    widthMm,
    heightMm,
    viewBoxMatchesMm1To1,
    hasInvalidNumbersOrNaN,
    hasNonProductiveGuides,
    engraveLayerCount,
    holesLayerCount,
    cutLayerCount,
    allCutAndHolePathsClosed,
    measuredCutBoundsMm,
    errors,
  };
}

/**
 * Lector/Parser DXF R12 independiente para auditar archivos .dxf destinados a RDWorks y LightBurn.
 * Verifica estructura de pares (código/valor), unidades, capas, cierre de polilíneas (flag 70=1 y vértice coincidente)
 * y mide las dimensiones físicas reales directamente desde los vértices exportados.
 */
export function parseAndAuditDxfR12(dxfContent: string): DxfAuditReport {
  const errors: string[] = [];
  const hasInvalidNumbersOrNaN = /\b(NaN|Infinity|undefined)\b/.test(dxfContent);
  if (hasInvalidNumbersOrNaN) {
    errors.push('El archivo DXF contiene valores numéricos inválidos (NaN, Infinity o undefined).');
  }

  const rawLines = dxfContent.replace(/\r\n/g, '\n').trim().split('\n');
  if (rawLines.length % 2 !== 0) {
    errors.push(
      `Estructura DXF inválida: cantidad impar de líneas (${rawLines.length}). Todo archivo DXF debe consistir en pares código/valor.`
    );
  }

  const pairs: Array<{ code: number; val: string }> = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    pairs.push({
      code: parseInt(rawLines[i].trim(), 10),
      val: rawLines[i + 1].trim(),
    });
  }

  let acadVer = '';
  let insUnits = 0;
  const extMin: Point2D = { x: 0, y: 0 };
  const extMax: Point2D = { x: 0, y: 0 };
  const layersDefined: string[] = [];
  const polylines: DxfParsedPolyline[] = [];

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 9 && p.val === '$ACADVER' && i + 1 < pairs.length) {
      acadVer = pairs[i + 1].val;
      i += 2;
      continue;
    }
    if (p.code === 9 && p.val === '$INSUNITS' && i + 1 < pairs.length) {
      insUnits = parseInt(pairs[i + 1].val, 10);
      i += 2;
      continue;
    }
    if (p.code === 9 && p.val === '$EXTMIN') {
      i++;
      while (i < pairs.length && pairs[i].code !== 9 && pairs[i].code !== 0) {
        if (pairs[i].code === 10) extMin.x = parseFloat(pairs[i].val);
        if (pairs[i].code === 20) extMin.y = parseFloat(pairs[i].val);
        i++;
      }
      continue;
    }
    if (p.code === 9 && p.val === '$EXTMAX') {
      i++;
      while (i < pairs.length && pairs[i].code !== 9 && pairs[i].code !== 0) {
        if (pairs[i].code === 10) extMax.x = parseFloat(pairs[i].val);
        if (pairs[i].code === 20) extMax.y = parseFloat(pairs[i].val);
        i++;
      }
      continue;
    }
    if (p.code === 0 && p.val === 'LAYER') {
      i++;
      while (i < pairs.length && pairs[i].code !== 0) {
        if (pairs[i].code === 2) {
          layersDefined.push(pairs[i].val);
        }
        i++;
      }
      continue;
    }
    if (p.code === 0 && p.val === 'POLYLINE') {
      let layer = '0';
      let colorIndex = 7;
      let closedFlag = false;
      const vertices: Point2D[] = [];
      i++;
      while (i < pairs.length && !(pairs[i].code === 0 && pairs[i].val === 'SEQEND')) {
        if (pairs[i].code === 8) layer = pairs[i].val;
        if (pairs[i].code === 62) colorIndex = parseInt(pairs[i].val, 10);
        if (pairs[i].code === 70) closedFlag = (parseInt(pairs[i].val, 10) & 1) === 1;
        if (pairs[i].code === 0 && pairs[i].val === 'VERTEX') {
          i++;
          let vx = 0;
          let vy = 0;
          while (i < pairs.length && pairs[i].code !== 0) {
            if (pairs[i].code === 10) vx = parseFloat(pairs[i].val);
            if (pairs[i].code === 20) vy = parseFloat(pairs[i].val);
            i++;
          }
          vertices.push({ x: vx, y: vy });
          continue;
        }
        i++;
      }
      // Saltar SEQEND y su capa
      if (i < pairs.length && pairs[i].code === 0 && pairs[i].val === 'SEQEND') {
        i++;
        while (i < pairs.length && pairs[i].code !== 0) i++;
      }

      const explicitlyClosedLoop =
        vertices.length >= 3 &&
        Math.hypot(
          vertices[0].x - vertices[vertices.length - 1].x,
          vertices[0].y - vertices[vertices.length - 1].y
        ) < 0.001;

      polylines.push({
        layer,
        colorIndex,
        closedFlag,
        explicitlyClosedLoop,
        vertices,
        boundingBox: computeBoundingBox(vertices),
      });
      continue;
    }
    i++;
  }

  if (acadVer !== 'AC1009') {
    errors.push(`Versión DXF inesperada: ${acadVer} (se requiere AC1009 / R12 para RDWorks).`);
  }

  const engravePolys = polylines.filter((p) => p.layer === 'GRABADO');
  const holePolys = polylines.filter((p) => p.layer === 'AGUJEROS');
  const cutPolys = polylines.filter((p) => p.layer === 'CORTE');

  const allCutAndHolesClosedFlag = [...holePolys, ...cutPolys].every((p) => p.closedFlag);
  const allCutAndHolesZeroGapLoop = [...holePolys, ...cutPolys].every(
    (p) => p.explicitlyClosedLoop
  );

  if (!allCutAndHolesClosedFlag) {
    errors.push('Existen polilíneas de CORTE o AGUJEROS sin el flag DXF 70=1 (cerrado).');
  }
  if (!allCutAndHolesZeroGapLoop) {
    errors.push(
      'Existen polilíneas de CORTE o AGUJEROS cuyo último vértice no cierra exactamente con el primero.'
    );
  }

  const allCutVertices = cutPolys.flatMap((p) => p.vertices);
  const measuredCutBoundsDxfMm =
    allCutVertices.length > 0 ? computeBoundingBox(allCutVertices) : null;

  if (measuredCutBoundsDxfMm) {
    if (
      measuredCutBoundsDxfMm.minX < -0.01 ||
      measuredCutBoundsDxfMm.minY < -0.01 ||
      measuredCutBoundsDxfMm.maxX > extMax.x + 0.01 ||
      measuredCutBoundsDxfMm.maxY > extMax.y + 0.01
    ) {
      errors.push('Vértices DXF fuera de los límites declarados en $EXTMIN / $EXTMAX.');
    }
  }

  const firstCutPieceSizeMm =
    cutPolys.length > 0
      ? {
          width: roundMm(cutPolys[0].boundingBox.width, 3),
          height: roundMm(cutPolys[0].boundingBox.height, 3),
        }
      : null;

  return {
    isValid: errors.length === 0,
    acadVer,
    insUnits,
    extMin,
    extMax,
    layersDefined,
    totalPolylines: polylines.length,
    engravePolylinesCount: engravePolys.length,
    holePolylinesCount: holePolys.length,
    cutPolylinesCount: cutPolys.length,
    allCutAndHolesClosedFlag,
    allCutAndHolesZeroGapLoop,
    hasInvalidNumbersOrNaN,
    firstCutPieceSizeMm,
    measuredCutBoundsDxfMm,
    errors,
  };
}
