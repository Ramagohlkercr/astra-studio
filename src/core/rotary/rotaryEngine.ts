import {Millimeters, LabelDesign} from '../types';
import {roundMm} from '../geometry/geometryEngine';
import {
  RotaryDirection,
  CalibrationStatus,
  CalibrationEvidence,
  LinearMeasurementMode,
  LinearCalibrationParams,
  LinearCalibrationResult,
  computeDetailedLinearCalibration,
  computeLinearCalibratedSteps,
  recordProposedCalibration,
  confirmPhysicalVerification,
  revertCalibrationOnProfile,
} from './rotaryProfiles';

export {
  computeDetailedLinearCalibration,
  computeLinearCalibratedSteps,
  recordProposedCalibration,
  confirmPhysicalVerification,
  revertCalibrationOnProfile,
};
export type {
  RotaryDirection,
  CalibrationStatus,
  CalibrationEvidence,
  LinearMeasurementMode,
  LinearCalibrationParams,
  LinearCalibrationResult,
};

/**
 * Accesorio rotativo (Vank 9060 / Ruida RDC8445S).
 * El archivo es el "desenrollado" del objeto cilíndrico:
 *   - X (ancho del lienzo)  = largo útil a lo largo del eje del objeto.
 *   - Y (alto del lienzo)   = arco de circunferencia a grabar (π × diámetro × arco/360).
 * En el diseño de etiqueta, widthMm corre a lo largo del eje y heightMm alrededor de la circunferencia.
 */
export type RotaryType = 'roller' | 'chuck';

export interface RotaryConfig {
  rotaryType: RotaryType;
  /** ID del perfil de accesorio persistente (opcional) */
  accessoryProfileId?: string;
  /** Sentido de giro del eje Y: normal o invertido */
  rotationDirection?: RotaryDirection;
  /** Pasos por vuelta del rodillo motriz o mandril, informados por el operador. */
  stepsPerRotation?: number;
  /** Diámetro del objeto (mm) en el extremo X=0; si no hay endDiameterMm, cilindro recto */
  objectDiameterMm: Millimeters;
  /** Diámetro en el extremo X=largo útil (mm). Distinto de objectDiameterMm = objeto cónico (ej. tumbler) */
  endDiameterMm?: Millimeters;
  /** Largo útil a grabar a lo largo del eje (mm) */
  usefulLengthMm: Millimeters;
  /** Arco a grabar en grados (360 = vuelta completa) */
  arcDeg: number;
  /** Diámetro de los rodillos del rotativo (mm), sólo informativo para tipo roller */
  rollerDiameterMm?: Millimeters;
  /** Ancho útil de la máquina en X (Vank 9060 = 900) */
  machineBedWidthMm: Millimeters;
  /** Copias del diseño repartidas alrededor del objeto (por defecto 1) */
  repeatCount?: number;
  /** Desplazamiento del diseño a lo largo del eje respecto del centro (mm) */
  axisOffsetMm?: Millimeters;
  /** Giro del diseño alrededor del objeto respecto del centro del arco (grados, + = hacia Y creciente) */
  angularOffsetDeg?: number;
  /** Rotación del logo sobre la superficie del cilindro/cono (0°, 90°, 180°, 270°) para orientarlo respecto a boca/base */
  designRotationDeg?: 0 | 90 | 180 | 270;
  /** Qué extremo del objeto queda mordido en el mandril izquierdo X=0 ('left_base' = base en mandril / boca a la derecha) */
  chuckSide?: 'left_base' | 'left_rim';
}

export interface RotaryPlacement {
  offsetXMm: Millimeters;
  offsetYMm: Millimeters;
  /** Línea central de la copia en Y (centro de deformación cónica) */
  centerYMm: Millimeters;
}

export const DEFAULT_ROTARY_CONFIG: RotaryConfig = {
  rotaryType: 'roller',
  accessoryProfileId: 'vank-roller-standard',
  rotationDirection: 'normal',
  objectDiameterMm: 75,
  usefulLengthMm: 100,
  arcDeg: 360,
  rollerDiameterMm: undefined,
  machineBedWidthMm: 900,
  designRotationDeg: 0,
  chuckSide: 'left_base',
};

