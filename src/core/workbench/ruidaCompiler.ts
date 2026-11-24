/**
 * Astra Studio — Compilador Binario Ruida (.RD) y Empaquetador UDP (RDC8445S / RDC644XG)
 * Convierte trayectorias validadas en comandos binarios nativos Ruida con codificación de 7 bits
 * en micrómetros, modulación de potencia de 14 bits y ofuscación estándar (magic 0x88).
 *
 * REGLA DE SEGURIDAD INDUSTRIAL:
 * Este compilador NUNCA inventa velocidades ni potencias. Si alguna capa activa carece de
 * velocidad (mm/s) o potencia (%) explícitamente ingresadas por el operador, o si existe
 * cualquier error geométrico en la mesa 900x600 mm, aborta la compilación.
 */

import { roundMm } from '../geometry/geometryEngine';
import { validateWorkbenchState } from './workbenchEngine';
import {
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
} from './workbenchTypes';

/**
 * Codifica una coordenada o velocidad absoluta en micrómetros (1 mm = 1000 µm)
 * en 5 bytes de 7 bits cada uno (35 bits con signo, Big-Endian).
 */
export function encodeRuidaAbsCoordMm(mm: number): number[] {
  let um = Math.round(mm * 1000);
  if (um < 0) {
    // Complemento a dos en 35 bits (2^35 = 34359738368)
    um = 0x800000000 + um;
  }
  const b0 = Math.floor(um / 0x10000000) & 0x7f;
  const b1 = (um >>> 21) & 0x7f;
  const b2 = (um >>> 14) & 0x7f;
  const b3 = (um >>> 7) & 0x7f;
  const b4 = um & 0x7f;
  return [b0, b1, b2, b3, b4];
}

/**
 * Decodifica 5 bytes de 7 bits de Ruida a milímetros.
 */
export function decodeRuidaAbsCoordMm(bytes: number[]): number {
  if (bytes.length < 5) throw new Error('Se requieren 5 bytes para coordenada absoluta Ruida.');
  let um =
    (bytes[0] & 0x7f) * 0x10000000 +
    ((bytes[1] & 0x7f) << 21) +
    ((bytes[2] & 0x7f) << 14) +
    ((bytes[3] & 0x7f) << 7) +
    (bytes[4] & 0x7f);
  if (um >= 0x400000000) {
    um -= 0x800000000;
  }
  return roundMm(um / 1000, 3);
}

/**
 * Codifica una velocidad en mm/s a µm/s en 5 bytes de 7 bits.
 */
export function encodeRuidaSpeedMmPerSec(speedMmPerSec: number): number[] {
  const safeSpeed = Math.max(0.1, Math.min(2000, speedMmPerSec));
  return encodeRuidaAbsCoordMm(safeSpeed);
}

/**
 * Codifica un porcentaje de potencia láser (0..100%) en 2 bytes de 7 bits (14 bits: 100% = 16383 = 0x3FFF).
 */
export function encodeRuidaPowerPercent(percent: number): number[] {
  const clamped = Math.max(0, Math.min(100, percent));
  const raw = Math.round(clamped * 163.83) & 0x3fff;
  return [(raw >>> 7) & 0x7f, raw & 0x7f];
}

/**
 * Decodifica 2 bytes de 7 bits de potencia Ruida a porcentaje (0..100%).
 */
export function decodeRuidaPowerPercent(bytes: number[]): number {
  const raw = ((bytes[0] & 0x7f) << 7) | (bytes[1] & 0x7f);
  return roundMm((raw / 16383) * 100, 2);
}

/**
 * Ofusca (scramble) un byte crudo de comando Ruida según el algoritmo estándar de controladoras RDC644X / RDC8445S:
 * 1. Intercambiar bit 0 y bit 7
 * 2. XOR con magic (0x88)
 * 3. Sumar 1 módulo 256
 */
export function scrambleRuidaByte(rawByte: number, magic = 0x88): number {
  const b = rawByte & 0xff;
  const swapped = (b & 0x7e) | ((b >>> 7) & 0x01) | ((b & 0x01) << 7);
  const xored = (swapped ^ magic) & 0xff;
  return (xored + 1) & 0xff;
}

/**
 * Desofusca (unscramble) un byte Ruida ofuscado para auditoría o verificación.
 */
export function unscrambleRuidaByte(scrambledByte: number, magic = 0x88): number {
  const b = (scrambledByte - 1 + 256) & 0xff;
  const xored = (b ^ magic) & 0xff;
  return (xored & 0x7e) | ((xored >>> 7) & 0x01) | ((xored & 0x01) << 7);
}

/**
 * Empaqueta un buffer Ruida ofuscado en datagramas UDP listos para el puerto 50200,
 * anteponiendo a cada paquete el checksum Big-Endian de 16 bits (suma de todos los bytes ofuscados del paquete).
 */
