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
}

export const DEFAULT_ROTARY_CONFIG: RotaryConfig = {
  rotaryType: 'roller',
  objectDiameterMm: 75,
  usefulLengthMm: 100,
  arcDeg: 360,
  rollerDiameterMm: 20,
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
 * así que el arco real en X vale Y × d(x)/dRef. Se pre-escala Y (respecto al centro del lienzo) por dRef/d(x).
 */
export function warpPointForTaper(config: RotaryConfig, canvasHeightMm: Millimeters, x: Millimeters, y: Millimeters): {x: Millimeters; y: Millimeters} {
  if (!isTapered(config)) return {x, y};
  const yc = canvasHeightMm / 2;
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
  if (!(config.arcDeg > 0) || config.arcDeg > 360) errors.push('El arco a grabar debe estar entre 1° y 360°.');

  const endOk = config.endDiameterMm === undefined || finite(config.endDiameterMm);
  const tapered = endOk && isTapered(config);
  const refD = endOk ? referenceDiameterMm(config) : config.objectDiameterMm;
  const circumferenceMm = rotaryCircumferenceMm(refD);
  const arcLengthMm = roundMm(circumferenceMm * Math.min(Math.max(config.arcDeg, 0), 360) / 360);

  if (design.widthMm > config.usefulLengthMm) {
    errors.push(`El diseño (${design.widthMm} mm a lo largo del eje) no entra en el largo útil de ${config.usefulLengthMm} mm.`);
  }
  if (design.heightMm > arcLengthMm) {
    errors.push(`El diseño (${design.heightMm} mm alrededor del objeto) no entra en el arco de ${arcLengthMm} mm.`);
  } else if (config.arcDeg >= 360 && design.heightMm > circumferenceMm * 0.98) {
    warnings.push('El diseño ocupa casi toda la circunferencia: los extremos pueden tocarse en la costura.');
  }
  let slantStretchPercent = 0;
  let minDiameterMm = refD;
  if (tapered && config.usefulLengthMm > 0) {
    const end = config.endDiameterMm as number;
    const x0 = (config.usefulLengthMm - design.widthMm) / 2;
    minDiameterMm = Math.min(diameterAtX(config, x0), diameterAtX(config, x0 + design.widthMm));
    // El diseño real debe caber en la circunferencia más chica que atraviesa y su comando en Y en la vuelta de referencia.
    if (design.heightMm > Math.PI * minDiameterMm * Math.min(config.arcDeg, 360) / 360) {
      errors.push(`El diseño (${design.heightMm} mm alrededor) no entra en el extremo más angosto (Ø ${roundMm(minDiameterMm, 1)} mm).`);
    } else if (design.heightMm * refD / minDiameterMm > arcLengthMm) {
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
  const offsetXMm = roundMm((canvasWidthMm - design.widthMm) / 2);
  const offsetYMm = roundMm((canvasHeightMm - design.heightMm) / 2);
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
    objectDiameterMm: r.objectDiameterMm,
    endDiameterMm: ok(r.endDiameterMm) ? r.endDiameterMm : undefined,
    usefulLengthMm: r.usefulLengthMm,
    arcDeg: r.arcDeg,
    rollerDiameterMm: ok(r.rollerDiameterMm) ? r.rollerDiameterMm : DEFAULT_ROTARY_CONFIG.rollerDiameterMm,
  };
}
