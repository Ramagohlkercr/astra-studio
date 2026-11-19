import { Millimeters } from '../types';
import { roundMm } from '../geometry/geometryEngine';

export type RotaryAccessoryType = 'roller' | 'chuck';
export type RotaryDirection = 'normal' | 'inverted';

export interface RotaryAccessoryProfile {
  id: string;
  name: string;
  type: RotaryAccessoryType;
  /** Diámetro del rodillo motriz (mm). Obligatorio para rodillos; no aplica para mandril */
  rollerDiameterMm?: Millimeters;
  /**
   * Pasos por vuelta del motor/driver (steps per rotation).
   * ATENCIÓN: Los valores predeterminados (ej. 3200) son ilustrativos;
   * nunca deben considerarse calibrados hasta realizar la prueba física.
   */
  stepsPerRotation: number;
  /** Sentido de giro configurado (orientación de montaje en la ficha técnica) */
  rotationDirection: RotaryDirection;
  /** Indica si los pasos por vuelta han sido verificados y calibrados físicamente */
  isCalibrated?: boolean;
  /** Fecha ISO de la última calibración física aplicada */
  calibratedAtIso?: string;
  /** Método utilizado en la última calibración */
  calibrationMethod?: RotaryCalibrationMethod;
  /** Valor anterior de pasos por vuelta antes de la última calibración (permite deshacer/recuperar) */
  previousStepsPerRotation?: number;
  /** Perfil integrado de taller o creado por el operador */
  isBuiltIn?: boolean;
  notes?: string;
}

export const STORAGE_KEY_ROTARY_PROFILES = 'ASTRA_ROTARY_ACCESSORY_PROFILES';
export const STORAGE_KEY_CALIBRATION_LOG = 'ASTRA_ROTARY_CALIBRATION_LOG';

export const DEFAULT_ROTARY_ACCESSORY_PROFILES: RotaryAccessoryProfile[] = [
  {
    id: 'vank-sanou-chuck',
    name: 'Mandril Sanou 3 Mordazas (Vank 9060 / Eje Y)',
    type: 'chuck',
    stepsPerRotation: 3200,
    rotationDirection: 'normal',
    isCalibrated: false,
    isBuiltIn: true,
    notes: 'Mandril Sanou conectado al eje Y de la Vank 9060 (Ruida RDC8445S). Los 3200 pasos son ilustrativos; requiere calibración física real con giro 360° o patrón métrico.',
  },
  {
    id: 'vank-roller-standard',
    name: 'Rotativo de Rodillos Vank 9060',
    type: 'roller',
    rollerDiameterMm: 50.0,
    stepsPerRotation: 3200,
    rotationDirection: 'normal',
    isCalibrated: false,
    isBuiltIn: true,
    notes: 'Accesorio de rodillos dobles. Los 3200 pasos y el diámetro de 50 mm son ilustrativos; deben medirse y calibrarse en el banco de trabajo.',
  },
  {
    id: 'vank-chuck-standard',
    name: 'Mandril 3 Mordazas (Chuck Estándar)',
    type: 'chuck',
    stepsPerRotation: 3200,
    rotationDirection: 'normal',
    isCalibrated: false,
    isBuiltIn: true,
    notes: 'Plato autocentrante estándar para copas, mates y formas cónicas. Pasos ilustrativos no verificados.',
  },
];

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): MinimalStorage | undefined {
  return (globalThis as { localStorage?: MinimalStorage }).localStorage;
}

export function loadRotaryAccessoryProfiles(): RotaryAccessoryProfile[] {
  const storage = getStorage();
  if (!storage) {
    return structuredClone(DEFAULT_ROTARY_ACCESSORY_PROFILES);
  }
  try {
    const raw = storage.getItem(STORAGE_KEY_ROTARY_PROFILES);
    if (!raw) return structuredClone(DEFAULT_ROTARY_ACCESSORY_PROFILES);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return structuredClone(DEFAULT_ROTARY_ACCESSORY_PROFILES);
    }
    const sanitized = parsed.map(sanitizeAccessoryProfile).filter((p): p is RotaryAccessoryProfile => p !== null);
    if (sanitized.length === 0) return structuredClone(DEFAULT_ROTARY_ACCESSORY_PROFILES);

    // Asegurar que perfiles predeterminados clave (Sanou chuck) estén presentes
    for (const def of DEFAULT_ROTARY_ACCESSORY_PROFILES) {
      if (!sanitized.some((p) => p.id === def.id)) {
        sanitized.push(structuredClone(def));
      }
    }
    return sanitized;
  } catch {
    return structuredClone(DEFAULT_ROTARY_ACCESSORY_PROFILES);
  }
}

