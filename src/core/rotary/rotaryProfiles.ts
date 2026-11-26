import { Millimeters } from '../types';
import { roundMm } from '../geometry/geometryEngine';

export type RotaryAccessoryType = 'roller' | 'chuck';
export type RotaryDirection = 'normal' | 'inverted';

/**
 * Tres estados de calibración física:
 * - 'uncalibrated': No calibrado. Los pasos son meramente ilustrativos.
 * - 'calculated_pending': Corrección calculada matemáticamente, pendiente de probar en la máquina.
 * - 'verified_physical': Prueba física ejecutada y confirmada explícitamente por el operador.
 */
export type CalibrationStatus = 'uncalibrated' | 'calculated_pending' | 'verified_physical';

export type RotaryCalibrationMethod = 'angular_360' | 'linear_caliper';
export type LinearMeasurementMode = 'surface_arc' | 'caliper_chord';

export interface CalibrationEvidence {
  method: RotaryCalibrationMethod;
  expectedValue: number;
  measuredValue: number;
  effectiveRealArcMm?: number;
  linearMode?: LinearMeasurementMode;
  operatorNotes?: string;
  verifiedAtIso: string;
}

export interface RotaryAccessoryProfile {
  id: string;
  name: string;
  type: RotaryAccessoryType;
  /** Diámetro del rodillo motriz (mm). Obligatorio para rodillos; no aplica para mandril */
  rollerDiameterMm?: Millimeters;
  /**
   * Pasos por vuelta del motor/driver (steps per rotation).
   * ATENCIÓN: Si calibrationStatus !== 'verified_physical', este valor es sólo orientativo.
   */
  stepsPerRotation: number;
  /** Sentido de giro configurado (orientación de montaje en la ficha técnica) */
  rotationDirection: RotaryDirection;

  /** Estado estricto de calibración */
  calibrationStatus: CalibrationStatus;

  /** Valor de pasos propuesto pendiente de verificación física */
  proposedStepsPerRotation?: number;

  /** Evidencia explícita registrada por el operador al verificar en máquina */
  verificationEvidence?: CalibrationEvidence;

  /** Valor anterior de pasos por vuelta antes de la última modificación (permite deshacer) */
  previousStepsPerRotation?: number;

  /** Retrocompatibilidad con esquemas anteriores */
  isCalibrated?: boolean;
  calibratedAtIso?: string;
  calibrationMethod?: RotaryCalibrationMethod;

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
    calibrationStatus: 'uncalibrated',
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
    calibrationStatus: 'uncalibrated',
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
    calibrationStatus: 'uncalibrated',
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

