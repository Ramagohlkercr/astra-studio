/**
 * Astra Studio — Importador Universal de Archivos Externos de Grabado y Corte Láser
 * Soporta apertura e importación 1:1 en milímetros reales (mm) desde:
 *   - DXF (.dxf): AutoCAD / CorelDraw / Illustrator R12–R2018 (LINE, LWPOLYLINE c/ bulge, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE)
 *   - SVG (.svg): Illustrator / CorelDraw / Inkscape (incluso con <g transform="...">, unidades mm/cm/in/pt/px e imágenes)
 *   - LightBurn (.lbrn2 / .lbrn): CutSettings (velocidad/potencia/intervalo) + Shapes + XForm afín + Bitmaps
 *   - Adobe Illustrator (.ai): Streams PostScript/EPS y PDF comprimidos con FlateDecode
 *   - Ruida Binario (.rd): Desofuscación de comandos Vank 9060 / RDWorks con velocidades, potencias y capas reales
 */

import {
  computeBoundingBox,
  roundMm,
  transformNormalizedPathToMillimeters,
} from '../geometry/geometryEngine';
import { computeNestingLayout } from '../nesting/nestingEngine';
import {
  ClosedContour,
  EngravedItemGeometry,
  HoleSpec,
  LabelDesign,
  Point2D,
  RasterLogoElement,
  SvgLogoElement,
} from '../types';
import {
  decodeRuidaAbsCoordMm,
  decodeRuidaPowerPercent,
  unscrambleRuidaByte,
} from './ruidaCompiler';
import {
  LightBurnCutMode,
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
  WorkbenchPlacedInstance,
} from './workbenchTypes';
import { createWorkbenchJobFromOrder } from './workbenchEngine';

export type ExternalLaserFormat = 'dxf' | 'svg' | 'lbrn2' | 'ai' | 'rd' | 'raster';

export type ExternalLaserRole = 'ENGRAVE' | 'HOLES' | 'CUT' | 'AUTO';

export interface ImportedVectorPath {
  points: Point2D[];
  closed: boolean;
  roleHint: ExternalLaserRole;
  filled?: boolean;
  layerName?: string;
}

export interface ImportedRasterImage {
  dataUrl: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  pixelWidth?: number;
  pixelHeight?: number;
  effectiveDpi?: number;
  rotationDeg?: number;
  mirrored?: boolean;
}

export interface ImportedLayerPreset {
  speedMmPerSec?: number;
  maxPowerPercent?: number;
  minPowerPercent?: number;
  lineIntervalMm?: number;
  passes?: number;
  mode?: LightBurnCutMode;
  outputEnabled?: boolean;
}

export interface ParsedExternalLaserGeometry {
  format: ExternalLaserFormat;
  paths: ImportedVectorPath[];
  rasters: ImportedRasterImage[];
  layerPresets: Partial<Record<'ENGRAVE' | 'HOLES' | 'CUT', ImportedLayerPreset>>;
}

export interface ExternalLaserImportSummary {
  format: ExternalLaserFormat;
  fileName: string;
  jobCount: number;
  pieceCount: number;
  engravePathCount: number;
  holeContourCount: number;
  cutContourCount: number;
  rasterCount: number;
  widthMm: number;
  heightMm: number;
  hasAppliedLayerParams: boolean;
  warnings: string[];
}

export interface ExternalLaserImportResult {
  jobs: WorkbenchJobItem[];
  layerUpdates: Partial<Record<'ENGRAVE' | 'HOLES' | 'CUT', Partial<WorkbenchLayerConfig>>>;
  summary: ExternalLaserImportSummary;
}

// =========================================================================
// UTILIDADES GEOMÉTRICAS Y CLASIFICACIÓN DE CAPAS LÁSER
// =========================================================================

type Affine2D = [number, number, number, number, number, number]; // [a, b, c, d, tx, ty]

const IDENTITY_MATRIX: Affine2D = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m1: Affine2D, m2: Affine2D): Affine2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Affine2D, pt: Point2D): Point2D {
  return {
    x: roundMm(m[0] * pt.x + m[2] * pt.y + m[4], 3),
    y: roundMm(m[1] * pt.x + m[3] * pt.y + m[5], 3),
  };
}

function polygonSignedAreaMm2(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(area) * 0.5;
}

