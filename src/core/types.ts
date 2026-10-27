/**
 * LaserHouse Studio — Core Domain Types
 * Todas las dimensiones geométricas se expresan estrictamente en milímetros (mm).
 * Máquina de referencia: Vank 9060 CO2 (Área útil: 900 x 600 mm, Controladora Ruida RDC8445S).
 */

export type Millimeters = number;

export interface Point2D {
  x: Millimeters;
  y: Millimeters;
}

export interface BoundingBox {
  minX: Millimeters;
  minY: Millimeters;
  maxX: Millimeters;
  maxY: Millimeters;
  width: Millimeters;
  height: Millimeters;
}

export type LabelShapeType =
  | 'rectangle'
  | 'square'
  | 'rounded_rect'
  | 'circle'
  | 'oval'
  | 'capsule'
  | 'octagon_tag'
  | 'custom_polygon';

export type HolePreset =
  | 'none'
  | 'single_left'
  | 'single_top'
  | 'two_horizontal'
  | 'two_vertical'
  | 'four_corners'
  | 'custom';

export interface HoleSpec {
  id: string;
  /** Coordenada X relativa al origen superior-izquierdo de la etiqueta (mm) */
  x: Millimeters;
  /** Coordenada Y relativa al origen superior-izquierdo de la etiqueta (mm) */
  y: Millimeters;
  /** Diámetro del agujero en milímetros reales */
  diameterMm: Millimeters;
}

export interface HoleConfiguration {
  preset: HolePreset;
  diameterMm: Millimeters;
  /** Distancia del centro del agujero al borde más cercano (mm) */
  edgeDistanceMm: Millimeters;
  customHoles: HoleSpec[];
}

export type OperationLayerType = 'ENGRAVE' | 'HOLES' | 'CUT' | 'GUIDE';

export interface LayerColorSpec {
  layer: OperationLayerType;
  name: string;
  lightBurnIndex: string;
  hexColor: string;
  dxfColorIndex: number; // AutoCAD Color Index (ACI): 7=White/Black, 5=Blue, 1=Red
  productive: boolean;
}

export const LIGHTBURN_LAYERS: Record<OperationLayerType, LayerColorSpec> = {
  ENGRAVE: {
    layer: 'ENGRAVE',
    name: 'GRABADO',
    lightBurnIndex: '00',
    hexColor: '#000000',
    dxfColorIndex: 7,
    productive: true,
  },
  HOLES: {
    layer: 'HOLES',
    name: 'AGUJEROS',
    lightBurnIndex: '01',
    hexColor: '#0000FF',
    dxfColorIndex: 5,
    productive: true,
  },
  CUT: {
    layer: 'CUT',
    name: 'CORTE',
    lightBurnIndex: '02',
    hexColor: '#FF0000',
    dxfColorIndex: 1,
    productive: true,
  },
  GUIDE: {
    layer: 'GUIDE',
    name: 'GUIAS',
    lightBurnIndex: 'T1',
    hexColor: '#F57900',
    dxfColorIndex: 30,
    productive: false,
  },
};

export interface ImageProcessingOptions {
  /** Modo de salida para grabado: vectorizado real (Marching Squares) o raster monocromático */
  mode: 'vector' | 'raster';
  /** Umbral blanco y negro (0 a 255) */
  threshold: number;
  /** Ajuste de brillo (-100 a 100) */
  brightness: number;
  /** Ajuste de contraste (-100 a 100) */
  contrast: number;
  /** Invertir zonas claras/oscuras */
  invert: boolean;
  /** Eliminar fondo claro automáticamente */
  removeBackground: boolean;
  /** Tolerancia de eliminación de fondo (0 a 100) */
  backgroundTolerance: number;
  /** Tolerancia de simplificación vectorial RDP en píxeles (ej. 0.8) */
  turdSize: number;
}

