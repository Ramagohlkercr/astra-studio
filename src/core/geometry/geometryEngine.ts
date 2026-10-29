import {
  BoundingBox,
  ClosedContour,
  CompiledLabelGeometry,
  ContentBoundsNormalized,
  EngravedItemGeometry,
  GeometricValidationReport,
  HoleConfiguration,
  HoleSpec,
  LabelDesign,
  LabelElement,
  LabelShapeType,
  Millimeters,
  NestingResult,
  OperationLayerType,
  PlacedLabelInstance,
  Point2D,
  ValidationIssue,
} from '../types';
import { compileVectorTextToGeometry } from './vectorFont';

/**
 * Redondeo de alta precisión a 4 decimales (0.0001 mm = 0.1 micrones).
 * Evita errores de punto flotante IEEE 754 manteniendo exactitud sub-micrométrica.
 */
export function roundMm(value: number, decimals = 4): Millimeters {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function computeBoundingBox(points: Point2D[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return {
    minX: roundMm(minX),
    minY: roundMm(minY),
    maxX: roundMm(maxX),
    maxY: roundMm(maxY),
    width: roundMm(maxX - minX),
    height: roundMm(maxY - minY),
  };
}

/**
 * Genera el contorno cerrado de una figura geométrica en milímetros reales
 * dentro de la caja [offsetX .. offsetX + widthMm, offsetY .. offsetY + heightMm].
 */
export function buildShapeClosedContour(params: {
  id: string;
  layer: OperationLayerType;
  shape: LabelShapeType;
  offsetXMm: Millimeters;
  offsetYMm: Millimeters;
  widthMm: Millimeters;
  heightMm: Millimeters;
  cornerRadiusMm?: Millimeters;
  customPolygonNormalized?: Point2D[];
  arcSegmentsPerQuarter?: number;
}): ClosedContour {
  const {
    id,
    layer,
    shape,
    offsetXMm: x0,
    offsetYMm: y0,
    widthMm: w,
    heightMm: h,
  } = params;
  const segs = params.arcSegmentsPerQuarter ?? 12;

  if (shape === 'rectangle' || shape === 'square') {
    const pts: Point2D[] = [
      { x: roundMm(x0), y: roundMm(y0) },
      { x: roundMm(x0 + w), y: roundMm(y0) },
      { x: roundMm(x0 + w), y: roundMm(y0 + h) },
      { x: roundMm(x0), y: roundMm(y0 + h) },
    ];
    const svgPathD = `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y} Z`;
    return {
      id,
      layer,
      points: pts,
      svgPathD,
      closed: true,
      boundingBox: {
        minX: roundMm(x0),
        minY: roundMm(y0),
        maxX: roundMm(x0 + w),
        maxY: roundMm(y0 + h),
        width: roundMm(w),
        height: roundMm(h),
      },
      primitive: {
        kind: 'rect',
        x: roundMm(x0),
        y: roundMm(y0),
        width: roundMm(w),
        height: roundMm(h),
        rx: 0,
      },
    };
  }

  if (shape === 'rounded_rect' || shape === 'capsule') {
    const maxRadius = Math.min(w, h) / 2;
    const r =
      shape === 'capsule'
        ? roundMm(maxRadius)
        : roundMm(Math.max(0, Math.min(params.cornerRadiusMm ?? 2, maxRadius)));

    if (r <= 0.001) {
      return buildShapeClosedContour({ ...params, shape: 'rectangle' });
    }

    const pts: Point2D[] = [];
    const corners = [
      { cx: x0 + w - r, cy: y0 + r, startAngle: -Math.PI / 2, endAngle: 0 },
      { cx: x0 + w - r, cy: y0 + h - r, startAngle: 0, endAngle: Math.PI / 2 },
      { cx: x0 + r, cy: y0 + h - r, startAngle: Math.PI / 2, endAngle: Math.PI },
      { cx: x0 + r, cy: y0 + r, startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 },
    ];

    for (const c of corners) {
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const ang = c.startAngle + t * (c.endAngle - c.startAngle);
        const px = roundMm(c.cx + r * Math.cos(ang));
        const py = roundMm(c.cy + r * Math.sin(ang));
        if (
          pts.length === 0 ||
          Math.hypot(px - pts[pts.length - 1].x, py - pts[pts.length - 1].y) > 0.0005
        ) {
          pts.push({ x: px, y: py });
        }
      }
    }
    if (
      pts.length > 1 &&
      Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.001
    ) {
      pts.pop();
    }

    const svgPathD = [
      `M ${roundMm(x0 + r)} ${roundMm(y0)}`,
      `L ${roundMm(x0 + w - r)} ${roundMm(y0)}`,
      `A ${r} ${r} 0 0 1 ${roundMm(x0 + w)} ${roundMm(y0 + r)}`,
      `L ${roundMm(x0 + w)} ${roundMm(y0 + h - r)}`,
      `A ${r} ${r} 0 0 1 ${roundMm(x0 + w - r)} ${roundMm(y0 + h)}`,
      `L ${roundMm(x0 + r)} ${roundMm(y0 + h)}`,
      `A ${r} ${r} 0 0 1 ${roundMm(x0)} ${roundMm(y0 + h - r)}`,
      `L ${roundMm(x0)} ${roundMm(y0 + r)}`,
      `A ${r} ${r} 0 0 1 ${roundMm(x0 + r)} ${roundMm(y0)}`,
      'Z',
    ].join(' ');

    return {
      id,
      layer,
      points: pts,
      svgPathD,
      closed: true,
      boundingBox: {
        minX: roundMm(x0),
        minY: roundMm(y0),
        maxX: roundMm(x0 + w),
        maxY: roundMm(y0 + h),
        width: roundMm(w),
        height: roundMm(h),
      },
      primitive: {
        kind: 'rect',
        x: roundMm(x0),
        y: roundMm(y0),
        width: roundMm(w),
        height: roundMm(h),
        rx: r,
      },
    };
  }

  if (shape === 'circle' || shape === 'oval') {
    const rx = roundMm(w / 2);
    const ry = shape === 'circle' ? roundMm(Math.min(w, h) / 2) : roundMm(h / 2);
    const cx = roundMm(x0 + w / 2);
    const cy = roundMm(y0 + h / 2);
    const totalSteps = segs * 4;
    const pts: Point2D[] = [];
    for (let i = 0; i < totalSteps; i++) {
      const ang = (2 * Math.PI * i) / totalSteps;
      pts.push({
        x: roundMm(cx + rx * Math.cos(ang)),
        y: roundMm(cy + ry * Math.sin(ang)),
      });
    }

    const svgPathD = [
      `M ${roundMm(cx - rx)} ${cy}`,
      `A ${rx} ${ry} 0 1 0 ${roundMm(cx + rx)} ${cy}`,
      `A ${rx} ${ry} 0 1 0 ${roundMm(cx - rx)} ${cy}`,
      'Z',
    ].join(' ');

    return {
      id,
      layer,
      points: pts,
      svgPathD,
      closed: true,
      boundingBox: {
        minX: roundMm(cx - rx),
        minY: roundMm(cy - ry),
        maxX: roundMm(cx + rx),
        maxY: roundMm(cy + ry),
        width: roundMm(rx * 2),
        height: roundMm(ry * 2),
      },
      primitive:
        Math.abs(rx - ry) < 0.0005
          ? { kind: 'circle', cx, cy, r: rx }
          : { kind: 'ellipse', cx, cy, rx, ry },
    };
  }

  if (shape === 'octagon_tag') {
    const chamfer = roundMm(Math.min(w, h) * 0.22);
    const pts: Point2D[] = [
      { x: roundMm(x0 + chamfer), y: roundMm(y0) },
      { x: roundMm(x0 + w - chamfer), y: roundMm(y0) },
      { x: roundMm(x0 + w), y: roundMm(y0 + chamfer) },
      { x: roundMm(x0 + w), y: roundMm(y0 + h - chamfer) },
      { x: roundMm(x0 + w - chamfer), y: roundMm(y0 + h) },
      { x: roundMm(x0 + chamfer), y: roundMm(y0 + h) },
      { x: roundMm(x0), y: roundMm(y0 + h - chamfer) },
      { x: roundMm(x0), y: roundMm(y0 + chamfer) },
    ];
    const svgPathD =
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
    return {
      id,
      layer,
      points: pts,
      svgPathD,
      closed: true,
      boundingBox: computeBoundingBox(pts),
    };
  }

  // custom_polygon
  const normPts =
    params.customPolygonNormalized && params.customPolygonNormalized.length >= 3
      ? params.customPolygonNormalized
      : [
          { x: 0.12, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0.12, y: 1 },
          { x: 0, y: 0.5 },
        ];
  const pts = normPts.map((np) => ({
    x: roundMm(x0 + np.x * w),
    y: roundMm(y0 + np.y * h),
  }));
  const svgPathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  return {
    id,
    layer,
    points: pts,
    svgPathD,
    closed: true,
    boundingBox: computeBoundingBox(pts),
  };
}

/**
 * Calcula las posiciones exactas en milímetros de los agujeros de costura/sujeción
 * dentro de una etiqueta de dimensiones (widthMm x heightMm).
 */
export function computeHoleSpecs(
  holesConfig: HoleConfiguration,
  widthMm: Millimeters,
  heightMm: Millimeters
): HoleSpec[] {
  const { preset, diameterMm, edgeDistanceMm } = holesConfig;
  if (preset === 'none' || diameterMm <= 0) {
    return [];
  }
  const d = roundMm(diameterMm);
  const dist = roundMm(Math.max(d / 2 + 0.5, edgeDistanceMm));

  switch (preset) {
    case 'single_left':
      return [
        {
          id: 'hole-left',
          x: roundMm(dist),
          y: roundMm(heightMm / 2),
          diameterMm: d,
        },
      ];
    case 'single_top':
      return [
        {
          id: 'hole-top',
          x: roundMm(widthMm / 2),
          y: roundMm(dist),
          diameterMm: d,
        },
      ];
    case 'two_horizontal':
      return [
        {
          id: 'hole-left',
          x: roundMm(dist),
          y: roundMm(heightMm / 2),
          diameterMm: d,
        },
        {
          id: 'hole-right',
          x: roundMm(widthMm - dist),
          y: roundMm(heightMm / 2),
          diameterMm: d,
        },
      ];
    case 'two_vertical':
      return [
        {
          id: 'hole-top',
          x: roundMm(widthMm / 2),
          y: roundMm(dist),
          diameterMm: d,
        },
        {
          id: 'hole-bottom',
          x: roundMm(widthMm / 2),
          y: roundMm(heightMm - dist),
          diameterMm: d,
        },
      ];
    case 'four_corners':
      return [
        {
          id: 'hole-tl',
          x: roundMm(dist),
          y: roundMm(dist),
          diameterMm: d,
        },
        {
          id: 'hole-tr',
          x: roundMm(widthMm - dist),
          y: roundMm(dist),
          diameterMm: d,
        },
        {
          id: 'hole-br',
          x: roundMm(widthMm - dist),
          y: roundMm(heightMm - dist),
          diameterMm: d,
        },
        {
          id: 'hole-bl',
          x: roundMm(dist),
          y: roundMm(heightMm - dist),
          diameterMm: d,
        },
      ];
    case 'custom':
      return (holesConfig.customHoles || []).map((ch, idx) => ({
        id: ch.id || `hole-custom-${idx + 1}`,
        x: roundMm(ch.x),
        y: roundMm(ch.y),
        diameterMm: roundMm(ch.diameterMm > 0 ? ch.diameterMm : d),
      }));
  }
}

/**
 * Construye el contorno cerrado de un agujero circular aplicando compensación de Kerf interior.
 */
export function buildCircularHoleContour(params: {
  id: string;
  centerXMm: Millimeters;
  centerYMm: Millimeters;
  nominalDiameterMm: Millimeters;
  kerfCompensationMm: Millimeters;
  segments?: number;
}): ClosedContour {
  const kerf = Math.max(0, params.kerfCompensationMm || 0);
  const effectiveDiameter = Math.max(0.2, params.nominalDiameterMm - kerf);
  const r = roundMm(effectiveDiameter / 2);
  const cx = roundMm(params.centerXMm);
  const cy = roundMm(params.centerYMm);
  const segs = params.segments ?? 24;

  const pts: Point2D[] = [];
  for (let i = 0; i < segs; i++) {
    const ang = (2 * Math.PI * i) / segs;
    pts.push({
      x: roundMm(cx + r * Math.cos(ang)),
      y: roundMm(cy + ryOrR(r) * Math.sin(ang)),
    });
  }

  const svgPathD = [
    `M ${roundMm(cx - r)} ${cy}`,
    `A ${r} ${r} 0 1 0 ${roundMm(cx + r)} ${cy}`,
    `A ${r} ${r} 0 1 0 ${roundMm(cx - r)} ${cy}`,
    'Z',
  ].join(' ');

  return {
    id: params.id,
    layer: 'HOLES',
    points: pts,
    svgPathD,
    closed: true,
    boundingBox: {
      minX: roundMm(cx - r),
      minY: roundMm(cy - r),
      maxX: roundMm(cx + r),
      maxY: roundMm(cy + r),
      width: roundMm(r * 2),
      height: roundMm(r * 2),
    },
    primitive: { kind: 'circle', cx, cy, r },
  };
}

function ryOrR(r: number) {
  return r;
}

/**
 * Aproxima un arco elíptico SVG (A rx ry xAxisRotation largeArcFlag sweepFlag x2 y2)
 * mediante puntos intermedios exactos según la parametrización oficial W3C SVG 1.1 F.6.5.
 */
function sampleSvgArcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number,
  segments = 16
): Point2D[] {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) {
    return [{ x: x2, y: y2 }];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) {
    return [{ x: x2, y: y2 }];
  }

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rxSq = rx * rx;
  let rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const sqrtL = Math.sqrt(lambda);
    rx *= sqrtL;
    ry *= sqrtL;
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const num = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
  const den = rxSq * y1pSq + rySq * x1pSq;
  const coef = sign * Math.sqrt(den > 0 ? num / den : 0);

  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const cos = Math.max(-1, Math.min(1, len > 0 ? dot / len : 1));
    const ang = Math.acos(cos);
    return ux * vy - uy * vx < 0 ? -ang : ang;
  };

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );

  if (!sweepFlag && dTheta > 0) {
    dTheta -= 2 * Math.PI;
  } else if (sweepFlag && dTheta < 0) {
    dTheta += 2 * Math.PI;
  }

  const pts: Point2D[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const ang = theta1 + t * dTheta;
    const xr = rx * Math.cos(ang);
    const yr = ry * Math.sin(ang);
    pts.push({
      x: cosPhi * xr - sinPhi * yr + cx,
      y: sinPhi * xr + cosPhi * yr + cy,
    });
  }
  return pts;
}