export function saveRotaryAccessoryProfiles(profiles: RotaryAccessoryProfile[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_ROTARY_PROFILES, JSON.stringify(profiles));
  } catch (err) {
    console.error('Error al guardar perfiles de accesorios rotativos:', err);
  }
}

export function saveRotaryAccessoryProfile(profile: RotaryAccessoryProfile): RotaryAccessoryProfile[] {
  const current = loadRotaryAccessoryProfiles();
  const existingIdx = current.findIndex((p) => p.id === profile.id);
  let updated: RotaryAccessoryProfile[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = { ...profile, isBuiltIn: current[existingIdx].isBuiltIn && profile.isBuiltIn };
  } else {
    updated = [...current, profile];
  }
  saveRotaryAccessoryProfiles(updated);
  return updated;
}

export function deleteRotaryAccessoryProfile(id: string): RotaryAccessoryProfile[] {
  const current = loadRotaryAccessoryProfiles();
  const updated = current.filter((p) => p.id !== id || p.isBuiltIn);
  saveRotaryAccessoryProfiles(updated);
  return updated;
}

/**
 * Aplica una calibración al perfil persistente, guardando el valor anterior para permitir deshacer.
 */
export function applyCalibrationToProfile(
  profileId: string,
  computedSteps: number,
  method: RotaryCalibrationMethod
): { updatedProfiles: RotaryAccessoryProfile[]; updatedProfile: RotaryAccessoryProfile | null } {
  const current = loadRotaryAccessoryProfiles();
  const idx = current.findIndex((p) => p.id === profileId);
  if (idx < 0) {
    return { updatedProfiles: current, updatedProfile: null };
  }

  const existing = current[idx];
  const updatedProfile: RotaryAccessoryProfile = {
    ...existing,
    previousStepsPerRotation: existing.stepsPerRotation,
    stepsPerRotation: roundMm(computedSteps, 3),
    isCalibrated: true,
    calibratedAtIso: new Date().toISOString(),
    calibrationMethod: method,
  };

  const updatedProfiles = [...current];
  updatedProfiles[idx] = updatedProfile;
  saveRotaryAccessoryProfiles(updatedProfiles);
  return { updatedProfiles, updatedProfile };
}

/**
 * Revierte la calibración de un perfil al valor anterior de pasos por vuelta si existe.
 */
export function revertCalibrationOnProfile(
  profileId: string
): { updatedProfiles: RotaryAccessoryProfile[]; revertedProfile: RotaryAccessoryProfile | null } {
  const current = loadRotaryAccessoryProfiles();
  const idx = current.findIndex((p) => p.id === profileId);
  if (idx < 0) {
    return { updatedProfiles: current, revertedProfile: null };
  }

  const existing = current[idx];
  if (existing.previousStepsPerRotation === undefined) {
    return { updatedProfiles: current, revertedProfile: existing };
  }

  const revertedProfile: RotaryAccessoryProfile = {
    ...existing,
    stepsPerRotation: existing.previousStepsPerRotation,
    previousStepsPerRotation: undefined,
    isCalibrated: false,
    calibratedAtIso: undefined,
    calibrationMethod: undefined,
  };

  const updatedProfiles = [...current];
  updatedProfiles[idx] = revertedProfile;
  saveRotaryAccessoryProfiles(updatedProfiles);
  return { updatedProfiles, revertedProfile };
}

