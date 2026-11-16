import {Millimeters, LabelDesign} from '../types';
import {roundMm} from '../geometry/geometryEngine';

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
}

export interface RotaryPlacement {
  offsetXMm: Millimeters;
  offsetYMm: Millimeters;
  /** Línea central de la copia en Y (centro de deformación cónica) */
  centerYMm: Millimeters;
}

export const DEFAULT_ROTARY_CONFIG: RotaryConfig = {
  rotaryType: 'roller',
  objectDiameterMm: 75,
  usefulLengthMm: 100,
  arcDeg: 360,
  rollerDiameterMm: undefined,
  machineBedWidthMm: 900,
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

export function computeRotaryLayout(config: RotaryConfig, design: Pick<LabelDesign, 'widthMm' | 'heightMm'>): RotaryLayout {
  const errors: string[] = [];
  const warnings: string[] = [];
  const finite = (v: number) => Number.isFinite(v);

  if (![config.objectDiameterMm, config.usefulLengthMm, config.arcDeg, config.machineBedWidthMm, design.widthMm, design.heightMm].every(finite)) {
    errors.push('Hay valores no numéricos en la configuración del rotativo.');
  }
  if (config.objectDiameterMm < MIN_OBJECT_DIAMETER_MM || config.objectDiameterMm > MAX_OBJECT_DIAMETER_MM) {
    errors.push(`El diámetro del objeto debe estar entre ${MIN_OBJECT_DIAMETER_MM} y ${MAX_OBJECT_DIAMETER_MM} mm.`);
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

  if (design.widthMm > config.usefulLengthMm) {
    errors.push(`El diseño (${design.widthMm} mm a lo largo del eje) no entra en el largo útil de ${config.usefulLengthMm} mm.`);
  }
  const repeatN = Number.isInteger(repeat) && repeat >= 1 && repeat <= 36 ? repeat : 1;
  const pitchMm = roundMm(arcLengthMm / repeatN);
  if (design.heightMm > pitchMm) {
    errors.push(repeatN > 1
      ? `El diseño (${design.heightMm} mm alrededor) no entra ${repeatN} veces en el arco: cada copia dispone de ${pitchMm} mm.`
      : `El diseño (${design.heightMm} mm alrededor del objeto) no entra en el arco de ${arcLengthMm} mm.`);
  } else if (repeatN > 1 && pitchMm - design.heightMm < 2) {
    warnings.push(`Las copias quedan a menos de 2 mm entre sí (${roundMm(pitchMm - design.heightMm, 2)} mm).`);
  } else if (config.arcDeg >= 360 && design.heightMm > circumferenceMm * 0.98) {
    warnings.push('El diseño ocupa casi toda la circunferencia: los extremos pueden tocarse en la costura.');
  }
  let slantStretchPercent = 0;
  let minDiameterMm = refD;
  if (tapered && config.usefulLengthMm > 0) {
    const end = config.endDiameterMm as number;
    const x0 = (config.usefulLengthMm - design.widthMm) / 2 + (finite(axisOff) ? axisOff : 0);
    minDiameterMm = Math.min(diameterAtX(config, x0), diameterAtX(config, x0 + design.widthMm));
    // El diseño real debe caber en la circunferencia más chica que atraviesa y su comando en Y en la vuelta de referencia.
    const widthSafe = Math.max(minDiameterMm, 1e-6);
    if (design.heightMm > Math.PI * minDiameterMm * Math.min(config.arcDeg, 360) / 360) {
      errors.push(`El diseño (${design.heightMm} mm alrededor) no entra en el extremo más angosto (Ø ${roundMm(minDiameterMm, 1)} mm).`);
    } else if (design.heightMm * refD / widthSafe > pitchMm) {
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
  const offsetXMm = roundMm((canvasWidthMm - design.widthMm) / 2 + (finite(axisOff) ? axisOff : 0));
  if (offsetXMm < -1e-9 || offsetXMm + design.widthMm > canvasWidthMm + 1e-9) {
    errors.push('El desplazamiento axial saca el diseño del largo útil.');
  }
  const stretch = tapered ? refD / Math.max(minDiameterMm, 1e-6) : 1;
  const halfSpan = design.heightMm * stretch / 2;
  const placements: RotaryPlacement[] = [];
  for (let i = 0; i < repeatN; i++) {
    const centerYMm = roundMm(pitchMm * (i + 0.5) + angOffMm);
    placements.push({offsetXMm, offsetYMm: roundMm(centerYMm - design.heightMm / 2), centerYMm});
    if (centerYMm - halfSpan < -1e-6 || centerYMm + halfSpan > canvasHeightMm + 1e-6) {
      errors.push(`El giro del diseño saca la copia ${i + 1} del arco disponible.`);
      break;
    }
  }
  const offsetYMm = placements[0].offsetYMm;
  const designArcDeg = circumferenceMm > 0 ? roundMm((design.heightMm / circumferenceMm) * 360, 2) : 0;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    circumferenceMm,
    arcLengthMm,
    canvasWidthMm,
    canvasHeightMm,
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
  return {
    ...DEFAULT_ROTARY_CONFIG,
    rotaryType: r.rotaryType === 'chuck' ? 'chuck' : 'roller',
    stepsPerRotation: ok(r.stepsPerRotation) && r.stepsPerRotation>0 ? r.stepsPerRotation : undefined,
    objectDiameterMm: r.objectDiameterMm,
    endDiameterMm: ok(r.endDiameterMm) ? r.endDiameterMm : undefined,
    usefulLengthMm: r.usefulLengthMm,
    arcDeg: r.arcDeg,
    repeatCount: ok(r.repeatCount) ? r.repeatCount : undefined,
    axisOffsetMm: ok(r.axisOffsetMm) ? r.axisOffsetMm : undefined,
    angularOffsetDeg: ok(r.angularOffsetDeg) ? r.angularOffsetDeg : undefined,
    rollerDiameterMm: ok(r.rollerDiameterMm) ? r.rollerDiameterMm : DEFAULT_ROTARY_CONFIG.rollerDiameterMm,
  };
}

/** Correct a known setting using a measured Test rotation; never sends movement. */
export function correctedRotarySteps(current:number, measuredDegrees:number):number | null {
 if(!Number.isFinite(current)||!Number.isFinite(measuredDegrees)||current<=0||measuredDegrees<=0) return null;
 const result=current*360/measuredDegrees;
 return Number.isFinite(result)?roundMm(result,3):null;
}