export const MIN_OBJECT_DIAMETER_MM = 5;
export const MAX_OBJECT_DIAMETER_MM = 300;

export interface RotaryLayout {
  valid: boolean;
  errors: string[];
  warnings: string[];
  circumferenceMm: Millimeters;
  arcLengthMm: Millimeters;
  canvasWidthMm: Millimeters;
  canvasHeightMm: Millimeters;
  /** Dimensiones efectivas del diseño sobre el cilindro tras rotarlo 0/90/180/270° */
  effectiveDesignWidthMm: Millimeters;
  effectiveDesignHeightMm: Millimeters;
  appliedDesignRotationDeg: 0 | 90 | 180 | 270;
  /** Traslación aplicada al diseño para centrarlo en el lienzo */
  offsetXMm: Millimeters;
  offsetYMm: Millimeters;
  placements: RotaryPlacement[];
  repeatCount: number;
  /** Separación entre centros de copias (mm), 0 si hay una sola */
  copyPitchMm: Millimeters;
  /** Posición angular del centro del diseño respecto a la costura (grados) */
  designArcDeg: number;
  /** Diámetro de referencia a cargar en la máquina (promedio de los extremos) */
  referenceDiameterMm: Millimeters;
  minDiameterMm: Millimeters;
  tapered: boolean;
  /** Estiramiento extra de X por inclinación de la pared (%), 0 en cilindros */
  slantStretchPercent: number;
}

export function isTapered(config: RotaryConfig): boolean {
  return config.endDiameterMm !== undefined && Math.abs(config.endDiameterMm - config.objectDiameterMm) > 1e-9;
}

export function referenceDiameterMm(config: RotaryConfig): Millimeters {
  return isTapered(config) ? roundMm((config.objectDiameterMm + (config.endDiameterMm as number)) / 2) : config.objectDiameterMm;
}

/** Diámetro del objeto a la distancia x (mm) desde el extremo X=0. */
export function diameterAtX(config: RotaryConfig, x: Millimeters): Millimeters {
  if (!isTapered(config)) return config.objectDiameterMm;
  const t = Math.min(Math.max(x / config.usefulLengthMm, 0), 1);
  return config.objectDiameterMm + ((config.endDiameterMm as number) - config.objectDiameterMm) * t;
}

/**
 * Compensa un punto del lienzo para un objeto cónico: la máquina gira un ángulo fijo por mm de Y,
 * así que el arco real en X vale Y × d(x)/dRef. Se pre-escala Y (respecto a la línea central de cada copia) por dRef/d(x).
 */
export function warpPointForTaper(config: RotaryConfig, centerYMm: Millimeters, x: Millimeters, y: Millimeters): {x: Millimeters; y: Millimeters} {
  if (!isTapered(config)) return {x, y};
  const yc = centerYMm;
  return {x, y: roundMm(yc + (y - yc) * referenceDiameterMm(config) / diameterAtX(config, x))};
}

export function rotaryCircumferenceMm(diameterMm: Millimeters): Millimeters {
  return roundMm(Math.PI * diameterMm);
}