export function buildRuidaUdpPackets(
  scrambledBytes: Uint8Array,
  maxPayloadBytes = 1400
): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < scrambledBytes.length; offset += maxPayloadBytes) {
    const slice = scrambledBytes.subarray(
      offset,
      Math.min(scrambledBytes.length, offset + maxPayloadBytes)
    );
    let checksum = 0;
    for (let i = 0; i < slice.length; i++) {
      checksum = (checksum + slice[i]) & 0xffff;
    }
    const packet = new Uint8Array(slice.length + 2);
    packet[0] = (checksum >>> 8) & 0xff;
    packet[1] = checksum & 0xff;
    packet.set(slice, 2);
    packets.push(packet);
  }
  return packets;
}

export interface CompiledRuidaRdArtifact {
  /** Bytes ofuscados listos para guardar como archivo .rd (U-Disk USB o envío UDP) */
  rdBytes: Uint8Array;
  /** Bytes crudos sin ofuscar para inspección técnica y pruebas */
  rawUnscrambledBytes: Uint8Array;
  filenameSuggested: string;
  ruidaJobName: string;
  totalPieces: number;
  activeLayersCount: number;
  boundingBoxMm: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  commandCount: number;
}

/**
 * Compila la mesa de trabajo completa en un archivo binario Ruida (.rd) verificado.
 */
