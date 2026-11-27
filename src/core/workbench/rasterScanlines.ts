import { roundMm } from '../geometry/geometryEngine';
import { EngravedItemGeometry, Point2D } from '../types';
import {
  LightBurnImageDitherMode,
  WorkbenchConfig,
  WorkbenchJobItem,
} from './workbenchTypes';

/**
 * Máscara horizontal pre-muestreada de un grabado raster en coordenadas del lecho final.
 * Cada fila `r` (0..rows-1, de arriba a abajo en Y del lecho) lista segmentos oscuros `[u0, u1]` en [0..1] sobre X.
 */
export interface RasterScanlineMask {
  cols: number;
  rows: number;
  rowRuns: Array<[number, number][]>;
}

/**
 * Rellena polilíneas vectoriales cerradas con corridas horizontales analíticas (regla par-impar)
 * a resolución exacta de `lineIntervalMm` (sin rejilla de píxeles en X).
 */
export function rasterizePolylinesToHorizontalRuns(
  polylines: Array<{ points: Point2D[]; closed?: boolean }>,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  lineIntervalMm: number
): Array<{ yMm: number; runsMm: Array<[number, number]> }> {
  const interval = Math.max(0.025, lineIntervalMm || 0.08);
  const spanY = Math.max(0.01, maxY - minY);
  const rows = Math.max(2, Math.min(1200, Math.ceil(spanY / interval)));
  const out: Array<{ yMm: number; runsMm: Array<[number, number]> }> = [];

  for (let r = 0; r < rows; r++) {
    const y = roundMm(minY + ((r + 0.5) / rows) * spanY, 4);
    const xs: number[] = [];

    for (const poly of polylines) {
      const pts = poly.points;
      if (pts.length < 2) continue;
      const count = pts.length;
      const limit = poly.closed === false ? count - 1 : count;
      for (let i = 0; i < limit; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % count];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
    }

    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const runsMm: Array<[number, number]> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(minX, Math.min(maxX, xs[i]));
      const x1 = Math.max(minX, Math.min(maxX, xs[i + 1]));
      if (x1 - x0 >= 0.012) {
        runsMm.push([roundMm(x0, 3), roundMm(x1, 3)]);
      }
    }
    if (runsMm.length > 0) {
      out.push({ yMm: roundMm(y, 3), runsMm });
    }
  }

  return out;
}

const rasterMaskCache = new Map<string, RasterScanlineMask>();

export function buildRasterMaskCacheKey(params: {
  dataUrl: string;
  bboxWidthMm: number;
  bboxHeightMm: number;
  rotationDeg: number;
  mirrored: boolean;
  lineIntervalMm: number;
  ditherMode: LightBurnImageDitherMode;
}): string {
  const normRot = ((Math.round(params.rotationDeg * 10) % 3600) + 3600) % 3600;
  return [
    params.dataUrl.length,
    params.dataUrl.slice(0, 64),
    params.dataUrl.slice(-32),
    Math.round(params.bboxWidthMm * 10),
    Math.round(params.bboxHeightMm * 10),
    normRot,
    params.mirrored ? 1 : 0,
    Math.round(params.lineIntervalMm * 1000),
    params.ditherMode,
  ].join('|');
}

export function getCachedRasterScanlineMask(key: string): RasterScanlineMask | undefined {
  return rasterMaskCache.get(key);
}

export function setCachedRasterScanlineMask(key: string, mask: RasterScanlineMask): void {
  if (rasterMaskCache.size > 120) {
    const oldestKey = rasterMaskCache.keys().next().value;
    if (oldestKey) rasterMaskCache.delete(oldestKey);
  }
  rasterMaskCache.set(key, mask);
}

/**
 * Convierte un buffer RGBA en máscara binaria (0/1) aplicando umbral nítido o dithering Floyd-Steinberg/Bayer
 * según el modo de imagen de LightBurn, y devuelve corridas `[u0, u1]` por fila.
 */