export function sanitizeAccessoryProfile(raw: unknown): RotaryAccessoryProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<RotaryAccessoryProfile>;
  if (!p.id || typeof p.id !== 'string') return null;
  if (!p.name || typeof p.name !== 'string') return null;
  const type: RotaryAccessoryType = p.type === 'chuck' ? 'chuck' : 'roller';
  const steps = Number(p.stepsPerRotation);
  if (!Number.isFinite(steps) || steps <= 0) return null;
  const rollerD = p.rollerDiameterMm !== undefined ? Number(p.rollerDiameterMm) : undefined;
  const prevSteps = p.previousStepsPerRotation !== undefined && Number.isFinite(Number(p.previousStepsPerRotation))
    ? roundMm(Number(p.previousStepsPerRotation), 3)
    : undefined;

  return {
    id: p.id,
    name: p.name,
    type,
    rollerDiameterMm: type === 'roller' ? roundMm(rollerD ?? 50.0, 2) : undefined,
    stepsPerRotation: roundMm(steps, 3),
    rotationDirection: p.rotationDirection === 'inverted' ? 'inverted' : 'normal',
    isCalibrated: Boolean(p.isCalibrated),
    calibratedAtIso: typeof p.calibratedAtIso === 'string' ? p.calibratedAtIso : undefined,
    calibrationMethod: p.calibrationMethod === 'linear_caliper' || p.calibrationMethod === 'angular_360'
      ? p.calibrationMethod
      : undefined,
    previousStepsPerRotation: prevSteps,
    isBuiltIn: Boolean(p.isBuiltIn),
    notes: typeof p.notes === 'string' ? p.notes : '',
  };
}

// ============================================================================
// ASISTENTE DE CALIBRACIÓN: ARCO SUPERFICIAL VS. CUERDA RECTA CON CALIBRE
// ============================================================================

export type RotaryCalibrationMethod = 'angular_360' | 'linear_caliper';
export type LinearMeasurementMode = 'surface_arc' | 'caliper_chord';

export interface RotaryCalibrationRecord {
  id: string;
  timestampIso: string;
  accessoryId?: string;
  accessoryName?: string;
  method: RotaryCalibrationMethod;
  initialSteps: number;
  expectedValue: number; // 360 grados o mm teóricos de arco
  measuredValue: number; // grados medidos o mm medidos (cuerda o arco)
  computedSteps: number;
  linearMode?: LinearMeasurementMode;
  effectiveRealArcMm?: number;
  operatorNotes?: string;
}

export interface LinearCalibrationParams {
  currentSteps: number;
  expectedArcMm: number;
  measuredValueMm: number;
  mode: LinearMeasurementMode;
  /** Diámetro del objeto (mm). Requerido estrictamente para mode === 'caliper_chord' */
  objectDiameterMm?: number;
}

export interface LinearCalibrationResult {
  valid: boolean;
  error?: string;
  expectedArcMm: number;
  measuredValueMm: number;
  mode: LinearMeasurementMode;
  /** Longitud de arco real resultante sobre la superficie del cilindro (mm) */
  effectiveRealArcMm: number;
  ratio: number;
  computedSteps: number;
}

/**
 * Calcula con rigor geométrico la calibración lineal.
 *
 * Modo 'surface_arc': Medición con cinta flexible o papel milimetrado.
 *   El valor medido es directamente la longitud de arco sobre la superficie: s_real = medida.
 *
 * Modo 'caliper_chord': Medición con calibre rígido (pie de rey).
 *   Las puntas del calibre miden la cuerda recta (c) a través del espacio 3D, no la curva del cilindro.
 *   Fórmula geométrica exacta:
 *     c = D * sin(s / D)  =>  s_real = D * arcsin(c / D)
 *   Donde D es el diámetro del objeto y arcsin está en radianes.
 *   Si c >= D, la medición es físicamente imposible para ese diámetro.
 */
