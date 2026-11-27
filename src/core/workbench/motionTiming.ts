/**
 * Astra Studio — Planificador Cinemático de Precisión y Calibración Automática Vank 9060 (Ruida RDC8445S)
 * Reproduce la física trapezoidal de aceleración/desaceleración, velocidad de esquina, sobreescaneo (overscan),
 * pasadas, modo unidireccional/bidireccional, agrupación (all_at_once / per_piece) e intervalo real
 * para que el cronómetro y la simulación coincidan 1:1 con la máquina física.
 */

import { Point2D } from '../types';
import { RasterScanlineMask } from './rasterScanlines';
import { RuidaMotionParamsResponse } from './ruidaTransportClient';

export interface MotionPlannerCalibration {
  idleSpeedMmPerSec: number;
  idleAccelMmPerSec2: number;
  cutAccelMmPerSec2: number;
  scanAccelMmPerSec2: number;
  cornerJumpSpeedMmPerSec: number;
  speedFactor: number;
  /** Ajuste fino auto-aprendido de corridas reales completas en Vank 9060 (rango seguro [0.65..1.55]). */
  empiricalTimeMultiplier: number;
  source: 'controller' | 'empirical' | 'default';
  updatedAtMs: number;
}

export const DEFAULT_RUIDA_MOTION_CALIBRATION: MotionPlannerCalibration = {
  idleSpeedMmPerSec: 400,
  idleAccelMmPerSec2: 3000,
  cutAccelMmPerSec2: 2500,
  scanAccelMmPerSec2: 3000,
  cornerJumpSpeedMmPerSec: 18,
  speedFactor: 1.0,
  empiricalTimeMultiplier: 1.0,
  source: 'default',
  updatedAtMs: 0,
};

const CALIBRATION_STORAGE_KEY = 'astra_vank9060_motion_calibration_v1';
const FILE_ESTIMATES_STORAGE_KEY = 'astra_vank9060_file_estimates_v1';

export interface RememberedRuidaFileEstimate {
  fileName: string;
  totalPieces: number;
  estimatedTotalSec: number;
  updatedAtMs: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function loadStoredMotionCalibration(): MotionPlannerCalibration {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_RUIDA_MOTION_CALIBRATION };
  }
  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RUIDA_MOTION_CALIBRATION };
    const parsed = JSON.parse(raw) as Partial<MotionPlannerCalibration>;
    return {
      ...DEFAULT_RUIDA_MOTION_CALIBRATION,
      ...parsed,
      idleSpeedMmPerSec: clamp(parsed.idleSpeedMmPerSec ?? 400, 40, 1000),
      idleAccelMmPerSec2: clamp(parsed.idleAccelMmPerSec2 ?? 3000, 200, 20000),
      cutAccelMmPerSec2: clamp(parsed.cutAccelMmPerSec2 ?? 2500, 150, 15000),
      scanAccelMmPerSec2: clamp(parsed.scanAccelMmPerSec2 ?? 3000, 400, 25000),
      cornerJumpSpeedMmPerSec: clamp(parsed.cornerJumpSpeedMmPerSec ?? 18, 5, 80),
      speedFactor: clamp(parsed.speedFactor ?? 1.0, 0.25, 2.0),
      empiricalTimeMultiplier: clamp(parsed.empiricalTimeMultiplier ?? 1.0, 0.65, 1.55),
    };
  } catch {
    return { ...DEFAULT_RUIDA_MOTION_CALIBRATION };
  }
}

export function saveStoredMotionCalibration(cal: MotionPlannerCalibration): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(cal));
  } catch {
    // Ignorar cuota de almacenamiento
  }
}

/**
 * Fusiona los registros leídos directamente desde la controladora Vank 9060
 * (`ReadSimulationValues`: 0x05, 0x25/0x35, 0x202, 0x21A, 0x225/0x235) con la calibración local.
 */