export function buildScanlineMaskFromRgba(
  rgba: Uint8ClampedArray,
  cols: number,
  rows: number,
  ditherMode: LightBurnImageDitherMode = 'threshold'
): RasterScanlineMask {
  const luma = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const o = i * 4;
    const a = rgba[o + 3] / 255;
    // Fondo transparente se compone sobre blanco (255 = sin disparo láser)
    const r = rgba[o] * a + 255 * (1 - a);
    const g = rgba[o + 1] * a + 255 * (1 - a);
    const b = rgba[o + 2] * a + 255 * (1 - a);
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const binary = new Uint8Array(cols * rows);
  if (ditherMode === 'jarvis' || ditherMode === 'stucki' || ditherMode === 'grayscale') {
    // Error diffusion (Floyd-Steinberg compacto) para sombreados fotográficos
    const work = new Float32Array(luma);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const oldVal = work[idx];
        const isBlack = oldVal < 142;
        binary[idx] = isBlack ? 1 : 0;
        const err = oldVal - (isBlack ? 0 : 255);
        if (x + 1 < cols) work[idx + 1] += err * (7 / 16);
        if (y + 1 < rows) {
          if (x > 0) work[(y + 1) * cols + x - 1] += err * (3 / 16);
          work[(y + 1) * cols + x] += err * (5 / 16);
          if (x + 1 < cols) work[(y + 1) * cols + x + 1] += err * (1 / 16);
        }
      }
    }
  } else if (ditherMode === 'halftone') {
    const bayer4 = [
      [15, 135, 45, 165],
      [195, 75, 225, 105],
      [60, 180, 30, 150],
      [240, 120, 210, 90],
    ];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        binary[idx] = luma[idx] < bayer4[y & 3][x & 3] ? 1 : 0;
      }
    }
  } else {
    // Umbral nítido por defecto para logos e isotipos monocromo
    for (let i = 0; i < cols * rows; i++) {
      binary[i] = luma[i] < 178 ? 1 : 0;
    }
  }

  const rowRuns: Array<[number, number][]> = [];
  for (let y = 0; y < rows; y++) {
    const runs: [number, number][] = [];
    const base = y * cols;
    let inRun = false;
    let startX = 0;
    for (let x = 0; x < cols; x++) {
      const dark = binary[base + x] === 1;
      if (dark && !inRun) {
        inRun = true;
        startX = x;
      } else if (!dark && inRun) {
        inRun = false;
        runs.push([startX / cols, x / cols]);
      }
    }
    if (inRun) {
      runs.push([startX / cols, 1]);
    }
    rowRuns.push(runs);
  }

  return { cols, rows, rowRuns };
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Decodifica un `EngravedItemGeometry` (`kind === 'raster_image'`) respetando su rotación final,
 * espejo horizontal e intervalo de línea, y lo almacena en caché en `rasterMaskCache`.
 */