export function computeDetailedLinearCalibration(params: LinearCalibrationParams): LinearCalibrationResult {
  const { currentSteps, expectedArcMm, measuredValueMm, mode, objectDiameterMm } = params;

  if (
    !Number.isFinite(currentSteps) ||
    !Number.isFinite(expectedArcMm) ||
    !Number.isFinite(measuredValueMm) ||
    currentSteps <= 0 ||
    expectedArcMm <= 0 ||
    measuredValueMm <= 0
  ) {
    return {
      valid: false,
      error: 'Valores numéricos inválidos o menores o iguales a cero.',
      expectedArcMm: expectedArcMm || 0,
      measuredValueMm: measuredValueMm || 0,
      mode,
      effectiveRealArcMm: 0,
      ratio: 1,
      computedSteps: currentSteps || 0,
    };
  }

  let effectiveRealArcMm: number;

  if (mode === 'surface_arc') {
    effectiveRealArcMm = measuredValueMm;
  } else {
    // Modo calibre rígido (cuerda)
    if (!objectDiameterMm || !Number.isFinite(objectDiameterMm) || objectDiameterMm <= 0) {
      return {
        valid: false,
        error: 'Para medir con calibre rígido se requiere especificar un diámetro de objeto válido mayor a cero.',
        expectedArcMm,
        measuredValueMm,
        mode,
        effectiveRealArcMm: 0,
        ratio: 1,
        computedSteps: currentSteps,
      };
    }

    if (measuredValueMm >= objectDiameterMm) {
      return {
        valid: false,
        error: `La distancia recta medida con calibre (${measuredValueMm} mm) no puede ser igual o mayor al diámetro del objeto (${objectDiameterMm} mm).`,
        expectedArcMm,
        measuredValueMm,
        mode,
        effectiveRealArcMm: 0,
        ratio: 1,
        computedSteps: currentSteps,
      };
    }

    // s_real = D * arcsin(c / D)
    const sinHalf = measuredValueMm / objectDiameterMm;
    const arcRad = Math.asin(sinHalf);
    effectiveRealArcMm = roundMm(objectDiameterMm * arcRad, 4);
  }

  if (effectiveRealArcMm <= 0) {
    return {
      valid: false,
      error: 'La longitud de arco calculada es inválida.',
      expectedArcMm,
      measuredValueMm,
      mode,
      effectiveRealArcMm: 0,
      ratio: 1,
      computedSteps: currentSteps,
    };
  }

  const ratio = expectedArcMm / effectiveRealArcMm;

  // Descartar lecturas absurdas (más del triple o menos de un tercio)
  if (ratio < 0.2 || ratio > 5.0) {
    return {
      valid: false,
      error: `La diferencia entre el arco esperado (${expectedArcMm} mm) y el real (${roundMm(effectiveRealArcMm, 2)} mm) supera los límites razonables de calibración (ratio ${roundMm(ratio, 2)}).`,
      expectedArcMm,
      measuredValueMm,
      mode,
      effectiveRealArcMm,
      ratio,
      computedSteps: currentSteps,
    };
  }

  const computedSteps = roundMm(currentSteps * ratio, 3);

  return {
    valid: true,
    expectedArcMm,
    measuredValueMm,
    mode,
    effectiveRealArcMm,
    ratio,
    computedSteps,
  };
}

/**
 * Función simplificada compatible hacia atrás con llamadas anteriores.
 */
export function computeLinearCalibratedSteps(
  currentSteps: number,
  expectedMm: number,
  measuredMm: number,
  mode: LinearMeasurementMode = 'surface_arc',
  objectDiameterMm?: number
): number | null {
  const result = computeDetailedLinearCalibration({
    currentSteps,
    expectedArcMm: expectedMm,
    measuredValueMm: measuredMm,
    mode,
    objectDiameterMm,
  });
  return result.valid ? result.computedSteps : null;
}

export function loadRotaryCalibrationHistory(): RotaryCalibrationRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY_CALIBRATION_LOG);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRotaryCalibrationRecord(record: Omit<RotaryCalibrationRecord, 'id' | 'timestampIso'>): RotaryCalibrationRecord {
  const newRecord: RotaryCalibrationRecord = {
    ...record,
    id: `calib-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestampIso: new Date().toISOString(),
  };
  const storage = getStorage();
  if (storage) {
    try {
      const history = loadRotaryCalibrationHistory();
      const updated = [newRecord, ...history].slice(0, 50); // Mantener últimas 50 calibraciones
      storage.setItem(STORAGE_KEY_CALIBRATION_LOG, JSON.stringify(updated));
    } catch (err) {
      console.error('Error al guardar registro de calibración:', err);
    }
  }
  return newRecord;
}

export function clearRotaryCalibrationHistory(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY_CALIBRATION_LOG);
  } catch (err) {
    console.error('Error al limpiar historial de calibración:', err);
  }
}