export function mergeControllerMotionParams(
  current: MotionPlannerCalibration,
  hw: RuidaMotionParamsResponse,
  nowMs = Date.now()
): MotionPlannerCalibration {
  if (!hw.calibrated) return current;

  const cutAccelCandidates = [hw.cut_accel_x_mm_s2, hw.cut_accel_y_mm_s2].filter(
    (v): v is number => v !== null && Number.isFinite(v) && v >= 100
  );
  const scanAccelCandidates = [hw.scan_accel_x_mm_s2, hw.scan_accel_y_mm_s2].filter(
    (v): v is number => v !== null && Number.isFinite(v) && v >= 200
  );

  const next: MotionPlannerCalibration = {
    ...current,
    idleSpeedMmPerSec:
      hw.idle_speed_mm_s && hw.idle_speed_mm_s >= 20
        ? clamp(hw.idle_speed_mm_s, 40, 1000)
        : current.idleSpeedMmPerSec,
    idleAccelMmPerSec2:
      hw.idle_accel_mm_s2 && hw.idle_accel_mm_s2 >= 100
        ? clamp(hw.idle_accel_mm_s2, 200, 20000)
        : current.idleAccelMmPerSec2,
    cutAccelMmPerSec2:
      cutAccelCandidates.length > 0
        ? clamp(Math.min(...cutAccelCandidates), 150, 15000)
        : current.cutAccelMmPerSec2,
    scanAccelMmPerSec2:
      scanAccelCandidates.length > 0
        ? clamp(Math.min(...scanAccelCandidates), 400, 25000)
        : current.scanAccelMmPerSec2,
    speedFactor:
      hw.speed_factor && hw.speed_factor >= 0.25 && hw.speed_factor <= 2.0
        ? hw.speed_factor
        : current.speedFactor,
    source: 'controller',
    updatedAtMs: nowMs,
  };
  saveStoredMotionCalibration(next);
  return next;
}

/**
 * Auto-ajuste empírico suave tras una ejecución real completa sin pausa manual:
 * acerca progresivamente el multiplicador al tiempo físico observado en la Vank 9060.
 */
export function learnEmpiricalDurationRatio(
  current: MotionPlannerCalibration,
  observedActualSec: number,
  predictedSec: number,
  nowMs = Date.now()
): MotionPlannerCalibration {
  if (observedActualSec < 8 || predictedSec < 8) return current;
  const rawRatio = observedActualSec / predictedSec;
  if (rawRatio < 0.4 || rawRatio > 2.5) {
    // Descartar lecturas anómalas (ej. si el operador detuvo el trabajo a la mitad con Stop)
    return current;
  }
  const adjustedTarget = clamp(current.empiricalTimeMultiplier * rawRatio, 0.65, 1.55);
  const nextMult = clamp(
    current.empiricalTimeMultiplier * 0.65 + adjustedTarget * 0.35,
    0.65,
    1.55
  );
  const next: MotionPlannerCalibration = {
    ...current,
    empiricalTimeMultiplier: Number(nextMult.toFixed(4)),
    source: current.source === 'controller' ? 'controller' : 'empirical',
    updatedAtMs: nowMs,
  };
  saveStoredMotionCalibration(next);
  return next;
}

export function loadRememberedFileEstimates(): Record<string, RememberedRuidaFileEstimate> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(FILE_ESTIMATES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RememberedRuidaFileEstimate>) : {};
  } catch {
    return {};
  }
}

export function rememberRuidaFileEstimate(entry: RememberedRuidaFileEstimate): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = entry.fileName.trim().toUpperCase();
  if (!key || entry.estimatedTotalSec <= 0) return;
  try {
    const map = loadRememberedFileEstimates();
    map[key] = { ...entry, fileName: key };
    window.localStorage.setItem(FILE_ESTIMATES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignorar error de cuota
  }
}

/**
 * Tiempo exacto de movimiento trapezoidal / triangular (física `MotionPlanner::ComputeBlockTime`):
 * cubre distancia `d` con velocidad inicial `vStart`, crucero `vCruise`, final `vEnd` y aceleración `accel`.
 */
