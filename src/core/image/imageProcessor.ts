import { roundMm } from '../geometry/geometryEngine';
import { ImageProcessingOptions, Millimeters, Point2D } from '../types';

export const DEFAULT_IMAGE_PROCESSING: ImageProcessingOptions = {
  mode: 'vector',
  threshold: 145,
  brightness: 0,
  contrast: 15,
  invert: false,
  removeBackground: true,
  backgroundTolerance: 22,
  turdSize: 0.75,
};

/**
 * Calcula la resolución efectiva en DPI (puntos por pulgada) cuando una imagen de
 * `pixelWidth` píxeles se imprime/graba a un ancho físico de `widthMm` milímetros.
 */
export function computeEffectiveDpi(pixelWidth: number, widthMm: Millimeters): number {
  if (widthMm <= 0 || pixelWidth <= 0) return 0;
  const inches = widthMm / 25.4;
  return roundMm(pixelWidth / inches, 1);
}

/**
 * Simplificación geométrica de polilíneas mediante el algoritmo Ramer-Douglas-Peucker (RDP).
 */
export function simplifyPolylineRDP(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) return points;

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    let dist = 0;
    if (lenSq === 0) {
      dist = Math.hypot(p.x - first.x, p.y - first.y);
    } else {
      const t = Math.max(0, Math.min(1, ((p.x - first.x) * dx + (p.y - first.y) * dy) / lenSq));
      const projX = first.x + t * dx;
      const projY = first.y + t * dy;
      dist = Math.hypot(p.x - projX, p.y - projY);
    }
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolylineRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyPolylineRDP(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Procesa un buffer RGBA real (Uint8ClampedArray) aplicando eliminación de fondo,
 * brillo, contraste, umbral monocromático e inversión, devolviendo:
 * - el buffer RGBA procesado (monocromático con fondo transparente)
 * - la máscara binaria (Uint8Array de 0 y 1 donde 1 = zona a grabar con láser)
 * - si la imagen original poseía transparencia alfa
 */
export function processRgbaBufferToBinaryMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: ImageProcessingOptions
): {
  processedRgba: Uint8ClampedArray;
  binaryMask: Uint8Array;
  hasTransparency: boolean;
  darkPixelCount: number;
} {
  const totalPixels = width * height;
  const processedRgba = new Uint8ClampedArray(rgba.length);
  const binaryMask = new Uint8Array(totalPixels);
  let hasTransparency = false;
  let darkPixelCount = 0;

  // Detectar color de fondo predominante en las 4 esquinas para eliminación de fondo blanco/claro
  const cornerIndices = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  let bgR = 255;
  let bgG = 255;
  let bgB = 255;
  if (rgba.length >= 4) {
    let sumR = 0,
      sumG = 0,
      sumB = 0,
      validCorners = 0;
    for (const idx of cornerIndices) {
      if (idx + 3 < rgba.length && rgba[idx + 3] > 128) {
        sumR += rgba[idx];
        sumG += rgba[idx + 1];
        sumB += rgba[idx + 2];
        validCorners++;
      }
    }
    if (validCorners > 0) {
      bgR = sumR / validCorners;
      bgG = sumG / validCorners;
      bgB = sumB / validCorners;
    }
  }

  const clampedContrast = Math.max(-100, Math.min(100, options.contrast));
  const contrastFactor =
    (259 * (clampedContrast + 255)) / (255 * (259 - clampedContrast));
  const brightnessOffset = (Math.max(-100, Math.min(100, options.brightness)) / 100) * 128;
  const bgTolDist = (options.backgroundTolerance / 100) * 220;

  for (let p = 0; p < totalPixels; p++) {
    const idx = p * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];

    if (a < 250) {
      hasTransparency = true;
    }

    // Píxeles transparentes (< 48 alfa) nunca se graban (incluso si invert está activo, el fondo transparente sigue siendo fondo)
    if (a < 48) {
      binaryMask[p] = 0;
      processedRgba[idx] = 255;
      processedRgba[idx + 1] = 255;
      processedRgba[idx + 2] = 255;
      processedRgba[idx + 3] = 0;
      continue;
    }

    // Si removeBackground está activo y el píxel coincide con el fondo claro de las esquinas
    if (options.removeBackground) {
      const colorDist = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (colorDist <= bgTolDist && (bgR + bgG + bgB) / 3 > 160) {
        binaryMask[p] = 0;
        processedRgba[idx] = 255;
        processedRgba[idx + 1] = 255;
        processedRgba[idx + 2] = 255;
        processedRgba[idx + 3] = 0;
        continue;
      }
    }

    // Luminancia estándar ITU-R BT.601
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lum = contrastFactor * (lum + brightnessOffset - 128) + 128;
    lum = Math.max(0, Math.min(255, lum));

    let isEngraved = lum < options.threshold;
    if (options.invert) {
      isEngraved = !isEngraved;
    }

    if (isEngraved) {
      binaryMask[p] = 1;
      darkPixelCount++;
      processedRgba[idx] = 18;
      processedRgba[idx + 1] = 18;
      processedRgba[idx + 2] = 18;
      processedRgba[idx + 3] = 255;
    } else {
      binaryMask[p] = 0;
      processedRgba[idx] = 255;
      processedRgba[idx + 1] = 255;
      processedRgba[idx + 2] = 255;
      processedRgba[idx + 3] = 0;
    }
  }

  return {
    processedRgba,
    binaryMask,
    hasTransparency,
    darkPixelCount,
  };
}

