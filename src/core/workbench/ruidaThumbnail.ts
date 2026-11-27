import {
  buildRasterMaskCacheKey,
  getCachedRasterScanlineMask,
  RasterScanlineMask,
} from './rasterScanlines';
import { LightBurnImageDitherMode, WorkbenchJobItem } from './workbenchTypes';

/**
 * Codifica un bitmap binario (size x size, fila 0 = arriba, 1 = negro/tinta, 0 = fondo)
 * en paquetes Ruida `E7 11` (144x144: 3 paquetes de 48 filas x 21 bytes = 1008 bytes c/u)
 * o `E7 12` (300x300: 15 paquetes de 20 filas x 43 bytes = 860 bytes c/u),
 * siguiendo exactamente el empaquetado de 7 bits por byte de `Protocol_Ruida::OutputThumbnails` (LightBurn).
 */
export function encodeRuidaThumbnailPackets(
  bitmap: Uint8Array,
  size: 144 | 300
): number[][] {
  const commandSub = size === 144 ? 0x11 : 0x12;
  const rowsPerChunk = size === 144 ? 48 : 20;
  const bitsPerRowAligned = size === 144 ? 147 : 301; // 21*7 y 43*7
  const bytesPerChunk = (rowsPerChunk * bitsPerRowAligned) / 7; // 1008 (0x3F0) o 860 (0x35C)
  const chunkCount = size / rowsPerChunk; // 3 o 15

  const packets: number[][] = [];
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const payload = new Uint8Array(bytesPerChunk);
    let bitIdx = 0;
    for (let r = 0; r < rowsPerChunk; r++) {
      const yOut = chunk * rowsPerChunk + r;
      // OutputThumbnails lee QImage de abajo hacia arriba (`scanLine(size - 1 - yOut)`).
      const srcY = size - 1 - yOut;
      const srcRowOffset = srcY * size;
      for (let x = 0; x < size; x++) {
        if (bitmap[srcRowOffset + x]) {
          const byteIdx = Math.floor(bitIdx / 7);
          const bitShift = 6 - (bitIdx % 7);
          payload[byteIdx] |= 1 << bitShift;
        }
        bitIdx++;
      }
      bitIdx += bitsPerRowAligned - size;
    }
    packets.push([0xe7, commandSub, ...Array.from(payload)]);
  }
  return packets;
}