export function computeRotaryLayout(
  config: RotaryConfig,
  design: Pick<LabelDesign, 'widthMm' | 'heightMm'> & { elements?: LabelDesign['elements'] }
): RotaryLayout {
  const errors: string[] = [];
  const warnings: string[] = [];
  const finite = (v: number) => Number.isFinite(v);

  if (Array.isArray(design.elements)) {
    const hasVisible = design.elements.some((el) => el.visible);
    if (!hasVisible) {
      errors.push('El diseño no contiene elementos de grabado visibles para exportar al rotativo.');
    }
  }

  if (![config.objectDiameterMm, config.usefulLengthMm, config.arcDeg, config.machineBedWidthMm, design.widthMm, design.heightMm].every(finite)) {
    errors.push('Hay valores no numéricos en la configuración del rotativo.');
  }
  if (config.objectDiameterMm < MIN_OBJECT_DIAMETER_MM || config.objectDiameterMm > MAX_OBJECT_DIAMETER_MM) {
    errors.push(`El diámetro del objeto debe estar entre ${MIN_OBJECT_DIAMETER_MM} y ${MAX_OBJECT_DIAMETER_MM} mm.`);
  }
  if (config.objectDiameterMm > 250) {
    warnings.push(`Diámetro elevado (${config.objectDiameterMm} mm): verifique la altura libre del eje Z en la Vank 9060 con el accesorio montado.`);
  }
  if (config.endDiameterMm !== undefined && (!finite(config.endDiameterMm) || config.endDiameterMm < MIN_OBJECT_DIAMETER_MM || config.endDiameterMm > MAX_OBJECT_DIAMETER_MM)) {
    errors.push(`El diámetro del extremo final debe estar entre ${MIN_OBJECT_DIAMETER_MM} y ${MAX_OBJECT_DIAMETER_MM} mm.`);
  }
  if (!(config.usefulLengthMm > 0)) errors.push('El largo útil debe ser mayor a 0 mm.');
  if (config.usefulLengthMm > config.machineBedWidthMm) {
    errors.push(`El largo útil (${config.usefulLengthMm} mm) supera el ancho de la máquina (${config.machineBedWidthMm} mm).`);
  }
  if (!(config.arcDeg >= 1) || config.arcDeg > 360) errors.push('El arco a grabar debe estar entre 1° y 360°.');

  if (!(design.widthMm>0) || !(design.heightMm>0)) errors.push('El diseño debe tener ancho y alto mayores a 0.');
  if (config.stepsPerRotation!==undefined && (!finite(config.stepsPerRotation)||config.stepsPerRotation<=0)) errors.push('Los pasos por vuelta deben ser mayores a 0 o dejarse sin completar.');
  if (config.rotaryType==='roller' && config.rollerDiameterMm!==undefined && (!finite(config.rollerDiameterMm)||config.rollerDiameterMm<=0)) errors.push('El diámetro del rodillo debe ser mayor a 0 o dejarse sin completar.');
  if (config.rotaryType==='roller' && config.rollerDiameterMm===undefined) warnings.push('Falta medir el rodillo motriz: el archivo se puede preparar, pero su diámetro debe configurarse en LightBurn antes de grabar.');
  if (config.stepsPerRotation===undefined) warnings.push('Pasos por vuelta pendientes: usá el valor del fabricante o una calibración del accesorio.');
  const repeat = config.repeatCount === undefined ? 1 : config.repeatCount;
  const axisOff = config.axisOffsetMm ?? 0;
  const angOff = config.angularOffsetDeg ?? 0;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 36) errors.push('Las copias alrededor deben ser un entero entre 1 y 36.');
  if (!finite(axisOff) || !finite(angOff)) errors.push('Los desplazamientos del diseño deben ser numéricos.');
  const endOk = config.endDiameterMm === undefined || finite(config.endDiameterMm);
  const tapered = endOk && isTapered(config);
  const refD = endOk ? referenceDiameterMm(config) : config.objectDiameterMm;
  const circumferenceMm = rotaryCircumferenceMm(refD);
  const arcLengthMm = roundMm(circumferenceMm * Math.min(Math.max(config.arcDeg, 0), 360) / 360);

  const rawRot = config.designRotationDeg ?? 0;
  const appliedDesignRotationDeg: 0 | 90 | 180 | 270 =
    rawRot === 90 || rawRot === 180 || rawRot === 270 ? rawRot : 0;
  const swapsAxes = appliedDesignRotationDeg === 90 || appliedDesignRotationDeg === 270;
  const effW = swapsAxes ? design.heightMm : design.widthMm;
  const effH = swapsAxes ? design.widthMm : design.heightMm;

  if (effW > config.usefulLengthMm) {
    errors.push(`El diseño (${effW} mm a lo largo del eje) no entra en el largo útil de ${config.usefulLengthMm} mm.`);
  }
  const repeatN = Number.isInteger(repeat) && repeat >= 1 && repeat <= 36 ? repeat : 1;
  const pitchMm = roundMm(arcLengthMm / repeatN);
  if (effH > pitchMm) {
    errors.push(repeatN > 1
      ? `El diseño (${effH} mm alrededor) no entra ${repeatN} veces en el arco: cada copia dispone de ${pitchMm} mm.`
      : `El diseño (${effH} mm alrededor del objeto) no entra en el arco de ${arcLengthMm} mm.`);
  } else if (repeatN > 1 && pitchMm - effH < 2) {
    warnings.push(`Las copias quedan a menos de 2 mm entre sí (${roundMm(pitchMm - effH, 2)} mm).`);
  } else if (config.arcDeg >= 360 && effH > circumferenceMm * 0.98) {
    warnings.push('El diseño ocupa casi toda la circunferencia: los extremos pueden tocarse en la costura.');
  }
  let slantStretchPercent = 0;
  let minDiameterMm = refD;
  if (tapered && config.usefulLengthMm > 0) {
    const end = config.endDiameterMm as number;
    const x0 = (config.usefulLengthMm - effW) / 2 + (finite(axisOff) ? axisOff : 0);
    minDiameterMm = Math.min(diameterAtX(config, x0), diameterAtX(config, x0 + effW));
    // El diseño real debe caber en la circunferencia más chica que atraviesa y su comando en Y en la vuelta de referencia.
    const widthSafe = Math.max(minDiameterMm, 1e-6);
    if (effH > Math.PI * minDiameterMm * Math.min(config.arcDeg, 360) / 360) {
      errors.push(`El diseño (${effH} mm alrededor) no entra en el extremo más angosto (Ø ${roundMm(minDiameterMm, 1)} mm).`);
    } else if (effH * refD / widthSafe > pitchMm) {
      errors.push('La compensación cónica estira el diseño más allá del arco disponible; reducí el alto o ampliá el arco.');
    }
    const half = Math.abs(end - config.objectDiameterMm) / 2;
    slantStretchPercent = roundMm((Math.sqrt(half * half + config.usefulLengthMm * config.usefulLengthMm) / config.usefulLengthMm - 1) * 100, 2);
    if (slantStretchPercent > 1) warnings.push(`La pared inclinada estira el largo real un ${slantStretchPercent}% respecto de X; ajustá el largo si necesitás precisión axial.`);
    warnings.push('Objeto cónico: el arte se pre-compensa en Y. Verificá con una prueba y el ángulo/soporte del rotativo.');
  }
  if (config.rotaryType === 'roller' && config.rollerDiameterMm !== undefined && config.objectDiameterMm < config.rollerDiameterMm) {
    warnings.push('El objeto es más fino que los rodillos: puede no apoyar bien en un rotativo de rodillos.');
  }

  const canvasWidthMm = roundMm(config.usefulLengthMm);
  const canvasHeightMm = arcLengthMm;
  const angOffMm = finite(angOff) ? roundMm(circumferenceMm * angOff / 360) : 0;
  const offsetXMm = roundMm((canvasWidthMm - effW) / 2 + (finite(axisOff) ? axisOff : 0));
  if (offsetXMm < -1e-9 || offsetXMm + effW > canvasWidthMm + 1e-9) {
    errors.push('El desplazamiento axial saca el diseño del largo útil.');
  }
  const stretch = tapered ? refD / Math.max(minDiameterMm, 1e-6) : 1;
  const halfSpan = effH * stretch / 2;
  const placements: RotaryPlacement[] = [];
  for (let i = 0; i < repeatN; i++) {
    const centerYMm = roundMm(pitchMm * (i + 0.5) + angOffMm);
    placements.push({offsetXMm, offsetYMm: roundMm(centerYMm - effH / 2), centerYMm});
    if (centerYMm - halfSpan < -1e-6 || centerYMm + halfSpan > canvasHeightMm + 1e-6) {
      errors.push(`El giro del diseño saca la copia ${i + 1} del arco disponible.`);
      break;
    }
  }
  const offsetYMm = placements[0]?.offsetYMm ?? 0;
  const designArcDeg = circumferenceMm > 0 ? roundMm((effH / circumferenceMm) * 360, 2) : 0;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    circumferenceMm,
    arcLengthMm,
    canvasWidthMm,
    canvasHeightMm,
    effectiveDesignWidthMm: roundMm(effW),
    effectiveDesignHeightMm: roundMm(effH),
    appliedDesignRotationDeg,
    offsetXMm,
    offsetYMm,
    placements,
    repeatCount: repeatN,
    copyPitchMm: repeatN > 1 ? pitchMm : 0,
    designArcDeg,
    referenceDiameterMm: refD,
    minDiameterMm: roundMm(minDiameterMm),
    tapered,
    slantStretchPercent,
  };
}