/**
 * Vectorizador real mediante Marching Squares + encadenamiento topológico de segmentos
 * y simplificación Ramer-Douglas-Peucker.
 * Conserva tanto contornos exteriores como agujeros/huecos internos (ej. interior de letras O, A, B, P, R).
 * Devuelve trazados SVG cerrados ('M ... L ... Z') normalizados al espacio [0..1, 0..1].
 */
export function traceBinaryMaskToNormalizedPaths(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  turdSize = 0.75
): string[] {
  if (width < 2 || height < 2) return [];

  const sample = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return binaryMask[y * width + x] ? 1 : 0;
  };

  const adjacency = new Map<string, string[]>();

  const addDirectedEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const k1 = `${x1},${y1}`;
    const k2 = `${x2},${y2}`;
    if (k1 === k2) return;
    const list = adjacency.get(k1);
    if (list) {
      list.push(k2);
    } else {
      adjacency.set(k1, [k2]);
    }
  };

  for (let cy = -1; cy < height; cy++) {
    for (let cx = -1; cx < width; cx++) {
      const tl = sample(cx, cy);
      const tr = sample(cx + 1, cy);
      const br = sample(cx + 1, cy + 1);
      const bl = sample(cx, cy + 1);
      const state = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (state === 0 || state === 15) continue;

      const topX = 2 * cx + 3,
        topY = 2 * cy + 2;
      const rightX = 2 * cx + 4,
        rightY = 2 * cy + 3;
      const botX = 2 * cx + 3,
        botY = 2 * cy + 4;
      const leftX = 2 * cx + 2,
        leftY = 2 * cy + 3;

      switch (state) {
        case 1:
          addDirectedEdge(leftX, leftY, botX, botY);
          break;
        case 2:
          addDirectedEdge(botX, botY, rightX, rightY);
          break;
        case 3:
          addDirectedEdge(leftX, leftY, rightX, rightY);
          break;
        case 4:
          addDirectedEdge(rightX, rightY, topX, topY);
          break;
        case 5:
          addDirectedEdge(leftX, leftY, topX, topY);
          addDirectedEdge(botX, botY, rightX, rightY);
          break;
        case 6:
          addDirectedEdge(botX, botY, topX, topY);
          break;
        case 7:
          addDirectedEdge(leftX, leftY, topX, topY);
          break;
        case 8:
          addDirectedEdge(topX, topY, leftX, leftY);
          break;
        case 9:
          addDirectedEdge(topX, topY, botX, botY);
          break;
        case 10:
          addDirectedEdge(topX, topY, rightX, rightY);
          addDirectedEdge(leftX, leftY, botX, botY);
          break;
        case 11:
          addDirectedEdge(topX, topY, rightX, rightY);
          break;
        case 12:
          addDirectedEdge(rightX, rightY, leftX, leftY);
          break;
        case 13:
          addDirectedEdge(rightX, rightY, botX, botY);
          break;
        case 14:
          addDirectedEdge(botX, botY, leftX, leftY);
          break;
      }
    }
  }

  const paths: string[] = [];
  const scaleX = 1 / (2 * width);
  const scaleY = 1 / (2 * height);
  const normEpsilon = Math.max(0.08, turdSize * 0.45) * Math.min(scaleX, scaleY) * 2;

  for (const [startKey, nextList] of adjacency.entries()) {
    while (nextList.length > 0) {
      const loopKeys: string[] = [startKey];
      let curr = nextList.pop()!;
      let safety = 0;
      const maxSteps = width * height * 4 + 100;

      while (curr !== startKey && safety < maxSteps) {
        safety++;
        loopKeys.push(curr);
        const list = adjacency.get(curr);
        if (!list || list.length === 0) break;
        curr = list.pop()!;
      }

      if (loopKeys.length >= 4) {
        const rawPts: Point2D[] = loopKeys.map((k) => {
          const [hx, hy] = k.split(',').map(Number);
          return {
            x: roundMm((hx - 2) * scaleX, 5),
            y: roundMm((hy - 2) * scaleY, 5),
          };
        });

        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of rawPts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const pixelSpanW = (maxX - minX) * width;
        const pixelSpanH = (maxY - minY) * height;
        if (pixelSpanW < turdSize && pixelSpanH < turdSize) {
          continue;
        }

        const simplified = simplifyPolylineRDP([...rawPts, rawPts[0]], normEpsilon);
        let closedPts = simplified.slice(0, -1);
        // Si un contorno pequeño se simplificó a menos de 3 puntos, conservar al menos 4 vértices del lazo original
        if (closedPts.length < 3 && rawPts.length >= 4) {
          const step = Math.max(1, Math.floor(rawPts.length / 4));
          closedPts = [
            rawPts[0],
            rawPts[step],
            rawPts[Math.min(rawPts.length - 1, step * 2)],
            rawPts[Math.min(rawPts.length - 1, step * 3)],
          ];
        }
        if (closedPts.length >= 3) {
          const d =
            closedPts
              .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${roundMm(pt.x, 4)} ${roundMm(pt.y, 4)}`)
              .join(' ') + ' Z';
          paths.push(d);
        }
      }
    }
  }

  return paths;
}

/**
 * Parsea un archivo SVG real (texto XML) y extrae sus trazados normalizados y su viewBox
 * para que pueda escalarse y grabarse sin deformaciones en milímetros reales.
 * Soporta <path>, <rect>, <circle>, <ellipse>, <line>, <polygon> y <polyline>.
 */
export function parseSvgLogoString(svgText: string): {
  originalViewBox: { minX: number; minY: number; width: number; height: number };
  normalizedPaths: string[];
  aspectRatio: number;
} {
  let minX = 0;
  let minY = 0;
  let width = 100;
  let height = 100;
  let hasExplicitBox = false;

  const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      [minX, minY, width, height] = parts;
      hasExplicitBox = true;
    }
  } else {
    const wMatch = svgText.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i);
    const hMatch = svgText.match(/\bheight\s*=\s*["']\s*([\d.]+)/i);
    if (wMatch && hMatch) {
      const wVal = parseFloat(wMatch[1]);
      const hVal = parseFloat(hMatch[1]);
      if (wVal > 0 && hVal > 0) {
        width = wVal;
        height = hVal;
        hasExplicitBox = true;
      }
    }
  }

  const normalizedPaths: string[] = [];

  // 1. Extraer atributos d="..." de <path>
  const pathRegex = /<path\b[^>]*?\bd\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRegex.exec(svgText)) !== null) {
    if (m[1].trim()) {
      normalizedPaths.push(m[1].trim());
    }
  }

  // 2. Convertir <rect> a path cerrado
  const rectRegex = /<rect\b([^>]+)>/gi;
  while ((m = rectRegex.exec(svgText)) !== null) {
    const attrs = m[1];
    const x = parseFloat(attrs.match(/\bx\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const y = parseFloat(attrs.match(/\by\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const rw = parseFloat(attrs.match(/\bwidth\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const rh = parseFloat(attrs.match(/\bheight\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    if (rw > 0 && rh > 0) {
      normalizedPaths.push(
        `M ${x} ${y} L ${x + rw} ${y} L ${x + rw} ${y + rh} L ${x} ${y + rh} Z`
      );
    }
  }

  // 3. Convertir <circle> a polígono cerrado de 28 lados
  const circleRegex = /<circle\b([^>]+)>/gi;
  while ((m = circleRegex.exec(svgText)) !== null) {
    const attrs = m[1];
    const cx = parseFloat(attrs.match(/\bcx\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const cy = parseFloat(attrs.match(/\bcy\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const r = parseFloat(attrs.match(/\br\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    if (r > 0) {
      const pts: string[] = [];
      for (let i = 0; i < 28; i++) {
        const ang = (2 * Math.PI * i) / 28;
        const px = roundMm(cx + r * Math.cos(ang), 3);
        const py = roundMm(cy + r * Math.sin(ang), 3);
        pts.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`);
      }
      pts.push('Z');
      normalizedPaths.push(pts.join(' '));
    }
  }

  // 4. Convertir <ellipse> a polígono cerrado de 28 lados
  const ellipseRegex = /<ellipse\b([^>]+)>/gi;
  while ((m = ellipseRegex.exec(svgText)) !== null) {
    const attrs = m[1];
    const cx = parseFloat(attrs.match(/\bcx\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const cy = parseFloat(attrs.match(/\bcy\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const rx = parseFloat(attrs.match(/\brx\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const ry = parseFloat(attrs.match(/\bry\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    if (rx > 0 && ry > 0) {
      const pts: string[] = [];
      for (let i = 0; i < 28; i++) {
        const ang = (2 * Math.PI * i) / 28;
        const px = roundMm(cx + rx * Math.cos(ang), 3);
        const py = roundMm(cy + ry * Math.sin(ang), 3);
        pts.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`);
      }
      pts.push('Z');
      normalizedPaths.push(pts.join(' '));
    }
  }

  // 5. Convertir <line> a trazo abierto M x1 y1 L x2 y2
  const lineRegex = /<line\b([^>]+)>/gi;
  while ((m = lineRegex.exec(svgText)) !== null) {
    const attrs = m[1];
    const x1 = parseFloat(attrs.match(/\bx1\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const y1 = parseFloat(attrs.match(/\by1\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const x2 = parseFloat(attrs.match(/\bx2\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    const y2 = parseFloat(attrs.match(/\by2\s*=\s*["']([\d.-]+)/i)?.[1] || '0');
    if (Math.hypot(x2 - x1, y2 - y1) > 1e-4) {
      normalizedPaths.push(`M ${x1} ${y1} L ${x2} ${y2}`);
    }
  }

  // 6. Convertir <polygon> y <polyline>
  const polyRegex = /<(polygon|polyline)\b[^>]*?\bpoints\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = polyRegex.exec(svgText)) !== null) {
    const isClosed = m[1].toLowerCase() === 'polygon';
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
    if (nums.length >= 4) {
      const segs: string[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        segs.push(`${i === 0 ? 'M' : 'L'} ${nums[i]} ${nums[i + 1]}`);
      }
      if (isClosed) segs.push('Z');
      normalizedPaths.push(segs.join(' '));
    }
  }

  if (normalizedPaths.length === 0) {
    normalizedPaths.push(
      `M ${minX + width * 0.15} ${minY + height * 0.2} L ${minX + width * 0.85} ${minY + height * 0.2} L ${minX + width * 0.85} ${minY + height * 0.8} L ${minX + width * 0.15} ${minY + height * 0.8} Z`
    );
  }

  // Si el SVG no tenía viewBox ni width/height explícitos, inferir caja de coordenadas desde los números de los paths
  if (!hasExplicitBox && normalizedPaths.length > 0) {
    const allNums = normalizedPaths
      .join(' ')
      .match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)
      ?.map(Number)
      .filter(Number.isFinite);
    if (allNums && allNums.length >= 4) {
      let bx0 = Infinity,
        by0 = Infinity,
        bx1 = -Infinity,
        by1 = -Infinity;
      for (let i = 0; i + 1 < allNums.length; i += 2) {
        const vx = allNums[i];
        const vy = allNums[i + 1];
        if (vx < bx0) bx0 = vx;
        if (vx > bx1) bx1 = vx;
        if (vy < by0) by0 = vy;
        if (vy > by1) by1 = vy;
      }
      if (bx1 > bx0 && by1 > by0) {
        minX = bx0;
        minY = by0;
        width = bx1 - bx0;
        height = by1 - by0;
      }
    }
  }

  return {
    originalViewBox: { minX, minY, width, height },
    normalizedPaths,
    aspectRatio: roundMm(width / Math.max(0.001, height), 4),
  };
}
