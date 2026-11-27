/**
 * Astra Studio — Exportadores Vectoriales de Alta Precisión 1:1 mm para Mesa Vank 9060
 * Genera DXF R12 (AC1009) y Adobe Illustrator (.AI / EPS multi-capa) directamente desde
 * los trabajos posicionados en la plancha (`WorkbenchJobItem[]`), preservando las 3 capas:
 *   - C00_GRABADO (vectorial + vectorización automática de logos ráster)
 *   - C01_CORTE_ORIFICIOS (contornos cerrados con cierre explícito 0.0000 mm)
 *   - C02_CORTE_EXTERIOR (contornos cerrados con cierre explícito 0.0000 mm)
 */

import { roundMm } from '../geometry/geometryEngine';
import { LIGHTBURN_LAYERS, Point2D } from '../types';
import {
  buildRasterMaskCacheKey,
  getCachedRasterScanlineMask,
  RasterScanlineMask,
} from './rasterScanlines';
import { validateWorkbenchState } from './workbenchEngine';
import { WorkbenchConfig, WorkbenchJobItem } from './workbenchTypes';

const MM_TO_PT = 72 / 25.4;

export interface WorkbenchDxfArtifact {
  dxfContent: string;
  filenameSuggested: string;
  widthMm: number;
  heightMm: number;
  pieceCount: number;
  engravePolylineCount: number;
  holeContourCount: number;
  cutContourCount: number;
}

export interface WorkbenchAiArtifact {
  aiContent: string;
  filenameSuggested: string;
  widthMm: number;
  heightMm: number;
  pieceCount: number;
  engraveContourCount: number;
  holeContourCount: number;
  cutContourCount: number;
}

interface CollectedLayerVectorPaths {
  canvasW: number;
  canvasH: number;
  pieceCount: number;
  safeProjectName: string;
  engraveGroups: Array<{ polylines: Array<{ points: Point2D[]; closed: boolean }> }>;
  holePolylines: Point2D[][];
  cutPolylines: Point2D[][];
}

function sanitizeExportBaseName(projectName: string): string {
  return (
    projectName
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Plancha_Vank_9060'
  );
}

function fmtNum4(n: number): string {
  const clean = Math.abs(n) < 1e-7 ? 0 : n;
  return clean.toFixed(4);
}

/**
 * Extrae contornos cerrados exactos (sin auto-intersecciones) a partir de una máscara raster
 * mediante encadenamiento topológico de bordes ortogonales y simplificación colineal sin pérdida.
 */