export async function resolveRasterEngravingMask(
  eng: EngravedItemGeometry,
  lineIntervalMm: number,
  ditherMode: LightBurnImageDitherMode = 'threshold',
  _totalInstancesOnBed = 1
): Promise<RasterScanlineMask | null> {
  if (eng.kind !== 'raster_image' || !eng.dataUrl) return null;
  if (typeof document === 'undefined') return null;

  const bb = eng.boundingBox;
  const bboxW = Math.max(0.5, bb.width || eng.widthMm || 10);
  const bboxH = Math.max(0.5, bb.height || eng.heightMm || 10);
  const rotDeg = eng.rotationDeg ?? 0;
  const mirrored = !!eng.mirrored;
  // Respetar exactamente el intervalo vertical configurado (p.ej. 0.073 mm = 348 DPI) sin degradar tiradas grandes
  const effectiveInterval = Math.max(0.025, lineIntervalMm || 0.08);

  const key = buildRasterMaskCacheKey({
    dataUrl: eng.dataUrl,
    bboxWidthMm: bboxW,
    bboxHeightMm: bboxH,
    rotationDeg: rotDeg,
    mirrored,
    lineIntervalMm: effectiveInterval,
    ditherMode,
  });

  const cached = getCachedRasterScanlineMask(key);
  if (cached) return cached;

  const img = await loadImageElement(eng.dataUrl);
  if (!img) return null;

  // Escala isotrópica de alta resolución en X (<= 0.02 mm, hasta 1024 px) para bordes de tipografía sin diente de sierra
  const xStepMm = Math.min(0.02, effectiveInterval * 0.4);
  const isoPxPerMm = Math.min(1024 / Math.max(bboxW, bboxH), 1 / xStepMm);
  const cols = Math.max(96, Math.min(1024, Math.ceil(bboxW * isoPxPerMm)));
  const isoH = Math.max(16, Math.min(1024, Math.ceil(bboxH * isoPxPerMm)));
  const rows = Math.max(16, Math.min(900, Math.round(bboxH / effectiveInterval)));

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = isoH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = ditherMode !== 'threshold';
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cols, isoH);

  const drawW = (eng.widthMm ?? bboxW) * isoPxPerMm;
  const drawH = (eng.heightMm ?? bboxH) * isoPxPerMm;

  ctx.save();
  ctx.translate(cols / 2, isoH / 2);
  if (rotDeg) {
    ctx.rotate((rotDeg * Math.PI) / 180);
  }
  if (mirrored) {
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  const isoRgba = ctx.getImageData(0, 0, cols, isoH).data;
  const sampledRgba = new Uint8ClampedArray(cols * rows * 4);
  const bandHalf =
    ditherMode === 'threshold' ? Math.min(1, Math.floor((isoH / rows) * 0.25)) : 0;

  for (let r = 0; r < rows; r++) {
    const centerY = Math.min(isoH - 1, Math.floor(((r + 0.5) / rows) * isoH));
    const yStart = Math.max(0, centerY - bandHalf);
    const yEnd = Math.min(isoH - 1, centerY + bandHalf);
    const dstRowOffset = r * cols * 4;

    if (bandHalf === 0) {
      const srcRowOffset = centerY * cols * 4;
      sampledRgba.set(
        isoRgba.subarray(srcRowOffset, srcRowOffset + cols * 4),
        dstRowOffset
      );
    } else {
      for (let x = 0; x < cols; x++) {
        let bestOffset = (centerY * cols + x) * 4;
        let bestLuma =
          isoRgba[bestOffset] * 0.299 +
          isoRgba[bestOffset + 1] * 0.587 +
          isoRgba[bestOffset + 2] * 0.114;
        for (let yy = yStart; yy <= yEnd; yy++) {
          const o = (yy * cols + x) * 4;
          const lum =
            isoRgba[o] * 0.299 + isoRgba[o + 1] * 0.587 + isoRgba[o + 2] * 0.114;
          if (lum < bestLuma) {
            bestLuma = lum;
            bestOffset = o;
          }
        }
        const dstO = dstRowOffset + x * 4;
        sampledRgba[dstO] = isoRgba[bestOffset];
        sampledRgba[dstO + 1] = isoRgba[bestOffset + 1];
        sampledRgba[dstO + 2] = isoRgba[bestOffset + 2];
        sampledRgba[dstO + 3] = isoRgba[bestOffset + 3];
      }
    }
  }

  const mask = buildScanlineMaskFromRgba(sampledRgba, cols, rows, ditherMode);
  setCachedRasterScanlineMask(key, mask);
  return mask;
}

/**
 * Pre-decodifica (con caché compartida) todas las imágenes raster presentes en la tirada
 * antes de compilar el `.RD` síncrono.
 */
export async function prepareWorkbenchRasterMasks(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): Promise<Map<string, RasterScanlineMask>> {
  const result = new Map<string, RasterScanlineMask>();
  const engraveLayer = config.layers.find((l) => l.role === 'ENGRAVE');
  const intervalMm = Math.max(0.025, engraveLayer?.lineIntervalMm || 0.08);
  const ditherMode: LightBurnImageDitherMode =
    engraveLayer?.imageDitherMode ?? 'threshold';

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const totalPieces = visibleJobs.reduce((acc, j) => acc + j.instances.length, 0);

  const tasks: Promise<void>[] = [];
  const seenKeys = new Set<string>();

  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      for (const eng of inst.engraveItems) {
        if (eng.kind !== 'raster_image' || !eng.dataUrl) continue;
        const bb = eng.boundingBox;
        const bboxW = Math.max(0.5, bb.width || eng.widthMm || 10);
        const bboxH = Math.max(0.5, bb.height || eng.heightMm || 10);
        const key = buildRasterMaskCacheKey({
          dataUrl: eng.dataUrl,
          bboxWidthMm: bboxW,
          bboxHeightMm: bboxH,
          rotationDeg: eng.rotationDeg ?? 0,
          mirrored: !!eng.mirrored,
          lineIntervalMm: intervalMm,
          ditherMode,
        });
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        tasks.push(
          resolveRasterEngravingMask(eng, intervalMm, ditherMode, totalPieces).then(
            (mask) => {
              if (mask) result.set(key, mask);
            }
          )
        );
      }
    }
  }

  await Promise.all(tasks);
  return result;
}
