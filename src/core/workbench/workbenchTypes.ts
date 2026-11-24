/**
 * Astra Studio — Módulo Mesa de Trabajo y Control Vank 9060 (Estilo LightBurn)
 * Tipos de dominio para armado libre en plancha o rollo de Ecocuero (73 cm x 5 m),
 * empaquetado continuo Cero Desperdicio (intercalado pieza a pieza sin huecos entre logos),
 * capas de corte/grabado (C00..C29), simulación de trayectoria y carga a Ruida RDC8445S.
 */

import {
  BoundingBox,
  ClosedContour,
  EngravedItemGeometry,
  LabelDesign,
  MaterialProfile,
  Millimeters,
  OperationLayerType,
} from '../types';

/** Dirección IP real de la Vank 9060 (Ruida RDC8445S) en la red local del taller */
export const VANK_9060_DEFAULT_IP = '192.168.0.195';
export const ECOCUERO_ROLL_WIDTH_MM = 730;
/** Profundidad máxima de una tirada sobre la mesa de la Vank 9060 (60 cm = 600 mm) */
export const ECOCUERO_BED_PASS_HEIGHT_MM = 600;
/** Largo total del rollo de Ecocuero enrollado a lo largo (5 m = 5000 mm = 500 cm) */
export const ECOCUERO_ROLL_TOTAL_LENGTH_MM = 5000;

export type LightBurnCutMode = 'fill' | 'line' | 'offset_fill';

export type MachineOriginCorner = 'top_right' | 'top_left' | 'bottom_left' | 'bottom_right';

export type StartFromMode = 'absolute_coords' | 'user_origin' | 'current_position';

export type JobOriginAnchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'middle_left'
  | 'center'
  | 'middle_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

export type WorkbenchPackingMode = 'continuous_zero_waste' | 'rectangular_blocks';

export type MaterialSavingPreset =
  | 'extreme_zero_waste'
  | 'compact_safe'
  | 'standard';

export interface WorkbenchLayerConfig {
  /** Índice de capa estilo LightBurn: 0 (C00), 1 (C01), 2 (C02)... */
  cutIndex: number;
  /** Código visual: 'C00', 'C01', 'C02', etc. */
  code: string;
  /** Rol lógico vinculado a las capas del diseño */
  role: OperationLayerType;
  /** Nombre descriptivo de la capa (ej. 'GRABADO', 'AGUJEROS INTERNOS', 'CORTE EXTERIOR') */
  name: string;
  /** Color hexadecimal estándar de la paleta LightBurn */
  hexColor: string;
  /** Modo de operación láser */
  mode: LightBurnCutMode;
  /** Velocidad en mm/s — Null indica pendiente de ingreso/validación por el operador */
  speedMmPerSec: number | null;
  /** Potencia máxima (%) — Null indica pendiente de ingreso/validación por el operador */
  maxPowerPercent: number | null;
  /** Potencia mínima (%) en esquinas para controladora Ruida */
  minPowerPercent: number | null;
  /** Cantidad de pasadas (1..20) */
  passes: number;
  /** Intervalo de escaneo entre líneas en mm (para modo fill/grabado, ej. 0.10 mm = 254 DPI) */
  lineIntervalMm: number;
  /** Ángulo de barrido en grados (por defecto 0°) */
  scanAngleDeg: number;
  /** Asistencia de aire (Air Assist) activada en la controladora Ruida */
  airAssist: boolean;
  /** Si la capa se envía a la salida láser */
  outputEnabled: boolean;
  /** Si la capa es visible en el lienzo de la mesa */
  visible: boolean;
  /** Orden de prioridad de ejecución (menor número se ejecuta primero: 0 = primero) */
  priority: number;
  /** Confirmado por el operador para el material actual */
  operatorValidated: boolean;
}

export interface WorkbenchPlacedInstance {
  instanceIndex: number;
  /** Posición local X dentro del grupo/trabajo (mm) */
  localXMm: Millimeters;
  /** Posición local Y dentro del grupo/trabajo (mm) */
  localYMm: Millimeters;
  widthMm: Millimeters;
  heightMm: Millimeters;
  rotated90: boolean;
  engraveItems: EngravedItemGeometry[];
  holeContours: ClosedContour[];
  cutContour: ClosedContour;
}

