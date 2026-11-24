/**
 * Astra Studio — Módulo Mesa de Trabajo y Control Vank 9060 (Estilo LightBurn)
 * Tipos de dominio para armado libre en plancha, gestión de capas de corte/grabado (C00..C29),
 * simulación de trayectoria y carga a controladora Ruida RDC8445S / exportación nativa .lbrn2 y .rd.
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
  /** Rotación adicional del bloque completo en la mesa (0 o 90 grados) */
  blockRotationDeg: 0 | 90;
  /** Cantidad de etiquetas incluidas en este bloque */
  pieceCount: number;
  /** Filas y columnas dentro de este bloque */
  columns: number;
  rows: number;
  gapXMm: Millimeters;
  gapYMm: Millimeters;
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
  /** Dimensiones de la plancha/recorte de material colocada sobre la mesa (mm) */
  sheetWidthMm: Millimeters;
  sheetHeightMm: Millimeters;
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
  sheetWidthMm = 600,
  sheetHeightMm = 400,
  material?: MaterialProfile
): WorkbenchConfig {
  return {
    machineBedWidthMm: 900,
    machineBedHeightMm: 600,
    machineOriginCorner: 'top_right',
    startFromMode: 'user_origin',
    jobOriginAnchor: 'top_left',
    userOriginXMm: 0,
    userOriginYMm: 0,
    sheetWidthMm,
    sheetHeightMm,
    sheetOffsetXMm: 0,
    sheetOffsetYMm: 0,
    sheetSafetyMarginMm: 5,
    optimizeInsideOut: true,
    ruidaIpAddress: '192.168.1.100',
    ruidaPort: 50200,
    ruidaJobName: 'ASTRA01',
    layers: createDefaultWorkbenchLayers(material),
  };
}