    // Asegurar que perfiles clave de fábrica estén presentes
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

export function saveRotaryAccessoryProfiles(profiles: RotaryAccessoryProfile[]): { success: boolean; error?: string } {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'Almacenamiento no disponible en este entorno.' };
  try {
    storage.setItem(STORAGE_KEY_ROTARY_PROFILES, JSON.stringify(profiles));
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error al guardar perfiles de accesorios rotativos:', message);
    return { success: false, error: message };
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
 * Registra una propuesta de calibración calculada, dejándola en estado 'calculated_pending'.
 * NO la marca como verificada físicamente hasta que el operador confirme la prueba en máquina.
 */
export function recordProposedCalibration(
  profileId: string,
  computedSteps: number,
  method: RotaryCalibrationMethod,
  evidenceParams?: {
    expectedValue: number;
    measuredValue: number;
    effectiveRealArcMm?: number;
    linearMode?: LinearMeasurementMode;
    operatorNotes?: string;
  }
): { success: boolean; updatedProfiles: RotaryAccessoryProfile[]; updatedProfile: RotaryAccessoryProfile | null; error?: string } {
  const current = loadRotaryAccessoryProfiles();
  const idx = current.findIndex((p) => p.id === profileId);
  if (idx < 0) {
    return { success: false, updatedProfiles: current, updatedProfile: null, error: 'Perfil no encontrado.' };
  }

  const existing = current[idx];
  const roundedSteps = roundMm(computedSteps, 3);
  const updatedProfile: RotaryAccessoryProfile = {
    ...existing,
    calibrationStatus: 'calculated_pending',
    proposedStepsPerRotation: roundedSteps,
    previousStepsPerRotation: existing.previousStepsPerRotation ?? existing.stepsPerRotation,
    isCalibrated: false, // Sólo se vuelve true al verificar físicamente
    calibrationMethod: method,
    notes: existing.notes,
  };

  const updatedProfiles = [...current];
  updatedProfiles[idx] = updatedProfile;
  const saveResult = saveRotaryAccessoryProfiles(updatedProfiles);
  return {
    success: saveResult.success,
    updatedProfiles,
    updatedProfile,
    error: saveResult.error,
  };
}

/**
 * Confirma explícitamente la verificación física de la calibración en máquina real por el operador.
 * Requiere registrar evidencia y fecha, estableciendo el estado 'verified_physical'.
 */
export function confirmPhysicalVerification(
  profileId: string,
  evidence: Omit<CalibrationEvidence, 'verifiedAtIso'>
): { success: boolean; updatedProfiles: RotaryAccessoryProfile[]; updatedProfile: RotaryAccessoryProfile | null; error?: string } {
  const current = loadRotaryAccessoryProfiles();
  const idx = current.findIndex((p) => p.id === profileId);
  if (idx < 0) {
    return { success: false, updatedProfiles: current, updatedProfile: null, error: 'Perfil no encontrado.' };
  }

  const existing = current[idx];
  const newSteps = existing.proposedStepsPerRotation || existing.stepsPerRotation;
  const nowIso = new Date().toISOString();

  const fullEvidence: CalibrationEvidence = {
    ...evidence,
    verifiedAtIso: nowIso,
  };

  const updatedProfile: RotaryAccessoryProfile = {
    ...existing,
    stepsPerRotation: newSteps,
    proposedStepsPerRotation: undefined,
    previousStepsPerRotation: existing.previousStepsPerRotation ?? existing.stepsPerRotation,
    calibrationStatus: 'verified_physical',
    isCalibrated: true,
    calibratedAtIso: nowIso,
    calibrationMethod: evidence.method,
    verificationEvidence: fullEvidence,
  };

  const updatedProfiles = [...current];
  updatedProfiles[idx] = updatedProfile;
  const saveResult = saveRotaryAccessoryProfiles(updatedProfiles);
  return {
    success: saveResult.success,
    updatedProfiles,
    updatedProfile,
    error: saveResult.error,
  };
}

/**
 * Reversión directa / Deshacer al valor anterior de pasos.
 */
export function revertCalibrationOnProfile(
  profileId: string
): { success: boolean; updatedProfiles: RotaryAccessoryProfile[]; revertedProfile: RotaryAccessoryProfile | null; error?: string } {
  const current = loadRotaryAccessoryProfiles();
  const idx = current.findIndex((p) => p.id === profileId);
  if (idx < 0) {
    return { success: false, updatedProfiles: current, revertedProfile: null, error: 'Perfil no encontrado.' };
  }

  const existing = current[idx];
  if (existing.previousStepsPerRotation === undefined) {
    return { success: true, updatedProfiles: current, revertedProfile: existing };
  }

  const revertedProfile: RotaryAccessoryProfile = {
    ...existing,
    stepsPerRotation: existing.previousStepsPerRotation,
    proposedStepsPerRotation: undefined,
    previousStepsPerRotation: undefined,
    calibrationStatus: 'uncalibrated',
    isCalibrated: false,
    calibratedAtIso: undefined,
    calibrationMethod: undefined,
    verificationEvidence: undefined,
  };

  const updatedProfiles = [...current];
  updatedProfiles[idx] = revertedProfile;
  const saveResult = saveRotaryAccessoryProfiles(updatedProfiles);
  return {
    success: saveResult.success,
    updatedProfiles,
    revertedProfile,
    error: saveResult.error,
  };
}

/**
 * Sanitiza un perfil asegurando que no se declare como 'verified_physical' sin evidencia registrada.
 */
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
  const propSteps = p.proposedStepsPerRotation !== undefined && Number.isFinite(Number(p.proposedStepsPerRotation))
    ? roundMm(Number(p.proposedStepsPerRotation), 3)
    : undefined;

  // Validación estricta del estado de calibración
  let calibrationStatus: CalibrationStatus = 'uncalibrated';
  const hasEvidence = p.verificationEvidence && typeof p.verificationEvidence.verifiedAtIso === 'string';
  const hasLegacyCalibration = p.isCalibrated === true && typeof p.calibratedAtIso === 'string';

  if (p.calibrationStatus === 'verified_physical' && (hasEvidence || hasLegacyCalibration)) {
    calibrationStatus = 'verified_physical';
  } else if (p.calibrationStatus === 'calculated_pending' || propSteps !== undefined) {
    calibrationStatus = 'calculated_pending';
  } else if (hasEvidence || hasLegacyCalibration) {
    calibrationStatus = 'verified_physical';
  }

  const isCalibrated = calibrationStatus === 'verified_physical';

  return {
    id: p.id,
    name: p.name,
    type,
    rollerDiameterMm: type === 'roller' ? roundMm(rollerD ?? 50.0, 2) : undefined,
    stepsPerRotation: roundMm(steps, 3),
    rotationDirection: p.rotationDirection === 'inverted' ? 'inverted' : 'normal',
    calibrationStatus,
    proposedStepsPerRotation: propSteps,
    previousStepsPerRotation: prevSteps,
    verificationEvidence: p.verificationEvidence,
    isCalibrated,
    calibratedAtIso: typeof p.calibratedAtIso === 'string' ? p.calibratedAtIso : undefined,
    calibrationMethod: p.calibrationMethod === 'linear_caliper' || p.calibrationMethod === 'angular_360'
      ? p.calibrationMethod
      : undefined,
    isBuiltIn: Boolean(p.isBuiltIn),
    notes: typeof p.notes === 'string' ? p.notes : '',
  };
}

// ============================================================================
// ASISTENTE DE CALIBRACIÓN: CÁLCULO RIGUROSO DE CUERDA VS. ARCO
// ============================================================================

export interface RotaryCalibrationRecord {
  id: string;
  timestampIso: string;
  accessoryId?: string;
  accessoryName?: string;
  method: RotaryCalibrationMethod;
  initialSteps: number;
  expectedValue: number;
  measuredValue: number;
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
  /** Diámetro del objeto (mm). Requerido para mode === 'caliper_chord' */
  objectDiameterMm?: number;
  /** Si el objeto es cónico (diámetro variable) */
  isTapered?: boolean;
}

export interface LinearCalibrationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  expectedArcMm: number;
  measuredValueMm: number;
  mode: LinearMeasurementMode;
  effectiveRealArcMm: number;
  ratio: number;
  computedSteps: number;
}