/** Valida una configuración guardada (p. ej. de un archivo de proyecto); devuelve undefined si no es utilizable. */
export function sanitizeRotaryConfig(raw: unknown): RotaryConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<RotaryConfig>;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!ok(r.objectDiameterMm) || !ok(r.usefulLengthMm) || !ok(r.arcDeg)) return undefined;

  const rotaryType: RotaryType = r.rotaryType === 'chuck' ? 'chuck' : 'roller';
  const defaultProfileId = rotaryType === 'chuck' ? 'vank-sanou-chuck' : 'vank-roller-standard';
  const profileId = typeof r.accessoryProfileId === 'string' ? r.accessoryProfileId : defaultProfileId;

  return {
    ...DEFAULT_ROTARY_CONFIG,
    rotaryType,
    accessoryProfileId: profileId,
    rotationDirection: r.rotationDirection === 'inverted' ? 'inverted' : 'normal',
    stepsPerRotation: ok(r.stepsPerRotation) && r.stepsPerRotation > 0 ? r.stepsPerRotation : undefined,
    objectDiameterMm: r.objectDiameterMm,
    endDiameterMm: ok(r.endDiameterMm) ? r.endDiameterMm : undefined,
    usefulLengthMm: r.usefulLengthMm,
    arcDeg: r.arcDeg,
    repeatCount: ok(r.repeatCount) ? r.repeatCount : undefined,
    axisOffsetMm: ok(r.axisOffsetMm) ? r.axisOffsetMm : undefined,
    angularOffsetDeg: ok(r.angularOffsetDeg) ? r.angularOffsetDeg : undefined,
    designRotationDeg:
      r.designRotationDeg === 90 || r.designRotationDeg === 180 || r.designRotationDeg === 270
        ? r.designRotationDeg
        : 0,
    chuckSide: r.chuckSide === 'left_rim' ? 'left_rim' : 'left_base',
    rollerDiameterMm: rotaryType === 'roller'
      ? (ok(r.rollerDiameterMm) ? r.rollerDiameterMm : DEFAULT_ROTARY_CONFIG.rollerDiameterMm)
      : undefined,
  };
}