export function computeTrapezoidMoveTimeSec(
  distanceMm: number,
  vCruiseMmS: number,
  vStartMmS: number,
  vEndMmS: number,
  accelMmS2: number
): number {
  const d = Math.max(0, distanceMm);
  if (d < 1e-5) return 0;
  const a = Math.max(50, accelMmS2);
  const vc = Math.max(1, vCruiseMmS);
  const vs = clamp(vStartMmS, 0, vc);
  const ve = clamp(vEndMmS, 0, vc);

  const accelDist = Math.max(0, (vc * vc - vs * vs) / (2 * a));
  const decelDist = Math.max(0, (vc * vc - ve * ve) / (2 * a));

  if (accelDist + decelDist <= d) {
    const tAccel = (vc - vs) / a;
    const tDecel = (vc - ve) / a;
    const tCruise = (d - accelDist - decelDist) / vc;
    return tAccel + tCruise + tDecel;
  }

  // Perfil triangular cuando el tramo es demasiado corto para alcanzar vCruise
  const vPeak = Math.sqrt(Math.max(0, a * d + 0.5 * (vs * vs + ve * ve)));
  return Math.max(0, (vPeak - vs) / a + (vPeak - ve) / a);
}

/**
 * Calcula tiempo exacto de corte/grabado lineal de una polilínea con desaceleración por ángulo de esquina.
 */
export function computePolylineCutDurationSec(
  points: Point2D[],
  closed: boolean,
  speedMmPerSec: number,
  passes: number,
  motion: MotionPlannerCalibration = DEFAULT_RUIDA_MOTION_CALIBRATION
): number {
  if (points.length < 2) return 0;
  const effectiveSpeed = Math.max(1, speedMmPerSec / Math.max(0.25, motion.speedFactor));
  const a = Math.max(100, motion.cutAccelMmPerSec2);
  const segCount = closed ? points.length : points.length - 1;
  if (segCount <= 0) return 0;

  const segLens: number[] = [];
  const segDirs: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < segCount; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-4) {
      segLens.push(len);
      segDirs.push({ dx: dx / len, dy: dy / len });
    }
  }
  if (segLens.length === 0) return 0;

  // Velocidades en cada vértice según ángulo de giro
  const n = segLens.length;
  const cornerSpeeds: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    const d0 = segDirs[i - 1];
    const d1 = segDirs[i];
    const dot = clamp(d0.dx * d1.dx + d0.dy * d1.dy, -1, 1);
    if (dot > 0.992) {
      cornerSpeeds[i] = effectiveSpeed;
    } else if (dot <= 0) {
      cornerSpeeds[i] = Math.min(effectiveSpeed, motion.cornerJumpSpeedMmPerSec);
    } else {
      const factor = Math.pow(dot, 2);
      cornerSpeeds[i] = Math.min(
        effectiveSpeed,
        motion.cornerJumpSpeedMmPerSec + (effectiveSpeed - motion.cornerJumpSpeedMmPerSec) * factor
      );
    }
  }
  if (closed && n >= 2) {
    const d0 = segDirs[n - 1];
    const d1 = segDirs[0];
    const dot = clamp(d0.dx * d1.dx + d0.dy * d1.dy, -1, 1);
    const vWrap =
      dot > 0.992
        ? effectiveSpeed
        : Math.min(
            effectiveSpeed,
            motion.cornerJumpSpeedMmPerSec +
              (effectiveSpeed - motion.cornerJumpSpeedMmPerSec) * Math.pow(Math.max(0, dot), 2)
          );
    cornerSpeeds[0] = vWrap;
    cornerSpeeds[n] = vWrap;
  }

  let onePassSec = 0.015; // Pequeño dwell de encendido/apagado por contorno Ruida
  for (let i = 0; i < n; i++) {
    onePassSec += computeTrapezoidMoveTimeSec(
      segLens[i],
      effectiveSpeed,
      cornerSpeeds[i],
      cornerSpeeds[i + 1],
      a
    );
  }
  return onePassSec * Math.max(1, passes);
}