export function extractClosedContoursFromRasterMask(
  mask: RasterScanlineMask,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  maxGridCols = 420
): Point2D[][] {
  const rows = mask.rows;
  if (rows <= 0 || mask.rowRuns.length === 0) return [];
  const spanX = Math.max(0.01, maxX - minX);
  const spanY = Math.max(0.01, maxY - minY);
  const cols = Math.max(
    16,
    Math.min(maxGridCols, Math.round((spanX / Math.max(spanY / rows, 0.02))))
  );

  // Grilla booleana compacta (rows * cols)
  const grid = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const runs = mask.rowRuns[r];
    if (!runs || runs.length === 0) continue;
    const rowOff = r * cols;
    for (let i = 0; i < runs.length; i++) {
      const [u0, u1] = runs[i];
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor(u0 * cols)));
      const c1 = Math.max(c0, Math.min(cols - 1, Math.ceil(u1 * cols) - 1));
      for (let c = c0; c <= c1; c++) {
        grid[rowOff + c] = 1;
      }
    }
  }

  const isFilled = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r * cols + c] === 1;

  // Mapa de aristas dirigidas desde cada vértice (vx, vy)
  type GridEdge = { sx: number; sy: number; ex: number; ey: number; dx: number; dy: number };
  const stride = cols + 1;
  const outEdges = new Map<number, GridEdge[]>();
  const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
    const key = sy * stride + sx;
    let list = outEdges.get(key);
    if (!list) {
      list = [];
      outEdges.set(key, list);
    }
    list.push({ sx, sy, ex, ey, dx: ex - sx, dy: ey - sy });
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isFilled(r, c)) continue;
      if (!isFilled(r - 1, c)) addEdge(c, r, c + 1, r);
      if (!isFilled(r, c + 1)) addEdge(c + 1, r, c + 1, r + 1);
      if (!isFilled(r + 1, c)) addEdge(c + 1, r + 1, c, r + 1);
      if (!isFilled(r, c - 1)) addEdge(c, r + 1, c, r);
    }
  }

  const cellW = spanX / cols;
  const cellH = spanY / rows;
  const result: Point2D[][] = [];

  for (const [startKey, list] of outEdges.entries()) {
    while (list.length > 0) {
      const firstEdge = list.pop()!;
      const gridLoop: Array<{ x: number; y: number }> = [
        { x: firstEdge.sx, y: firstEdge.sy },
        { x: firstEdge.ex, y: firstEdge.ey },
      ];
      let curX = firstEdge.ex;
      let curY = firstEdge.ey;
      let prevDx = firstEdge.dx;
      let prevDy = firstEdge.dy;

      let safety = rows * cols * 4 + 8;
      while ((curY * stride + curX) !== startKey && safety-- > 0) {
        const nextList = outEdges.get(curY * stride + curX);
        if (!nextList || nextList.length === 0) break;
        let pickIdx = 0;
        if (nextList.length > 1) {
          // Resolver vértice silla girando siempre en sentido horario (mantiene región llena separada limpiamente)
          const rightDx = -prevDy;
          const rightDy = prevDx;
          const foundIdx = nextList.findIndex((e) => e.dx === rightDx && e.dy === rightDy);
          if (foundIdx >= 0) pickIdx = foundIdx;
        }
        const edge = nextList.splice(pickIdx, 1)[0];
        curX = edge.ex;
        curY = edge.ey;
        prevDx = edge.dx;
        prevDy = edge.dy;
        gridLoop.push({ x: curX, y: curY });
      }

      if (gridLoop.length < 4) continue;
      // Eliminar punto final duplicado antes de simplificar colineales
      gridLoop.pop();

      const simplified: Point2D[] = [];
      const n = gridLoop.length;
      for (let i = 0; i < n; i++) {
        const prev = gridLoop[(i - 1 + n) % n];
        const curr = gridLoop[i];
        const next = gridLoop[(i + 1) % n];
        const sameX = prev.x === curr.x && curr.x === next.x;
        const sameY = prev.y === curr.y && curr.y === next.y;
        if (!sameX && !sameY) {
          simplified.push({
            x: roundMm(minX + curr.x * cellW, 4),
            y: roundMm(minY + curr.y * cellH, 4),
          });
        }
      }
      if (simplified.length >= 3) {
        result.push(simplified);
      }
    }
  }

  return result;
}