export interface DesignElementBase {
  id: string;
  name: string;
  type: 'logo_svg' | 'logo_raster' | 'vector_text' | 'decorative_border';
  /** Posición del centro del elemento en mm dentro de la etiqueta (relativo a 0..width, 0..height) */
  xMm: Millimeters;
  yMm: Millimeters;
  /** Dimensiones reales del elemento en mm */
  widthMm: Millimeters;
  heightMm: Millimeters;
  /** Relación de aspecto original ancho/alto */
  aspectRatio: number;
  lockAspectRatio: boolean;
  /** Rotación en grados */
  rotationDeg: number;
  locked: boolean;
  visible: boolean;
  groupId?: string;
}

export interface SvgLogoElement extends DesignElementBase {
  type: 'logo_svg';
  rawSvgContent: string;
  /** Paths extraídos y normalizados a un viewBox local [0, 0, originalWidth, originalHeight] */
  normalizedPaths: string[];
  originalViewBox: { minX: number; minY: number; width: number; height: number };
}

export interface RasterLogoElement extends DesignElementBase {
  type: 'logo_raster';
  originalDataUrl: string;
  processedDataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  processing: ImageProcessingOptions;
  /** Trazados vectoriales cerrados generados por Marching Squares normalizados a [0..1, 0..1] */
  vectorizedPathsNormalized: string[];
  /** DPI efectivo calculado en base al tamaño en mm en la etiqueta */
  effectiveDpi: number;
}

export interface VectorTextElement extends DesignElementBase {
  type: 'vector_text';
  text: string;
  fontSizeMm: Millimeters;
  letterSpacingMm: Millimeters;
  fontStyle: 'sans_industrial' | 'serif_classic' | 'stencil_bold';
  /** Indica si se graba como relleno/trazo en capa GRABADO */
  strokeWidthMm: Millimeters;
}

export interface DecorativeBorderElement extends DesignElementBase {
  type: 'decorative_border';
  insetMm: Millimeters;
  strokeWidthMm: Millimeters;
  dashed: boolean;
}

export type LabelElement =
  | SvgLogoElement
  | RasterLogoElement
  | VectorTextElement
  | DecorativeBorderElement;

export interface LabelDesign {
  id: string;
  name: string;
  shape: LabelShapeType;
  /** Ancho nominal de la etiqueta en milímetros */
  widthMm: Millimeters;
  /** Alto nominal de la etiqueta en milímetros */
  heightMm: Millimeters;
  /** Radio de esquina en mm (para rounded_rect) */
  cornerRadiusMm: Millimeters;
  /** Margen de seguridad interior en mm (guía no productiva) */
  safetyMarginMm: Millimeters;
  /** Compensación de kerf de corte en mm (0 = sin compensación, editable tras calibración física) */
  kerfCompensationMm: Millimeters;
  /** Configuración de agujeros para costura o sujeción */
  holes: HoleConfiguration;
  /** Puntos personalizados si shape === 'custom_polygon' (normalizados 0..1) */
  customPolygonNormalized?: Point2D[];
  /** Elementos de grabado dentro de la etiqueta */
  elements: LabelElement[];
}

export interface ClosedContour {
  id: string;
  layer: OperationLayerType;
  /** Lista ordenada de vértices en milímetros reales; el contorno es implícitamente cerrado entre el último y el primero */
  points: Point2D[];
  /** Representación SVG path ('M ... L ... Z' o curvas exactas cerradas con Z) */
  svgPathD: string;
  closed: boolean;
  boundingBox: BoundingBox;
  /** Si proviene de un círculo o elipse exacta, metadatos para primitiva DXF/SVG precisa */
  primitive?:
    | { kind: 'circle'; cx: Millimeters; cy: Millimeters; r: Millimeters }
    | { kind: 'ellipse'; cx: Millimeters; cy: Millimeters; rx: Millimeters; ry: Millimeters }
    | {
        kind: 'rect';
        x: Millimeters;
        y: Millimeters;
        width: Millimeters;
        height: Millimeters;
        rx: Millimeters;
      };
}