/** Correct a known setting using a measured Test rotation; never sends movement. */
export function correctedRotarySteps(current:number, measuredDegrees:number):number | null {
 if(!Number.isFinite(current)||!Number.isFinite(measuredDegrees)||current<=0||measuredDegrees<=0) return null;
 const result=current*360/measuredDegrees;
 return Number.isFinite(result)?roundMm(result,3):null;
}

export interface RotaryEngraveLayerParams {
  mode: 'image' | 'fill' | 'line';
  speedMmPerSec: number | null;
  maxPowerPercent: number | null;
  minPowerPercent: number | null;
  lineIntervalMm: number;
  passes: number;
  airAssist: boolean;
  bidirectional: boolean;
  crossHatch: boolean;
  overscanPercent: number;
}

export const DEFAULT_ROTARY_LAYER_PARAMS: RotaryEngraveLayerParams = {
  mode: 'fill',
  speedMmPerSec: null,
  maxPowerPercent: null,
  minPowerPercent: null,
  lineIntervalMm: 0.073,
  passes: 1,
  airAssist: true,
  bidirectional: true,
  crossHatch: false,
  overscanPercent: 2.5,
};

export interface RotaryPhysicalSetupInfo {
  /** Ángulo de inclinación de la pared del cono respecto al eje central (°) */
  wallTiltAngleDeg: number;
  /** Milímetros que debe levantarse el extremo más angosto (en la longitud útil L) para nivelar la generatriz superior a foco Z constante */
  tailstockLiftMm: number;
  /** Extremo que debe levantarse ('end' si X=L es más angosto, 'start' si X=0 es más angosto, 'none' si es recto) */
  endToLift: 'start' | 'end' | 'none';
  /** Distancia real sobre la pared inclinada (generatriz) en mm */
  slantLengthMm: number;
  /** Factor de estiramiento/escala axial si el cono es pronunciado (slantLength / usefulLength) */
  axisLengthScaleRatio: number;
  /** Resolución lineal real por cada micropaso del rotativo (µm/paso sobre la superficie) */
  stepResolutionUm: number | null;
  /** Tiempo estimado de grabado rotativo en segundos (0 si aún no se ingresó velocidad) */
  estimatedDurationSec: number;
  /** Desglose del tiempo de producción (en segundos) para vista de taller y lotes */
  timeBreakdown: {
    scanOrCutSec: number;
    turnaroundAndIndexSec: number;
    perPieceSec: number;
    effectiveDpi: number;
    recommendedMaxRollerSpeedWarning: string | null;
  };
  /** Cantidad total de líneas de barrido axial X a lo largo del giro Y */
  estimatedScanLines: number;
}