export interface WorkbenchJobItem {
  id: string;
  name: string;
  clientName: string;
  sourceOrderId: string;
  createdAt: string;
  /** Diseño de etiqueta fuente para recompilación exacta */
  labelDesign: LabelDesign;
  /** Posición X de la esquina superior-izquierda del bloque en la plancha/mesa (mm) */
  xMm: Millimeters;
  /** Posición Y de la esquina superior-izquierda del bloque en la plancha/mesa (mm) */
  yMm: Millimeters;
  /** Ancho total de la envolvente del trabajo (mm) */
  widthMm: Millimeters;
  /** Alto total de la envolvente del trabajo (mm) */
  heightMm: Millimeters;
  /** Rotación adicional de cada etiqueta dentro del trabajo (0 o 90 grados) */
  blockRotationDeg: 0 | 90;
  /** Cantidad de etiquetas incluidas en este trabajo */
  pieceCount: number;
  /** Filas y columnas máximas de referencia */
  columns: number;
  rows: number;
  gapXMm: Millimeters;
  gapYMm: Millimeters;
  /** Desplazamiento X inicial en la primera fila para intercalado continuo sin huecos con el trabajo anterior */
  firstRowIndentMm?: Millimeters;
  /** Altura de la fila compartida si la primera fila convive con etiquetas más altas */
  firstRowShelfHeightMm?: Millimeters;
  /** Posición X local donde termina la última etiqueta de la última fila */
  lastRowEndXMm?: Millimeters;
  /** Posición Y local donde comienza la última fila */
  lastRowLocalYMm?: Millimeters;
  /** Instancias compiladas en coordenadas locales [0..widthMm, 0..heightMm] */
  instances: WorkbenchPlacedInstance[];
  locked: boolean;
  visible: boolean;
}

export interface WorkbenchConfig {
  /** Dimensiones físicas de la mesa Vank 9060 (900 x 600 mm) */
  machineBedWidthMm: Millimeters;
  machineBedHeightMm: Millimeters;
  /** Esquina donde hace Home la máquina Ruida (en Vank 9060 suele ser superior-derecha o superior-izquierda) */
  machineOriginCorner: MachineOriginCorner;
  /** Modo "Comenzar desde" estilo LightBurn */
  startFromMode: StartFromMode;
  /** Punto de anclaje del origen del trabajo (9 puntos) */
  jobOriginAnchor: JobOriginAnchor;
  /** Coordenadas del origen de usuario o cabezal en la mesa (mm) */
  userOriginXMm: Millimeters;
  userOriginYMm: Millimeters;
  /** Dimensiones de la plancha/rollo colocada sobre la mesa (mm). Para Ecocuero: 730 x 600 mm */
  sheetWidthMm: Millimeters;
  sheetHeightMm: Millimeters;
  /** Indica si el material proviene de un rollo continuo (ej. Ecocuero 73 cm x 5 m) */
  isRollMaterial: boolean;
  /** Largo total del rollo en milímetros (ej. 5000 mm = 5 m para Ecocuero) */
  rollTotalLengthMm: Millimeters;
  /** Modo de empaquetado de múltiples trabajos: flujo continuo pieza a pieza (cero huecos) o bloques rectangulares */
  packingMode: WorkbenchPackingMode;
  /** Nivel de ahorro de márgenes y separaciones */
  savingPreset: MaterialSavingPreset;
  /** Rotar automáticamente 0°/90° cada trabajo para minimizar el avance lineal del rollo */
  autoRotateForMinRoll: boolean;
  /** Posición de la plancha sobre la mesa de 900x600 mm */
  sheetOffsetXMm: Millimeters;
  sheetOffsetYMm: Millimeters;
  /** Margen perimetral seguro dentro de la plancha (mm) */
  sheetSafetyMarginMm: Millimeters;
  /** Optimizar orden de corte: siempre interior antes de exterior */
  optimizeInsideOut: boolean;
  /** Dirección IP de la controladora Ruida RDC8445S en la red local */
  ruidaIpAddress: string;
  /** Puerto UDP de la Ruida (estándar 50200) */
  ruidaPort: number;
  /** Nombre del archivo en la memoria de la Ruida (máx 8 caracteres alfanuméricos) */
  ruidaJobName: string;
  /** Configuración de capas estilo LightBurn */
  layers: WorkbenchLayerConfig[];
}

