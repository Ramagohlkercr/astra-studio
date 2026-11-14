import { Millimeters, Point2D } from '../types';
import { roundMm } from './geometryEngine';

/**
 * Motor tipográfico vectorial paramétrico (Hershey / Industrial CNC Stroke Font).
 * Garantiza que todo texto en una etiqueta se convierta en geometría real (trazos y polilíneas en mm)
 * sin depender de fuentes instaladas en la computadora donde corra LightBurn o RDWorks.
 * Cada glifo está definido en una grilla normalizada X: [0..1], Y: [0..1] (0 = arriba, 1 = base).
 */

type GlyphStrokes = Point2D[][];

const GLYPH_MAP: Record<string, GlyphStrokes> = {
  A: [
    [{ x: 0.05, y: 1 }, { x: 0.5, y: 0 }, { x: 0.95, y: 1 }],
    [{ x: 0.22, y: 0.65 }, { x: 0.78, y: 0.65 }],
  ],
  B: [
    [
      { x: 0.1, y: 1 },
      { x: 0.1, y: 0 },
      { x: 0.65, y: 0 },
      { x: 0.85, y: 0.12 },
      { x: 0.85, y: 0.35 },
      { x: 0.65, y: 0.48 },
      { x: 0.1, y: 0.48 },
    ],
    [
      { x: 0.65, y: 0.48 },
      { x: 0.9, y: 0.6 },
      { x: 0.9, y: 0.86 },
      { x: 0.68, y: 1 },
      { x: 0.1, y: 1 },
    ],
  ],
  C: [
    [
      { x: 0.9, y: 0.2 },
      { x: 0.72, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.1, y: 0.22 },
      { x: 0.1, y: 0.78 },
      { x: 0.3, y: 1 },
      { x: 0.72, y: 1 },
      { x: 0.9, y: 0.8 },
    ],
  ],
  D: [
    [
      { x: 0.1, y: 0 },
      { x: 0.1, y: 1 },
      { x: 0.62, y: 1 },
      { x: 0.9, y: 0.76 },
      { x: 0.9, y: 0.24 },
      { x: 0.62, y: 0 },
      { x: 0.1, y: 0 },
    ],
  ],
  E: [
    [{ x: 0.88, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 1 }, { x: 0.88, y: 1 }],
    [{ x: 0.1, y: 0.48 }, { x: 0.72, y: 0.48 }],
  ],
  F: [
    [{ x: 0.1, y: 1 }, { x: 0.1, y: 0 }, { x: 0.88, y: 0 }],
    [{ x: 0.1, y: 0.48 }, { x: 0.72, y: 0.48 }],
  ],
  G: [
    [
      { x: 0.9, y: 0.2 },
      { x: 0.72, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.1, y: 0.22 },
      { x: 0.1, y: 0.78 },
      { x: 0.3, y: 1 },
      { x: 0.75, y: 1 },
      { x: 0.9, y: 0.82 },
      { x: 0.9, y: 0.52 },
      { x: 0.52, y: 0.52 },
    ],
  ],
  H: [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.9, y: 0 }, { x: 0.9, y: 1 }],
    [{ x: 0.1, y: 0.48 }, { x: 0.9, y: 0.48 }],
  ],
  I: [
    [{ x: 0.25, y: 0 }, { x: 0.75, y: 0 }],
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
    [{ x: 0.25, y: 1 }, { x: 0.75, y: 1 }],
  ],
  J: [
    [
      { x: 0.8, y: 0 },
      { x: 0.8, y: 0.78 },
      { x: 0.62, y: 1 },
      { x: 0.3, y: 1 },
      { x: 0.12, y: 0.8 },
    ],
  ],
  K: [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.88, y: 0 }, { x: 0.1, y: 0.52 }],
    [{ x: 0.32, y: 0.38 }, { x: 0.9, y: 1 }],
  ],
  L: [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }, { x: 0.88, y: 1 }],
  ],
  M: [
    [
      { x: 0.08, y: 1 },
      { x: 0.08, y: 0 },
      { x: 0.5, y: 0.62 },
      { x: 0.92, y: 0 },
      { x: 0.92, y: 1 },
    ],
  ],
  N: [
    [{ x: 0.1, y: 1 }, { x: 0.1, y: 0 }, { x: 0.9, y: 1 }, { x: 0.9, y: 0 }],
  ],
  O: [
    [
      { x: 0.3, y: 0 },
      { x: 0.7, y: 0 },
      { x: 0.9, y: 0.22 },
      { x: 0.9, y: 0.78 },
      { x: 0.7, y: 1 },
      { x: 0.3, y: 1 },
      { x: 0.1, y: 0.78 },
      { x: 0.1, y: 0.22 },
      { x: 0.3, y: 0 },
    ],
  ],
  P: [
    [
      { x: 0.1, y: 1 },
      { x: 0.1, y: 0 },
      { x: 0.68, y: 0 },
      { x: 0.9, y: 0.16 },
      { x: 0.9, y: 0.38 },
      { x: 0.68, y: 0.54 },
      { x: 0.1, y: 0.54 },
    ],
  ],
  Q: [
    [
      { x: 0.3, y: 0 },
      { x: 0.7, y: 0 },
      { x: 0.9, y: 0.22 },
      { x: 0.9, y: 0.78 },
      { x: 0.7, y: 1 },
      { x: 0.3, y: 1 },
      { x: 0.1, y: 0.78 },
      { x: 0.1, y: 0.22 },
      { x: 0.3, y: 0 },
    ],
    [{ x: 0.58, y: 0.68 }, { x: 0.95, y: 1.04 }],
  ],
  R: [
    [
      { x: 0.1, y: 1 },
      { x: 0.1, y: 0 },
      { x: 0.68, y: 0 },
      { x: 0.9, y: 0.15 },
      { x: 0.9, y: 0.36 },
      { x: 0.68, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ],
    [{ x: 0.52, y: 0.5 }, { x: 0.9, y: 1 }],
  ],
  S: [
    [
      { x: 0.88, y: 0.18 },
      { x: 0.7, y: 0 },
      { x: 0.28, y: 0 },
      { x: 0.1, y: 0.16 },
      { x: 0.1, y: 0.34 },
      { x: 0.28, y: 0.48 },
      { x: 0.72, y: 0.52 },
      { x: 0.9, y: 0.68 },
      { x: 0.9, y: 0.85 },
      { x: 0.7, y: 1 },
      { x: 0.28, y: 1 },
      { x: 0.1, y: 0.82 },
    ],
  ],
  T: [
    [{ x: 0.06, y: 0 }, { x: 0.94, y: 0 }],
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
  ],
  U: [
    [
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.78 },
      { x: 0.3, y: 1 },
      { x: 0.7, y: 1 },
      { x: 0.9, y: 0.78 },
      { x: 0.9, y: 0 },
    ],
  ],
  V: [
    [{ x: 0.08, y: 0 }, { x: 0.5, y: 1 }, { x: 0.92, y: 0 }],
  ],
  W: [
    [
      { x: 0.05, y: 0 },
      { x: 0.26, y: 1 },
      { x: 0.5, y: 0.38 },
      { x: 0.74, y: 1 },
      { x: 0.95, y: 0 },
    ],
  ],
  X: [
    [{ x: 0.1, y: 0 }, { x: 0.9, y: 1 }],
    [{ x: 0.9, y: 0 }, { x: 0.1, y: 1 }],
  ],
  Y: [
    [{ x: 0.08, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.92, y: 0 }],
    [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }],
  ],
  Z: [
    [{ x: 0.1, y: 0 }, { x: 0.9, y: 0 }, { x: 0.1, y: 1 }, { x: 0.9, y: 1 }],
  ],
  '0': [
    [
      { x: 0.3, y: 0 },
      { x: 0.7, y: 0 },
      { x: 0.9, y: 0.22 },
      { x: 0.9, y: 0.78 },
      { x: 0.7, y: 1 },
      { x: 0.3, y: 1 },
      { x: 0.1, y: 0.78 },
      { x: 0.1, y: 0.22 },
      { x: 0.3, y: 0 },
    ],
    [{ x: 0.2, y: 0.82 }, { x: 0.8, y: 0.18 }],
  ],
  '1': [
    [{ x: 0.25, y: 0.2 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
    [{ x: 0.22, y: 1 }, { x: 0.78, y: 1 }],
  ],
  '2': [
    [
      { x: 0.12, y: 0.22 },
      { x: 0.3, y: 0 },
      { x: 0.72, y: 0 },
      { x: 0.9, y: 0.18 },
      { x: 0.9, y: 0.38 },
      { x: 0.1, y: 1 },
      { x: 0.9, y: 1 },
    ],
  ],
  '3': [
    [
      { x: 0.12, y: 0.18 },
      { x: 0.3, y: 0 },
      { x: 0.72, y: 0 },
      { x: 0.88, y: 0.16 },
      { x: 0.88, y: 0.36 },
      { x: 0.68, y: 0.48 },
      { x: 0.4, y: 0.48 },
    ],
    [
      { x: 0.68, y: 0.48 },
      { x: 0.9, y: 0.64 },
      { x: 0.9, y: 0.84 },
      { x: 0.7, y: 1 },
      { x: 0.28, y: 1 },
      { x: 0.1, y: 0.82 },
    ],
  ],
  '4': [
    [{ x: 0.72, y: 1 }, { x: 0.72, y: 0 }, { x: 0.1, y: 0.68 }, { x: 0.92, y: 0.68 }],
  ],
  '5': [
    [
      { x: 0.88, y: 0 },
      { x: 0.14, y: 0 },
      { x: 0.12, y: 0.46 },
      { x: 0.68, y: 0.46 },
      { x: 0.9, y: 0.62 },
      { x: 0.9, y: 0.84 },
      { x: 0.7, y: 1 },
      { x: 0.26, y: 1 },
      { x: 0.1, y: 0.84 },
    ],
  ],
  '6': [
    [
      { x: 0.84, y: 0.14 },
      { x: 0.68, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.1, y: 0.24 },
      { x: 0.1, y: 0.8 },
      { x: 0.3, y: 1 },
      { x: 0.72, y: 1 },
      { x: 0.9, y: 0.82 },
      { x: 0.9, y: 0.6 },
      { x: 0.72, y: 0.46 },
      { x: 0.1, y: 0.46 },
    ],
  ],
  '7': [
    [{ x: 0.1, y: 0 }, { x: 0.9, y: 0 }, { x: 0.38, y: 1 }],
  ],
  '8': [
    [
      { x: 0.3, y: 0.48 },
      { x: 0.14, y: 0.34 },
      { x: 0.14, y: 0.14 },
      { x: 0.3, y: 0 },
      { x: 0.7, y: 0 },
      { x: 0.86, y: 0.14 },
      { x: 0.86, y: 0.34 },
      { x: 0.7, y: 0.48 },
      { x: 0.3, y: 0.48 },
      { x: 0.1, y: 0.64 },
      { x: 0.1, y: 0.84 },
      { x: 0.3, y: 1 },
      { x: 0.7, y: 1 },
      { x: 0.9, y: 0.84 },
      { x: 0.9, y: 0.64 },
      { x: 0.7, y: 0.48 },
    ],
  ],
  '9': [
    [
      { x: 0.9, y: 0.52 },
      { x: 0.28, y: 0.52 },
      { x: 0.1, y: 0.36 },
      { x: 0.1, y: 0.16 },
      { x: 0.3, y: 0 },
      { x: 0.7, y: 0 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.78 },
      { x: 0.7, y: 1 },
      { x: 0.28, y: 1 },
    ],
  ],
  '-': [[{ x: 0.18, y: 0.5 }, { x: 0.82, y: 0.5 }]],
  '.': [
    [
      { x: 0.45, y: 0.9 },
      { x: 0.55, y: 0.9 },
      { x: 0.55, y: 1 },
      { x: 0.45, y: 1 },
      { x: 0.45, y: 0.9 },
    ],
  ],
  '/': [[{ x: 0.15, y: 1 }, { x: 0.85, y: 0 }]],
  '&': [
    [
      { x: 0.88, y: 1 },
      { x: 0.22, y: 0.34 },
      { x: 0.22, y: 0.12 },
      { x: 0.38, y: 0 },
      { x: 0.62, y: 0 },
      { x: 0.76, y: 0.14 },
      { x: 0.76, y: 0.32 },
      { x: 0.12, y: 0.72 },
      { x: 0.12, y: 0.88 },
      { x: 0.3, y: 1 },
      { x: 0.66, y: 1 },
      { x: 0.88, y: 0.72 },
    ],
  ],
};

/**
 * Convierte una cadena de texto en polilíneas y un path SVG en coordenadas reales (mm),
 * centrado alrededor de (centerXMm, centerYMm).
 */
export function compileVectorTextToGeometry(params: {
  text: string;
  centerXMm: Millimeters;
  centerYMm: Millimeters;
  fontSizeMm: Millimeters;
  letterSpacingMm: Millimeters;
  rotationDeg?: number;
  /** Reflejo horizontal del texto sobre su centro, antes de rotar */
  mirrored?: boolean;
}): {
  svgPathD: string;
  polylines: { points: Point2D[]; closed: boolean }[];
  widthMm: Millimeters;
  heightMm: Millimeters;
} {
  const cleanText = (params.text || 'LASERHOUSE').toUpperCase();
  const charHeight = Math.max(0.8, params.fontSizeMm);
  const charWidth = roundMm(charHeight * 0.68);
  const spacing = params.letterSpacingMm ?? roundMm(charHeight * 0.22);

  const count = cleanText.length;
  const totalWidth =
    count > 0 ? roundMm(count * charWidth + Math.max(0, count - 1) * spacing) : charWidth;
  const startX = params.centerXMm - totalWidth / 2;
  const startY = params.centerYMm - charHeight / 2;

  const angleRad = ((params.rotationDeg || 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const transformPt = (rawX: number, y: number): Point2D => {
    const x = params.mirrored ? 2 * params.centerXMm - rawX : rawX;
    if (!params.rotationDeg) {
      return { x: roundMm(x), y: roundMm(y) };
    }
    const dx = x - params.centerXMm;
    const dy = y - params.centerYMm;
    return {
      x: roundMm(params.centerXMm + dx * cosA - dy * sinA),
      y: roundMm(params.centerYMm + dx * sinA + dy * cosA),
    };
  };

  const polylines: { points: Point2D[]; closed: boolean }[] = [];
  const pathParts: string[] = [];

  for (let i = 0; i < count; i++) {
    const ch = cleanText[i];
    if (ch === ' ') continue;
    const glyph = GLYPH_MAP[ch] || GLYPH_MAP['O'];
    const charOriginX = startX + i * (charWidth + spacing);

    for (const stroke of glyph) {
      if (stroke.length < 2) continue;
      const pts = stroke.map((pt) =>
        transformPt(charOriginX + pt.x * charWidth, startY + pt.y * charHeight)
      );
      polylines.push({ points: pts, closed: false });
      const segs = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`);
      pathParts.push(segs.join(' '));
    }
  }

  return {
    svgPathD: pathParts.join(' '),
    polylines,
    widthMm: totalWidth,
    heightMm: charHeight,
  };
}