function drawBresenhamLine(
  bitmap: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  let ix0 = Math.round(x0);
  let iy0 = Math.round(y0);
  const ix1 = Math.round(x1);
  const iy1 = Math.round(y1);
  const dx = Math.abs(ix1 - ix0);
  const dy = -Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx + dy;

  for (let guard = 0; guard < size * 4; guard++) {
    if (ix0 >= 0 && ix0 < size && iy0 >= 0 && iy0 < size) {
      bitmap[iy0 * size + ix0] = 1;
    }
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ix0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

function rasterizeWorkbenchToSquareBitmap(params: {
  size: 144 | 300;
  visibleJobs: WorkbenchJobItem[];
  boundsMm: { minX: number; minY: number; maxX: number; maxY: number };
  rasterMasks?: Map<string, RasterScanlineMask>;
  engraveIntervalMm: number;
  engraveDitherMode: LightBurnImageDitherMode;
}): Uint8Array {
  const {
    size,
    visibleJobs,
    boundsMm,
    rasterMasks,
    engraveIntervalMm,
    engraveDitherMode,
  } = params;
  const bitmap = new Uint8Array(size * size);
  const spanW = Math.max(0.1, boundsMm.maxX - boundsMm.minX);
  const spanH = Math.max(0.1, boundsMm.maxY - boundsMm.minY);
  const usable = size * 0.92;
  const scale = Math.min(usable / spanW, usable / spanH);
  const offsetX = (size - spanW * scale) / 2;
  const offsetY = (size - spanH * scale) / 2;

  const mapX = (bedX: number) => offsetX + (bedX - boundsMm.minX) * scale;
  const mapY = (bedY: number) => offsetY + (bedY - boundsMm.minY) * scale;

  const drawPolyline = (points: { x: number; y: number }[], closed: boolean, jx: number, jy: number) => {
    if (points.length < 2) return;
    for (let i = 1; i < points.length; i++) {
      drawBresenhamLine(
        bitmap,
        size,
        mapX(jx + points[i - 1].x),
        mapY(jy + points[i - 1].y),
        mapX(jx + points[i].x),
        mapY(jy + points[i].y)
      );
    }
    if (closed && points.length > 2) {
      const last = points[points.length - 1];
      const first = points[0];
      drawBresenhamLine(
        bitmap,
        size,
        mapX(jx + last.x),
        mapY(jy + last.y),
        mapX(jx + first.x),
        mapY(jy + first.y)
      );
    }
  };

  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      for (const eng of inst.engraveItems) {
        if (eng.kind === 'vector_path' && eng.polylines) {
          for (const pl of eng.polylines) {
            drawPolyline(pl.points, !!pl.closed, job.xMm, job.yMm);
          }
        } else {
          const bb = eng.boundingBox;
          const minX = job.xMm + bb.minX;
          const maxX = job.xMm + bb.maxX;
          const minY = job.yMm + bb.minY;
          const maxY = job.yMm + bb.maxY;

          let mask: RasterScanlineMask | undefined;
          if (eng.kind === 'raster_image' && eng.dataUrl) {
            const key = buildRasterMaskCacheKey({
              dataUrl: eng.dataUrl,
              bboxWidthMm: Math.max(0.5, bb.width || eng.widthMm || 10),
              bboxHeightMm: Math.max(0.5, bb.height || eng.heightMm || 10),
              rotationDeg: eng.rotationDeg ?? 0,
              mirrored: !!eng.mirrored,
              lineIntervalMm: Math.max(0.025, engraveIntervalMm),
              ditherMode: engraveDitherMode,
            });
            mask = rasterMasks?.get(key) ?? getCachedRasterScanlineMask(key);
          }

          if (mask && mask.rowRuns.length > 0) {
            const engW = Math.max(0.01, maxX - minX);
            const engH = Math.max(0.01, maxY - minY);
            for (let r = 0; r < mask.rowRuns.length; r++) {
              const runs = mask.rowRuns[r];
              if (runs.length === 0) continue;
              const py = Math.max(
                0,
                Math.min(size - 1, Math.round(mapY(minY + ((r + 0.5) / mask.rows) * engH)))
              );
              const rowOffset = py * size;
              for (const [u0, u1] of runs) {
                const px0 = Math.max(0, Math.min(size - 1, Math.floor(mapX(minX + u0 * engW))));
                const px1 = Math.max(px0, Math.min(size - 1, Math.ceil(mapX(minX + u1 * engW))));
                for (let px = px0; px <= px1; px++) {
                  bitmap[rowOffset + px] = 1;
                }
              }
            }
          } else {
            drawBresenhamLine(bitmap, size, mapX(minX), mapY(minY), mapX(maxX), mapY(minY));
            drawBresenhamLine(bitmap, size, mapX(maxX), mapY(minY), mapX(maxX), mapY(maxY));
            drawBresenhamLine(bitmap, size, mapX(maxX), mapY(maxY), mapX(minX), mapY(maxY));
            drawBresenhamLine(bitmap, size, mapX(minX), mapY(maxY), mapX(minX), mapY(minY));
          }
        }
      }

      for (const hole of inst.holeContours) {
        drawPolyline(hole.points, true, job.xMm, job.yMm);
      }
      if (inst.cutContour) {
        drawPolyline(inst.cutContour.points, true, job.xMm, job.yMm);
      }
    }
  }

  return bitmap;
}

/**
 * Construye los comandos `E7 11` (144x144) y `E7 12` (300x300) de previsualización LCD
 * para controladores Ruida RDC8445S / RDC6445G.
 */
export function buildRuidaThumbnailsCommands(params: {
  visibleJobs: WorkbenchJobItem[];
  boundsMm: { minX: number; minY: number; maxX: number; maxY: number };
  rasterMasks?: Map<string, RasterScanlineMask>;
  engraveIntervalMm: number;
  engraveDitherMode: LightBurnImageDitherMode;
}): number[][] {
  const bmp144 = rasterizeWorkbenchToSquareBitmap({ ...params, size: 144 });
  const bmp300 = rasterizeWorkbenchToSquareBitmap({ ...params, size: 300 });
  return [
    ...encodeRuidaThumbnailPackets(bmp144, 144),
    ...encodeRuidaThumbnailPackets(bmp300, 300),
  ];
}