export interface EcocueroRollMetrics {
  /** Ancho del rollo en mm (730 mm) y cm (73 cm) */
  rollWidthMm: Millimeters;
  rollWidthCm: number;
  /** Largo total del rollo en mm (5000 mm) y cm (500 cm = 5 m) */
  totalRollLengthMm: Millimeters;
  totalRollLengthCm: number;
  /** Avance lineal de rollo consumido en esta tirada (mm y cm) */
  usedLengthMm: Millimeters;
  usedLengthCm: number;
  /** Rollo restante luego de esta tirada (cm y m) */
  remainingRollLengthCm: number;
  remainingRollLengthMeters: number;
  /** Porcentaje del rollo de 5m consumido en esta tirada */
  rollConsumptionPercent: number;
  /** Porcentaje del ancho de 73 cm aprovechado */
  widthUtilizationPercent: number;
  /** Eficiencia real de área de etiquetas sobre la franja cortada del rollo (%) */
  stripAreaEfficiencyPercent: number;
  /** Cantidad de etiquetas adicionales que entran gratis en el hueco libre de la última fila (sin gastar ni 1 mm más de rollo) */
  freeSlotsInLastRow: number;
  /** Ancho libre disponible en la última fila en mm y cm */
  freeWidthInLastRowMm: Millimeters;
  freeWidthInLastRowCm: number;
  /** Milímetros y centímetros de rollo ahorrados frente a armado tradicional en bloques separados */
  savedRollLengthMm: Millimeters;
  savedRollLengthCm: number;
  /** Cantidad estimada de tiradas iguales que rinde el rollo de 5m */
  estimatedRunsPerRoll: number;
  /** Indica si el avance requerido supera los 600 mm de una tirada de mesa Vank 9060 */
  exceedsSingleBedPass: boolean;
}

export interface WorkbenchValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface WorkbenchValidationReport {
  isValidForExport: boolean;
  isValidForMachineSend: boolean;
  totalJobs: number;
  totalPieces: number;
  occupiedBoundsMm: BoundingBox | null;
  jobOriginPointMm: { x: Millimeters; y: Millimeters };
  outOfSheetJobsCount: number;
  outOfMachineBedJobsCount: number;
  overlappingJobsCount: number;
  unconfiguredLayersCount: number;
  issues: WorkbenchValidationIssue[];
}

export interface ToolpathSegment {
  id: string;
  kind: 'rapid_move' | 'engrave_scan' | 'hole_cut' | 'outer_cut';
  layerCode: string;
  hexColor: string;
  fromX: Millimeters;
  fromY: Millimeters;
  toX: Millimeters;
  toY: Millimeters;
  /** Polilínea completa si es un contorno continuo */
  points: { x: Millimeters; y: Millimeters }[];
  distanceMm: Millimeters;
  durationSec: number;
  startTimeSec: number;
  endTimeSec: number;
}

export interface WorkbenchSimulationResult {
  segments: ToolpathSegment[];
  totalDistanceMm: Millimeters;
  engraveDistanceMm: Millimeters;
  cutDistanceMm: Millimeters;
  rapidDistanceMm: Millimeters;
  totalDurationSec: number;
  engraveDurationSec: number;
  holesDurationSec: number;
  outerCutDurationSec: number;
  rapidDurationSec: number;
}

export function isEcocueroMaterial(material?: MaterialProfile): boolean {
  if (!material) return false;
  return (
    material.id === 'ECOCUERO_SUELA' ||
    material.category === 'synthetic_leather' ||
    material.name.toLowerCase().includes('ecocuero')
  );
}