/**
 * Transforma un path SVG normalizado en el rango [0..origW, 0..origH]
 * al espacio físico en milímetros [targetX..targetX+targetW, targetY..targetY+targetH].
 * Soporta todos los comandos SVG 1.1 (M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z)
 * y secuencias implícitas de coordenadas repetidas.
 */
export function transformNormalizedPathToMillimeters(
  pathD: string,
  origBox: { minX: number; minY: number; width: number; height: number },
  targetCenterXMm: Millimeters,
  targetCenterYMm: Millimeters,
  targetWidthMm: Millimeters,
  targetHeightMm: Millimeters,
  rotationDeg = 0
): {
  svgPathD: string;
  sampledPoints: Point2D[];
  subPolylines: { points: Point2D[]; closed: boolean }[];
  hasClosedSubpaths: boolean;
  hasOpenSubpaths: boolean;
} {
  const scaleX = origBox.width > 0 ? targetWidthMm / origBox.width : 1;
  const scaleY = origBox.height > 0 ? targetHeightMm / origBox.height : 1;
  const leftMm = targetCenterXMm - targetWidthMm / 2;
  const topMm = targetCenterYMm - targetHeightMm / 2;

  const rad = (rotationDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const mapPoint = (nx: number, ny: number): Point2D => {
    const rawX = leftMm + (nx - origBox.minX) * scaleX;
    const rawY = topMm + (ny - origBox.minY) * scaleY;
    if (!rotationDeg) {
      return { x: roundMm(rawX), y: roundMm(rawY) };
    }
    const dx = rawX - targetCenterXMm;
    const dy = rawY - targetCenterYMm;
    return {
      x: roundMm(targetCenterXMm + dx * cosA - dy * sinA),
      y: roundMm(targetCenterYMm + dx * sinA + dy * cosA),
    };
  };

  const tokens =
    pathD.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const outTokens: string[] = [];
  const sampledPoints: Point2D[] = [];
  const subPolylines: { points: Point2D[]; closed: boolean }[] = [];
  let activeSubpath: Point2D[] = [];
  let activeSubpathClosed = false;

  const flushSubpath = (closed: boolean) => {
    if (activeSubpath.length >= 2) {
      subPolylines.push({ points: activeSubpath, closed });
    }
    activeSubpath = [];
    activeSubpathClosed = false;
  };

  let i = 0;
  let currentCmd = 'M';
  let curX = origBox.minX;
  let curY = origBox.minY;
  let subpathStartX = curX;
  let subpathStartY = curY;

  const isCmdToken = (t: string | undefined) => t !== undefined && /^[a-zA-Z]$/.test(t);
  const readNum = (): number => {
    if (i >= tokens.length) return NaN;
    return parseFloat(tokens[i++]);
  };

  while (i < tokens.length) {
    if (isCmdToken(tokens[i])) {
      currentCmd = tokens[i++];
      if (currentCmd === 'Z' || currentCmd === 'z') {
        outTokens.push('Z');
        curX = subpathStartX;
        curY = subpathStartY;
        activeSubpathClosed = true;
        flushSubpath(true);
        continue;
      }
    }

    const upper = currentCmd.toUpperCase();
    const isRel = currentCmd !== upper;

    if (upper === 'M') {
      const xVal = readNum();
      const yVal = readNum();
      if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
        flushSubpath(activeSubpathClosed);
        curX = isRel ? curX + xVal : xVal;
        curY = isRel ? curY + yVal : yVal;
        subpathStartX = curX;
        subpathStartY = curY;
        const pt = mapPoint(curX, curY);
        sampledPoints.push(pt);
        activeSubpath.push(pt);
        outTokens.push(`M ${pt.x} ${pt.y}`);
        // Coordenadas subsiguientes tras M se tratan como L/l según especificación SVG
        currentCmd = isRel ? 'l' : 'L';
      }
    } else if (upper === 'L' || upper === 'T') {
      const xVal = readNum();
      const yVal = readNum();
      if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
        curX = isRel ? curX + xVal : xVal;
        curY = isRel ? curY + yVal : yVal;
        const pt = mapPoint(curX, curY);
        sampledPoints.push(pt);
        activeSubpath.push(pt);
        outTokens.push(`L ${pt.x} ${pt.y}`);
      }
    } else if (upper === 'H') {
      const xVal = readNum();
      if (Number.isFinite(xVal)) {
        curX = isRel ? curX + xVal : xVal;
        const pt = mapPoint(curX, curY);
        sampledPoints.push(pt);
        activeSubpath.push(pt);
        outTokens.push(`L ${pt.x} ${pt.y}`);
      }
    } else if (upper === 'V') {
      const yVal = readNum();
      if (Number.isFinite(yVal)) {
        curY = isRel ? curY + yVal : yVal;
        const pt = mapPoint(curX, curY);
        sampledPoints.push(pt);
        activeSubpath.push(pt);
        outTokens.push(`L ${pt.x} ${pt.y}`);
      }
    } else if (upper === 'C') {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      const x = readNum();
      const y = readNum();
      if ([x1, y1, x2, y2, x, y].every(Number.isFinite)) {
        const p1 = mapPoint(isRel ? curX + x1 : x1, isRel ? curY + y1 : y1);
        const p2 = mapPoint(isRel ? curX + x2 : x2, isRel ? curY + y2 : y2);
        curX = isRel ? curX + x : x;
        curY = isRel ? curY + y : y;
        const p = mapPoint(curX, curY);
        sampledPoints.push(p1, p2, p);
        activeSubpath.push(p1, p2, p);
        outTokens.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p.x} ${p.y}`);
      }
    } else if (upper === 'Q' || upper === 'S') {
      const x1 = readNum();
      const y1 = readNum();
      const x = readNum();
      const y = readNum();
      if ([x1, y1, x, y].every(Number.isFinite)) {
        const p1 = mapPoint(isRel ? curX + x1 : x1, isRel ? curY + y1 : y1);
        curX = isRel ? curX + x : x;
        curY = isRel ? curY + y : y;
        const p = mapPoint(curX, curY);
        sampledPoints.push(p1, p);
        activeSubpath.push(p1, p);
        outTokens.push(`${upper} ${p1.x} ${p1.y} ${p.x} ${p.y}`);
      }
    } else if (upper === 'A') {
      const rx = readNum();
      const ry = readNum();
      const xAxisRotation = readNum();
      const largeArcFlag = readNum();
      const sweepFlag = readNum();
      const x = readNum();
      const y = readNum();
      if ([rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x, y].every(Number.isFinite)) {
        const nextX = isRel ? curX + x : x;
        const nextY = isRel ? curY + y : y;
        const arcPts = sampleSvgArcPoints(
          curX,
          curY,
          rx,
          ry,
          xAxisRotation,
          largeArcFlag,
          sweepFlag,
          nextX,
          nextY,
          14
        );
        for (const ap of arcPts) {
          const mp = mapPoint(ap.x, ap.y);
          sampledPoints.push(mp);
          activeSubpath.push(mp);
          outTokens.push(`L ${mp.x} ${mp.y}`);
        }
        curX = nextX;
        curY = nextY;
      }
    } else {
      i++;
    }
  }
  flushSubpath(activeSubpathClosed);

  const hasClosedSubpaths = subPolylines.some((s) => s.closed);
  const hasOpenSubpaths = subPolylines.some((s) => !s.closed);

  return {
    svgPathD: outTokens.join(' '),
    sampledPoints,
    subPolylines,
    hasClosedSubpaths,
    hasOpenSubpaths,
  };
}

/**
 * Calcula la zona segura de grabado dentro de la etiqueta en milímetros reales,
 * respetando tanto el margen de seguridad perimetral (`safetyMarginMm`) como
 * una distancia libre de `0.6 mm` alrededor de todos los agujeros activos.
 */
export function computeSafeEngravingZone(design: LabelDesign): BoundingBox {
  const margin = Math.max(0.5, Math.min(design.safetyMarginMm, Math.min(design.widthMm, design.heightMm) * 0.35));
  let minX = margin;
  let minY = margin;
  let maxX = design.widthMm - margin;
  let maxY = design.heightMm - margin;

  // Para etiquetas circulares u ovaladas, inscribir un rectángulo seguro dentro de la elipse interior
  if (design.shape === 'circle' || design.shape === 'oval') {
    const rx = Math.max(1, design.widthMm / 2 - margin);
    const ry = Math.max(1, design.heightMm / 2 - margin);
    // Rectángulo inscrito geométrico exacto a 45° (cos 45° = 1 / sqrt(2) ≈ 0.7071)
    const factor = 0.7071;
    const cx = design.widthMm / 2;
    const cy = design.heightMm / 2;
    minX = Math.max(minX, cx - rx * factor);
    maxX = Math.min(maxX, cx + rx * factor);
    minY = Math.max(minY, cy - ry * factor);
    maxY = Math.min(maxY, cy + ry * factor);
  }

  // Restringir zona según agujeros para evitar que un logo centrado pise agujeros laterales o superiores
  const holes = computeHoleSpecs(design.holes, design.widthMm, design.heightMm);
  const holeClearance = 0.6;
  const cx = design.widthMm / 2;
  const cy = design.heightMm / 2;

  for (const h of holes) {
    const r = h.diameterMm / 2 + holeClearance;
    // Si el agujero está en la banda central vertical (cerca de cy), recortar minX o maxX
    if (Math.abs(h.y - cy) < design.heightMm * 0.32) {
      if (h.x < cx) {
        minX = Math.max(minX, h.x + r);
      } else {
        maxX = Math.min(maxX, h.x - r);
      }
    } else if (Math.abs(h.x - cx) < design.widthMm * 0.32) {
      // Si el agujero está en la banda central horizontal (arriba o abajo), recortar minY o maxY
      if (h.y < cy) {
        minY = Math.max(minY, h.y + r);
      } else {
        maxY = Math.min(maxY, h.y - r);
      }
    }
  }

  if (maxX <= minX + 1) {
    minX = margin;
    maxX = Math.max(minX + 1, design.widthMm - margin);
  }
  if (maxY <= minY + 1) {
    minY = margin;
    maxY = Math.max(minY + 1, design.heightMm - margin);
  }

  return {
    minX: roundMm(minX, 2),
    minY: roundMm(minY, 2),
    maxX: roundMm(maxX, 2),
    maxY: roundMm(maxY, 2),
    width: roundMm(maxX - minX, 2),
    height: roundMm(maxY - minY, 2),
  };
}

/**
 * Ajusta y centra automáticamente un elemento de diseño (Logo SVG/PNG o Texto)
 * dentro de la zona segura de grabado de la etiqueta, conservando su proporción exacta
 * y evitando invadir agujeros o líneas de corte.
 */
/**
 * Obtiene los límites de contenido normalizados [0..1] de un elemento,
 * detectando automáticamente el contenido visible si contiene márgenes transparentes.
 */
export function getElementNormalizedContentBounds(el: LabelElement): ContentBoundsNormalized {
  if (el.contentBoundsNormalized) {
    return el.contentBoundsNormalized;
  }

  if (el.type === 'logo_svg') {
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    const allNums = el.normalizedPaths
      .join(' ')
      .match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)
      ?.map(Number)
      .filter(Number.isFinite);

    const vb = el.originalViewBox;
    if (allNums && allNums.length >= 4 && vb.width > 0 && vb.height > 0) {
      for (let i = 0; i + 1 < allNums.length; i += 2) {
        const vx = allNums[i];
        const vy = allNums[i + 1];
        if (vx < bx0) bx0 = vx;
        if (vx > bx1) bx1 = vx;
        if (vy < by0) by0 = vy;
        if (vy > by1) by1 = vy;
      }
      if (bx1 > bx0 && by1 > by0) {
        const normMinX = Math.max(0, Math.min(1, (bx0 - vb.minX) / vb.width));
        const normMinY = Math.max(0, Math.min(1, (by0 - vb.minY) / vb.height));
        const normMaxX = Math.max(normMinX, Math.min(1, (bx1 - vb.minX) / vb.width));
        const normMaxY = Math.max(normMinY, Math.min(1, (by1 - vb.minY) / vb.height));
        return {
          minX: roundMm(normMinX, 5),
          minY: roundMm(normMinY, 5),
          maxX: roundMm(normMaxX, 5),
          maxY: roundMm(normMaxY, 5),
          width: Math.max(0.001, roundMm(normMaxX - normMinX, 5)),
          height: Math.max(0.001, roundMm(normMaxY - normMinY, 5)),
          centerNormX: roundMm((normMinX + normMaxX) / 2, 5),
          centerNormY: roundMm((normMinY + normMaxY) / 2, 5),
        };
      }
    }
  }

  return {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    width: 1,
    height: 1,
    centerNormX: 0.5,
    centerNormY: 0.5,
  };
}

/**
 * Calcula la caja envolvente física (en milímetros reales) del contenido visible de un elemento,
 * ignorando márgenes transparentes o espacios vacíos del lienzo original.
 */
export function getElementVisibleBoundingBoxMm(el: LabelElement): BoundingBox {
  const norm = getElementNormalizedContentBounds(el);
  const visW = roundMm(el.widthMm * norm.width, 3);
  const visH = roundMm(el.heightMm * norm.height, 3);
  const visCx = roundMm(el.xMm + (norm.centerNormX - 0.5) * el.widthMm, 3);
  const visCy = roundMm(el.yMm + (norm.centerNormY - 0.5) * el.heightMm, 3);

  return {
    minX: roundMm(visCx - visW / 2, 3),
    minY: roundMm(visCy - visH / 2, 3),
    maxX: roundMm(visCx + visW / 2, 3),
    maxY: roundMm(visCy + visH / 2, 3),
    width: visW,
    height: visH,
  };
}

/**
 * Calcula la caja envolvente combinada en milímetros de un grupo de elementos visibles.
 */
export function computeGroupVisibleBoundingBox(elements: LabelElement[]): BoundingBox {
  const visibleEls = elements.filter((e) => e.visible);
  if (visibleEls.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const el of visibleEls) {
    const box = getElementVisibleBoundingBoxMm(el);
    if (box.minX < minX) minX = box.minX;
    if (box.minY < minY) minY = box.minY;
    if (box.maxX > maxX) maxX = box.maxX;
    if (box.maxY > maxY) maxY = box.maxY;
  }
  return {
    minX: roundMm(minX, 3),
    minY: roundMm(minY, 3),
    maxX: roundMm(maxX, 3),
    maxY: roundMm(maxY, 3),
    width: roundMm(maxX - minX, 3),
    height: roundMm(maxY - minY, 3),
  };
}

/**
 * Centrado Geométrico Exacto:
 * Posiciona el centro del contenido VISIBLE del elemento exactamente en el centro físico de la etiqueta
 * (o centro de la zona segura). No utiliza el centro del lienzo del PNG si tiene espacios transparentes.
 */
export function centerElementGeometrically(
  el: LabelElement,
  design: LabelDesign,
  alignTo: 'label_center' | 'safe_zone_center' = 'label_center'
): LabelElement {
  const safeZone = computeSafeEngravingZone(design);
  const targetCx =
    alignTo === 'label_center'
      ? roundMm(design.widthMm / 2, 4)
      : roundMm((safeZone.minX + safeZone.maxX) / 2, 4);
  const targetCy =
    alignTo === 'label_center'
      ? roundMm(design.heightMm / 2, 4)
      : roundMm((safeZone.minY + safeZone.maxY) / 2, 4);

  const norm = getElementNormalizedContentBounds(el);
  const newXMm = roundMm(targetCx - (norm.centerNormX - 0.5) * el.widthMm, 3);
  const newYMm = roundMm(targetCy - (norm.centerNormY - 0.5) * el.heightMm, 3);

  return {
    ...el,
    xMm: newXMm,
    yMm: newYMm,
  };
}

/**
 * Centra un conjunto de elementos geométricamente en la etiqueta,
 * conservando estrictamente su composición y distancias relativas.
 */
export function centerAllElementsGeometrically(
  elements: LabelElement[],
  design: LabelDesign,
  alignTo: 'label_center' | 'safe_zone_center' = 'label_center'
): LabelElement[] {
  const visibleEls = elements.filter((e) => e.visible);
  if (visibleEls.length === 0) return elements;
  if (visibleEls.length === 1) {
    return elements.map((e) =>
      e.id === visibleEls[0].id ? centerElementGeometrically(e, design, alignTo) : e
    );
  }

  const groupBBox = computeGroupVisibleBoundingBox(elements);
  const safeZone = computeSafeEngravingZone(design);
  const targetCx =
    alignTo === 'label_center'
      ? roundMm(design.widthMm / 2, 4)
      : roundMm((safeZone.minX + safeZone.maxX) / 2, 4);
  const targetCy =
    alignTo === 'label_center'
      ? roundMm(design.heightMm / 2, 4)
      : roundMm((safeZone.minY + safeZone.maxY) / 2, 4);

  const currentGroupCx = (groupBBox.minX + groupBBox.maxX) / 2;
  const currentGroupCy = (groupBBox.minY + groupBBox.maxY) / 2;
  const deltaX = targetCx - currentGroupCx;
  const deltaY = targetCy - currentGroupCy;

  return elements.map((el) => {
    if (!el.visible) return el;
    return {
      ...el,
      xMm: roundMm(el.xMm + deltaX, 3),
      yMm: roundMm(el.yMm + deltaY, 3),
    };
  });
}

/**
 * Ajusta y escala automáticamente un elemento al espacio disponible dentro de la zona segura,
 * conservando su proporción exacta y centrándolo geométricamente.
 */
export function fitElementToAvailableSpace(
  el: LabelElement,
  design: LabelDesign,
  fillRatio = 0.88,
  alignTo: 'label_center' | 'safe_zone_center' = 'label_center'
): LabelElement {
  const safeZone = computeSafeEngravingZone(design);
  const norm = getElementNormalizedContentBounds(el);

  const maxVisW = Math.max(1.0, safeZone.width * fillRatio);
  const maxVisH = Math.max(1.0, safeZone.height * fillRatio);

  const visAspect =
    el.aspectRatio > 0
      ? el.aspectRatio
      : Math.max(
          0.001,
          (el.widthMm * norm.width) / Math.max(0.001, el.heightMm * norm.height)
        );

  let nextVisW = maxVisW;
  let nextVisH = nextVisW / visAspect;
  if (nextVisH > maxVisH) {
    nextVisH = maxVisH;
    nextVisW = nextVisH * visAspect;
  }

  const nextWidthMm = roundMm(Math.max(1.0, nextVisW / Math.max(0.01, norm.width)), 2);
  const nextHeightMm = roundMm(Math.max(1.0, nextVisH / Math.max(0.01, norm.height)), 2);

  let updatedEl: LabelElement;
  if (el.type === 'vector_text') {
    const scaleFactor = el.heightMm > 0 ? nextHeightMm / el.heightMm : 1;
    const nextFontSize = roundMm(Math.max(1.0, Math.min(maxVisH, el.fontSizeMm * scaleFactor)), 2);
    updatedEl = {
      ...el,
      widthMm: nextWidthMm,
      heightMm: nextHeightMm,
      fontSizeMm: nextFontSize,
    };
  } else {
    updatedEl = {
      ...el,
      widthMm: nextWidthMm,
      heightMm: nextHeightMm,
    };
  }

  return centerElementGeometrically(updatedEl, design, alignTo);
}

/**
 * Ajusta y escala todos los elementos colectivamente al espacio disponible,
 * conservando su proporción y distancias relativas.
 */
export function fitAllElementsToAvailableSpace(
  elements: LabelElement[],
  design: LabelDesign,
  fillRatio = 0.88,
  alignTo: 'label_center' | 'safe_zone_center' = 'label_center'
): LabelElement[] {
  const visibleEls = elements.filter((e) => e.visible);
  if (visibleEls.length === 0) return elements;
  if (visibleEls.length === 1) {
    return elements.map((e) =>
      e.id === visibleEls[0].id ? fitElementToAvailableSpace(e, design, fillRatio, alignTo) : e
    );
  }

  const groupBBox = computeGroupVisibleBoundingBox(elements);
  const safeZone = computeSafeEngravingZone(design);
  const maxW = Math.max(1.0, safeZone.width * fillRatio);
  const maxH = Math.max(1.0, safeZone.height * fillRatio);

  const scale = Math.min(
    groupBBox.width > 0 ? maxW / groupBBox.width : 1,
    groupBBox.height > 0 ? maxH / groupBBox.height : 1
  );

  const groupCx = (groupBBox.minX + groupBBox.maxX) / 2;
  const groupCy = (groupBBox.minY + groupBBox.maxY) / 2;

  const targetCx =
    alignTo === 'label_center'
      ? roundMm(design.widthMm / 2, 4)
      : roundMm((safeZone.minX + safeZone.maxX) / 2, 4);
  const targetCy =
    alignTo === 'label_center'
      ? roundMm(design.heightMm / 2, 4)
      : roundMm((safeZone.minY + safeZone.maxY) / 2, 4);

  return elements.map((el) => {
    if (!el.visible) return el;
    const relX = el.xMm - groupCx;
    const relY = el.yMm - groupCy;
    const newW = roundMm(el.widthMm * scale, 2);
    const newH = roundMm(el.heightMm * scale, 2);
    const newX = roundMm(targetCx + relX * scale, 3);
    const newY = roundMm(targetCy + relY * scale, 3);

    if (el.type === 'vector_text') {
      return {
        ...el,
        xMm: newX,
        yMm: newY,
        widthMm: newW,
        heightMm: newH,
        fontSizeMm: roundMm(Math.max(1.0, el.fontSizeMm * scale), 2),
      };
    }
    return {
      ...el,
      xMm: newX,
      yMm: newY,
      widthMm: newW,
      heightMm: newH,
    };
  });
}

/**
 * Micromovimiento o ajuste fino en milímetros exactos (ej. 0.1 mm, 0.01 mm).
 */
export function nudgeElementMm(
  el: LabelElement,
  deltaXMm: number,
  deltaYMm: number,
  design?: LabelDesign
): LabelElement {
  let nextX = roundMm(el.xMm + deltaXMm, 3);
  let nextY = roundMm(el.yMm + deltaYMm, 3);

  if (design) {
    const minX = 0;
    const maxX = design.widthMm;
    const minY = 0;
    const maxY = design.heightMm;
    nextX = Math.max(minX, Math.min(maxX, nextX));
    nextY = Math.max(minY, Math.min(maxY, nextY));
  }

  return {
    ...el,
    xMm: nextX,
    yMm: nextY,
  };
}

/**
 * Ajusta y centra automáticamente un elemento de diseño (Logo SVG/PNG o Texto)
 * dentro de la zona segura de grabado de la etiqueta, conservando su proporción exacta
 * y evitando invadir agujeros o líneas de corte. (Compatible con versiones anteriores).
 */
export function fitElementIntoSafeZone(
  el: LabelElement,
  design: LabelDesign,
  fillRatio = 0.85
): LabelElement {
  return fitElementToAvailableSpace(el, design, fillRatio, 'safe_zone_center');
}

/**
 * Compila un elemento de diseño (Logo SVG, Logo Raster vectorizado/monocromático, Texto vectorial o Borde decorativo)
 * al espacio físico en milímetros de la etiqueta.
 */
export function compileDesignElement(
  el: LabelElement,
  offsetXMm = 0,
  offsetYMm = 0
): EngravedItemGeometry | null {
  if (!el.visible) return null;

  const cx = roundMm(offsetXMm + el.xMm);
  const cy = roundMm(offsetYMm + el.yMm);

  if (el.type === 'vector_text') {
    const compiled = compileVectorTextToGeometry({
      text: el.text,
      centerXMm: cx,
      centerYMm: cy,
      fontSizeMm: el.fontSizeMm,
      letterSpacingMm: el.letterSpacingMm,
      rotationDeg: el.rotationDeg,
    });
    const allPts = compiled.polylines.flatMap((pl) => pl.points);
    return {
      id: el.id,
      kind: 'vector_path',
      svgPathD: compiled.svgPathD,
      polylines: compiled.polylines,
      strokeWidthMm: el.strokeWidthMm || 0.35,
      filled: false,
      boundingBox: computeBoundingBox(allPts),
    };
  }

  if (el.type === 'decorative_border') {
    const rotNorm = ((el.rotationDeg % 360) + 360) % 360;
    const isRot90 = Math.abs(rotNorm - 90) < 1 || Math.abs(rotNorm - 270) < 1;
    const effW = isRot90 ? el.heightMm : el.widthMm;
    const effH = isRot90 ? el.widthMm : el.heightMm;
    const x0 = roundMm(cx - effW / 2);
    const y0 = roundMm(cy - effH / 2);
    const contour = buildShapeClosedContour({
      id: `${el.id}-border`,
      layer: 'ENGRAVE',
      shape: 'rounded_rect',
      offsetXMm: x0,
      offsetYMm: y0,
      widthMm: effW,
      heightMm: effH,
      cornerRadiusMm: 1.0,
    });
    return {
      id: el.id,
      kind: 'vector_path',
      svgPathD: contour.svgPathD,
      polylines: [{ points: contour.points, closed: true }],
      strokeWidthMm: el.strokeWidthMm || 0.3,
      filled: false,
      boundingBox: contour.boundingBox,
    };
  }

  if (el.type === 'logo_svg') {
    const combinedPaths: string[] = [];
    const polylines: { points: Point2D[]; closed: boolean }[] = [];
    let anyClosed = false;
    let anyOpen = false;

    for (const normPath of el.normalizedPaths) {
      const tr = transformNormalizedPathToMillimeters(
        normPath,
        el.originalViewBox,
        cx,
        cy,
        el.widthMm,
        el.heightMm,
        el.rotationDeg
      );
      if (tr.svgPathD) {
        combinedPaths.push(tr.svgPathD);
        if (tr.hasClosedSubpaths) anyClosed = true;
        if (tr.hasOpenSubpaths) anyOpen = true;
        for (const sub of tr.subPolylines) {
          polylines.push(sub);
        }
      }
    }
    const allPts = polylines.flatMap((p) => p.points);
    // Si todos los trazos del SVG son abiertos (ej. líneas o polilíneas), se exportan con stroke
    const shouldFill = anyClosed && !anyOpen;
    return {
      id: el.id,
      kind: 'vector_path',
      svgPathD: combinedPaths.join(' '),
      polylines,
      strokeWidthMm: 0.25,
      filled: shouldFill,
      fillRule: 'evenodd',
      boundingBox:
        allPts.length > 0
          ? computeBoundingBox(allPts)
          : {
              minX: roundMm(cx - el.widthMm / 2),
              minY: roundMm(cy - el.heightMm / 2),
              maxX: roundMm(cx + el.widthMm / 2),
              maxY: roundMm(cy + el.heightMm / 2),
              width: roundMm(el.widthMm),
              height: roundMm(el.heightMm),
            },
    };
  }

  // logo_raster
  if (el.processing.mode === 'vector' && el.vectorizedPathsNormalized.length > 0) {
    const combinedPaths: string[] = [];
    const polylines: { points: Point2D[]; closed: boolean }[] = [];
    for (const normPath of el.vectorizedPathsNormalized) {
      const tr = transformNormalizedPathToMillimeters(
        normPath,
        { minX: 0, minY: 0, width: 1, height: 1 },
        cx,
        cy,
        el.widthMm,
        el.heightMm,
        el.rotationDeg
      );
      if (tr.svgPathD) {
        combinedPaths.push(tr.svgPathD);
        for (const sub of tr.subPolylines) {
          polylines.push({ points: sub.points, closed: true });
        }
      }
    }
    const allPts = polylines.flatMap((p) => p.points);
    return {
      id: el.id,
      kind: 'vector_path',
      svgPathD: combinedPaths.join(' '),
      polylines,
      strokeWidthMm: 0.2,
      filled: true,
      fillRule: 'evenodd',
      boundingBox:
        allPts.length > 0
          ? computeBoundingBox(allPts)
          : {
              minX: roundMm(cx - el.widthMm / 2),
              minY: roundMm(cy - el.heightMm / 2),
              maxX: roundMm(cx + el.widthMm / 2),
              maxY: roundMm(cy + el.heightMm / 2),
              width: roundMm(el.widthMm),
              height: roundMm(el.heightMm),
            },
    };
  }

  // Grabado raster monocromático real (calcular boundingBox real rotado)
  const xMm = roundMm(cx - el.widthMm / 2);
  const yMm = roundMm(cy - el.heightMm / 2);
  const rad = ((el.rotationDeg || 0) * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const corners: Point2D[] = [
    { x: -el.widthMm / 2, y: -el.heightMm / 2 },
    { x: el.widthMm / 2, y: -el.heightMm / 2 },
    { x: el.widthMm / 2, y: el.heightMm / 2 },
    { x: -el.widthMm / 2, y: el.heightMm / 2 },
  ].map((c) => ({
    x: roundMm(cx + c.x * cosA - c.y * sinA),
    y: roundMm(cy + c.x * sinA + c.y * cosA),
  }));

  return {
    id: el.id,
    kind: 'raster_image',
    dataUrl: el.processedDataUrl || el.originalDataUrl,
    xMm,
    yMm,
    widthMm: roundMm(el.widthMm),
    heightMm: roundMm(el.heightMm),
    rotationDeg: el.rotationDeg,
    boundingBox: computeBoundingBox(corners),
  };
}

/**
 * Compila el diseño completo de una etiqueta en su modelo geométrico exacto en milímetros.
 * Permite opcionalmente trasladar a (offsetXMm, offsetYMm) y rotar 90° para el anidado en mesa.
 */
export function compileLabelGeometry(
  design: LabelDesign,
  options?: {
    offsetXMm?: Millimeters;
    offsetYMm?: Millimeters;
    rotated90?: boolean;
    instanceIdPrefix?: string;
  }
): CompiledLabelGeometry {
  const offsetX = options?.offsetXMm ?? 0;
  const offsetY = options?.offsetYMm ?? 0;
  const rotated90 = options?.rotated90 ?? false;
  const prefix = options?.instanceIdPrefix ?? design.id;

  const nominalW = rotated90 ? design.heightMm : design.widthMm;
  const nominalH = rotated90 ? design.widthMm : design.heightMm;

  const kerf = Math.max(0, design.kerfCompensationMm || 0);
  const effectiveW = roundMm(nominalW + kerf);
  const effectiveH = roundMm(nominalH + kerf);
  const kerfHalf = roundMm(kerf / 2);

  const outerCutContour = buildShapeClosedContour({
    id: `${prefix}-cut`,
    layer: 'CUT',
    shape: design.shape,
    offsetXMm: roundMm(offsetX - kerfHalf),
    offsetYMm: roundMm(offsetY - kerfHalf),
    widthMm: effectiveW,
    heightMm: effectiveH,
    cornerRadiusMm: design.cornerRadiusMm > 0 ? roundMm(design.cornerRadiusMm + kerfHalf) : 0,
    customPolygonNormalized: design.customPolygonNormalized,
  });

  const safetyMargin = Math.max(
    0.5,
    Math.min(design.safetyMarginMm, Math.min(nominalW, nominalH) / 3)
  );
  const safetyGuideContour = buildShapeClosedContour({
    id: `${prefix}-guide`,
    layer: 'GUIDE',
    shape: design.shape,
    offsetXMm: roundMm(offsetX + safetyMargin),
    offsetYMm: roundMm(offsetY + safetyMargin),
    widthMm: roundMm(Math.max(1, nominalW - safetyMargin * 2)),
    heightMm: roundMm(Math.max(1, nominalH - safetyMargin * 2)),
    cornerRadiusMm: Math.max(0, design.cornerRadiusMm - safetyMargin),
  });

  const rawHoles = computeHoleSpecs(design.holes, design.widthMm, design.heightMm);
  const holeContours: ClosedContour[] = rawHoles.map((h) => {
    const localX = rotated90 ? design.heightMm - h.y : h.x;
    const localY = rotated90 ? h.x : h.y;
    return buildCircularHoleContour({
      id: `${prefix}-${h.id}`,
      centerXMm: roundMm(offsetX + localX),
      centerYMm: roundMm(offsetY + localY),
      nominalDiameterMm: h.diameterMm,
      kerfCompensationMm: kerf,
    });
  });

  const engravingItems: EngravedItemGeometry[] = [];
  for (const el of design.elements) {
    const adjustedEl: LabelElement = rotated90
      ? {
          ...el,
          xMm: roundMm(design.heightMm - el.yMm),
          yMm: roundMm(el.xMm),
          rotationDeg: (el.rotationDeg + 90) % 360,
        }
      : el;
    const compiledEl = compileDesignElement(adjustedEl, offsetX, offsetY);
    if (compiledEl) {
      engravingItems.push({
        ...compiledEl,
        id: `${prefix}-${compiledEl.id}`,
      });
    }
  }

  return {
    nominalWidthMm: roundMm(nominalW),
    nominalHeightMm: roundMm(nominalH),
    effectiveCutWidthMm: effectiveW,
    effectiveCutHeightMm: effectiveH,
    outerCutContour,
    holeContours,
    engravingItems,
    safetyGuideContour,
  };
}

/**
 * Detecta si existen segmentos de corte exactamente superpuestos/duplicados
 * dentro de una lista de contornos cerrados.
 */
export function detectDuplicateCutSegments(contours: ClosedContour[]): number {
  const seenSegments = new Set<string>();
  let duplicates = 0;

  const fmt = (n: number) => roundMm(n, 3).toFixed(3);
  const makeSegmentKey = (p1: Point2D, p2: Point2D): string => {
    const a = `${fmt(p1.x)},${fmt(p1.y)}`;
    const b = `${fmt(p2.x)},${fmt(p2.y)}`;
    return a < b ? `${a}->${b}` : `${b}->${a}`;
  };

  for (const c of contours) {
    const pts = c.points;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.0005) continue;
      const key = makeSegmentKey(p1, p2);
      if (seenSegments.has(key)) {
        duplicates++;
      } else {
        seenSegments.add(key);
      }
    }
  }
  return duplicates;
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox, toleranceMm = 0.001): boolean {
  return (
    a.minX < b.maxX - toleranceMm &&
    a.maxX > b.minX + toleranceMm &&
    a.minY < b.maxY - toleranceMm &&
    a.maxY > b.minY + toleranceMm
  );
}

/**
 * Verifica si un punto (x, y) está dentro de un polígono cerrado (algoritmo Ray-Casting).
 */
export function pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Ejecuta una auditoría geométrica exhaustiva sobre el diseño de etiqueta y una tanda de producción.
 */
export function validateLabelAndBatchGeometry(
  design: LabelDesign,
  nestingResult: NestingResult,
  batchIndex = 0
): GeometricValidationReport {
  const issues: ValidationIssue[] = [];
  const singleCompiled = compileLabelGeometry(design);

  // 1. Validar dimensiones positivas
  if (design.widthMm <= 0 || design.heightMm <= 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_LABEL_DIMENSIONS',
      message: `Las dimensiones de la etiqueta (${design.widthMm} × ${design.heightMm} mm) deben ser mayores a 0 mm.`,
    });
  }

  // 2. Validar tamaño de plancha respecto a la máquina Vank 9060 (900 x 600 mm)
  const { sheetWidthMm, sheetHeightMm, machineBedWidthMm, machineBedHeightMm } =
    nestingResult.config;
  if (sheetWidthMm > machineBedWidthMm || sheetHeightMm > machineBedHeightMm) {
    issues.push({
      severity: 'error',
      code: 'SHEET_EXCEEDS_MACHINE_BED',
      message: `El material (${sheetWidthMm} × ${sheetHeightMm} mm) excede el área útil de la máquina Vank 9060 (${machineBedWidthMm} × ${machineBedHeightMm} mm).`,
    });
  }

  // 3. Validar agujeros dentro de los límites de la etiqueta y sin superponerse entre sí
  let invalidHolesCount = 0;
  for (let i = 0; i < singleCompiled.holeContours.length; i++) {
    const hc = singleCompiled.holeContours[i];
    const hb = hc.boundingBox;
    const minWallMm = 0.5;
    const centerPt: Point2D = {
      x: (hb.minX + hb.maxX) / 2,
      y: (hb.minY + hb.maxY) / 2,
    };

    const outsideBox =
      hb.minX < minWallMm ||
      hb.minY < minWallMm ||
      hb.maxX > singleCompiled.nominalWidthMm - minWallMm ||
      hb.maxY > singleCompiled.nominalHeightMm - minWallMm;
    const centerInsideOuter = pointInPolygon(centerPt, singleCompiled.outerCutContour.points);

    if (outsideBox || !centerInsideOuter) {
      invalidHolesCount++;
      issues.push({
        severity: 'error',
        code: 'HOLE_OUTSIDE_OR_TOO_CLOSE_TO_EDGE',
        message: `El agujero "${hc.id}" rompe o queda a menos de ${minWallMm} mm del borde de corte.`,
      });
    }

    // Verificar superposición entre agujeros
    for (let j = i + 1; j < singleCompiled.holeContours.length; j++) {
      const hc2 = singleCompiled.holeContours[j];
      if (boxesOverlap(hb, hc2.boundingBox, -0.2)) {
        invalidHolesCount++;
        issues.push({
          severity: 'error',
          code: 'HOLE_OVERLAPS_HOLE',
          message: `Los agujeros "${hc.id}" y "${hc2.id}" se superponen o están a menos de 0.2 mm entre sí.`,
        });
      }
    }
  }

  // 4. Validar que el GRABADO no invada AGUJEROS ni cruce la LÍNEA DE CORTE EXTERIOR ni el MARGEN DE SEGURIDAD
  let engraveInvasionCount = 0;
  let engraveSafetyWarningCount = 0;
  const safetyBox = singleCompiled.safetyGuideContour.boundingBox;

  for (const eng of singleCompiled.engravingItems) {
    const eb = eng.boundingBox;
    if (eb.width <= 0 || eb.height <= 0) continue;

    // 4a. ¿Cruza o sale del contorno de corte exterior?
    const sampleCorners: Point2D[] = [
      { x: eb.minX, y: eb.minY },
      { x: eb.maxX, y: eb.minY },
      { x: eb.maxX, y: eb.maxY },
      { x: eb.minX, y: eb.maxY },
    ];
    const outOfLabelBox =
      eb.minX < 0.05 ||
      eb.minY < 0.05 ||
      eb.maxX > singleCompiled.nominalWidthMm - 0.05 ||
      eb.maxY > singleCompiled.nominalHeightMm - 0.05;
    const anyCornerOutsidePolygon = sampleCorners.some(
      (pt) => !pointInPolygon(pt, singleCompiled.outerCutContour.points)
    );

    if (outOfLabelBox || anyCornerOutsidePolygon) {
      engraveInvasionCount++;
      issues.push({
        severity: 'error',
        code: 'ENGRAVE_CROSSES_CUT_LINE',
        message: `El elemento de grabado "${eng.id}" invade o sobresale de la línea de corte exterior. Use "Ajustar a Zona Segura" o reduzca su tamaño.`,
      });
    } else if (
      eb.minX < safetyBox.minX - 0.05 ||
      eb.minY < safetyBox.minY - 0.05 ||
      eb.maxX > safetyBox.maxX + 0.05 ||
      eb.maxY > safetyBox.maxY + 0.05
    ) {
      engraveSafetyWarningCount++;
      issues.push({
        severity: 'warning',
        code: 'ENGRAVE_OUTSIDE_SAFETY_MARGIN',
        message: `El grabado "${eng.id}" supera el margen de seguridad interior (${design.safetyMarginMm} mm).`,
      });
    }

    // 4b. ¿Invade algún agujero de costura/sujeción?
    for (const hc of singleCompiled.holeContours) {
      if (boxesOverlap(eb, hc.boundingBox, -0.15)) {
        engraveInvasionCount++;
        issues.push({
          severity: 'error',
          code: 'ENGRAVE_INVADES_HOLE',
          message: `El elemento de grabado "${eng.id}" invade el agujero "${hc.id}". Ajuste la posición o use "Ajustar a Zona Segura".`,
        });
      }
    }
  }

  // 5. Validar resolución DPI si hay imágenes rasterizadas
  for (const el of design.elements) {
    if (el.type === 'logo_raster' && el.visible && el.effectiveDpi < 250) {
      issues.push({
        severity: 'warning',
        code: 'LOW_IMAGE_DPI',
        message: `La imagen "${el.name}" tiene una resolución efectiva de ${Math.round(el.effectiveDpi)} DPI al tamaño actual (${el.widthMm} × ${el.heightMm} mm). Se recomienda al menos 250–300 DPI para grabado láser nítido.`,
      });
    }
  }

  // 6. Validar instancias en la tanda seleccionada
  const batch = nestingResult.batches[batchIndex] || nestingResult.batches[0];
  const instances: PlacedLabelInstance[] = batch ? batch.placedInstances : [];

  let overlappingPiecesCount = 0;
  let outOfBoundsPiecesCount = 0;
  let allContoursClosed = singleCompiled.outerCutContour.closed;

  const allCutContours: ClosedContour[] = [];
  const allHoleContours: ClosedContour[] = [];
  let totalEngraveItems = 0;

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const b = inst.boundingBox;

    const minAllowedX = nestingResult.config.marginLeftMm - 0.001;
    const minAllowedY = nestingResult.config.marginTopMm - 0.001;
    const maxAllowedX = sheetWidthMm - nestingResult.config.marginRightMm + 0.001;
    const maxAllowedY = sheetHeightMm - nestingResult.config.marginBottomMm + 0.001;

    if (
      b.minX < minAllowedX ||
      b.minY < minAllowedY ||
      b.maxX > maxAllowedX ||
      b.maxY > maxAllowedY ||
      b.maxX > machineBedWidthMm + 0.001 ||
      b.maxY > machineBedHeightMm + 0.001
    ) {
      outOfBoundsPiecesCount++;
    }

    for (let j = i + 1; j < instances.length; j++) {
      if (boxesOverlap(b, instances[j].boundingBox, 0.001)) {
        overlappingPiecesCount++;
      }
    }

    const compiledInst = compileLabelGeometry(design, {
      offsetXMm: inst.xMm,
      offsetYMm: inst.yMm,
      rotated90: inst.rotated90,
      instanceIdPrefix: `inst-${inst.instanceIndex}`,
    });

    if (
      !compiledInst.outerCutContour.closed ||
      !/Z\s*$/i.test(compiledInst.outerCutContour.svgPathD)
    ) {
      allContoursClosed = false;
    }
    for (const h of compiledInst.holeContours) {
      if (!h.closed || !/Z\s*$/i.test(h.svgPathD)) {
        allContoursClosed = false;
      }
    }

    allCutContours.push(compiledInst.outerCutContour);
    allHoleContours.push(...compiledInst.holeContours);
    totalEngraveItems += compiledInst.engravingItems.length;
  }

  const duplicateCutSegmentsCount = detectDuplicateCutSegments([
    ...allCutContours,
    ...allHoleContours,
  ]);

  if (duplicateCutSegmentsCount > 0) {
    issues.push({
      severity: 'error',
      code: 'DUPLICATE_CUT_LINES',
      message: `Se detectaron ${duplicateCutSegmentsCount} segmentos de corte superpuestos/duplicados. Aumente la separación entre etiquetas (ej. >= 1.0 mm) para evitar doble pasada del láser.`,
    });
  }

  if (overlappingPiecesCount > 0) {
    issues.push({
      severity: 'error',
      code: 'OVERLAPPING_PIECES',
      message: `Se detectaron ${overlappingPiecesCount} colisiones entre etiquetas en la mesa.`,
    });
  }

  if (outOfBoundsPiecesCount > 0) {
    issues.push({
      severity: 'error',
      code: 'PIECES_OUT_OF_BOUNDS',
      message: `Se detectaron ${outOfBoundsPiecesCount} etiquetas fuera del área útil del material o de la mesa.`,
    });
  }

  for (const err of nestingResult.errors) {
    issues.push({ severity: 'error', code: 'NESTING_ERROR', message: err });
  }
  for (const warn of nestingResult.warnings) {
    issues.push({ severity: 'warning', code: 'NESTING_WARNING', message: warn });
  }

  const hasErrors = issues.some((iss) => iss.severity === 'error');

  return {
    isValid:
      !hasErrors &&
      allContoursClosed &&
      duplicateCutSegmentsCount === 0 &&
      overlappingPiecesCount === 0 &&
      outOfBoundsPiecesCount === 0 &&
      invalidHolesCount === 0 &&
      engraveInvasionCount === 0,
    timestamp: new Date().toISOString(),
    labelDimensionsMm: {
      width: roundMm(design.widthMm),
      height: roundMm(design.heightMm),
    },
    effectiveCutDimensionsMm: {
      width: singleCompiled.effectiveCutWidthMm,
      height: singleCompiled.effectiveCutHeightMm,
    },
    sheetDimensionsMm: {
      width: roundMm(sheetWidthMm),
      height: roundMm(sheetHeightMm),
    },
    machineLimitMm: {
      width: roundMm(machineBedWidthMm),
      height: roundMm(machineBedHeightMm),
    },
    allContoursClosed,
    duplicateCutSegmentsCount,
    overlappingPiecesCount,
    outOfBoundsPiecesCount,
    invalidHolesCount,
    engraveInvasionCount,
    engraveSafetyWarningCount,
    totalProductiveCutContours: allCutContours.length,
    totalProductiveHoleContours: allHoleContours.length,
    totalProductiveEngraveItems: totalEngraveItems,
    issues,
  };
}