function pointsToSvgPathD(pts: Point2D[], closed: boolean): string {
  if (pts.length === 0) return '';
  const segs = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`);
  if (closed) segs.push('Z');
  return segs.join(' ');
}

function isNearZeroDist(a: Point2D, b: Point2D, tol = 0.08): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

function dedupePolylinePoints(pts: Point2D[], closed: boolean): Point2D[] {
  const out: Point2D[] = [];
  for (const p of pts) {
    if (out.length === 0 || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 0.004) {
      out.push({ x: roundMm(p.x, 3), y: roundMm(p.y, 3) });
    }
  }
  if (closed && out.length > 2 && isNearZeroDist(out[0], out[out.length - 1], 0.03)) {
    out.pop();
  }
  return out;
}

function stitchOpenPaths(paths: ImportedVectorPath[], tolMm = 0.14): ImportedVectorPath[] {
  const closedOut: ImportedVectorPath[] = [];
  const openPool: ImportedVectorPath[] = [];

  for (const p of paths) {
    const clean = dedupePolylinePoints(p.points, p.closed);
    if (clean.length < 2) continue;
    if (p.closed || (clean.length >= 3 && isNearZeroDist(clean[0], clean[clean.length - 1], tolMm))) {
      const closedPts = dedupePolylinePoints(clean, true);
      if (closedPts.length >= 3) {
        closedOut.push({ ...p, points: closedPts, closed: true });
      }
    } else {
      openPool.push({ ...p, points: clean, closed: false });
    }
  }

  const used = new Array<boolean>(openPool.length).fill(false);
  for (let i = 0; i < openPool.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const base = openPool[i];
    const chain = [...base.points];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const tail = chain[chain.length - 1];
      const head = chain[0];
      for (let j = 0; j < openPool.length; j++) {
        if (used[j]) continue;
        const cand = openPool[j];
        if (cand.roleHint !== base.roleHint) continue;
        const cHead = cand.points[0];
        const cTail = cand.points[cand.points.length - 1];
        if (isNearZeroDist(tail, cHead, tolMm)) {
          chain.push(...cand.points.slice(1));
          used[j] = true;
          progressed = true;
          break;
        }
        if (isNearZeroDist(tail, cTail, tolMm)) {
          chain.push(...[...cand.points].reverse().slice(1));
          used[j] = true;
          progressed = true;
          break;
        }
        if (isNearZeroDist(head, cTail, tolMm)) {
          chain.unshift(...cand.points.slice(0, -1));
          used[j] = true;
          progressed = true;
          break;
        }
        if (isNearZeroDist(head, cHead, tolMm)) {
          chain.unshift(...[...cand.points].reverse().slice(0, -1));
          used[j] = true;
          progressed = true;
          break;
        }
      }
    }
    const isNowClosed = chain.length >= 3 && isNearZeroDist(chain[0], chain[chain.length - 1], tolMm);
    const finalPts = dedupePolylinePoints(chain, isNowClosed);
    if (finalPts.length >= (isNowClosed ? 3 : 2)) {
      closedOut.push({
        ...base,
        points: finalPts,
        closed: isNowClosed,
      });
    }
  }

  return closedOut;
}

function classifyRoleByNameOrHex(layerName?: string, colorStr?: string, filled?: boolean): ExternalLaserRole {
  const name = (layerName ?? '').toLowerCase();
  if (/corte|cut|outer|edge|perim|contorno|c0?2\b/.test(name)) return 'CUT';
  if (/aguj|hole|perf|drill|calado|c0?1\b/.test(name)) return 'HOLES';
  if (/grab|engrave|scan|fill|logo|texto|text|etch|c0?0\b/.test(name)) return 'ENGRAVE';

  const col = (colorStr ?? '').trim().toLowerCase();
  if (col) {
    const hexMatch = col.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    let r = -1;
    let g = -1;
    let b = -1;
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
    } else {
      const rgbMatch = col.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
      if (rgbMatch) {
        r = Number(rgbMatch[1]);
        g = Number(rgbMatch[2]);
        b = Number(rgbMatch[3]);
      } else if (col === 'red') {
        r = 255; g = 0; b = 0;
      } else if (col === 'blue') {
        r = 0; g = 0; b = 255;
      } else if (col === 'black') {
        r = 0; g = 0; b = 0;
      }
    }
    if (r >= 0) {
      if (r >= 170 && g <= 95 && b <= 95) return 'CUT';
      if (b >= 170 && r <= 95 && g <= 95) return 'HOLES';
      if (r <= 70 && g <= 70 && b <= 70) return 'ENGRAVE';
    }
  }

  if (filled) return 'ENGRAVE';
  return 'AUTO';
}

function classifyDxfAciRole(layerName: string | undefined, aci: number): ExternalLaserRole {
  const byName = classifyRoleByNameOrHex(layerName);
  if (byName !== 'AUTO') return byName;
  if (aci === 1 || aci === 10 || aci === 20 || aci === 240) return 'CUT';
  if (aci === 5 || aci === 140 || aci === 150 || aci === 160 || aci === 170) return 'HOLES';
  if (aci === 7 || aci === 0 || (aci >= 250 && aci <= 255)) return 'ENGRAVE';
  return 'AUTO';
}

function parseBulgeArcPoints(p1: Point2D, p2: Point2D, bulge: number): Point2D[] {
  if (Math.abs(bulge) < 1e-5) return [p2];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-5) return [p2];

  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(theta / 2);
  if (Math.abs(sinHalf) < 1e-6) return [p2];
  const radius = Math.abs(chord / (2 * sinHalf));
  const sagitta = (bulge * chord) / 2;
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const nx = -dy / chord;
  const ny = dx / chord;
  const distToCenter = (chord / (2 * Math.tan(theta / 2)));
  const cx = midX + nx * distToCenter;
  const cy = midY + ny * distToCenter;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(8, Math.min(48, Math.ceil(Math.abs(theta * radius) / 0.35)));
  const out: Point2D[] = [];
  void sagitta;
  for (let s = 1; s <= steps; s++) {
    const a = startAngle + (theta * s) / steps;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

// =========================================================================
// 1. PARSER DXF (.dxf) — AutoCAD / Corel / Illustrator R12-R2018
// =========================================================================

export function parseDxfExternalFile(dxfText: string): ParsedExternalLaserGeometry {
  const lines = dxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const pairs: Array<{ code: number; val: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, val: lines[i + 1].trim() });
  }

  let unitScaleMm = 1; // $INSUNITS: 4=mm, 1=in, 2=ft, 5=cm, 6=m
  const layerColors = new Map<string, number>();

  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].val === '$INSUNITS') {
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j].code === 70) {
          const u = parseInt(pairs[j].val, 10);
          if (u === 1) unitScaleMm = 25.4;
          else if (u === 2) unitScaleMm = 304.8;
          else if (u === 5) unitScaleMm = 10;
          else if (u === 6) unitScaleMm = 1000;
          break;
        }
      }
    }
    if (pairs[i].code === 0 && pairs[i].val === 'LAYER') {
      let lname = '';
      let lcol = 256;
      for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
        if (pairs[j].code === 2) lname = pairs[j].val;
        if (pairs[j].code === 62) lcol = Math.abs(parseInt(pairs[j].val, 10) || 256);
      }
      if (lname) layerColors.set(lname, lcol);
    }
  }

  let inEntities = false;
  const rawPaths: ImportedVectorPath[] = [];

  let idx = 0;
  while (idx < pairs.length) {
    const cur = pairs[idx];
    if (cur.code === 2 && cur.val === 'ENTITIES') {
      inEntities = true;
      idx++;
      continue;
    }
    if (inEntities && cur.code === 0 && cur.val === 'ENDSEC') {
      break;
    }
    if (!inEntities || cur.code !== 0) {
      idx++;
      continue;
    }

    const etype = cur.val.toUpperCase();
    const fields: Array<{ code: number; val: string }> = [];
    idx++;
    while (idx < pairs.length && pairs[idx].code !== 0) {
      fields.push(pairs[idx]);
      idx++;
    }

    const getNum = (c: number, fallback = 0): number => {
      const f = fields.find((x) => x.code === c);
      const n = f ? parseFloat(f.val) : NaN;
      return Number.isFinite(n) ? n : fallback;
    };
    const layerName = fields.find((x) => x.code === 8)?.val ?? '0';
    const explicitColor = fields.find((x) => x.code === 62)?.val;
    const aci = explicitColor !== undefined
      ? Math.abs(parseInt(explicitColor, 10) || 256)
      : (layerColors.get(layerName) ?? 256);
    const roleHint = classifyDxfAciRole(layerName, aci);

    if (etype === 'LINE') {
      const x1 = getNum(10) * unitScaleMm;
      const y1 = -getNum(20) * unitScaleMm;
      const x2 = getNum(11) * unitScaleMm;
      const y2 = -getNum(21) * unitScaleMm;
      if (Math.hypot(x2 - x1, y2 - y1) > 0.01) {
        rawPaths.push({
          points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
          closed: false,
          roleHint,
          layerName,
        });
      }
    } else if (etype === 'CIRCLE') {
      const cx = getNum(10) * unitScaleMm;
      const cy = -getNum(20) * unitScaleMm;
      const r = Math.abs(getNum(40) * unitScaleMm);
      if (r > 0.05) {
        const steps = Math.max(24, Math.min(72, Math.ceil((2 * Math.PI * r) / 0.35)));
        const pts: Point2D[] = [];
        for (let s = 0; s < steps; s++) {
          const a = (2 * Math.PI * s) / steps;
          pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        rawPaths.push({ points: pts, closed: true, roleHint, layerName });
      }
    } else if (etype === 'ARC') {
      const cx = getNum(10) * unitScaleMm;
      const cy = -getNum(20) * unitScaleMm;
      const r = Math.abs(getNum(40) * unitScaleMm);
      const a0Deg = getNum(50, 0);
      let a1Deg = getNum(51, 360);
      if (a1Deg <= a0Deg) a1Deg += 360;
      if (r > 0.05) {
        const spanRad = ((a1Deg - a0Deg) * Math.PI) / 180;
        const steps = Math.max(8, Math.min(64, Math.ceil((spanRad * r) / 0.35)));
        const pts: Point2D[] = [];
        for (let s = 0; s <= steps; s++) {
          const ang = ((a0Deg + ((a1Deg - a0Deg) * s) / steps) * Math.PI) / 180;
          pts.push({ x: cx + r * Math.cos(ang), y: cy - r * Math.sin(ang) });
        }
        rawPaths.push({ points: pts, closed: false, roleHint, layerName });
      }
    } else if (etype === 'ELLIPSE') {
      const cx = getNum(10) * unitScaleMm;
      const cy = -getNum(20) * unitScaleMm;
      const mx = getNum(11) * unitScaleMm;
      const my = -getNum(21) * unitScaleMm;
      const ratio = Math.max(0.01, getNum(40, 1));
      const p0 = getNum(41, 0);
      let p1 = getNum(42, Math.PI * 2);
      if (p1 <= p0) p1 += Math.PI * 2;
      const isClosed = Math.abs(p1 - p0 - Math.PI * 2) < 0.02;
      const majorLen = Math.hypot(mx, my);
      if (majorLen > 0.05) {
        const rot = Math.atan2(my, mx);
        const rx = majorLen;
        const ry = majorLen * ratio;
        const steps = 40;
        const pts: Point2D[] = [];
        const limit = isClosed ? steps : steps + 1;
        for (let s = 0; s < limit; s++) {
          const t = p0 + ((p1 - p0) * s) / steps;
          const lx = rx * Math.cos(t);
          const ly = ry * Math.sin(t);
          pts.push({
            x: cx + lx * Math.cos(rot) - ly * Math.sin(rot),
            y: cy + lx * Math.sin(rot) + ly * Math.cos(rot),
          });
        }
        rawPaths.push({ points: pts, closed: isClosed, roleHint, layerName });
      }
    } else if (etype === 'LWPOLYLINE') {
      const flags = parseInt(fields.find((x) => x.code === 70)?.val ?? '0', 10) || 0;
      const closed = (flags & 1) === 1;
      const verts: Array<{ x: number; y: number; bulge: number }> = [];
      let curV: { x?: number; y?: number; bulge: number } = { bulge: 0 };
      for (const f of fields) {
        if (f.code === 10) {
          if (curV.x !== undefined && curV.y !== undefined) {
            verts.push({ x: curV.x, y: curV.y, bulge: curV.bulge });
            curV = { bulge: 0 };
          }
          curV.x = parseFloat(f.val) * unitScaleMm;
        } else if (f.code === 20) {
          curV.y = -parseFloat(f.val) * unitScaleMm;
        } else if (f.code === 42) {
          curV.bulge = parseFloat(f.val) || 0;
        }
      }
      if (curV.x !== undefined && curV.y !== undefined) {
        verts.push({ x: curV.x, y: curV.y, bulge: curV.bulge });
      }
      if (verts.length >= 2) {
        const pts: Point2D[] = [{ x: verts[0].x, y: verts[0].y }];
        const segTotal = closed ? verts.length : verts.length - 1;
        for (let s = 0; s < segTotal; s++) {
          const v0 = verts[s];
          const v1 = verts[(s + 1) % verts.length];
          if (Math.abs(v0.bulge) > 1e-4) {
            // Porque Y fue invertido (-y), el signo de bulge también se invierte en el plano Y-abajo
            pts.push(...parseBulgeArcPoints(v0, v1, -v0.bulge));
          } else {
            pts.push({ x: v1.x, y: v1.y });
          }
        }
        rawPaths.push({ points: pts, closed, roleHint, layerName });
      }
    } else if (etype === 'POLYLINE') {
      const flags = parseInt(fields.find((x) => x.code === 70)?.val ?? '0', 10) || 0;
      const closed = (flags & 1) === 1;
      const verts: Array<{ x: number; y: number; bulge: number }> = [];
      while (idx < pairs.length) {
        if (pairs[idx].code === 0 && pairs[idx].val === 'SEQEND') {
          idx++;
          while (idx < pairs.length && pairs[idx].code !== 0) idx++;
          break;
        }
        if (pairs[idx].code === 0 && pairs[idx].val === 'VERTEX') {
          idx++;
          let vx = 0;
          let vy = 0;
          let vbulge = 0;
          while (idx < pairs.length && pairs[idx].code !== 0) {
            if (pairs[idx].code === 10) vx = parseFloat(pairs[idx].val) * unitScaleMm;
            else if (pairs[idx].code === 20) vy = -parseFloat(pairs[idx].val) * unitScaleMm;
            else if (pairs[idx].code === 42) vbulge = parseFloat(pairs[idx].val) || 0;
            idx++;
          }
          verts.push({ x: vx, y: vy, bulge: vbulge });
        } else {
          idx++;
        }
      }
      if (verts.length >= 2) {
        const pts: Point2D[] = [{ x: verts[0].x, y: verts[0].y }];
        const segTotal = closed ? verts.length : verts.length - 1;
        for (let s = 0; s < segTotal; s++) {
          const v0 = verts[s];
          const v1 = verts[(s + 1) % verts.length];
          if (Math.abs(v0.bulge) > 1e-4) {
            pts.push(...parseBulgeArcPoints(v0, v1, -v0.bulge));
          } else {
            pts.push({ x: v1.x, y: v1.y });
          }
        }
        rawPaths.push({ points: pts, closed, roleHint, layerName });
      }
    } else if (etype === 'SPLINE') {
      const flags = parseInt(fields.find((x) => x.code === 70)?.val ?? '0', 10) || 0;
      const closed = (flags & 1) === 1;
      const fitPts: Point2D[] = [];
      const ctrlPts: Point2D[] = [];
      let curPt: { x?: number; codeX: number } = { codeX: 0 };
      for (const f of fields) {
        if (f.code === 11) {
          curPt = { x: parseFloat(f.val) * unitScaleMm, codeX: 11 };
        } else if (f.code === 21 && curPt.codeX === 11 && curPt.x !== undefined) {
          fitPts.push({ x: curPt.x, y: -parseFloat(f.val) * unitScaleMm });
          curPt = { codeX: 0 };
        } else if (f.code === 10) {
          curPt = { x: parseFloat(f.val) * unitScaleMm, codeX: 10 };
        } else if (f.code === 20 && curPt.codeX === 10 && curPt.x !== undefined) {
          ctrlPts.push({ x: curPt.x, y: -parseFloat(f.val) * unitScaleMm });
          curPt = { codeX: 0 };
        }
      }
      const chosen = fitPts.length >= 2 ? fitPts : ctrlPts;
      if (chosen.length >= 2) {
        rawPaths.push({ points: chosen, closed, roleHint, layerName });
      }
    }
  }

  return {
    format: 'dxf',
    paths: stitchOpenPaths(rawPaths),
    rasters: [],
    layerPresets: {},
  };
}

// =========================================================================
// 2. PARSER SVG (.svg) — soporta transform cascada, unidades físicas e imágenes
// =========================================================================

function parseSvgTransformString(str: string | null): Affine2D {
  if (!str) return IDENTITY_MATRIX;
  let mat: Affine2D = [...IDENTITY_MATRIX];
  const cmdRegex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRegex.exec(str)) !== null) {
    const fn = m[1].toLowerCase();
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
    let local: Affine2D | null = null;
    if (fn === 'matrix' && nums.length >= 6) {
      local = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    } else if (fn === 'translate' && nums.length >= 1) {
      local = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      local = [nums[0], 0, 0, nums[1] ?? nums[0], 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      local = [
        cos,
        sin,
        -sin,
        cos,
        cx - cos * cx + sin * cy,
        cy - sin * cx - cos * cy,
      ];
    } else if (fn === 'skewx' && nums.length >= 1) {
      local = [1, 0, Math.tan((nums[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === 'skewy' && nums.length >= 1) {
      local = [1, Math.tan((nums[0] * Math.PI) / 180), 0, 1, 0, 0];
    }
    if (local) mat = multiplyMatrix(mat, local);
  }
  return mat;
}

function parseSvgLengthToMm(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+))\s*(mm|cm|in|pt|pc|px)?$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === 'mm') return v;
  if (unit === 'cm') return v * 10;
  if (unit === 'in') return v * 25.4;
  if (unit === 'pt') return (v * 25.4) / 72;
  if (unit === 'pc') return (v * 25.4) / 6;
  return (v * 25.4) / 96;
}

function extractStyleProp(styleAttr: string | null, prop: string): string | undefined {
  if (!styleAttr) return undefined;
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  return styleAttr.match(re)?.[1]?.trim();
}

export function parseSvgExternalFile(svgText: string): ParsedExternalLaserGeometry {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Entorno sin parser XML para SVG.');
  }
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) {
    throw new Error('El archivo SVG no contiene una etiqueta raíz <svg> válida.');
  }

  let vbMinX = 0;
  let vbMinY = 0;
  let vbW = 0;
  let vbH = 0;
  const vbAttr = svgEl.getAttribute('viewBox');
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      [vbMinX, vbMinY, vbW, vbH] = parts;
    }
  }

  const widthMmAttr = parseSvgLengthToMm(svgEl.getAttribute('width'));
  const heightMmAttr = parseSvgLengthToMm(svgEl.getAttribute('height'));
  const hasPhysicalUnits = /\d\s*(mm|cm|in|pt)\b/i.test(svgEl.getAttribute('width') ?? '');

  let scaleX = 25.4 / 96;
  let scaleY = 25.4 / 96;
  if (widthMmAttr && vbW > 0) {
    scaleX = widthMmAttr / vbW;
    scaleY = heightMmAttr && vbH > 0 ? heightMmAttr / vbH : scaleX;
  } else if (hasPhysicalUnits && !vbW) {
    scaleX = 1;
    scaleY = 1;
  }

  const rootMat: Affine2D = [
    scaleX,
    0,
    0,
    scaleY,
    -vbMinX * scaleX,
    -vbMinY * scaleY,
  ];

  const rawPaths: ImportedVectorPath[] = [];
  const rasters: ImportedRasterImage[] = [];

  const walkNode = (node: Element, parentMat: Affine2D, parentLayer?: string) => {
    const tag = node.tagName.toLowerCase();
    if (['defs', 'clippath', 'mask', 'style', 'script', 'metadata', 'title', 'desc'].includes(tag)) {
      return;
    }

    const ownTransform = parseSvgTransformString(node.getAttribute('transform'));
    const curMat = multiplyMatrix(parentMat, ownTransform);

    const idOrLabel =
      node.getAttribute('inkscape:label') ||
      node.getAttribute('data-name') ||
      node.getAttribute('id') ||
      parentLayer;

    const styleAttr = node.getAttribute('style');
    const stroke = extractStyleProp(styleAttr, 'stroke') ?? node.getAttribute('stroke') ?? '';
    const fill = extractStyleProp(styleAttr, 'fill') ?? node.getAttribute('fill') ?? '';
    const strokeActive = stroke && stroke !== 'none' && stroke !== 'transparent';
    const fillActive = fill !== 'none' && fill !== 'transparent';

    const roleHint = classifyRoleByNameOrHex(
      idOrLabel ?? undefined,
      strokeActive ? stroke : fill,
      fillActive && !strokeActive
    );

    if (tag === 'path') {
      const d = node.getAttribute('d');
      if (d) {
        const res = transformNormalizedPathToMillimeters(
          d,
          { minX: 0, minY: 0, width: 1, height: 1 },
          0.5,
          0.5,
          1,
          1
        );
        for (const sp of res.subPolylines) {
          const pts = sp.points.map((pt) => applyMatrix(curMat, pt));
          if (pts.length >= (sp.closed ? 3 : 2)) {
            rawPaths.push({
              points: pts,
              closed: sp.closed,
              roleHint,
              filled: fillActive && sp.closed && !strokeActive,
              layerName: idOrLabel ?? undefined,
            });
          }
        }
      }
    } else if (tag === 'rect') {
      const x = parseFloat(node.getAttribute('x') || '0') || 0;
      const y = parseFloat(node.getAttribute('y') || '0') || 0;
      const w = parseFloat(node.getAttribute('width') || '0') || 0;
      const h = parseFloat(node.getAttribute('height') || '0') || 0;
      const rxRaw = parseFloat(node.getAttribute('rx') || node.getAttribute('ry') || '0') || 0;
      if (w > 0 && h > 0) {
        const r = Math.min(rxRaw, w / 2, h / 2);
        const pts: Point2D[] = [];
        if (r > 0.05) {
          const corners = [
            { cx: x + w - r, cy: y + r, a0: -Math.PI / 2, a1: 0 },
            { cx: x + w - r, cy: y + h - r, a0: 0, a1: Math.PI / 2 },
            { cx: x + r, cy: y + h - r, a0: Math.PI / 2, a1: Math.PI },
            { cx: x + r, cy: y + r, a0: Math.PI, a1: 1.5 * Math.PI },
          ];
          for (const c of corners) {
            for (let s = 0; s <= 5; s++) {
              const a = c.a0 + ((c.a1 - c.a0) * s) / 5;
              pts.push(applyMatrix(curMat, { x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) }));
            }
          }
        } else {
          pts.push(
            applyMatrix(curMat, { x, y }),
            applyMatrix(curMat, { x: x + w, y }),
            applyMatrix(curMat, { x: x + w, y: y + h }),
            applyMatrix(curMat, { x, y: y + h })
          );
        }
        rawPaths.push({
          points: pts,
          closed: true,
          roleHint,
          filled: fillActive && !strokeActive,
          layerName: idOrLabel ?? undefined,
        });
      }
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = parseFloat(node.getAttribute('cx') || '0') || 0;
      const cy = parseFloat(node.getAttribute('cy') || '0') || 0;
      const rx =
        tag === 'circle'
          ? parseFloat(node.getAttribute('r') || '0') || 0
          : parseFloat(node.getAttribute('rx') || '0') || 0;
      const ry =
        tag === 'circle' ? rx : parseFloat(node.getAttribute('ry') || '0') || rx;
      if (rx > 0 && ry > 0) {
        const steps = 36;
        const pts: Point2D[] = [];
        for (let s = 0; s < steps; s++) {
          const a = (2 * Math.PI * s) / steps;
          pts.push(applyMatrix(curMat, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }));
        }
        rawPaths.push({
          points: pts,
          closed: true,
          roleHint,
          filled: fillActive && !strokeActive,
          layerName: idOrLabel ?? undefined,
        });
      }
    } else if (tag === 'line') {
      const x1 = parseFloat(node.getAttribute('x1') || '0') || 0;
      const y1 = parseFloat(node.getAttribute('y1') || '0') || 0;
      const x2 = parseFloat(node.getAttribute('x2') || '0') || 0;
      const y2 = parseFloat(node.getAttribute('y2') || '0') || 0;
      rawPaths.push({
        points: [applyMatrix(curMat, { x: x1, y: y1 }), applyMatrix(curMat, { x: x2, y: y2 })],
        closed: false,
        roleHint,
        layerName: idOrLabel ?? undefined,
      });
    } else if (tag === 'polygon' || tag === 'polyline') {
      const nums = (node.getAttribute('points') || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      if (nums.length >= 4) {
        const pts: Point2D[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
          pts.push(applyMatrix(curMat, { x: nums[i], y: nums[i + 1] }));
        }
        rawPaths.push({
          points: pts,
          closed: tag === 'polygon',
          roleHint,
          filled: fillActive && tag === 'polygon' && !strokeActive,
          layerName: idOrLabel ?? undefined,
        });
      }
    } else if (tag === 'image') {
      const href =
        node.getAttribute('href') || node.getAttribute('xlink:href') || '';
      if (href.startsWith('data:image/')) {
        const x = parseFloat(node.getAttribute('x') || '0') || 0;
        const y = parseFloat(node.getAttribute('y') || '0') || 0;
        const w = parseFloat(node.getAttribute('width') || '20') || 20;
        const h = parseFloat(node.getAttribute('height') || '20') || 20;
        const tl = applyMatrix(curMat, { x, y });
        const br = applyMatrix(curMat, { x: x + w, y: y + h });
        rasters.push({
          dataUrl: href,
          xMm: Math.min(tl.x, br.x),
          yMm: Math.min(tl.y, br.y),
          widthMm: Math.max(1, Math.abs(br.x - tl.x)),
          heightMm: Math.max(1, Math.abs(br.y - tl.y)),
        });
      }
    }

    for (const child of Array.from(node.children)) {
      walkNode(child, curMat, idOrLabel ?? undefined);
    }
  };

  walkNode(svgEl, rootMat);

  return {
    format: 'svg',
    paths: stitchOpenPaths(rawPaths),
    rasters,
    layerPresets: {},
  };
}

// =========================================================================
// 3. PARSER LIGHTBURN (.lbrn2 / .lbrn)
// =========================================================================

function getLbrnAttrOrChildValue(el: Element, key: string): string | undefined {
  const direct = el.getAttribute(key);
  if (direct !== null) return direct;
  const child = Array.from(el.children).find(
    (c) => c.tagName.toLowerCase() === key.toLowerCase()
  );
  return child?.getAttribute('Value') ?? undefined;
}

function parseLbrnXForm(el: Element): Affine2D {
  const xformEl = Array.from(el.children).find(
    (c) => c.tagName.toLowerCase() === 'xform'
  );
  const raw = xformEl?.textContent?.trim();
  if (!raw) return IDENTITY_MATRIX;
  const nums = raw.split(/\s+/).map(Number);
  if (nums.length >= 6 && nums.every(Number.isFinite)) {
    return [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
  }
  return IDENTITY_MATRIX;
}

export function parseLbrn2ExternalFile(xmlText: string): ParsedExternalLaserGeometry {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Entorno sin parser XML para LightBurn.');
  }
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const root = doc.querySelector('LightBurnProject');
  if (!root) {
    throw new Error('El archivo no corresponde a un proyecto LightBurn (.lbrn2 / .lbrn) válido.');
  }

  const cutSettings = new Map<
    number,
    { role: ExternalLaserRole; preset: ImportedLayerPreset }
  >();
  const layerPresets: ParsedExternalLaserGeometry['layerPresets'] = {};

  for (const cs of Array.from(root.querySelectorAll('CutSetting'))) {
    const idxStr = getLbrnAttrOrChildValue(cs, 'index');
    const cutIdx = idxStr !== undefined ? parseInt(idxStr, 10) : NaN;
    if (!Number.isFinite(cutIdx)) continue;

    const csType = (cs.getAttribute('type') || 'Cut').toLowerCase();
    const name = getLbrnAttrOrChildValue(cs, 'name') || `C${String(cutIdx).padStart(2, '0')}`;
    const speed = parseFloat(getLbrnAttrOrChildValue(cs, 'speed') || '');
    const maxP = parseFloat(getLbrnAttrOrChildValue(cs, 'maxPower') || '');
    const minP = parseFloat(getLbrnAttrOrChildValue(cs, 'minPower') || '');
    const interval = parseFloat(getLbrnAttrOrChildValue(cs, 'interval') || '');
    const passes = parseInt(getLbrnAttrOrChildValue(cs, 'numPasses') || '1', 10);
    const doOutput = getLbrnAttrOrChildValue(cs, 'doOutput') !== '0';

    let role: ExternalLaserRole = classifyRoleByNameOrHex(name);
    let mode: LightBurnCutMode = 'line';
    if (csType === 'scan' || csType === 'image' || csType === 'offset') {
      mode = csType === 'image' ? 'image' : csType === 'offset' ? 'offset_fill' : 'fill';
      if (role === 'AUTO') role = 'ENGRAVE';
    } else {
      if (role === 'AUTO') {
        role = cutIdx === 0 ? 'ENGRAVE' : cutIdx === 1 ? 'HOLES' : 'CUT';
      }
    }

    const preset: ImportedLayerPreset = {
      ...(Number.isFinite(speed) && speed > 0 ? { speedMmPerSec: speed } : {}),
      ...(Number.isFinite(maxP) && maxP > 0 ? { maxPowerPercent: maxP } : {}),
      ...(Number.isFinite(minP) && minP >= 0 ? { minPowerPercent: minP } : {}),
      ...(Number.isFinite(interval) && interval > 0 ? { lineIntervalMm: interval } : {}),
      ...(Number.isFinite(passes) && passes >= 1 ? { passes } : {}),
      mode,
      outputEnabled: doOutput,
    };
    cutSettings.set(cutIdx, { role, preset });
    if (!layerPresets[role]) {
      layerPresets[role] = preset;
    }
  }

  const paths: ImportedVectorPath[] = [];
  const rasters: ImportedRasterImage[] = [];

  const parseVertListText = (
    vertText: string,
    primText: string,
    mat: Affine2D,
    roleHint: ExternalLaserRole,
    filled: boolean
  ) => {
    const verts: Array<{
      x: number;
      y: number;
      c0x?: number;
      c0y?: number;
      c1x?: number;
      c1y?: number;
    }> = [];
    // LightBurn formato 2.x: "V x y c0x c0y c1x c1y" o "V x y" separado por \n o ';'
    const vTokens = vertText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of vTokens) {
      const m = line.match(
        /^V\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:\s+c0x([-+]?\d*\.?\d+)\s+c0y([-+]?\d*\.?\d+))?(?:\s+c1x([-+]?\d*\.?\d+)\s+c1y([-+]?\d*\.?\d+))?/
      );
      if (m) {
        verts.push({
          x: parseFloat(m[1]),
          y: parseFloat(m[2]),
          ...(m[3] !== undefined && m[4] !== undefined
            ? { c0x: parseFloat(m[3]), c0y: parseFloat(m[4]) }
            : {}),
          ...(m[5] !== undefined && m[6] !== undefined
            ? { c1x: parseFloat(m[5]), c1y: parseFloat(m[6]) }
            : {}),
        });
      }
    }
    if (verts.length < 2) return;

    const pLines = primText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (pLines.length === 0) {
      const pts = verts.map((v) => applyMatrix(mat, { x: v.x, y: v.y }));
      paths.push({ points: pts, closed: false, roleHint, filled });
      return;
    }

    let curPoly: Point2D[] = [];
    let closed = false;
    const flush = () => {
      if (curPoly.length >= (closed ? 3 : 2)) {
        paths.push({ points: curPoly, closed, roleHint, filled });
      }
      curPoly = [];
      closed = false;
    };

    for (const pl of pLines) {
      const pm = pl.match(/^([LB])(\d+)\s+(\d+)$/);
      if (pl === 'LineClosed' || pl === 'Closed') {
        closed = true;
        continue;
      }
      if (!pm) continue;
      const op = pm[1];
      const i0 = parseInt(pm[2], 10);
      const i1 = parseInt(pm[3], 10);
      const v0 = verts[i0];
      const v1 = verts[i1];
      if (!v0 || !v1) continue;

      if (curPoly.length === 0) {
        curPoly.push(applyMatrix(mat, { x: v0.x, y: v0.y }));
      }
      if (op === 'B') {
        const c1x = v0.c1x ?? v0.x;
        const c1y = v0.c1y ?? v0.y;
        const c2x = v1.c0x ?? v1.x;
        const c2y = v1.c0y ?? v1.y;
        const steps = 12;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          const bx =
            u * u * u * v0.x +
            3 * u * u * t * c1x +
            3 * u * t * t * c2x +
            t * t * t * v1.x;
          const by =
            u * u * u * v0.y +
            3 * u * u * t * c1y +
            3 * u * t * t * c2y +
            t * t * t * v1.y;
          curPoly.push(applyMatrix(mat, { x: bx, y: by }));
        }
      } else {
        curPoly.push(applyMatrix(mat, { x: v1.x, y: v1.y }));
      }
      if (i1 === 0 && pLines.includes('LineClosed')) {
        closed = true;
      }
    }
    flush();
  };

  const walkShape = (shapeEl: Element, parentMat: Affine2D) => {
    const type = (shapeEl.getAttribute('Type') || '').toLowerCase();
    const cutIdx = parseInt(shapeEl.getAttribute('CutIndex') || '0', 10) || 0;
    const setting = cutSettings.get(cutIdx);
    const roleHint: ExternalLaserRole =
      setting?.role ?? (cutIdx === 0 ? 'ENGRAVE' : cutIdx === 1 ? 'HOLES' : 'CUT');
    const isScan = setting?.preset.mode === 'fill' || setting?.preset.mode === 'offset_fill';

    const localMat = parseLbrnXForm(shapeEl);
    const curMat = multiplyMatrix(parentMat, localMat);

    if (type === 'group') {
      const childrenEl = Array.from(shapeEl.children).find(
        (c) => c.tagName.toLowerCase() === 'children'
      );
      const container = childrenEl ?? shapeEl;
      for (const child of Array.from(container.children)) {
        if (child.tagName.toLowerCase() === 'shape') {
          walkShape(child, curMat);
        }
      }
      return;
    }

    if (type === 'rect') {
      const w = parseFloat(shapeEl.getAttribute('w') || '0') || 0;
      const h = parseFloat(shapeEl.getAttribute('h') || '0') || 0;
      const cr = parseFloat(shapeEl.getAttribute('cr') || '0') || 0;
      if (w > 0 && h > 0) {
        const hw = w / 2;
        const hh = h / 2;
        const r = Math.min(cr, hw, hh);
        const pts: Point2D[] = [];
        if (r > 0.05) {
          const corners = [
            { cx: hw - r, cy: -hh + r, a0: -Math.PI / 2, a1: 0 },
            { cx: hw - r, cy: hh - r, a0: 0, a1: Math.PI / 2 },
            { cx: -hw + r, cy: hh - r, a0: Math.PI / 2, a1: Math.PI },
            { cx: -hw + r, cy: -hh + r, a0: Math.PI, a1: 1.5 * Math.PI },
          ];
          for (const c of corners) {
            for (let s = 0; s <= 5; s++) {
              const a = c.a0 + ((c.a1 - c.a0) * s) / 5;
              pts.push(applyMatrix(curMat, { x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) }));
            }
          }
        } else {
          pts.push(
            applyMatrix(curMat, { x: -hw, y: -hh }),
            applyMatrix(curMat, { x: hw, y: -hh }),
            applyMatrix(curMat, { x: hw, y: hh }),
            applyMatrix(curMat, { x: -hw, y: hh })
          );
        }
        paths.push({ points: pts, closed: true, roleHint, filled: isScan });
      }
      return;
    }

    if (type === 'ellipse') {
      const rx = parseFloat(shapeEl.getAttribute('Rx') || shapeEl.getAttribute('rx') || '0') || 0;
      const ry = parseFloat(shapeEl.getAttribute('Ry') || shapeEl.getAttribute('ry') || '0') || rx;
      if (rx > 0 && ry > 0) {
        const pts: Point2D[] = [];
        for (let s = 0; s < 36; s++) {
          const a = (2 * Math.PI * s) / 36;
          pts.push(applyMatrix(curMat, { x: rx * Math.cos(a), y: ry * Math.sin(a) }));
        }
        paths.push({ points: pts, closed: true, roleHint, filled: isScan });
      }
      return;
    }

    if (type === 'polygon') {
      const r = parseFloat(shapeEl.getAttribute('r') || '0') || 0;
      const sides = Math.max(3, parseInt(shapeEl.getAttribute('sides') || '6', 10) || 6);
      if (r > 0) {
        const pts: Point2D[] = [];
        for (let s = 0; s < sides; s++) {
          const a = (2 * Math.PI * s) / sides;
          pts.push(applyMatrix(curMat, { x: r * Math.cos(a), y: r * Math.sin(a) }));
        }
        paths.push({ points: pts, closed: true, roleHint, filled: isScan });
      }
      return;
    }

    if (type === 'bitmap') {
      const dataB64 = shapeEl.getAttribute('Data');
      if (dataB64) {
        const pw = parseFloat(shapeEl.getAttribute('W') || shapeEl.getAttribute('w') || '20') || 20;
        const ph = parseFloat(shapeEl.getAttribute('H') || shapeEl.getAttribute('h') || '20') || 20;
        const tl = applyMatrix(curMat, { x: -pw / 2, y: -ph / 2 });
        const br = applyMatrix(curMat, { x: pw / 2, y: ph / 2 });
        const dataUrl = dataB64.startsWith('data:')
          ? dataB64
          : `data:image/png;base64,${dataB64}`;
        rasters.push({
          dataUrl,
          xMm: Math.min(tl.x, br.x),
          yMm: Math.min(tl.y, br.y),
          widthMm: Math.max(1, Math.abs(br.x - tl.x)),
          heightMm: Math.max(1, Math.abs(br.y - tl.y)),
        });
      }
      return;
    }

    if (type === 'path') {
      const vertListEl = Array.from(shapeEl.children).find(
        (c) => c.tagName.toLowerCase() === 'vertlist'
      );
      const primListEl = Array.from(shapeEl.children).find(
        (c) => c.tagName.toLowerCase() === 'primlist'
      );
      if (vertListEl?.textContent) {
        parseVertListText(
          vertListEl.textContent,
          primListEl?.textContent ?? '',
          curMat,
          roleHint,
          isScan
        );
      } else {
        // LightBurn v1 formato XML con nodos hijos <Vert x="..." y="..."/>
        const vertChildren = Array.from(shapeEl.children).filter(
          (c) => c.tagName.toLowerCase() === 'vert'
        );
        const primChildren = Array.from(shapeEl.children).filter(
          (c) => c.tagName.toLowerCase() === 'prim'
        );
        if (vertChildren.length >= 2) {
          const pts = vertChildren.map((vc) =>
            applyMatrix(curMat, {
              x: parseFloat(vc.getAttribute('x') || '0') || 0,
              y: parseFloat(vc.getAttribute('y') || '0') || 0,
            })
          );
          const closed = primChildren.some(
            (p) => (p.getAttribute('Type') || '').toLowerCase() === 'lineclosed'
          );
          paths.push({ points: pts, closed, roleHint, filled: isScan });
        }
      }
    }
  };

  for (const child of Array.from(root.children)) {
    if (child.tagName.toLowerCase() === 'shape') {
      walkShape(child, IDENTITY_MATRIX);
    }
  }

  return {
    format: 'lbrn2',
    paths: stitchOpenPaths(paths),
    rasters,
    layerPresets,
  };
}

// =========================================================================
// 4. PARSER ADOBE ILLUSTRATOR (.ai) — PostScript + Streams PDF FlateDecode
// =========================================================================

async function extractAiContentStreamsText(bytes: Uint8Array): Promise<string> {
  const rawAscii = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];

  // 1. Streams EPS/AI en texto plano (sin necesidad de descompresión)
  if (!/%PDF-/i.test(rawAscii.slice(0, 128))) {
    return rawAscii;
  }

  // 2. Streams PDF (/FlateDecode o planos) entre "stream\r?\n" y "\nendstream"
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRegex.exec(rawAscii)) !== null) {
    const dict = m[1];
    const startIdx = m.index + m[0].length;
    const endIdx = rawAscii.indexOf('endstream', startIdx);
    if (endIdx <= startIdx) continue;
    let payloadEnd = endIdx;
    if (rawAscii[payloadEnd - 1] === '\n') payloadEnd--;
    if (rawAscii[payloadEnd - 1] === '\r') payloadEnd--;

    const slice = bytes.subarray(startIdx, payloadEnd);
    if (/\/FlateDecode/i.test(dict) && typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        const writeCopy = new Uint8Array(slice.byteLength);
        writeCopy.set(slice);
        void writer.write(writeCopy);
        void writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        const text = new TextDecoder('latin1').decode(decompressed);
        if (/\b(?:m|l|c|re)\b/.test(text)) {
          chunks.push(text);
        }
      } catch {
        // Ignorar flujos de fuentes/metadatos no descomprimibles con deflate estándar
      }
    } else if (!/\/FlateDecode/i.test(dict)) {
      const plain = rawAscii.slice(startIdx, payloadEnd);
      if (/\b(?:m|l|c|re)\b/.test(plain)) {
        chunks.push(plain);
      }
    }
  }

  // También capturar trazos fuera de streams PDF si es híbrido EPS
  chunks.push(rawAscii);
  return chunks.join('\n');
}

export async function parseAiExternalFile(bytes: Uint8Array): Promise<ParsedExternalLaserGeometry> {
  const text = await extractAiContentStreamsText(bytes);
  const PT_TO_MM = 25.4 / 72;

  // En PDF/PostScript Y crece hacia arriba -> invertir Y para sistema láser top-left
  const matStack: Affine2D[] = [[PT_TO_MM, 0, 0, -PT_TO_MM, 0, 0]];
  const curMat = () => matStack[matStack.length - 1];

  const rawPaths: ImportedVectorPath[] = [];
  let subPaths: Array<{ points: Point2D[]; closed: boolean }> = [];
  let activeSub: Point2D[] = [];
  let curPt: Point2D = { x: 0, y: 0 };
  let startPt: Point2D = { x: 0, y: 0 };
  let currentRole: ExternalLaserRole = 'AUTO';

  const flushSub = (closed: boolean) => {
    if (activeSub.length >= 2) {
      subPaths.push({ points: activeSub, closed });
    }
    activeSub = [];
  };

  const emitPaint = (filled: boolean) => {
    flushSub(false);
    for (const sp of subPaths) {
      rawPaths.push({
        points: sp.points,
        closed: sp.closed,
        roleHint: currentRole,
        filled: filled && sp.closed,
      });
    }
    subPaths = [];
  };

  const numStack: number[] = [];
  const tokenRegex = /[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*]+/g;
  let tok: RegExpExecArray | null;

  const popN = (n: number): number[] | null => {
    if (numStack.length < n) {
      numStack.length = 0;
      return null;
    }
    return numStack.splice(numStack.length - n, n);
  };

  const mapAiPt = (x: number, y: number) => applyMatrix(curMat(), { x, y });

  while ((tok = tokenRegex.exec(text)) !== null) {
    const t = tok[0];
    if (/^[-+.\d]/.test(t)) {
      const n = parseFloat(t);
      if (Number.isFinite(n)) numStack.push(n);
      continue;
    }

    if (t === 'q') {
      matStack.push([...curMat()]);
      numStack.length = 0;
    } else if (t === 'Q') {
      if (matStack.length > 1) matStack.pop();
      numStack.length = 0;
    } else if (t === 'cm') {
      const a = popN(6);
      if (a) {
        matStack[matStack.length - 1] = multiplyMatrix(curMat(), [
          a[0], a[1], a[2], a[3], a[4], a[5],
        ]);
      }
    } else if (t === 'RG' || t === 'rg') {
      const rgb = popN(3);
      if (rgb) {
        const [r, g, b] = rgb.map((v) => Math.round(v * 255));
        currentRole = classifyRoleByNameOrHex(undefined, `rgb(${r},${g},${b})`, t === 'rg');
      }
    } else if (t === 'K' || t === 'k') {
      const cmyk = popN(4);
      if (cmyk) {
        const [c, m, y, k] = cmyk;
        const r = Math.round(255 * (1 - c) * (1 - k));
        const g = Math.round(255 * (1 - m) * (1 - k));
        const b = Math.round(255 * (1 - y) * (1 - k));
        currentRole = classifyRoleByNameOrHex(undefined, `rgb(${r},${g},${b})`, t === 'k');
      }
    } else if (t === 'm') {
      const p = popN(2);
      if (p) {
        flushSub(false);
        curPt = { x: p[0], y: p[1] };
        startPt = curPt;
        activeSub = [mapAiPt(curPt.x, curPt.y)];
      }
    } else if (t === 'l' || t === 'L') {
      const p = popN(2);
      if (p) {
        curPt = { x: p[0], y: p[1] };
        if (activeSub.length === 0) activeSub.push(mapAiPt(curPt.x, curPt.y));
        else activeSub.push(mapAiPt(curPt.x, curPt.y));
      }
    } else if (t === 'c' || t === 'C') {
      const a = popN(6);
      if (a) {
        const [x1, y1, x2, y2, x3, y3] = a;
        const sx = curPt.x;
        const sy = curPt.y;
        const steps = 12;
        for (let s = 1; s <= steps; s++) {
          const u = 1 - s / steps;
          const k = s / steps;
          const bx = u * u * u * sx + 3 * u * u * k * x1 + 3 * u * k * k * x2 + k * k * k * x3;
          const by = u * u * u * sy + 3 * u * u * k * y1 + 3 * u * k * k * y2 + k * k * k * y3;
          activeSub.push(mapAiPt(bx, by));
        }
        curPt = { x: x3, y: y3 };
      }
    } else if (t === 'v' || t === 'V') {
      const a = popN(4);
      if (a) {
        const [x2, y2, x3, y3] = a;
        const sx = curPt.x;
        const sy = curPt.y;
        for (let s = 1; s <= 10; s++) {
          const u = 1 - s / 10;
          const k = s / 10;
          const bx = u * u * u * sx + 3 * u * u * k * sx + 3 * u * k * k * x2 + k * k * k * x3;
          const by = u * u * u * sy + 3 * u * u * k * sy + 3 * u * k * k * y2 + k * k * k * y3;
          activeSub.push(mapAiPt(bx, by));
        }
        curPt = { x: x3, y: y3 };
      }
    } else if (t === 'y' || t === 'Y') {
      const a = popN(4);
      if (a) {
        const [x1, y1, x3, y3] = a;
        const sx = curPt.x;
        const sy = curPt.y;
        for (let s = 1; s <= 10; s++) {
          const u = 1 - s / 10;
          const k = s / 10;
          const bx = u * u * u * sx + 3 * u * u * k * x1 + 3 * u * k * k * x3 + k * k * k * x3;
          const by = u * u * u * sy + 3 * u * u * k * y1 + 3 * u * k * k * y3 + k * k * k * y3;
          activeSub.push(mapAiPt(bx, by));
        }
        curPt = { x: x3, y: y3 };
      }
    } else if (t === 're') {
      const a = popN(4);
      if (a) {
        flushSub(false);
        const [rx, ry, rw, rh] = a;
        subPaths.push({
          points: [
            mapAiPt(rx, ry),
            mapAiPt(rx + rw, ry),
            mapAiPt(rx + rw, ry + rh),
            mapAiPt(rx, ry + rh),
          ],
          closed: true,
        });
      }
    } else if (t === 'h' || t === 'H') {
      flushSub(true);
      curPt = startPt;
      numStack.length = 0;
    } else if (t === 'S') {
      emitPaint(false);
    } else if (t === 's') {
      flushSub(true);
      emitPaint(false);
    } else if (t === 'f' || t === 'F' || t === 'f*') {
      flushSub(true);
      emitPaint(true);
    } else if (t === 'B' || t === 'B*' || t === 'b' || t === 'b*') {
      if (t.startsWith('b')) flushSub(true);
      emitPaint(true);
    } else if (t === 'n') {
      subPaths = [];
      activeSub = [];
      numStack.length = 0;
    } else {
      numStack.length = 0;
    }
  }

  return {
    format: 'ai',
    paths: stitchOpenPaths(rawPaths),
    rasters: [],
    layerPresets: {},
  };
}

// =========================================================================
// 5. PARSER RUIDA BINARIO (.rd) — Vank 9060 / LightBurn / RDWorks
// =========================================================================

export function parseRdExternalFile(bytes: Uint8Array): ParsedExternalLaserGeometry {
  const raw = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    raw[i] = unscrambleRuidaByte(bytes[i]);
  }

  const absCoord = (offset: number) =>
    decodeRuidaAbsCoordMm([
      raw[offset],
      raw[offset + 1],
      raw[offset + 2],
      raw[offset + 3],
      raw[offset + 4],
    ]);

  const relCoord = (b0: number, b1: number) => {
    let val = ((b0 & 0x7f) << 7) | (b1 & 0x7f);
    if (val >= 0x2000) val -= 0x4000;
    return val / 1000;
  };

  let curX = 0;
  let curY = 0;
  let curLayer = 0;
  const layerPresets: ParsedExternalLaserGeometry['layerPresets'] = {};
  const roleForLayer = (idx: number): 'ENGRAVE' | 'HOLES' | 'CUT' =>
    idx === 0 ? 'ENGRAVE' : idx === 1 ? 'HOLES' : 'CUT';

  const paths: ImportedVectorPath[] = [];
  let curCutPts: Point2D[] = [];
  let curCutLayer = 0;

  const flushCut = () => {
    if (curCutPts.length >= 2) {
      const closed =
        curCutPts.length >= 3 &&
        isNearZeroDist(curCutPts[0], curCutPts[curCutPts.length - 1], 0.15);
      paths.push({
        points: dedupePolylinePoints(curCutPts, closed),
        closed,
        roleHint: roleForLayer(curCutLayer),
        layerName: `C${String(curCutLayer).padStart(2, '0')}`,
      });
    }
    curCutPts = [];
  };

  let i = 0;
  while (i < raw.length) {
    const cmd = raw[i];
    if (cmd === 0x88 && i + 10 < raw.length) {
      flushCut();
      curX = absCoord(i + 1);
      curY = absCoord(i + 6);
      curCutPts = [{ x: curX, y: curY }];
      curCutLayer = curLayer;
      i += 11;
    } else if (cmd === 0xa8 && i + 10 < raw.length) {
      const nx = absCoord(i + 1);
      const ny = absCoord(i + 6);
      if (curCutPts.length === 0 || curCutLayer !== curLayer) {
        flushCut();
        curCutPts = [{ x: curX, y: curY }];
        curCutLayer = curLayer;
      }
      curX = nx;
      curY = ny;
      curCutPts.push({ x: curX, y: curY });
      i += 11;
    } else if (cmd === 0x89 && i + 4 < raw.length) {
      flushCut();
      curX = roundMm(curX + relCoord(raw[i + 1], raw[i + 2]), 3);
      curY = roundMm(curY + relCoord(raw[i + 3], raw[i + 4]), 3);
      curCutPts = [{ x: curX, y: curY }];
      curCutLayer = curLayer;
      i += 5;
    } else if (cmd === 0xa9 && i + 4 < raw.length) {
      if (curCutPts.length === 0 || curCutLayer !== curLayer) {
        flushCut();
        curCutPts = [{ x: curX, y: curY }];
        curCutLayer = curLayer;
      }
      curX = roundMm(curX + relCoord(raw[i + 1], raw[i + 2]), 3);
      curY = roundMm(curY + relCoord(raw[i + 3], raw[i + 4]), 3);
      curCutPts.push({ x: curX, y: curY });
      i += 5;
    } else if (cmd === 0x8a && i + 2 < raw.length) {
      flushCut();
      curX = roundMm(curX + relCoord(raw[i + 1], raw[i + 2]), 3);
      curCutPts = [{ x: curX, y: curY }];
      curCutLayer = curLayer;
      i += 3;
    } else if (cmd === 0xaa && i + 2 < raw.length) {
      if (curCutPts.length === 0 || curCutLayer !== curLayer) {
        flushCut();
        curCutPts = [{ x: curX, y: curY }];
        curCutLayer = curLayer;
      }
      curX = roundMm(curX + relCoord(raw[i + 1], raw[i + 2]), 3);
      curCutPts.push({ x: curX, y: curY });
      i += 3;
    } else if (cmd === 0x8b && i + 2 < raw.length) {
      flushCut();
      curY = roundMm(curY + relCoord(raw[i + 1], raw[i + 2]), 3);
      curCutPts = [{ x: curX, y: curY }];
      curCutLayer = curLayer;
      i += 3;
    } else if (cmd === 0xab && i + 2 < raw.length) {
      if (curCutPts.length === 0 || curCutLayer !== curLayer) {
        flushCut();
        curCutPts = [{ x: curX, y: curY }];
        curCutLayer = curLayer;
      }
      curY = roundMm(curY + relCoord(raw[i + 1], raw[i + 2]), 3);
      curCutPts.push({ x: curX, y: curY });
      i += 3;
    } else if (cmd === 0xca && i + 2 < raw.length) {
      const sub = raw[i + 1];
      if (sub === 0x06 && i + 7 < raw.length) {
        i += 8;
      } else if (sub === 0x02 && i + 2 < raw.length) {
        curLayer = raw[i + 2];
        i += 3;
      } else if (sub === 0x41 && i + 3 < raw.length) {
        i += 4;
      } else {
        i += 3;
      }
    } else if (cmd === 0xc9 && i + 1 < raw.length) {
      const sub = raw[i + 1];
      if (sub === 0x02 && i + 6 < raw.length) {
        const sp = absCoord(i + 2);
        const role = roleForLayer(curLayer);
        layerPresets[role] = { ...layerPresets[role], speedMmPerSec: sp };
        i += 7;
      } else if (sub === 0x04 && i + 7 < raw.length) {
        const targetRole = roleForLayer(raw[i + 2]);
        const sp = absCoord(i + 3);
        layerPresets[targetRole] = { ...layerPresets[targetRole], speedMmPerSec: sp };
        i += 8;
      } else {
        i += 7;
      }
    } else if (cmd === 0xc6 && i + 1 < raw.length) {
      const sub = raw[i + 1];
      if ((sub === 0x01 || sub === 0x02) && i + 3 < raw.length) {
        const pwr = decodeRuidaPowerPercent([raw[i + 2], raw[i + 3]]);
        const role = roleForLayer(curLayer);
        layerPresets[role] =
          sub === 0x01
            ? { ...layerPresets[role], minPowerPercent: pwr }
            : { ...layerPresets[role], maxPowerPercent: pwr };
        i += 4;
      } else if ((sub === 0x31 || sub === 0x32) && i + 4 < raw.length) {
        const targetRole = roleForLayer(raw[i + 2]);
        const pwr = decodeRuidaPowerPercent([raw[i + 3], raw[i + 4]]);
        layerPresets[targetRole] =
          sub === 0x31
            ? { ...layerPresets[targetRole], minPowerPercent: pwr }
            : { ...layerPresets[targetRole], maxPowerPercent: pwr };
        i += 5;
      } else if (sub >= 0x10 && sub <= 0x16) {
        i += 7;
      } else {
        i += 4;
      }
    } else if (cmd === 0xe7 && i + 1 < raw.length) {
      const sub = raw[i + 1];
      if (sub === 0x00) {
        i += 2;
      } else if (sub === 0x24 || sub === 0x60) {
        i += 3;
      } else if (sub === 0x54 || sub === 0x55) {
        i += 8;
      } else if (sub === 0x08) {
        i += 16;
      } else if (sub === 0x52 || sub === 0x53 || sub === 0x61 || sub === 0x62) {
        i += 13;
      } else if (
        sub === 0x03 ||
        sub === 0x06 ||
        sub === 0x07 ||
        sub === 0x13 ||
        sub === 0x17 ||
        sub === 0x23 ||
        sub === 0x37 ||
        sub === 0x50 ||
        sub === 0x51
      ) {
        i += 12;
      } else {
        i += 7;
      }
    } else if (cmd === 0xf1 && i + 1 < raw.length) {
      const sub = raw[i + 1];
      i += sub === 0x03 ? 12 : 3;
    } else if (cmd === 0xf2 && i + 1 < raw.length) {
      const sub = raw[i + 1];
      if (sub === 0x05) i += 16;
      else if (sub === 0x02 || sub === 0x03 || sub === 0x04 || sub === 0x06) i += 12;
      else i += 3;
    } else if (cmd === 0xea && i + 1 < raw.length) {
      const sub = raw[i + 1];
      i += sub === 0x00 || sub === 0x0f ? 2 : 12;
    } else if (cmd === 0xd8 || cmd === 0xf0 || cmd === 0xd7) {
      i += 2;
    } else if (cmd === 0xeb) {
      flushCut();
      break;
    } else {
      i++;
    }
  }
  flushCut();

  return {
    format: 'rd',
    paths: stitchOpenPaths(paths),
    rasters: [],
    layerPresets,
  };
}

// =========================================================================
// CONVERSIÓN A TRABAJOS LISTOS PARA MESA VANK 9060 (`WorkbenchJobItem`)
// =========================================================================

function resolveAutoRoles(paths: ImportedVectorPath[]): ImportedVectorPath[] {
  const hasExplicitCut = paths.some((p) => p.roleHint === 'CUT');
  if (hasExplicitCut) {
    return paths.map((p) =>
      p.roleHint === 'AUTO' ? { ...p, roleHint: 'ENGRAVE' } : p
    );
  }

  // Sin colores/capas explícitos de corte: detectar contornos cerrados más externos como CUT
  const closedCandidates = paths
    .map((p, idx) => ({
      idx,
      p,
      area: p.closed ? polygonSignedAreaMm2(p.points) : 0,
      bb: computeBoundingBox(p.points),
    }))
    .filter((c) => c.p.closed && c.area > 4 && !c.p.filled);

  if (closedCandidates.length === 0) {
    return paths.map((p) =>
      p.roleHint === 'AUTO' ? { ...p, roleHint: 'ENGRAVE' } : p
    );
  }

  const maxArea = Math.max(...closedCandidates.map((c) => c.area));
  const cutIndices = new Set<number>();
  for (const c of closedCandidates) {
    if (c.area >= maxArea * 0.55 && c.p.roleHint === 'AUTO') {
      cutIndices.add(c.idx);
    }
  }

  return paths.map((p, idx) => {
    if (p.roleHint !== 'AUTO') return p;
    return { ...p, roleHint: cutIndices.has(idx) ? 'CUT' : 'ENGRAVE' };
  });
}

function isCircularLoop(pts: Point2D[]): { cx: number; cy: number; diameterMm: number } | null {
  if (pts.length < 10) return null;
  const bb = computeBoundingBox(pts);
  if (bb.width < 0.8 || bb.height < 0.8) return null;
  const ratio = bb.width / bb.height;
  if (ratio < 0.88 || ratio > 1.14) return null;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const rAvg = (bb.width + bb.height) / 4;
  for (const p of pts) {
    if (Math.abs(Math.hypot(p.x - cx, p.y - cy) - rAvg) > Math.max(0.25, rAvg * 0.14)) {
      return null;
    }
  }
  return { cx: roundMm(cx, 2), cy: roundMm(cy, 2), diameterMm: roundMm(rAvg * 2, 2) };
}

function buildWorkbenchJobFromParsedPaths(params: {
  cleanName: string;
  parsed: ParsedExternalLaserGeometry;
  config: WorkbenchConfig;
}): { jobs: WorkbenchJobItem[]; warnings: string[]; widthMm: number; heightMm: number } {
  const { cleanName, parsed, config } = params;
  const warnings: string[] = [];

  const resolved = resolveAutoRoles(parsed.paths);
  if (resolved.length === 0 && parsed.rasters.length === 0) {
    throw new Error(`El archivo "${cleanName}" no contiene trazados ni imágenes válidas de grabado o corte.`);
  }

  const allPts = [
    ...resolved.flatMap((p) => p.points),
    ...parsed.rasters.flatMap((r) => [
      { x: r.xMm, y: r.yMm },
      { x: r.xMm + r.widthMm, y: r.yMm + r.heightMm },
    ]),
  ];
  const globalBb = computeBoundingBox(allPts);
  const shiftX = -globalBb.minX;
  const shiftY = -globalBb.minY;

  const totalW = Math.max(1, roundMm(globalBb.width, 2));
  const totalH = Math.max(1, roundMm(globalBb.height, 2));

  const cutPaths = resolved.filter((p) => p.roleHint === 'CUT');
  const holePaths = resolved.filter((p) => p.roleHint === 'HOLES');
  const engravePaths = resolved.filter((p) => p.roleHint === 'ENGRAVE');

  if (cutPaths.length === 0) {
    warnings.push(
      'Solo se detectaron trazos de grabado (sin capa de corte roja). Revisá la capa C02 antes de cortar.'
    );
  }

  // Normalizar primer contorno de corte externo para `custom_polygon` (permite rotar/repetir/escalar)
  const mainCut =
    cutPaths.length > 0
      ? [...cutPaths].sort((a, b) => polygonSignedAreaMm2(b.points) - polygonSignedAreaMm2(a.points))[0]
      : null;

  const customPolygonNormalized: Point2D[] | undefined = mainCut
    ? mainCut.points.map((pt) => ({
        x: roundMm((pt.x + shiftX) / totalW, 5),
        y: roundMm((pt.y + shiftY) / totalH, 5),
      }))
    : undefined;

  const customHoles: HoleSpec[] = [];
  const extraNonCircularHoleContours: ClosedContour[] = [];

  holePaths.forEach((hp, idx) => {
    const shifted = hp.points.map((pt) => ({
      x: roundMm(pt.x + shiftX, 3),
      y: roundMm(pt.y + shiftY, 3),
    }));
    const circ = hp.closed ? isCircularLoop(shifted) : null;
    if (circ) {
      customHoles.push({
        id: `ext-hole-${idx + 1}`,
        x: circ.cx,
        y: circ.cy,
        diameterMm: circ.diameterMm,
      });
    } else if (shifted.length >= 2) {
      extraNonCircularHoleContours.push({
        id: `ext-hole-poly-${idx + 1}`,
        layer: 'HOLES',
        points: shifted,
        svgPathD: pointsToSvgPathD(shifted, hp.closed),
        closed: hp.closed,
        boundingBox: computeBoundingBox(shifted),
      });
    }
  });

  // Otros contornos de corte adicionales cuando el archivo trae múltiples contornos independientes
  const extraCutContours: ClosedContour[] = cutPaths
    .filter((cp) => cp !== mainCut)
    .map((cp, idx) => {
      const shifted = cp.points.map((pt) => ({
        x: roundMm(pt.x + shiftX, 3),
        y: roundMm(pt.y + shiftY, 3),
      }));
      return {
        id: `ext-cut-extra-${idx + 1}`,
        layer: 'CUT',
        points: shifted,
        svgPathD: pointsToSvgPathD(shifted, cp.closed),
        closed: cp.closed,
        boundingBox: computeBoundingBox(shifted),
      };
    });

  // Convertir trazos de grabado a `SvgLogoElement` + `EngravedItemGeometry` directos
  const elements: LabelDesign['elements'] = [];
  const directEngraveItems: EngravedItemGeometry[] = [];

  if (engravePaths.length > 0) {
    const shiftedPolys = engravePaths.map((ep) => ({
      points: ep.points.map((pt) => ({
        x: roundMm(pt.x + shiftX, 3),
        y: roundMm(pt.y + shiftY, 3),
      })),
      closed: ep.closed,
    }));
    const engPts = shiftedPolys.flatMap((pl) => pl.points);
    const engBb = computeBoundingBox(engPts);
    const engW = Math.max(0.5, engBb.width);
    const engH = Math.max(0.5, engBb.height);
    const dStr = shiftedPolys
      .map((pl) => {
        const segs = pl.points.map(
          (p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
        );
        if (pl.closed) segs.push('Z');
        return segs.join(' ');
      })
      .join(' ');

    const anyFilled = engravePaths.some((ep) => ep.filled);
    const svgEl: SvgLogoElement = {
      id: `ext-svg-${Date.now()}`,
      name: `${cleanName} Grabado`,
      type: 'logo_svg',
      xMm: roundMm(engBb.minX + engW / 2, 2),
      yMm: roundMm(engBb.minY + engH / 2, 2),
      widthMm: roundMm(engW, 2),
      heightMm: roundMm(engH, 2),
      aspectRatio: roundMm(engW / engH, 4),
      lockAspectRatio: true,
      rotationDeg: 0,
      locked: false,
      visible: true,
      rawSvgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${engBb.minX} ${engBb.minY} ${engW} ${engH}"><path d="${dStr}" /></svg>`,
      normalizedPaths: [dStr],
      originalViewBox: {
        minX: engBb.minX,
        minY: engBb.minY,
        width: engW,
        height: engH,
      },
    };
    elements.push(svgEl);
    directEngraveItems.push({
      id: svgEl.id,
      kind: 'vector_path',
      svgPathD: dStr,
      polylines: shiftedPolys,
      strokeWidthMm: 0.25,
      filled: anyFilled,
      fillRule: 'evenodd',
      boundingBox: engBb,
    });
  }

  parsed.rasters.forEach((r, idx) => {
    const rx = roundMm(r.xMm + shiftX, 2);
    const ry = roundMm(r.yMm + shiftY, 2);
    const rw = roundMm(r.widthMm, 2);
    const rh = roundMm(r.heightMm, 2);
    const rasterEl: RasterLogoElement = {
      id: `ext-raster-${Date.now()}-${idx}`,
      name: `${cleanName} Imagen ${idx + 1}`,
      type: 'logo_raster',
      xMm: roundMm(rx + rw / 2, 2),
      yMm: roundMm(ry + rh / 2, 2),
      widthMm: rw,
      heightMm: rh,
      aspectRatio: roundMm(rw / Math.max(0.5, rh), 4),
      lockAspectRatio: true,
      rotationDeg: r.rotationDeg ?? 0,
      mirrored: r.mirrored,
      locked: false,
      visible: true,
      originalDataUrl: r.dataUrl,
      processedDataUrl: r.dataUrl,
      pixelWidth: r.pixelWidth ?? 500,
      pixelHeight: r.pixelHeight ?? 500,
      processing: {
        mode: 'raster',
        threshold: 165,
        brightness: 0,
        contrast: 0,
        invert: false,
        removeBackground: false,
        backgroundTolerance: 20,
        turdSize: 0.8,
      },
      vectorizedPathsNormalized: [],
      effectiveDpi: r.effectiveDpi ?? 300,
    };
    elements.push(rasterEl);
    directEngraveItems.push({
      id: rasterEl.id,
      kind: 'raster_image',
      dataUrl: r.dataUrl,
      xMm: rx,
      yMm: ry,
      widthMm: rw,
      heightMm: rh,
      rotationDeg: r.rotationDeg ?? 0,
      mirrored: r.mirrored,
      boundingBox: {
        minX: rx,
        minY: ry,
        maxX: roundMm(rx + rw, 2),
        maxY: roundMm(ry + rh, 2),
        width: rw,
        height: rh,
      },
    });
  });

  const design: LabelDesign = {
    id: `ext-design-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    shape: customPolygonNormalized ? 'custom_polygon' : 'rectangle',
    widthMm: totalW,
    heightMm: totalH,
    cornerRadiusMm: 0,
    safetyMarginMm: 0,
    kerfCompensationMm: 0,
    holes: {
      preset: customHoles.length > 0 ? 'custom' : 'none',
      diameterMm: customHoles[0]?.diameterMm ?? 3,
      edgeDistanceMm: 3,
      customHoles,
    },
    ...(customPolygonNormalized ? { customPolygonNormalized } : {}),
    elements,
  };

  const importedNesting = computeNestingLayout(design, {
    requestedQuantity: 1,
    machineBedWidthMm: config.machineBedWidthMm,
    machineBedHeightMm: config.machineBedHeightMm,
    sheetWidthMm: Math.max(totalW + 10, config.sheetWidthMm),
    sheetHeightMm: Math.max(totalH + 10, config.sheetHeightMm),
    gapXMm: 2,
    gapYMm: 2,
    marginTopMm: 2,
    marginRightMm: 2,
    marginBottomMm: 2,
    marginLeftMm: 2,
    rotationMode: '0',
    centerInSheet: false,
    fillEntireSheetCapacity: false,
  });

  const baseJob = createWorkbenchJobFromOrder({
    design,
    nesting: importedNesting,
    mode: 'single_piece',
    projectName: cleanName,
    clientName: `Externo (${parsed.format.toUpperCase()})`,
    orderId: `ext-${parsed.format}-${Date.now()}`,
    existingJobs: [],
    config,
  });

  // Inyectar geometría exacta directa (agujeros no circulares + trazos múltiples + corte principal real)
  const mainCutShiftedPts = mainCut
    ? mainCut.points.map((pt) => ({
        x: roundMm(pt.x + shiftX, 3),
        y: roundMm(pt.y + shiftY, 3),
      }))
    : [];
  const mainCutContour: ClosedContour = mainCut
    ? {
        id: 'ext-cut-main',
        layer: 'CUT',
        points: mainCutShiftedPts,
        svgPathD: pointsToSvgPathD(mainCutShiftedPts, mainCut.closed),
        closed: mainCut.closed,
        boundingBox: computeBoundingBox(mainCutShiftedPts),
      }
    : {
        id: 'ext-cut-none',
        layer: 'CUT',
        points: [],
        svgPathD: '',
        closed: false,
        boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      };

  // Si hubo cortes múltiples (ej. plancha entera con varias figuras), añadirlos también en el trabajo
  // colocando los contornos adicionales como cortes de instancia extra cuando hay >1 contorno de corte
  const instances: WorkbenchPlacedInstance[] = [
    {
      ...baseJob.instances[0],
      localXMm: 0,
      localYMm: 0,
      widthMm: totalW,
      heightMm: totalH,
      engraveItems: directEngraveItems,
      holeContours: [
        ...baseJob.instances[0].holeContours,
        ...extraNonCircularHoleContours,
      ],
      cutContour: mainCutContour,
    },
    ...extraCutContours.map((ec, idx) => ({
      instanceIndex: idx + 2,
      localXMm: roundMm(ec.boundingBox.minX, 2),
      localYMm: roundMm(ec.boundingBox.minY, 2),
      widthMm: roundMm(ec.boundingBox.width, 2),
      heightMm: roundMm(ec.boundingBox.height, 2),
      rotated90: false,
      engraveItems: [],
      holeContours: [],
      cutContour: ec,
    })),
  ];

  const finalJob: WorkbenchJobItem = {
    ...baseJob,
    pieceCount: Math.max(1, cutPaths.length),
    columns: 1,
    rows: 1,
    firstRowIndentMm: 0,
    firstRowShelfHeightMm: 0,
    widthMm: totalW,
    heightMm: totalH,
    preserveImportedGeometry: true,
    instances,
  };

  return { jobs: [finalJob], warnings, widthMm: totalW, heightMm: totalH };
}

function getImportedJobLayerFlags(job: WorkbenchJobItem): {
  hasEngrave: boolean;
  hasCutOrHoles: boolean;
} {
  let hasEngrave = false;
  let hasCutOrHoles = false;
  for (const inst of job.instances) {
    if (inst.engraveItems.length > 0) hasEngrave = true;
    if (inst.cutContour.points.length >= 2 || inst.holeContours.length > 0) {
      hasCutOrHoles = true;
    }
  }
  return { hasEngrave, hasCutOrHoles };
}

function shiftImportedCutContoursAndHoles(
  instances: WorkbenchPlacedInstance[],
  dx: number,
  dy: number
): WorkbenchPlacedInstance[] {
  if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return instances;
  const shiftPt = (p: Point2D) => ({ x: roundMm(p.x + dx, 3), y: roundMm(p.y + dy, 3) });
  return instances.map((inst) => ({
    ...inst,
    localXMm: roundMm(inst.localXMm + dx, 2),
    localYMm: roundMm(inst.localYMm + dy, 2),
    cutContour:
      inst.cutContour.points.length >= 2
        ? {
            ...inst.cutContour,
            points: inst.cutContour.points.map(shiftPt),
            svgPathD: pointsToSvgPathD(inst.cutContour.points.map(shiftPt), inst.cutContour.closed),
            boundingBox: computeBoundingBox(inst.cutContour.points.map(shiftPt)),
          }
        : inst.cutContour,
    holeContours: inst.holeContours.map((hc) => {
      const pts = hc.points.map(shiftPt);
      return {
        ...hc,
        points: pts,
        svgPathD: pointsToSvgPathD(pts, hc.closed),
        boundingBox: computeBoundingBox(pts),
      };
    }),
  }));
}

function shiftImportedEngraveItems(
  items: EngravedItemGeometry[],
  dx: number,
  dy: number
): EngravedItemGeometry[] {
  if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return items;
  const shiftPt = (p: Point2D) => ({ x: roundMm(p.x + dx, 3), y: roundMm(p.y + dy, 3) });
  return items.map((eng) => {
    if (eng.kind === 'vector_path' && eng.polylines) {
      const nextPolys = eng.polylines.map((pl) => ({ ...pl, points: pl.points.map(shiftPt) }));
      const pts = nextPolys.flatMap((pl) => pl.points);
      return {
        ...eng,
        polylines: nextPolys,
        svgPathD: nextPolys.map((pl) => pointsToSvgPathD(pl.points, pl.closed)).join(' '),
        boundingBox: pts.length > 0 ? computeBoundingBox(pts) : eng.boundingBox,
      };
    }
    if (eng.kind === 'raster_image') {
      const nx = roundMm((eng.xMm ?? 0) + dx, 2);
      const ny = roundMm((eng.yMm ?? 0) + dy, 2);
      const nw = eng.widthMm ?? 10;
      const nh = eng.heightMm ?? 10;
      return {
        ...eng,
        xMm: nx,
        yMm: ny,
        boundingBox: {
          minX: nx,
          minY: ny,
          maxX: roundMm(nx + nw, 2),
          maxY: roundMm(ny + nh, 2),
          width: nw,
          height: nh,
        },
      };
    }
    return eng;
  });
}

function combinePairedEngraveAndCutJobs(
  engraveJob: WorkbenchJobItem,
  cutJob: WorkbenchJobItem
): WorkbenchJobItem {
  const mergedW = roundMm(Math.max(engraveJob.widthMm, cutJob.widthMm), 2);
  const mergedH = roundMm(Math.max(engraveJob.heightMm, cutJob.heightMm), 2);
  const engDx = roundMm((mergedW - engraveJob.widthMm) / 2, 2);
  const engDy = roundMm((mergedH - engraveJob.heightMm) / 2, 2);
  const cutDx = roundMm((mergedW - cutJob.widthMm) / 2, 2);
  const cutDy = roundMm((mergedH - cutJob.heightMm) / 2, 2);

  const allShiftedEngrave = engraveJob.instances.flatMap((i) =>
    shiftImportedEngraveItems(i.engraveItems, engDx, engDy)
  );
  const shiftedCutInstances = shiftImportedCutContoursAndHoles(cutJob.instances, cutDx, cutDy);
  shiftedCutInstances[0] = {
    ...shiftedCutInstances[0],
    widthMm: mergedW,
    heightMm: mergedH,
    engraveItems: allShiftedEngrave,
  };

  return {
    ...cutJob,
    name: `${cutJob.name} + Grabado`,
    widthMm: mergedW,
    heightMm: mergedH,
    preserveImportedGeometry: true,
    labelDesign: {
      ...cutJob.labelDesign,
      widthMm: mergedW,
      heightMm: mergedH,
      elements: [
        ...engraveJob.labelDesign.elements,
        ...cutJob.labelDesign.elements,
      ],
    },
    instances: shiftedCutInstances,
  };
}

/**
 * Detecta y combina automáticamente archivos externos complementarios de la misma tirada/plancha
 * (ej. `01_GRABADO_50_600dpi.png` solo grabado + `02_CORTE_50.dxf` solo corte con idénticas dimensiones ±8 mm),
 * tanto si se abren juntos como uno después del otro.
 */
export function mergeComplementaryImportedJobs(
  existingJobs: WorkbenchJobItem[],
  incomingJobs: WorkbenchJobItem[]
): { jobs: WorkbenchJobItem[]; mergedCount: number } {
  const workingExisting = [...existingJobs];
  const remainingIncoming: WorkbenchJobItem[] = [];
  let mergedCount = 0;

  const canPair = (a: WorkbenchJobItem, b: WorkbenchJobItem): boolean => {
    if (!a.preserveImportedGeometry || !b.preserveImportedGeometry) return false;
    const fa = getImportedJobLayerFlags(a);
    const fb = getImportedJobLayerFlags(b);
    const complementary =
      (fa.hasEngrave && !fa.hasCutOrHoles && fb.hasCutOrHoles && !fb.hasEngrave) ||
      (fb.hasEngrave && !fb.hasCutOrHoles && fa.hasCutOrHoles && !fa.hasEngrave);
    if (!complementary) return false;
    const tol = Math.max(8, Math.max(a.widthMm, a.heightMm, b.widthMm, b.heightMm) * 0.04);
    return Math.abs(a.widthMm - b.widthMm) <= tol && Math.abs(a.heightMm - b.heightMm) <= tol;
  };

  // 1. Emparejar dentro del mismo lote entrante
  const pool = [...incomingJobs];
  const pairedIncoming: WorkbenchJobItem[] = [];
  const usedIdx = new Set<number>();

  for (let i = 0; i < pool.length; i++) {
    if (usedIdx.has(i)) continue;
    let cur = pool[i];
    for (let j = i + 1; j < pool.length; j++) {
      if (usedIdx.has(j)) continue;
      if (canPair(cur, pool[j])) {
        const flagsCur = getImportedJobLayerFlags(cur);
        cur = flagsCur.hasEngrave
          ? combinePairedEngraveAndCutJobs(cur, pool[j])
          : combinePairedEngraveAndCutJobs(pool[j], cur);
        usedIdx.add(j);
        mergedCount++;
        break;
      }
    }
    pairedIncoming.push(cur);
  }

  // 2. Emparejar con trabajos ya presentes en mesa
  for (const inc of pairedIncoming) {
    const matchIdx = workingExisting.findIndex((ex) => canPair(ex, inc));
    if (matchIdx >= 0) {
      const ex = workingExisting[matchIdx];
      const flagsEx = getImportedJobLayerFlags(ex);
      workingExisting[matchIdx] = flagsEx.hasEngrave
        ? combinePairedEngraveAndCutJobs(ex, inc)
        : combinePairedEngraveAndCutJobs(inc, ex);
      mergedCount++;
    } else {
      remainingIncoming.push(inc);
    }
  }

  return {
    jobs: [...workingExisting, ...remainingIncoming],
    mergedCount,
  };
}

// =========================================================================
// PUNTO DE ENTRADA UNIFICADO PARA ARCHIVOS EXTERNOS DE GRABADO Y CORTE
// =========================================================================

export function mergeImportedLayerUpdates(
  config: WorkbenchConfig,
  updates: ExternalLaserImportResult['layerUpdates']
): WorkbenchConfig {
  if (!updates || Object.keys(updates).length === 0) return config;
  return {
    ...config,
    layers: config.layers.map((layer) => {
      if (layer.role === 'GUIDE') return layer;
      const patch = updates[layer.role];
      return patch ? { ...layer, ...patch } : layer;
    }),
  };
}

// =========================================================================
// 6. PARSER RÁSTER EXTERNO (.png / .jpg / .webp / .bmp) CON DPI FÍSICO REAL
// =========================================================================

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function readUint16BE(b: Uint8Array, off: number): number {
  return ((b[off] << 8) | b[off + 1]) >>> 0;
}

function readUint32BE(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function readInt32LE(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) | 0;
}

function extractFilenameDpiHint(fileName: string): number | null {
  const m = fileName.match(/(?:^|[^0-9])(\d{2,4})\s*dpi\b/i);
  if (!m) return null;
  const dpi = parseInt(m[1], 10);
  return Number.isFinite(dpi) && dpi >= 36 && dpi <= 2400 ? dpi : null;
}

export function parseRasterEngraveExternalFile(
  fileName: string,
  bytes: Uint8Array
): ParsedExternalLaserGeometry {
  const lower = fileName.trim().toLowerCase();
  let mime = 'image/png';
  let widthPx = 0;
  let heightPx = 0;
  let dpiX: number | null = null;
  let dpiY: number | null = null;

  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;

  if (isPng) {
    mime = 'image/png';
    widthPx = readUint32BE(bytes, 16);
    heightPx = readUint32BE(bytes, 20);
    let pos = 8;
    while (pos + 12 <= bytes.length) {
      const len = readUint32BE(bytes, pos);
      const tag = String.fromCharCode(
        bytes[pos + 4],
        bytes[pos + 5],
        bytes[pos + 6],
        bytes[pos + 7]
      );
      if (tag === 'pHYs' && len >= 9 && pos + 8 + 9 <= bytes.length) {
        const ppuX = readUint32BE(bytes, pos + 8);
        const ppuY = readUint32BE(bytes, pos + 12);
        const unit = bytes[pos + 16];
        if (unit === 1 && ppuX > 0 && ppuY > 0) {
          dpiX = Math.round(ppuX * 0.0254);
          dpiY = Math.round(ppuY * 0.0254);
        }
        break;
      }
      if (tag === 'IDAT' || tag === 'IEND') break;
      pos += 12 + len;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg';
    let pos = 2;
    while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const segLen = readUint16BE(bytes, pos + 2);
      if (segLen < 2 || pos + 2 + segLen > bytes.length) break;
      if (
        marker === 0xe0 &&
        segLen >= 16 &&
        bytes[pos + 4] === 0x4a &&
        bytes[pos + 5] === 0x46 &&
        bytes[pos + 6] === 0x49 &&
        bytes[pos + 7] === 0x46
      ) {
        const units = bytes[pos + 11];
        const xDens = readUint16BE(bytes, pos + 12);
        const yDens = readUint16BE(bytes, pos + 14);
        if (units === 1 && xDens > 0 && yDens > 0) {
          dpiX = xDens;
          dpiY = yDens;
        } else if (units === 2 && xDens > 0 && yDens > 0) {
          dpiX = Math.round(xDens * 2.54);
          dpiY = Math.round(yDens * 2.54);
        }
      } else if (marker >= 0xc0 && marker <= 0xc3 && segLen >= 9) {
        heightPx = readUint16BE(bytes, pos + 5);
        widthPx = readUint16BE(bytes, pos + 7);
      }
      pos += 2 + segLen;
    }
  } else if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    mime = 'image/bmp';
    widthPx = Math.abs(readInt32LE(bytes, 18));
    heightPx = Math.abs(readInt32LE(bytes, 22));
    if (bytes.length >= 46) {
      const ppmX = readInt32LE(bytes, 38);
      const ppmY = readInt32LE(bytes, 42);
      if (ppmX > 0 && ppmY > 0) {
        dpiX = Math.round(ppmX * 0.0254);
        dpiY = Math.round(ppmY * 0.0254);
      }
    }
  } else if (lower.endsWith('.webp') && bytes.length >= 30) {
    mime = 'image/webp';
    const chunkTag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunkTag === 'VP8X') {
      widthPx = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
      heightPx = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    }
  } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    mime = 'image/jpeg';
  } else if (lower.endsWith('.bmp')) {
    mime = 'image/bmp';
  }

  const nameDpi = extractFilenameDpiHint(fileName);
  const effDpiX = nameDpi ?? (dpiX && dpiX >= 36 ? dpiX : 300);
  const effDpiY = nameDpi ?? (dpiY && dpiY >= 36 ? dpiY : effDpiX);

  const safeWpx = widthPx > 0 ? widthPx : 600;
  const safeHpx = heightPx > 0 ? heightPx : 600;
  const widthMm = Math.max(1, roundMm((safeWpx / effDpiX) * 25.4, 2));
  const heightMm = Math.max(1, roundMm((safeHpx / effDpiY) * 25.4, 2));

  const dataUrl = `data:${mime};base64,${uint8ToBase64(bytes)}`;

  return {
    format: 'raster',
    paths: [],
    rasters: [
      {
        dataUrl,
        xMm: 0,
        yMm: 0,
        widthMm,
        heightMm,
        pixelWidth: safeWpx,
        pixelHeight: safeHpx,
        effectiveDpi: effDpiX,
      },
    ],
    layerPresets: {},
  };
}

export function detectExternalLaserFormat(fileName: string): ExternalLaserFormat | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.dxf')) return 'dxf';
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.lbrn2') || lower.endsWith('.lbrn')) return 'lbrn2';
  if (lower.endsWith('.ai')) return 'ai';
  if (lower.endsWith('.rd')) return 'rd';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp')
  ) {
    return 'raster';
  }
  return null;
}

export async function importExternalLaserFile(params: {
  fileName: string;
  bytes: Uint8Array;
  config: WorkbenchConfig;
}): Promise<ExternalLaserImportResult> {
  const { fileName, bytes, config } = params;
  const format = detectExternalLaserFormat(fileName);
  if (!format) {
    throw new Error(
      `Formato no soportado para "${fileName}". Formatos admitidos: .dxf, .svg, .lbrn2, .lbrn, .ai, .rd, .png, .jpg, .webp y .bmp`
    );
  }

  const cleanName = fileName.replace(/\.[^.]+$/, '') || 'Archivo Externo';
  let parsed: ParsedExternalLaserGeometry;

  if (format === 'dxf') {
    parsed = parseDxfExternalFile(new TextDecoder('utf-8').decode(bytes));
  } else if (format === 'svg') {
    parsed = parseSvgExternalFile(new TextDecoder('utf-8').decode(bytes));
  } else if (format === 'lbrn2') {
    parsed = parseLbrn2ExternalFile(new TextDecoder('utf-8').decode(bytes));
  } else if (format === 'ai') {
    parsed = await parseAiExternalFile(bytes);
  } else if (format === 'rd') {
    parsed = parseRdExternalFile(bytes);
  } else {
    parsed = parseRasterEngraveExternalFile(fileName, bytes);
  }

  const built = buildWorkbenchJobFromParsedPaths({
    cleanName,
    parsed,
    config,
  });

  const layerUpdates: ExternalLaserImportResult['layerUpdates'] = {};
  for (const role of ['ENGRAVE', 'HOLES', 'CUT'] as const) {
    const p = parsed.layerPresets[role];
    if (p) {
      layerUpdates[role] = p;
    }
  }

  const resolved = resolveAutoRoles(parsed.paths);
  return {
    jobs: built.jobs,
    layerUpdates,
    summary: {
      format,
      fileName,
      jobCount: built.jobs.length,
      pieceCount: built.jobs.reduce((s, j) => s + j.pieceCount, 0),
      engravePathCount: resolved.filter((p) => p.roleHint === 'ENGRAVE').length,
      holeContourCount: resolved.filter((p) => p.roleHint === 'HOLES').length,
      cutContourCount: resolved.filter((p) => p.roleHint === 'CUT').length,
      rasterCount: parsed.rasters.length,
      widthMm: built.widthMm,
      heightMm: built.heightMm,
      hasAppliedLayerParams: Object.keys(layerUpdates).length > 0,
      warnings: built.warnings,
    },
  };
}
