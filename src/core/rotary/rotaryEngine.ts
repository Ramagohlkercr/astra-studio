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
  /** Diámetro del objeto (mm), cilindro recto */
  objectDiameterMm: Millimeters;
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
  if (!(config.usefulLengthMm > 0)) errors.push('El largo útil debe ser mayor a 0 mm.');
  if (config.usefulLengthMm > config.machineBedWidthMm) {
    errors.push(`El largo útil (${config.usefulLengthMm} mm) supera el ancho de la máquina (${config.machineBedWidthMm} mm).`);
  }
  if (!(config.arcDeg > 0) || config.arcDeg > 360) errors.push('El arco a grabar debe estar entre 1° y 360°.');

  const circumferenceMm = rotaryCircumferenceMm(config.objectDiameterMm);
  const arcLengthMm = roundMm(circumferenceMm * Math.min(Math.max(config.arcDeg, 0), 360) / 360);

  if (design.widthMm > config.usefulLengthMm) {
    errors.push(`El diseño (${design.widthMm} mm a lo largo del eje) no entra en el largo útil de ${config.usefulLengthMm} mm.`);
  }
  if (design.heightMm > arcLengthMm) {
    errors.push(`El diseño (${design.heightMm} mm alrededor del objeto) no entra en el arco de ${arcLengthMm} mm.`);
  } else if (config.arcDeg >= 360 && design.heightMm > circumferenceMm * 0.98) {
    warnings.push('El diseño ocupa casi toda la circunferencia: los extremos pueden tocarse en la costura.');
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
  };
}
