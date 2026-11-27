/**
 * Astra Studio — Módulo Mesa de Trabajo y Control Vank 9060 (Estilo LightBurn Pro 2.2)
 * Tipos de dominio para armado libre en plancha o rollo de Ecocuero (73 cm x 5 m),
 * empaquetado continuo Cero Desperdicio, editor avanzado de ajustes de corte/grabado (C00..C29),
 * generador de Matriz de Calibración de Potencia x Velocidad (Material Test Generator),
 * Biblioteca de Materiales y carga directa a Ruida RDC8445S (192.168.0.195).
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
/** Ancho real del rollo de Ecocuero cortado para entrar en la mesa de la Vank 9060 (73 cm = 730 mm) */
export const ECOCUERO_ROLL_WIDTH_MM = 730;
/** Profundidad máxima de una tirada sobre la mesa de la Vank 9060 (60 cm = 600 mm) */
export const ECOCUERO_BED_PASS_HEIGHT_MM = 600;
/** Largo total del rollo de Ecocuero enrollado a lo largo (5 m = 5000 mm = 500 cm) */
export const ECOCUERO_ROLL_TOTAL_LENGTH_MM = 5000;

export type LightBurnCutMode = 'image' | 'fill' | 'line' | 'offset_fill';

export type LightBurnImageDitherMode =
  | 'threshold'
  | 'jarvis'
  | 'stucki'
  | 'halftone'
  | 'grayscale'
  | 'pass_through';

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

export type WorkbenchExecutionSequenceMode = 'sequential_per_job' | 'global_by_layer';

export type WorkbenchEngraveGrouping = 'all_at_once' | 'per_piece';

export type WorkbenchTravelOrder = 'zigzag_rows' | 'left_to_right' | 'top_to_bottom';

export type MaterialSavingPreset =
  | 'extreme_zero_waste'
  | 'compact_safe'
  | 'standard';

/** Paleta oficial de 30 capas de LightBurn (C00..C29) + T1 y T2 */
export const LIGHTBURN_PALETTE_COLORS: { code: string; index: number; hex: string }[] = [
  { code: '00', index: 0, hex: '#000000' },
  { code: '01', index: 1, hex: '#0000FF' },
  { code: '02', index: 2, hex: '#FF0000' },
  { code: '03', index: 3, hex: '#00E000' },
  { code: '04', index: 4, hex: '#D0D000' },
  { code: '05', index: 5, hex: '#FF8000' },
  { code: '06', index: 6, hex: '#00E0E0' },
  { code: '07', index: 7, hex: '#FF00FF' },
  { code: '08', index: 8, hex: '#B4B4B4' },
  { code: '09', index: 9, hex: '#0000A0' },
  { code: '10', index: 10, hex: '#A00000' },
  { code: '11', index: 11, hex: '#00A000' },
  { code: '12', index: 12, hex: '#A0A000' },
  { code: '13', index: 13, hex: '#C08000' },
  { code: '14', index: 14, hex: '#00A0FF' },
  { code: '15', index: 15, hex: '#A000A0' },
  { code: '16', index: 16, hex: '#808080' },
  { code: '17', index: 17, hex: '#7D87B9' },
  { code: '18', index: 18, hex: '#BB7784' },
  { code: '19', index: 19, hex: '#4A6FE3' },
  { code: '20', index: 20, hex: '#D33F6A' },
  { code: '21', index: 21, hex: '#8CD790' },
  { code: '22', index: 22, hex: '#F0B98D' },
  { code: '23', index: 23, hex: '#F6C4E1' },
  { code: '24', index: 24, hex: '#FA9ED4' },
  { code: '25', index: 25, hex: '#500A78' },
  { code: '26', index: 26, hex: '#B45A00' },
  { code: '27', index: 27, hex: '#004754' },
  { code: '28', index: 28, hex: '#86FA88' },
  { code: '29', index: 29, hex: '#FFDB66' },
];