export function createDefaultWorkbenchLayers(material?: MaterialProfile): WorkbenchLayerConfig[] {
  const eng = material?.engraveParams;
  const hol = material?.holesParams;
  const cut = material?.cutParams;

  return [
    {
      cutIndex: 0,
      code: 'C00',
      role: 'ENGRAVE',
      name: 'GRABADO',
      hexColor: '#000000',
      mode: 'fill',
      speedMmPerSec: eng?.speedMmPerSec ?? null,
      maxPowerPercent: eng?.maxPowerPercent ?? null,
      minPowerPercent: eng?.minPowerPercent ?? null,
      passes: eng?.passes ?? 1,
      lineIntervalMm: eng?.lineIntervalMm ?? 0.1,
      scanAngleDeg: 0,
      airAssist: false,
      outputEnabled: true,
      visible: true,
      priority: 0,
      operatorValidated: eng?.operatorValidated ?? false,
    },
    {
      cutIndex: 1,
      code: 'C01',
      role: 'HOLES',
      name: 'ORIFICIOS INTERNOS',
      hexColor: '#0000FF',
      mode: 'line',
      speedMmPerSec: hol?.speedMmPerSec ?? null,
      maxPowerPercent: hol?.maxPowerPercent ?? null,
      minPowerPercent: hol?.minPowerPercent ?? null,
      passes: hol?.passes ?? 1,
      lineIntervalMm: 0.1,
      scanAngleDeg: 0,
      airAssist: true,
      outputEnabled: true,
      visible: true,
      priority: 1,
      operatorValidated: hol?.operatorValidated ?? false,
    },
    {
      cutIndex: 2,
      code: 'C02',
      role: 'CUT',
      name: 'CORTE EXTERIOR',
      hexColor: '#FF0000',
      mode: 'line',
      speedMmPerSec: cut?.speedMmPerSec ?? null,
      maxPowerPercent: cut?.maxPowerPercent ?? null,
      minPowerPercent: cut?.minPowerPercent ?? null,
      passes: cut?.passes ?? 1,
      lineIntervalMm: 0.1,
      scanAngleDeg: 0,
      airAssist: true,
      outputEnabled: true,
      visible: true,
      priority: 2,
      operatorValidated: cut?.operatorValidated ?? false,
    },
  ];
}

export function createDefaultWorkbenchConfig(
  sheetWidthMm?: number,
  sheetHeightMm?: number,
  material?: MaterialProfile
): WorkbenchConfig {
  const isEco = isEcocueroMaterial(material);
  const resolvedWidth =
    sheetWidthMm !== undefined
      ? sheetWidthMm
      : isEco
        ? ECOCUERO_ROLL_WIDTH_MM
        : 600;
  const resolvedHeight =
    sheetHeightMm !== undefined
      ? sheetHeightMm
      : isEco
        ? ECOCUERO_BED_PASS_HEIGHT_MM
        : 400;

  return {
    machineBedWidthMm: 900,
    machineBedHeightMm: 600,
    machineOriginCorner: 'top_right',
    startFromMode: 'user_origin',
    jobOriginAnchor: 'top_left',
    userOriginXMm: 0,
    userOriginYMm: 0,
    sheetWidthMm: resolvedWidth,
    sheetHeightMm: resolvedHeight,
    isRollMaterial: isEco || resolvedWidth === ECOCUERO_ROLL_WIDTH_MM,
    rollTotalLengthMm: ECOCUERO_ROLL_TOTAL_LENGTH_MM,
    packingMode: 'continuous_zero_waste',
    savingPreset: 'extreme_zero_waste',
    autoRotateForMinRoll: true,
    sheetOffsetXMm: 0,
    sheetOffsetYMm: 0,
    sheetSafetyMarginMm: 5,
    optimizeInsideOut: true,
    ruidaIpAddress: VANK_9060_DEFAULT_IP,
    ruidaPort: 50200,
    ruidaJobName: 'ASTRA01',
    layers: createDefaultWorkbenchLayers(material),
  };
}