/**
 * Estima el tiempo por lote de N piezas agregando un tiempo breve de cambio de pieza entre objetos.
 */
export function estimateRotaryBatchDuration(
  perPieceSec: number,
  quantity: number,
  swapTimePerPieceSec = 18
): { totalSec: number; machiningSec: number; handlingSec: number } {
  const safeQty = Math.max(1, Math.round(quantity || 1));
  const safePerPiece = Math.max(0, perPieceSec || 0);
  if (safePerPiece <= 0) {
    return { totalSec: 0, machiningSec: 0, handlingSec: 0 };
  }
  const machiningSec = Math.round(safePerPiece * safeQty);
  const handlingSec = safeQty > 1 ? (safeQty - 1) * swapTimePerPieceSec : 0;
  return {
    totalSec: machiningSec + handlingSec,
    machiningSec,
    handlingSec,
  };
}

/**
 * Calcula los datos físicos de montaje, nivelación de foco Z en conos, resolución angular en µm/paso
 * y tiempo estimado de grabado real para el Mandril Sanou o Rodillos en la Vank 9060.
 */
export function computeRotaryPhysicalSetup(
  config: RotaryConfig,
  design: Pick<LabelDesign, 'widthMm' | 'heightMm'> & {
    elements?: LabelDesign['elements'];
  },
  layerParams: RotaryEngraveLayerParams = DEFAULT_ROTARY_LAYER_PARAMS
): RotaryPhysicalSetupInfo {
  const tapered = isTapered(config);
  const dStart = config.objectDiameterMm;
  const dEnd = tapered ? (config.endDiameterMm as number) : dStart;
  const len = Math.max(1, config.usefulLengthMm);

  const radiusDiffMm = Math.abs(dStart - dEnd) / 2;
  const alphaRad = tapered ? Math.atan2(radiusDiffMm, len) : 0;
  const wallTiltAngleDeg = tapered ? roundMm((alphaRad * 180) / Math.PI, 2) : 0;
  // Para nivelar la generatriz superior (que cae ΔR = |d0 - d1|/2 a lo largo de L), la inclinación axial α levanta L * sin(α)
  const tailstockLiftMm = tapered ? roundMm(len * Math.sin(alphaRad), 2) : 0;
  const endToLift: 'start' | 'end' | 'none' = !tapered
    ? 'none'
    : dEnd < dStart
      ? 'end'
      : 'start';
  const slantLengthMm = roundMm(Math.hypot(len, radiusDiffMm), 2);
  const axisLengthScaleRatio = roundMm(slantLengthMm / len, 4);

  const refD = referenceDiameterMm(config);
  const effectiveMechDiameter =
    config.rotaryType === 'roller'
      ? (config.rollerDiameterMm ?? refD)
      : refD;
  const stepResolutionUm =
    config.stepsPerRotation && config.stepsPerRotation > 0
      ? roundMm((Math.PI * effectiveMechDiameter * 1000) / config.stepsPerRotation, 1)
      : null;

  const swapsAxes =
    config.designRotationDeg === 90 || config.designRotationDeg === 270;

  // Calcular caja real ocupada por los elementos visibles dentro del diseño para no sobreestimar márgenes vacíos
  let activeW = design.widthMm;
  let activeH = design.heightMm;
  let visibleCount = 0;
  if (Array.isArray(design.elements)) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of design.elements) {
      if (!el.visible) continue;
      visibleCount++;
      minX = Math.min(minX, el.xMm);
      minY = Math.min(minY, el.yMm);
      maxX = Math.max(maxX, el.xMm + el.widthMm);
      maxY = Math.max(maxY, el.yMm + el.heightMm);
    }
    if (visibleCount > 0 && Number.isFinite(minX)) {
      activeW = Math.max(1, Math.min(design.widthMm, maxX - minX));
      activeH = Math.max(1, Math.min(design.heightMm, maxY - minY));
    }
  }

  const effW = swapsAxes ? activeH : activeW;
  const effH = swapsAxes ? activeW : activeH;

  const copies = Math.max(1, Math.min(36, Math.round(config.repeatCount ?? 1)));
  const interval = Math.max(0.02, layerParams.lineIntervalMm || 0.073);
  const effectiveDpi = Math.round(25.4 / interval);
  const passes = Math.max(1, layerParams.passes || 1);
  const crossFactor = layerParams.mode !== 'line' && layerParams.crossHatch ? 2 : 1;

  const linesPerCopy =
    layerParams.mode === 'line'
      ? Math.max(1, visibleCount || 1)
      : Math.ceil(Math.max(1, effH) / interval);
  const estimatedScanLines = linesPerCopy * copies * passes * crossFactor;

  let scanOrCutSec = 0;
  let turnaroundAndIndexSec = 0;
  let estimatedDurationSec = 0;

  if (layerParams.speedMmPerSec && layerParams.speedMmPerSec > 0) {
    const speed = layerParams.speedMmPerSec;
    if (layerParams.mode === 'line') {
      // Modo Línea (contorno vectorial): perímetro aproximado del diseño × factor de detalle interior
      const approxPerimeterMm = 2 * (effW + effH) * Math.max(1.8, Math.min(4.5, (visibleCount || 1) * 1.4));
      scanOrCutSec = (approxPerimeterMm * copies * passes) / speed;
      turnaroundAndIndexSec = copies * passes * 1.1;
      estimatedDurationSec = Math.max(1, Math.ceil(scanOrCutSec + turnaroundAndIndexSec));
    } else {
      const overscanExtraMm =
        effW * ((layerParams.overscanPercent || 2.5) / 100) * 2;
      const strokeMm = effW + overscanExtraMm;
      const forwardSec = (estimatedScanLines * strokeMm) / speed;
      // Si es unidireccional, cada línea vuelve en vacío a ~300 mm/s
      const returnSec = layerParams.bidirectional
        ? 0
        : (estimatedScanLines * strokeMm) / Math.max(speed, 300);
      scanOrCutSec = forwardSec + returnSec;
      const indexSecPerLine = config.rotaryType === 'roller' ? 0.115 : 0.095;
      // Giro de separación entre copias cuando copies > 1
      const interCopyIndexSec = copies > 1 ? copies * 0.85 : 0;
      turnaroundAndIndexSec = estimatedScanLines * indexSecPerLine + interCopyIndexSec;
      estimatedDurationSec = Math.max(1, Math.ceil(scanOrCutSec + turnaroundAndIndexSec));
    }
  }

  let recommendedMaxRollerSpeedWarning: string | null = null;
  if (
    config.rotaryType === 'roller' &&
    layerParams.speedMmPerSec &&
    layerParams.speedMmPerSec > 450
  ) {
    recommendedMaxRollerSpeedWarning =
      `Velocidad alta (${layerParams.speedMmPerSec} mm/s) para rodillos: a >450 mm/s la pieza puede patinar. Recomendado <= 400 mm/s o usar Mandril Sanou.`;
  }

  return {
    wallTiltAngleDeg,
    tailstockLiftMm,
    endToLift,
    slantLengthMm,
    axisLengthScaleRatio,
    stepResolutionUm,
    estimatedDurationSec,
    timeBreakdown: {
      scanOrCutSec: roundMm(scanOrCutSec, 1),
      turnaroundAndIndexSec: roundMm(turnaroundAndIndexSec, 1),
      perPieceSec: estimatedDurationSec,
      effectiveDpi,
      recommendedMaxRollerSpeedWarning,
    },
    estimatedScanLines,
  };
}