export function compileWorkbenchToRuidaRd(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): CompiledRuidaRdArtifact {
  const report = validateWorkbenchState(jobs, config);

  if (!report.isValidForExport) {
    const errMsg =
      report.issues.find((i) => i.severity === 'error')?.message ||
      'Geometría inválida en la mesa de trabajo.';
    throw new Error(`Compilación Ruida (.rd) bloqueada: ${errMsg}`);
  }

  if (!report.isValidForMachineSend || !report.occupiedBoundsMm) {
    const unconfMsg =
      report.issues.find((i) => i.code === 'LAYER_PARAMS_UNCONFIGURED')?.message ||
      'Todas las capas activas deben tener velocidad (mm/s) y potencia (%) validadas por el operador.';
    throw new Error(`Compilación Ruida (.rd) bloqueada por seguridad: ${unconfMsg}`);
  }

  const bounds = report.occupiedBoundsMm;
  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const sortedLayers = [...config.layers]
    .filter((l) => l.outputEnabled)
    .sort((a, b) => a.priority - b.priority);

  const raw: number[] = [];
  let commandCount = 0;

  const emit = (bytes: number[]) => {
    for (const b of bytes) raw.push(b & 0xff);
    commandCount++;
  };

  // 1. Cabecera de inicio de trabajo Ruida y caja envolvente global
  // D8 00: Start Job / Reset state
  emit([0xd8, 0x00]);
  // E7 01 + nombre del archivo en ASCII 7-bit (hasta 8 caracteres en mayúsculas)
  const cleanJobName =
    (config.ruidaJobName || 'ASTRA01')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 8) || 'ASTRA01';
  const nameBytes = Array.from(cleanJobName).map((ch) => ch.charCodeAt(0) & 0x7f);
  emit([0xe7, 0x01, ...nameBytes, 0x00]);

  // E7 03 (Top-Left Bound) y E7 07 (Bottom-Right Bound)
  emit([
    0xe7,
    0x03,
    ...encodeRuidaAbsCoordMm(bounds.minX),
    ...encodeRuidaAbsCoordMm(bounds.minY),
  ]);
  emit([
    0xe7,
    0x07,
    ...encodeRuidaAbsCoordMm(bounds.maxX),
    ...encodeRuidaAbsCoordMm(bounds.maxY),
  ]);

  // Asistencia de aire (Soplador general si alguna capa lo requiere)
  const anyAirAssist = sortedLayers.some((l) => l.airAssist);
  emit([0xca, 0x01, anyAirAssist ? 0x13 : 0x12]);

  // 2. Cabeceras de parámetros por capa activa
  for (const layer of sortedLayers) {
    const lIdx = layer.cutIndex & 0x7f;
    const speed = layer.speedMmPerSec!;
    const maxP = layer.maxPowerPercent!;
    const minP =
      layer.minPowerPercent !== null && layer.minPowerPercent >= 0
        ? Math.min(maxP, layer.minPowerPercent)
        : maxP;

    // C9 04 <layer> <speed 5B>: Layer Speed
    emit([0xc9, 0x04, lIdx, ...encodeRuidaSpeedMmPerSec(speed)]);
    // C6 31 <layer> <minPower 2B>: Layer Min Power Лазер 1
    emit([0xc6, 0x31, lIdx, ...encodeRuidaPowerPercent(minP)]);
    // C6 32 <layer> <maxPower 2B>: Layer Max Power Лазер 1
    emit([0xc6, 0x32, lIdx, ...encodeRuidaPowerPercent(maxP)]);
  }

  // 3. Emisión de trayectorias por orden de prioridad de capa
  const emitLayerPreamble = (layer: WorkbenchLayerConfig) => {
    const lIdx = layer.cutIndex & 0x7f;
    const speed = layer.speedMmPerSec!;
    const maxP = layer.maxPowerPercent!;
    const minP =
      layer.minPowerPercent !== null && layer.minPowerPercent >= 0
        ? Math.min(maxP, layer.minPowerPercent)
        : maxP;

    // CA 02 <layer>: Select active layer
    emit([0xca, 0x02, lIdx]);
    // CA 01: Air assist toggle por capa
    emit([0xca, 0x01, layer.airAssist ? 0x13 : 0x12]);
    // C9 02 <speed 5B>: Active cut speed
    emit([0xc9, 0x02, ...encodeRuidaSpeedMmPerSec(speed)]);
    // C6 01 <minP 2B> & C6 02 <maxP 2B>: Active power
    emit([0xc6, 0x01, ...encodeRuidaPowerPercent(minP)]);
    emit([0xc6, 0x02, ...encodeRuidaPowerPercent(maxP)]);
  };

  const emitMoveAbs = (xMm: number, yMm: number) => {
    // 88 <X 5B> <Y 5B>: Move Absolute (Rapid G0 Laser Off)
    emit([0x88, ...encodeRuidaAbsCoordMm(xMm), ...encodeRuidaAbsCoordMm(yMm)]);
  };

  const emitCutAbs = (xMm: number, yMm: number) => {
    // A8 <X 5B> <Y 5B>: Cut Absolute (G1 Laser On)
    emit([0xa8, ...encodeRuidaAbsCoordMm(xMm), ...encodeRuidaAbsCoordMm(yMm)]);
  };

  let activeLayersCount = 0;

  for (const layer of sortedLayers) {
    const passes = Math.max(1, layer.passes);
    let emittedInLayer = false;

    if (layer.role === 'ENGRAVE') {
      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          if (inst.engraveItems.length === 0) continue;
          if (!emittedInLayer) {
            emitLayerPreamble(layer);
            emittedInLayer = true;
            activeLayersCount++;
          }

          for (let pass = 0; pass < passes; pass++) {
            for (const eng of inst.engraveItems) {
              if (eng.kind === 'vector_path' && eng.polylines && eng.polylines.length > 0) {
                for (const poly of eng.polylines) {
                  if (poly.points.length < 2) continue;
                  const p0 = poly.points[0];
                  emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
                  for (let i = 1; i < poly.points.length; i++) {
                    const pt = poly.points[i];
                    emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
                  }
                  if (poly.closed && poly.points.length > 2) {
                    emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
                  }
                }
              } else {
                // Barrido raster dentro de la caja del elemento
                const bb = eng.boundingBox;
                const minX = roundMm(job.xMm + bb.minX);
                const maxX = roundMm(job.xMm + bb.maxX);
                const minY = roundMm(job.yMm + bb.minY);
                const maxY = roundMm(job.yMm + bb.maxY);
                const interval = Math.max(0.05, layer.lineIntervalMm || 0.1);
                const linesCount = Math.max(1, Math.min(400, Math.ceil((maxY - minY) / interval)));

                for (let row = 0; row <= linesCount; row++) {
                  const y = roundMm(minY + ((maxY - minY) * row) / Math.max(1, linesCount));
                  if (row % 2 === 0) {
                    emitMoveAbs(minX, y);
                    emitCutAbs(maxX, y);
                  } else {
                    emitMoveAbs(maxX, y);
                    emitCutAbs(minX, y);
                  }
                }
              }
            }
          }
        }
      }
    } else if (layer.role === 'HOLES') {
      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          for (const hole of inst.holeContours) {
            if (hole.points.length < 2) continue;
            if (!emittedInLayer) {
              emitLayerPreamble(layer);
              emittedInLayer = true;
              activeLayersCount++;
            }
            for (let pass = 0; pass < passes; pass++) {
              const p0 = hole.points[0];
              emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
              for (let i = 1; i < hole.points.length; i++) {
                const pt = hole.points[i];
                emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
              }
              emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
            }
          }
        }
      }
    } else if (layer.role === 'CUT') {
      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          const contour = inst.cutContour;
          if (!contour || contour.points.length < 2) continue;
          if (!emittedInLayer) {
            emitLayerPreamble(layer);
            emittedInLayer = true;
            activeLayersCount++;
          }
          for (let pass = 0; pass < passes; pass++) {
            const p0 = contour.points[0];
            emitMoveAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
            for (let i = 1; i < contour.points.length; i++) {
              const pt = contour.points[i];
              emitCutAbs(roundMm(job.xMm + pt.x), roundMm(job.yMm + pt.y));
            }
            emitCutAbs(roundMm(job.xMm + p0.x), roundMm(job.yMm + p0.y));
          }
        }
      }
    }
  }

  // Retornar cabezal al origen del trabajo y cerrar trama Ruida (D7 = EOF)
  const origin = report.jobOriginPointMm;
  emitMoveAbs(origin.x, origin.y);
  emit([0xd7]);

  const rawUnscrambledBytes = new Uint8Array(raw);
  const rdBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    rdBytes[i] = scrambleRuidaByte(raw[i]);
  }

  return {
    rdBytes,
    rawUnscrambledBytes,
    filenameSuggested: `${cleanJobName}_Vank9060.rd`,
    ruidaJobName: cleanJobName,
    totalPieces: report.totalPieces,
    activeLayersCount,
    boundingBoxMm: bounds,
    commandCount,
  };
}
