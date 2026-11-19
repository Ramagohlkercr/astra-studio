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
  /** Pasos por vuelta del motor/driver (steps per rotation) */
  stepsPerRotation: number;
  /** Sentido de giro: normal (+Y avanza sentido horario) o invertido */
  rotationDirection: RotaryDirection;
  /** Perfil integrado de taller o creado por el operador */
  isBuiltIn?: boolean;
  notes?: string;
}

export const STORAGE_KEY_ROTARY_PROFILES = 'ASTRA_ROTARY_ACCESSORY_PROFILES';
export const STORAGE_KEY_CALIBRATION_LOG = 'ASTRA_ROTARY_CALIBRATION_LOG';

export const DEFAULT_ROTARY_ACCESSORY_PROFILES: RotaryAccessoryProfile[] = [
  {
    id: 'vank-roller-standard',
    name: 'Rotativo de Rodillos Vank 9060',
    type: 'roller',
    rollerDiameterMm: 50.0,
    stepsPerRotation: 3200,
    rotationDirection: 'normal',
    isBuiltIn: true,
    notes: 'Accesorio de rodillos dobles con tracción de goma para botellas, vasos rectos y termos.',
  },
  {
    id: 'vank-chuck-standard',
    name: 'Mandril 3 Mordazas (Chuck)',
    type: 'chuck',
    stepsPerRotation: 3200,
    rotationDirection: 'normal',
    isBuiltIn: true,
    notes: 'Plato autocentrante para copas, mates y formas cónicas.',
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
    return parsed.map(sanitizeAccessoryProfile).filter((p): p is RotaryAccessoryProfile => p !== null);
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

export function sanitizeAccessoryProfile(raw: unknown): RotaryAccessoryProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<RotaryAccessoryProfile>;
  if (!p.id || typeof p.id !== 'string') return null;
  if (!p.name || typeof p.name !== 'string') return null;
  const type: RotaryAccessoryType = p.type === 'chuck' ? 'chuck' : 'roller';
  const steps = Number(p.stepsPerRotation);
  if (!Number.isFinite(steps) || steps <= 0) return null;
  const rollerD = p.rollerDiameterMm !== undefined ? Number(p.rollerDiameterMm) : undefined;
  if (type === 'roller' && (rollerD === undefined || !Number.isFinite(rollerD) || rollerD <= 0)) {
    // Si es roller y no tiene diámetro válido, corregir a valor por defecto
    return {
      id: p.id,
      name: p.name,
      type: 'roller',
      rollerDiameterMm: 50.0,
      stepsPerRotation: roundMm(steps, 3),
      rotationDirection: p.rotationDirection === 'inverted' ? 'inverted' : 'normal',
      isBuiltIn: Boolean(p.isBuiltIn),
      notes: typeof p.notes === 'string' ? p.notes : '',
    };
  }

  return {
    id: p.id,
    name: p.name,
    type,
    rollerDiameterMm: type === 'roller' ? roundMm(rollerD ?? 50.0, 2) : undefined,
    stepsPerRotation: roundMm(steps, 3),
    rotationDirection: p.rotationDirection === 'inverted' ? 'inverted' : 'normal',
    isBuiltIn: Boolean(p.isBuiltIn),
    notes: typeof p.notes === 'string' ? p.notes : '',
  };
}

// ============================================================================
// ASISTENTE DE CALIBRACIÓN Y REGISTRO DE MEDIDAS REALES
// ============================================================================

export type RotaryCalibrationMethod = 'angular_360' | 'linear_caliper';

export interface RotaryCalibrationRecord {
  id: string;
  timestampIso: string;
  accessoryId?: string;
  accessoryName?: string;
  method: RotaryCalibrationMethod;
  initialSteps: number;
  expectedValue: number; // 360 grados o mm teóricos
  measuredValue: number; // grados medidos o mm medidos con calibre
  computedSteps: number;
  operatorNotes?: string;
}

/**
 * Calcula los pasos por vuelta corregidos a partir de una medición lineal con calibre.
 * Fórmula: Pasos_Nuevos = Pasos_Actuales * (Longitud_Esperada / Longitud_Medida)
 */
export function computeLinearCalibratedSteps(
  currentSteps: number,
  expectedMm: number,
  measuredMm: number
): number | null {
  if (
    !Number.isFinite(currentSteps) ||
    !Number.isFinite(expectedMm) ||
    !Number.isFinite(measuredMm) ||
    currentSteps <= 0 ||
    expectedMm <= 0 ||
    measuredMm <= 0
  ) {
    return null;
  }
  const ratio = expectedMm / measuredMm;
  // Descartar mediciones absurdas o errores de dedo (más del triple o menos de un tercio)
  if (ratio < 0.2 || ratio > 5.0) return null;
  const result = currentSteps * ratio;
  return Number.isFinite(result) ? roundMm(result, 3) : null;
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