export interface WorkbenchLayerConfig {
  /** Índice de capa estilo LightBurn: 0 (C00), 1 (C01), 2 (C02)... */
  cutIndex: number;
  /** Código visual: 'C00', 'C01', 'C02', etc. */
  code: string;
  /** Rol lógico vinculado a las capas del diseño */
  role: OperationLayerType;
  /** Nombre descriptivo de la capa (ej. 'GRABADO', 'ORIFICIOS INTERNOS', 'CORTE EXTERIOR') */
  name: string;
  /** Color hexadecimal estándar de la paleta LightBurn */
  hexColor: string;
  /** Modo de operación láser estilo LightBurn: Imagen, Relleno (Fill), Línea (Line), Relleno Offset */
  mode: LightBurnCutMode;
  /** Velocidad en mm/s — Null indica pendiente de ingreso/validación por el operador */
  speedMmPerSec: number | null;
  /** Potencia máxima (%) — Null indica pendiente de ingreso/validación por el operador */
  maxPowerPercent: number | null;
  /** Potencia mínima (%) en esquinas para controladora Ruida */
  minPowerPercent: number | null;
  /** Cantidad de pasadas (1..20) */
  passes: number;
  /** Intervalo de escaneo entre líneas en mm (ej. 0.073 mm = 348 DPI, 0.100 mm = 254 DPI) */
  lineIntervalMm: number;
  /** Ángulo de barrido en grados (por defecto 0°) */
  scanAngleDeg: number;
  /** Barrido bidireccional activado (por defecto true) */
  bidirectional?: boolean;
  /** Sombreado cruzado (Cross-hatch) al finalizar la pasada */
  crossHatch?: boolean;
  /** Porcentaje de sobreescaneo (Overscan) en modo Relleno/Imagen */
  overscanPercent?: number;
  /** Modo de tramado cuando mode === 'image' (Umbral, Jarvis, Stucki, Halftone, Escala de grises) */
  imageDitherMode?: LightBurnImageDitherMode;
  /** Desplazamiento de Kerf en mm para modo Línea (+ hacia afuera, - hacia adentro) */
  kerfOffsetMm?: number;
  /** Sobre-corte (Overcut) en mm al cerrar contornos en modo Línea */
  overcutMm?: number;
  /** Retardo de inicio/perforación en milisegundos */
  startPauseMs?: number;
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

export interface MaterialTestGridConfig {
  /** Tipo de matriz de prueba: Grabado (Imagen/Relleno) o Corte (Línea) */
  testType: 'engrave_grid' | 'cut_grid';
  /** Capa destino donde se aplicará el resultado ganador */
  targetRole: 'ENGRAVE' | 'HOLES' | 'CUT';
  /** Rango de Velocidad (mm/s) — Eje Y (Filas) */
  minSpeedMmS: number;
  maxSpeedMmS: number;
  speedSteps: number; // 2..8 filas
  /** Rango de Potencia Máx (%) — Eje X (Columnas) */
  minPowerPercent: number;
  maxPowerPercent: number;
  powerSteps: number; // 2..8 columnas
  /** Intervalo de línea en mm (para prueba de grabado, ej. 0.073 mm = 348 DPI) */
  lineIntervalMm: number;
  /** Tamaño de cada celda cuadrada en mm (ej. 10 mm) */
  cellSizeMm: number;
  /** Separación entre celdas en mm (ej. 3 mm) */
  cellGapMm: number;
  /** Asistencia de aire durante la prueba */
  airAssist: boolean;
  /** Pasadas por celda */
  passes: number;
}

export interface MaterialTestCell {
  row: number;
  col: number;
  cutIndex: number;
  layerCode: string;
  hexColor: string;
  speedMmPerSec: number;
  maxPowerPercent: number;
  minPowerPercent: number;
  lineIntervalMm: number;
  xMm: Millimeters;
  yMm: Millimeters;
  sizeMm: Millimeters;
}

export interface SavedMaterialLibraryEntry {
  id: string;
  materialName: string;
  thicknessMm: number;
  description: string;
  updatedAt: string;
  engrave: {
    mode: LightBurnCutMode;
    speedMmPerSec: number;
    maxPowerPercent: number;
    minPowerPercent: number;
    lineIntervalMm: number;
    passes: number;
    airAssist: boolean;
    imageDitherMode: LightBurnImageDitherMode;
  };
  holes: {
    speedMmPerSec: number;
    maxPowerPercent: number;
    minPowerPercent: number;
    passes: number;
    airAssist: boolean;
  };
  cut: {
    speedMmPerSec: number;
    maxPowerPercent: number;
    minPowerPercent: number;
    passes: number;
    airAssist: boolean;
    kerfOffsetMm: number;
  };
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
  /** Esquina donde hace Home la máquina Ruida (en Vank 9060 es superior-derecha) */
  machineOriginCorner: MachineOriginCorner;
  /** Modo "Iniciar desde" estilo LightBurn */
  startFromMode: StartFromMode;
  /** Punto de anclaje del origen del trabajo (9 puntos — en Vank 9060 por defecto top_right) */
  jobOriginAnchor: JobOriginAnchor;
  /** Coordenadas del origen de usuario o cabezal en la mesa (mm) */
  userOriginXMm: Millimeters;
  userOriginYMm: Millimeters;
  /** Solicitar nombre de archivo al enviar a la Vank 9060 */
  promptForFilenameOnSend?: boolean;
  /** Cortar sólo gráficos seleccionados */
  cutSelectedGraphicsOnly?: boolean;
  /** Usar origen de selección */
  useSelectionOrigin?: boolean;
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
  /** Secuencia de ejecución con varios archivos: terminar trabajo #1 completo antes de pasar al #2, o global por capa */
  executionSequenceMode?: WorkbenchExecutionSequenceMode;
  /** Cómo graba C00 cuando hay muchas etiquetas: todas las de la misma fila juntas (LightBurn) o etiqueta por etiqueta */
  engraveGrouping?: WorkbenchEngraveGrouping;
  /** Sentido ordenado de barrido dentro de cada trabajo (serpenteo zigzag, izq→der o arriba→abajo) */
  travelOrder?: WorkbenchTravelOrder;
  /** Al optimizar el espacio, respetar el orden #1 → #2 → #3 definido por el operador */
  preserveJobSequenceInNesting?: boolean;
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
  /** Porcentaje estimado de material desperdiciado en la franja consumida (%) */
  wastePercent?: number;
  /** Área desperdiciada estimada dentro de la franja consumida (cm²) */
  wasteAreaCm2?: number;
  /** Área real aprovechada por etiquetas (cm²) */
  usedPiecesAreaCm2?: number;
  /** Retazo rectangular limpio al costado derecho si hay espacio reutilizable */
  reusableSideRemnantMm?: { widthMm: Millimeters; heightMm: Millimeters } | null;
  /** Cantidad de pasadas físicas de mesa Vank (máx 600 mm por pasada) requeridas por esta tirada */
  sheetPassCount?: number;
  /** Centímetros libres restantes dentro de la pasada de mesa actual de 60 cm antes de tener que avanzar el rollo */
  remainingInCurrentPassCm?: number;
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
  /** Índice secuencial del trabajo (0-based) e ID para auditar ejecución ordenada trabajo por trabajo */
  jobIndex?: number;
  jobId?: string;
  jobName?: string;
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
      lineIntervalMm: eng?.lineIntervalMm ?? 0.073,
      scanAngleDeg: 0,
      bidirectional: true,
      crossHatch: false,
      overscanPercent: 2.5,
      imageDitherMode: 'threshold',
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
      kerfOffsetMm: 0,
      overcutMm: 0,
      startPauseMs: 0,
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
      kerfOffsetMm: 0,
      overcutMm: 0,
      startPauseMs: 0,
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
    promptForFilenameOnSend: true,
    cutSelectedGraphicsOnly: false,
    useSelectionOrigin: false,
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
    executionSequenceMode: 'sequential_per_job',
    engraveGrouping: 'all_at_once',
    travelOrder: 'zigzag_rows',
    preserveJobSequenceInNesting: false,
    ruidaIpAddress: VANK_9060_DEFAULT_IP,
    ruidaPort: 50200,
    ruidaJobName: 'ASTRA01',
    layers: createDefaultWorkbenchLayers(material),
  };
}