/**
 * Calcula con rigor geométrico la calibración lineal.
 *
 * Restricciones geométricas fundamentales:
 * 1. Restringido a cilindros de diámetro constante: Si el objeto es cónico (isTapered),
 *    la medición con calibre rígido (cuerda) no es matemáticamente unívoca porque el diámetro
 *    varía a lo largo de X y el calibre no asienta en un corte ortogonal al eje. En conos
 *    se debe usar cinta métrica flexible sobre la superficie o calibrar en un cilindro recto.
 * 2. Cuerda menor al diámetro (c < D): Una cuerda recta no puede ser mayor o igual al diámetro.
 * 3. Alerta de ángulo crítico: Si c > 0.85 * D (ángulo mayor a 115°), las puntas del calibre
 *    pierden precisión por el ángulo de deslizamiento tangencial; se advierte al operador.
 */
export function computeDetailedLinearCalibration(params: LinearCalibrationParams): LinearCalibrationResult {
  const { currentSteps, expectedArcMm, measuredValueMm, mode, objectDiameterMm, isTapered } = params;

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

  // Restricción: No admitir medición con calibre rígido sobre conos
  if (isTapered && mode === 'caliper_chord') {
    return {
      valid: false,
      error: 'La medición con calibre rígido (cuerda recta) no es unívoca en conos porque el diámetro varía a lo largo del eje. Para calibrar sobre un objeto cónico utilice cinta flexible (arco superficial) o monte una probeta cilíndrica recta.',
      expectedArcMm,
      measuredValueMm,
      mode,
      effectiveRealArcMm: 0,
      ratio: 1,
      computedSteps: currentSteps,
    };
  }

  let effectiveRealArcMm: number;
  let warning: string | undefined;

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

    // Advertencia de ángulo obtuso (c > 0.85 * D)
    if (measuredValueMm > 0.85 * objectDiameterMm) {
      warning = `La cuerda medida (${measuredValueMm} mm) supera el 85% del diámetro (${objectDiameterMm} mm). A ángulos mayores a 115°, las puntas del calibre pierden precisión por contacto tangencial. Se sugiere medir un patrón más pequeño o usar cinta métrica flexible.`;
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

  // Descartar lecturas aberrantes
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
    warning,
    expectedArcMm,
    measuredValueMm,
    mode,
    effectiveRealArcMm,
    ratio,
    computedSteps,
  };
}