/**
 * Calcula tiempo exacto de escaneo ráster (`Scan`) incluyendo:
 *   - Distancia de aceleración + sobreescaneo (overscan = v^2 / a_scan) por cada pasada horizontal
 *   - Pasadas reales por intervalo `max(0.025, lineIntervalMm || 0.08)`
 *   - Doble retorno rápido si `bidirectional === false`
 *   - Ancho activo real por fila cuando está disponible la máscara de píxeles
 */
export function computeRasterBandScanDurationSec(
  params: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    speedMmPerSec: number;
    lineIntervalMm: number;
    bidirectional: boolean;
    passes: number;
    activeRowWidthsMm?: number[];
  },
  motion: MotionPlannerCalibration = DEFAULT_RUIDA_MOTION_CALIBRATION
): { durationSec: number; totalScanDistanceMm: number; scanLinesCount: number } {
  const vScan = Math.max(5, params.speedMmPerSec / Math.max(0.25, motion.speedFactor));
  const aScan = Math.max(200, motion.scanAccelMmPerSec2);
  const effInterval = Math.max(0.025, params.lineIntervalMm || 0.08);
  const passes = Math.max(1, params.passes);

  const bboxWidth = Math.max(0.5, params.maxX - params.minX);
  const scanHeight = Math.max(0.3, params.maxY - params.minY);
  const realScanLines = Math.max(1, Math.ceil(scanHeight / effInterval));

  // Ruida agrega overscan de rampa en cada extremo del barrido (v^2 / (2 * aScan) por lado)
  const overscanTotalMm = (vScan * vScan) / aScan;
  const yStepTimeSec = computeTrapezoidMoveTimeSec(
    effInterval,
    120,
    0,
    0,
    motion.cutAccelMmPerSec2
  );

  let onePassSec = 0;
  let onePassDistMm = 0;

  if (params.activeRowWidthsMm && params.activeRowWidthsMm.length > 0) {
    const sampleCount = params.activeRowWidthsMm.length;
    const scaleLines = realScanLines / sampleCount;
    let sumTime = 0;
    let sumDist = 0;
    for (let i = 0; i < sampleCount; i++) {
      const w = Math.max(0.2, params.activeRowWidthsMm[i]);
      const lineDistWithOverscan = w + overscanTotalMm;
      let tLine =
        computeTrapezoidMoveTimeSec(lineDistWithOverscan, vScan, 0, 0, aScan) + yStepTimeSec;
      if (!params.bidirectional) {
        tLine += computeTrapezoidMoveTimeSec(
          lineDistWithOverscan,
          motion.idleSpeedMmPerSec,
          0,
          0,
          motion.idleAccelMmPerSec2
        );
      }
      sumTime += tLine;
      sumDist += w;
    }
    onePassSec = sumTime * scaleLines;
    onePassDistMm = sumDist * scaleLines;
  } else {
    const lineDistWithOverscan = bboxWidth + overscanTotalMm;
    let tSingleLine =
      computeTrapezoidMoveTimeSec(lineDistWithOverscan, vScan, 0, 0, aScan) + yStepTimeSec;
    if (!params.bidirectional) {
      tSingleLine += computeTrapezoidMoveTimeSec(
        lineDistWithOverscan,
        motion.idleSpeedMmPerSec,
        0,
        0,
        motion.idleAccelMmPerSec2
      );
    }
    onePassSec = tSingleLine * realScanLines;
    onePassDistMm = bboxWidth * realScanLines;
  }

  return {
    durationSec: Math.max(0.05, onePassSec * passes),
    totalScanDistanceMm: onePassDistMm * passes,
    scanLinesCount: realScanLines * passes,
  };
}

/** Calcula los anchos por fila (maxX - minX activos) de una máscara raster ya decodificada. */
export function extractActiveRowWidthsMmFromMask(
  mask: RasterScanlineMask,
  spanXMm: number
): number[] {
  const widths: number[] = [];
  for (const row of mask.rowRuns) {
    if (!row || row.length === 0) continue;
    const uMin = row[0][0];
    const uMax = row[row.length - 1][1];
    widths.push(Math.max(0.2, (uMax - uMin) * spanXMm));
  }
  return widths;
}