function collectWorkbenchVectorPaths(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  rasterMasks?: Map<string, RasterScanlineMask>,
  projectName = 'Plancha_Vank_9060'
): CollectedLayerVectorPaths {
  const report = validateWorkbenchState(jobs, config);
  if (!report.isValidForExport) {
    const firstErr =
      report.issues.find((i) => i.severity === 'error')?.message ||
      'La mesa de trabajo contiene errores geométricos.';
    throw new Error(`Exportación vectorial bloqueada: ${firstErr}`);
  }

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const engraveLayer = config.layers.find((l) => l.role === 'ENGRAVE');
  const holesLayer = config.layers.find((l) => l.role === 'HOLES');
  const cutLayer = config.layers.find((l) => l.role === 'CUT');

  const includeEngrave = engraveLayer ? engraveLayer.outputEnabled : true;
  const includeHoles = holesLayer ? holesLayer.outputEnabled : true;
  const includeCut = cutLayer ? cutLayer.outputEnabled : true;
  const effInterval = Math.max(0.03, engraveLayer?.lineIntervalMm || 0.08);
  const ditherMode = engraveLayer?.imageDitherMode ?? 'threshold';

  const engraveGroups: CollectedLayerVectorPaths['engraveGroups'] = [];
  const holePolylines: Point2D[][] = [];
  const cutPolylines: Point2D[][] = [];

  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      if (includeEngrave) {
        for (const eng of inst.engraveItems) {
          if (eng.kind === 'vector_path' && eng.polylines && eng.polylines.length > 0) {
            const absPolys = eng.polylines
              .filter((p) => p.points.length >= 2)
              .map((p) => ({
                closed: p.closed,
                points: p.points.map((pt) => ({
                  x: roundMm(job.xMm + pt.x, 4),
                  y: roundMm(job.yMm + pt.y, 4),
                })),
              }));
            if (absPolys.length > 0) {
              engraveGroups.push({ polylines: absPolys });
            }
          } else if (eng.kind === 'raster_image') {
            const bb = eng.boundingBox;
            const minX = roundMm(job.xMm + bb.minX, 4);
            const maxX = roundMm(job.xMm + bb.maxX, 4);
            const minY = roundMm(job.yMm + bb.minY, 4);
            const maxY = roundMm(job.yMm + bb.maxY, 4);

            let mask: RasterScanlineMask | undefined;
            if (eng.dataUrl) {
              const key = buildRasterMaskCacheKey({
                dataUrl: eng.dataUrl,
                bboxWidthMm: Math.max(0.5, bb.width || eng.widthMm || 10),
                bboxHeightMm: Math.max(0.5, bb.height || eng.heightMm || 10),
                rotationDeg: eng.rotationDeg ?? 0,
                mirrored: !!eng.mirrored,
                lineIntervalMm: effInterval,
                ditherMode,
              });
              mask = rasterMasks?.get(key) ?? getCachedRasterScanlineMask(key);
            }

            if (mask && mask.rowRuns.length > 0) {
              const loops = extractClosedContoursFromRasterMask(mask, minX, minY, maxX, maxY);
              if (loops.length > 0) {
                engraveGroups.push({
                  polylines: loops.map((pts) => ({ closed: true, points: pts })),
                });
                continue;
              }
            }

            // Fallback geométrico si no hay máscara bitmap cargada
            if (maxX > minX && maxY > minY) {
              engraveGroups.push({
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: minX, y: minY },
                      { x: maxX, y: minY },
                      { x: maxX, y: maxY },
                      { x: minX, y: maxY },
                    ],
                  },
                ],
              });
            }
          }
        }
      }

      if (includeHoles) {
        for (const hole of inst.holeContours) {
          if (hole.points.length >= 2) {
            holePolylines.push(
              hole.points.map((pt) => ({
                x: roundMm(job.xMm + pt.x, 4),
                y: roundMm(job.yMm + pt.y, 4),
              }))
            );
          }
        }
      }

      if (includeCut && inst.cutContour && inst.cutContour.points.length >= 2) {
        cutPolylines.push(
          inst.cutContour.points.map((pt) => ({
            x: roundMm(job.xMm + pt.x, 4),
            y: roundMm(job.yMm + pt.y, 4),
          }))
        );
      }
    }
  }

  return {
    canvasW: roundMm(config.sheetOffsetXMm + config.sheetWidthMm, 4),
    canvasH: roundMm(config.sheetOffsetYMm + config.sheetHeightMm, 4),
    pieceCount: report.totalPieces,
    safeProjectName: sanitizeExportBaseName(projectName),
    engraveGroups,
    holePolylines,
    cutPolylines,
  };
}

/**
 * Normaliza y quantiza vértices a 0.0001 mm eliminando vértices consecutivos idénticos
 * y cerrando explícitamente la polilínea cuando `closed === true`.
 */
function normalizeDxfVertices(pts: Point2D[], closed: boolean): Point2D[] {
  const vertices = pts
    .map((p) => ({ x: roundMm(p.x, 4), y: roundMm(p.y, 4) }))
    .filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);

  if (closed && vertices.length >= 3) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.0001) {
      vertices.push({ x: first.x, y: first.y });
    }
  }
  return vertices;
}

/**
 * Exporta toda la Mesa de Trabajo Vank 9060 a DXF R12 (`AC1009`) 1:1 en milímetros (precisión 0.0001 mm),
 * compatible con RDWorks V8, LightBurn, CorelDRAW, AutoCAD e Illustrator.
 */