export interface EngravedItemGeometry {
  id: string;
  kind: 'vector_path' | 'raster_image';
  /** Para vector_path: SVG path en coordenadas absolutas (mm) y polilíneas discretizadas para DXF/validación */
  svgPathD?: string;
  polylines?: { points: Point2D[]; closed: boolean }[];
  strokeWidthMm?: Millimeters;
  fillRule?: 'nonzero' | 'evenodd';
  filled?: boolean;
  /** Para raster_image: imagen procesada monocromática y su caja en mm */
  dataUrl?: string;
  xMm?: Millimeters;
  yMm?: Millimeters;
  widthMm?: Millimeters;
  heightMm?: Millimeters;
  rotationDeg?: number;
  boundingBox: BoundingBox;
}

export interface CompiledLabelGeometry {
  nominalWidthMm: Millimeters;
  nominalHeightMm: Millimeters;
  effectiveCutWidthMm: Millimeters;
  effectiveCutHeightMm: Millimeters;
  outerCutContour: ClosedContour;
  holeContours: ClosedContour[];
  engravingItems: EngravedItemGeometry[];
  safetyGuideContour: ClosedContour;
}

export type MaterialId =
  | 'ECOCUERO_SUELA'
  | 'ACRILICO_TRANSPARENTE'
  | 'ACRILICO_ESPEJO_PLATEADO'
  | 'POLIAMIDA_BLANCA'
  | 'MDF_3MM'
  | 'PAPEL_KRAFT';

export interface LaserOperationParams {
  /** Velocidad en mm/s — Null o 0 indica que debe ser ingresada/validada por el operador */
  speedMmPerSec: number | null;
  /** Potencia máxima (%) — Null indica que debe ser ingresada/validada por el operador */
  maxPowerPercent: number | null;
  /** Potencia mínima (%) para esquinas en Ruida */
  minPowerPercent: number | null;
  /** Pasadas */
  passes: number;
  /** Intervalo de escaneo en mm (sólo para grabado) */
  lineIntervalMm?: number;
  /** Confirmado en máquina real por el operador */
  operatorValidated: boolean;
  notes: string;
}

export interface MaterialProfile {
  id: MaterialId | string;
  code: string;
  name: string;
  category: 'synthetic_leather' | 'acrylic' | 'textile_ribbon' | 'wood' | 'paper' | 'custom';
  thicknessMm: Millimeters;
  availableThicknessesMm: Millimeters[];
  /** Ancho fijo de rollo/cinta en mm (ej. 30 mm para Poliamida Blanca) o null si es plancha */
  fixedRibbonWidthMm: Millimeters | null;
  visual: {
    surfaceColor: string;
    surfaceSecondaryColor: string;
    engraveColor: string;
    cutStrokeColor: string;
    opacity: number;
    metallic: boolean;
    textureStyle: 'leather' | 'glass' | 'mirror' | 'ribbon' | 'wood' | 'paper';
  };
  safetyWarning: string | null;
  requiresCompositionConfirmation: boolean;
  compositionConfirmedByOperator: boolean;
  separatePrintWorkflow: boolean;
  mirrorArtworkForBackEngrave: boolean;
  engraveParams: LaserOperationParams;
  holesParams: LaserOperationParams;
  cutParams: LaserOperationParams;
}

export interface NestingConfig {
  /** Cantidad total de etiquetas solicitadas en el pedido */
  requestedQuantity: number;
  /** Ancho de la mesa de la máquina en mm (Vank 9060 = 900 mm) */
  machineBedWidthMm: Millimeters;
  /** Alto de la mesa de la máquina en mm (Vank 9060 = 600 mm) */
  machineBedHeightMm: Millimeters;
  /** Ancho del recorte o plancha de material colocado sobre la mesa (mm) */
  sheetWidthMm: Millimeters;
  /** Alto del recorte o plancha de material colocado sobre la mesa (mm) */
  sheetHeightMm: Millimeters;
  /** Separación horizontal entre etiquetas en mm */
  gapXMm: Millimeters;
  /** Separación vertical entre etiquetas en mm */
  gapYMm: Millimeters;
  /** Márgenes perimetrales del material en mm */
  marginTopMm: Millimeters;
  marginRightMm: Millimeters;
  marginBottomMm: Millimeters;
  marginLeftMm: Millimeters;
  /** Orientación permitida: 0°, 90° o automática para maximizar aprovechamiento */
  rotationMode: '0' | '90' | 'auto_optimize';
  /** Centrar el bloque de etiquetas dentro del área útil del material */
  centerInSheet: boolean;
  /** Rellenar toda la plancha aunque supere la cantidad pedida (por defecto FALSE según regla 6) */
  fillEntireSheetCapacity: boolean;
}