/**
 * Función compatible hacia atrás.
 */
export function computeLinearCalibratedSteps(
  currentSteps: number,
  expectedMm: number,
  measuredMm: number,
  mode: LinearMeasurementMode = 'surface_arc',
  objectDiameterMm?: number,
  isTapered?: boolean
): number | null {
  const result = computeDetailedLinearCalibration({
    currentSteps,
    expectedArcMm: expectedMm,
    measuredValueMm: measuredMm,
    mode,
    objectDiameterMm,
    isTapered,
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
      const updated = [newRecord, ...history].slice(0, 50);
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

// ============================================================================
// RECETAS GUARDADAS DE OBJETOS ROTATIVOS (TERMOS, MATES, VASOS + VEL/POT)
// ============================================================================

export const STORAGE_KEY_ROTARY_RECIPES = 'ASTRA_ROTARY_RECIPES_V1';

export interface RotaryJobRecipe {
  id: string;
  name: string;
  materialNote?: string;
  rotaryType: RotaryAccessoryType;
  objectDiameterMm: Millimeters;
  endDiameterMm?: Millimeters;
  usefulLengthMm: Millimeters;
  repeatCount: number;
  designRotationDeg: 0 | 90 | 180 | 270;
  chuckSide?: 'left_base' | 'left_rim';
  layerMode: 'image' | 'fill' | 'line';
  speedMmPerSec: number;
  maxPowerPercent: number;
  minPowerPercent: number;
  lineIntervalMm: number;
  passes: number;
  airAssist: boolean;
  bidirectional?: boolean;
  updatedAtIso: string;
}

export function loadRotaryRecipes(): RotaryJobRecipe[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY_ROTARY_RECIPES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRotaryRecipe(recipe: RotaryJobRecipe): RotaryJobRecipe[] {
  const current = loadRotaryRecipes().filter((r) => r.id !== recipe.id);
  const next = [recipe, ...current].slice(0, 40);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY_ROTARY_RECIPES, JSON.stringify(next));
    } catch (err) {
      console.error('Error al guardar receta rotativa:', err);
    }
  }
  return next;
}

export function deleteRotaryRecipe(id: string): RotaryJobRecipe[] {
  const next = loadRotaryRecipes().filter((r) => r.id !== id);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY_ROTARY_RECIPES, JSON.stringify(next));
    } catch (err) {
      console.error('Error al borrar receta rotativa:', err);
    }
  }
  return next;
}