export function exportWorkbenchToDxf(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  rasterMasks?: Map<string, RasterScanlineMask>,
  projectName = 'Plancha_Vank_9060'
): WorkbenchDxfArtifact {
  const data = collectWorkbenchVectorPaths(jobs, config, rasterMasks, projectName);
  const dxfLines: string[] = [];
  const pushPair = (code: number, value: string | number) => {
    dxfLines.push(String(code));
    dxfLines.push(String(value));
  };

  pushPair(999, 'ASTRA_STUDIO_VANK9060_PRECISION_1_TO_1_MM');

  // 1. HEADER SECTION
  pushPair(0, 'SECTION');
  pushPair(2, 'HEADER');
  pushPair(9, '$ACADVER');
  pushPair(1, 'AC1009');
  pushPair(9, '$INSUNITS');
  pushPair(70, 4); // Millimeters
  pushPair(9, '$MEASUREMENT');
  pushPair(70, 1); // Metric
  pushPair(9, '$LUNITS');
  pushPair(70, 2); // Decimal
  pushPair(9, '$LUPREC');
  pushPair(70, 4); // 4 decimales (0.0001 mm)
  pushPair(9, '$EXTMIN');
  pushPair(10, '0.0000');
  pushPair(20, '0.0000');
  pushPair(30, '0.0000');
  pushPair(9, '$EXTMAX');
  pushPair(10, fmtNum4(data.canvasW));
  pushPair(20, fmtNum4(data.canvasH));
  pushPair(30, '0.0000');
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
  pushPair(40, '0.0');
  pushPair(0, 'ENDTAB');

  pushPair(0, 'TABLE');
  pushPair(2, 'LAYER');
  pushPair(70, 3);
  for (const lyr of [LIGHTBURN_LAYERS.ENGRAVE, LIGHTBURN_LAYERS.HOLES, LIGHTBURN_LAYERS.CUT]) {
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

  const emitPolyline = (layerName: string, colorIndex: number, pts: Point2D[], closed: boolean) => {
    const vertices = normalizeDxfVertices(pts, closed);
    if (vertices.length < 2) return false;
    pushPair(0, 'POLYLINE');
    pushPair(8, layerName);
    pushPair(62, colorIndex);
    pushPair(66, 1);
    pushPair(10, '0.0000');
    pushPair(20, '0.0000');
    pushPair(30, '0.0000');
    pushPair(70, closed ? 1 : 0);

    for (const pt of vertices) {
      pushPair(0, 'VERTEX');
      pushPair(8, layerName);
      pushPair(10, fmtNum4(pt.x));
      pushPair(20, fmtNum4(data.canvasH - pt.y));
      pushPair(30, '0.0000');
    }

    pushPair(0, 'SEQEND');
    pushPair(8, layerName);
    return true;
  };

  let engravePolylineCount = 0;
  for (const grp of data.engraveGroups) {
    for (const pl of grp.polylines) {
      if (emitPolyline(LIGHTBURN_LAYERS.ENGRAVE.name, LIGHTBURN_LAYERS.ENGRAVE.dxfColorIndex, pl.points, pl.closed)) {
        engravePolylineCount++;
      }
    }
  }

  let holeContourCount = 0;
  for (const pts of data.holePolylines) {
    if (emitPolyline(LIGHTBURN_LAYERS.HOLES.name, LIGHTBURN_LAYERS.HOLES.dxfColorIndex, pts, true)) {
      holeContourCount++;
    }
  }

  let cutContourCount = 0;
  for (const pts of data.cutPolylines) {
    if (emitPolyline(LIGHTBURN_LAYERS.CUT.name, LIGHTBURN_LAYERS.CUT.dxfColorIndex, pts, true)) {
      cutContourCount++;
    }
  }

  pushPair(0, 'ENDSEC');
  pushPair(0, 'EOF');

  return {
    dxfContent: dxfLines.join('\n') + '\n',
    filenameSuggested: `${data.safeProjectName}_Vank9060_${data.pieceCount}u_1a1mm.dxf`,
    widthMm: data.canvasW,
    heightMm: data.canvasH,
    pieceCount: data.pieceCount,
    engravePolylineCount,
    holeContourCount,
    cutContourCount,
  };
}

/**
 * Exporta toda la Mesa de Trabajo Vank 9060 a Adobe Illustrator (.AI / PostScript vectorial multi-capa)
 * con escala métrica exacta 1:1 mm (`1 mm = 72/25.4 pt`, precisión 0.0001 pt), compatible con
 * Adobe Illustrator, CorelDRAW, LightBurn Pro y RDWorks.
 */
export function exportWorkbenchToAi(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  rasterMasks?: Map<string, RasterScanlineMask>,
  projectName = 'Plancha_Vank_9060'
): WorkbenchAiArtifact {
  const data = collectWorkbenchVectorPaths(jobs, config, rasterMasks, projectName);
  const wPt = data.canvasW * MM_TO_PT;
  const hPt = data.canvasH * MM_TO_PT;
  const bbMaxX = Math.ceil(wPt);
  const bbMaxY = Math.ceil(hPt);

  const toAiX = (xMm: number) => fmtNum4(xMm * MM_TO_PT);
  const toAiY = (yMm: number) => fmtNum4((data.canvasH - yMm) * MM_TO_PT);

  const lines: string[] = [
    '%!PS-Adobe-3.0',
    `%%Creator: Astra Studio CAD/CAM (Vank 9060 1:1 mm)`,
    `%%Title: ${data.safeProjectName}`,
    `%%BoundingBox: 0 0 ${bbMaxX} ${bbMaxY}`,
    `%%HiResBoundingBox: 0.0000 0.0000 ${fmtNum4(wPt)} ${fmtNum4(hPt)}`,
    '%%DocumentProcessColors: Cyan Magenta Yellow Black',
    '%%EndComments',
    '%%BeginProlog',
    '/m { moveto } bind def',
    '/l { lineto } bind def',
    '/h { closepath } bind def',
    '/S { stroke } bind def',
    '/f* { eofill } bind def',
    '/n { newpath } bind def',
    '/w { setlinewidth } bind def',
    '/XA { setrgbcolor } bind def',
    '%%EndProlog',
    '%%BeginSetup',
    '1 setlinejoin 1 setlinecap',
    '%%EndSetup',
  ];

  // CAPA C00: GRABADO (Negro 0 0 0, contorno compuesto con relleno evenodd `f*`)
  let engraveContourCount = 0;
  lines.push(`%AI5_BeginLayer: 1 1 1 1 0 0 0 0 0 0`);
  lines.push(`%LayerName: ${LIGHTBURN_LAYERS.ENGRAVE.name}`);
  lines.push('0.0000 0.0000 0.0000 XA');
  lines.push(`${fmtNum4(0.1 * MM_TO_PT)} w`);

  for (const grp of data.engraveGroups) {
    const validPolys = grp.polylines.filter((p) => p.points.length >= 2);
    if (validPolys.length === 0) continue;

    const allClosed = validPolys.every((p) => p.closed && p.points.length >= 3);
    lines.push('n');
    for (const pl of validPolys) {
      const first = pl.points[0];
      lines.push(`${toAiX(first.x)} ${toAiY(first.y)} m`);
      for (let i = 1; i < pl.points.length; i++) {
        lines.push(`${toAiX(pl.points[i].x)} ${toAiY(pl.points[i].y)} l`);
      }
      if (pl.closed) {
        lines.push('h');
      }
      engraveContourCount++;
    }
    lines.push(allClosed ? 'f*' : 'S');
  }
  lines.push('%AI5_EndLayer');

  // CAPA C01: CORTE ORIFICIOS (Azul 0 0 1, línea fina 0.1 mm cerrada)
  let holeContourCount = 0;
  lines.push(`%AI5_BeginLayer: 1 1 1 1 0 0 0 0 0 255`);
  lines.push(`%LayerName: ${LIGHTBURN_LAYERS.HOLES.name}`);
  lines.push('0.0000 0.0000 1.0000 XA');
  lines.push(`${fmtNum4(0.1 * MM_TO_PT)} w`);
  for (const pts of data.holePolylines) {
    if (pts.length < 3) continue;
    lines.push('n');
    lines.push(`${toAiX(pts[0].x)} ${toAiY(pts[0].y)} m`);
    for (let i = 1; i < pts.length; i++) {
      lines.push(`${toAiX(pts[i].x)} ${toAiY(pts[i].y)} l`);
    }
    lines.push('h S');
    holeContourCount++;
  }
  lines.push('%AI5_EndLayer');

  // CAPA C02: CORTE EXTERIOR (Rojo 1 0 0, línea fina 0.1 mm cerrada)
  let cutContourCount = 0;
  lines.push(`%AI5_BeginLayer: 1 1 1 1 0 0 255 0 0 0`);
  lines.push(`%LayerName: ${LIGHTBURN_LAYERS.CUT.name}`);
  lines.push('1.0000 0.0000 0.0000 XA');
  lines.push(`${fmtNum4(0.1 * MM_TO_PT)} w`);
  for (const pts of data.cutPolylines) {
    if (pts.length < 3) continue;
    lines.push('n');
    lines.push(`${toAiX(pts[0].x)} ${toAiY(pts[0].y)} m`);
    for (let i = 1; i < pts.length; i++) {
      lines.push(`${toAiX(pts[i].x)} ${toAiY(pts[i].y)} l`);
    }
    lines.push('h S');
    cutContourCount++;
  }
  lines.push('%AI5_EndLayer');

  lines.push('showpage');
  lines.push('%%EOF');

  return {
    aiContent: lines.join('\n') + '\n',
    filenameSuggested: `${data.safeProjectName}_Vank9060_${data.pieceCount}u_1a1mm.ai`,
    widthMm: data.canvasW,
    heightMm: data.canvasH,
    pieceCount: data.pieceCount,
    engraveContourCount,
    holeContourCount,
    cutContourCount,
  };
}