export interface PlacedLabelInstance {
  instanceIndex: number; // 1..totalQuantity
  batchIndex: number; // 0..totalBatches-1
  indexInBatch: number; // 0..batchCount-1
  row: number;
  col: number;
  /** Coordenada X de la esquina superior-izquierda en la plancha (mm) */
  xMm: Millimeters;
  /** Coordenada Y de la esquina superior-izquierda en la plancha (mm) */
  yMm: Millimeters;
  widthMm: Millimeters;
  heightMm: Millimeters;
  rotated90: boolean;
  boundingBox: BoundingBox;
}

export interface ProductionBatch {
  batchNumber: number; // 1-based
  totalBatches: number;
  count: number;
  columnsUsed: number;
  rowsUsed: number;
  placedInstances: PlacedLabelInstance[];
  /** Caja envolvente real del conjunto de piezas en esta tanda */
  occupiedBounds: BoundingBox;
  /** Porcentaje de aprovechamiento del área del material en esta tanda */
  sheetUtilizationPercent: number;
  /** Porcentaje de aprovechamiento respecto a la envolvente ocupada */
  boundingBoxEfficiencyPercent: number;
}

export interface NestingResult {
  config: NestingConfig;
  appliedRotationDeg: 0 | 90;
  pieceWidthMm: Millimeters;
  pieceHeightMm: Millimeters;
  maxColumnsPerSheet: number;
  maxRowsPerSheet: number;
  maxCapacityPerSheet: number;
  totalRequestedQuantity: number;
  totalExportedQuantity: number;
  totalBatches: number;
  batches: ProductionBatch[];
  /** Comparativa de capacidad entre orientación 0° y 90° */
  orientationComparison: {
    deg0Capacity: number;
    deg0Cols: number;
    deg0Rows: number;
    deg90Capacity: number;
    deg90Cols: number;
    deg90Rows: number;
  };
  warnings: string[];
  errors: string[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface GeometricValidationReport {
  isValid: boolean;
  timestamp: string;
  labelDimensionsMm: { width: Millimeters; height: Millimeters };
  effectiveCutDimensionsMm: { width: Millimeters; height: Millimeters };
  sheetDimensionsMm: { width: Millimeters; height: Millimeters };
  machineLimitMm: { width: Millimeters; height: Millimeters };
  allContoursClosed: boolean;
  duplicateCutSegmentsCount: number;
  overlappingPiecesCount: number;
  outOfBoundsPiecesCount: number;
  invalidHolesCount: number;
  engraveInvasionCount: number;
  engraveSafetyWarningCount: number;
  totalProductiveCutContours: number;
  totalProductiveHoleContours: number;
  totalProductiveEngraveItems: number;
  issues: ValidationIssue[];
}

export interface ExportedFileRecord {
  id: string;
  filename: string;
  format: 'svg_combined' | 'svg_engrave_only' | 'svg_cut_only' | 'dxf_rdworks' | 'production_summary';
  batchNumber: number;
  createdAt: string;
  quantityInFile: number;
  widthMm: Millimeters;
  heightMm: Millimeters;
}

export interface OrderProject {
  id: string;
  projectName: string;
  clientName: string;
  createdAt: string;
  updatedAt: string;
  notes: string;
  materialId: string;
  materialProfileSnapshot: MaterialProfile;
  labelDesign: LabelDesign;
  nestingConfig: NestingConfig;
  exportedFilesHistory: ExportedFileRecord[];
}
