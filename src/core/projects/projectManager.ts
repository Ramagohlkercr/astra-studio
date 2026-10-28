import { roundMm } from '../geometry/geometryEngine';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { DEFAULT_NESTING_CONFIG } from '../nesting/nestingEngine';
import {
  LabelDesign,
  Millimeters,
  NestingConfig,
  OrderProject,
} from '../types';

const STORAGE_KEY = 'laserhouse_studio_orders_v1';

export interface DimensionPreset {
  id: string;
  label: string;
  widthMm: Millimeters;
  heightMm: Millimeters;
  recommendedShape: LabelDesign['shape'];
  recommendedCornerRadiusMm: Millimeters;
}

export interface SheetSizePreset {
  id: string;
  label: string;
  widthMm: Millimeters;
  heightMm: Millimeters;
  description: string;
}

export const STANDARD_DIMENSION_PRESETS: DimensionPreset[] = [
  {
    id: '10x10',
    label: '10 × 10 mm',
    widthMm: 10,
    heightMm: 10,
    recommendedShape: 'square',
    recommendedCornerRadiusMm: 0,
  },
  {
    id: '15x15',
    label: '15 × 15 mm',
    widthMm: 15,
    heightMm: 15,
    recommendedShape: 'rounded_rect',
    recommendedCornerRadiusMm: 2.0,
  },
  {
    id: '10x20',
    label: '10 × 20 mm',
    widthMm: 10,
    heightMm: 20,
    recommendedShape: 'rounded_rect',
    recommendedCornerRadiusMm: 1.5,
  },
  {
    id: '20x10',
    label: '20 × 10 mm',
    widthMm: 20,
    heightMm: 10,
    recommendedShape: 'rounded_rect',
    recommendedCornerRadiusMm: 1.5,
  },
  {
    id: '20x20',
    label: '20 × 20 mm',
    widthMm: 20,
    heightMm: 20,
    recommendedShape: 'circle',
    recommendedCornerRadiusMm: 0,
  },
  {
    id: '30x15',
    label: '30 × 15 mm',
    widthMm: 30,
    heightMm: 15,
    recommendedShape: 'rounded_rect',
    recommendedCornerRadiusMm: 2.0,
  },
];

export const MATERIAL_SHEET_PRESETS: SheetSizePreset[] = [
  {
    id: '900x600',
    label: '900 × 600 mm',
    widthMm: 900,
    heightMm: 600,
    description: 'Mesa completa Vank 9060 CO₂',
  },
  {
    id: '600x400',
    label: '600 × 400 mm',
    widthMm: 600,
    heightMm: 400,
    description: 'Plancha mediana estándar',
  },
  {
    id: '400x300',
    label: '400 × 300 mm',
    widthMm: 400,
    heightMm: 300,
    description: 'Recorte cuarto de plancha',
  },
  {
    id: '200x200',
    label: '200 × 200 mm',
    widthMm: 200,
    heightMm: 200,
    description: 'Recorte chico / muestra',
  },
];

export const STANDARD_QUANTITY_PRESETS: number[] = [50, 100, 200, 300, 500];

/**
 * Crea una etiqueta nueva desde cero.
 * REGLA OBLIGATORIA (Sprint 2 Punto 3): NO agregar agujeros automáticamente a etiquetas nuevas (preset: 'none').
 */
export function createBlankLabelDesign(
  widthMm = 20,
  heightMm = 10,
  shape: LabelDesign['shape'] = 'rounded_rect'
): LabelDesign {
  return {
    id: `design-${Date.now()}`,
    name: `Etiqueta_${widthMm}x${heightMm}mm`,
    shape,
    widthMm: roundMm(widthMm),
    heightMm: roundMm(heightMm),
    cornerRadiusMm: shape === 'rounded_rect' ? 1.5 : 0,
    safetyMarginMm: 1.2,
    kerfCompensationMm: 0,
    holes: {
      preset: 'none',
      diameterMm: 1.6,
      edgeDistanceMm: 2.2,
      customHoles: [],
    },
    elements: [
      {
        id: `el-text-${Date.now()}`,
        name: 'Texto Marca',
        type: 'vector_text',
        xMm: roundMm(widthMm / 2, 2),
        yMm: roundMm(heightMm / 2, 2),
        widthMm: roundMm(Math.min(12, widthMm * 0.65), 2),
        heightMm: 2.0,
        aspectRatio: 6.0,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        text: 'LASERHOUSE',
        fontSizeMm: 2.0,
        letterSpacingMm: 0.35,
        fontStyle: 'sans_industrial',
        strokeWidthMm: 0.3,
      },
    ],
  };
}

/**
 * Crea el diseño de referencia oficial de 20 x 10 mm con logo vectorial y texto en capa GRABADO,
 * sin agujeros por defecto salvo que se configure explícitamente.
 */
export function createReference20x10LabelDesign(withTwoHoles = false): LabelDesign {
  return {
    id: 'design-lh-20x10',
    name: 'Etiqueta_Ecocuero_20x10',
    shape: 'rounded_rect',
    widthMm: 20,
    heightMm: 10,
    cornerRadiusMm: 1.5,
    safetyMarginMm: 1.2,
    kerfCompensationMm: 0,
    holes: {
      preset: withTwoHoles ? 'two_horizontal' : 'none',
      diameterMm: 1.6,
      edgeDistanceMm: 2.2,
      customHoles: [],
    },
    elements: [
      {
        id: 'el-logo-emblem',
        name: 'Isotipo Hexagonal LH',
        type: 'logo_svg',
        xMm: 10,
        yMm: 3.4,
        widthMm: 4.4,
        heightMm: 2.8,
        aspectRatio: 4.4 / 2.8,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent:
          '<svg viewBox="0 0 44 28"><path d="M 8 2 L 36 2 L 42 14 L 36 26 L 8 26 L 2 14 Z M 14 8 L 14 20 L 22 20 M 24 8 L 24 20 M 31 8 L 31 20 M 24 14 L 31 14" /></svg>',
        normalizedPaths: [
          'M 8 2 L 36 2 L 42 14 L 36 26 L 8 26 L 2 14 Z',
          'M 14 8 L 20 8 L 20 18 L 30 18 L 30 22 L 14 22 Z',
        ],
        originalViewBox: { minX: 0, minY: 0, width: 44, height: 28 },
      },
      {
        id: 'el-brand-text',
        name: 'Texto Marca LASERHOUSE',
        type: 'vector_text',
        xMm: 10,
        yMm: 7.1,
        widthMm: 11.2,
        heightMm: 2.0,
        aspectRatio: 11.2 / 2.0,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        text: 'LASERHOUSE',
        fontSizeMm: 1.8,
        letterSpacingMm: 0.3,
        fontStyle: 'sans_industrial',
        strokeWidthMm: 0.3,
      },
    ],
  };
}

export function createInitialOrdersCatalog(): OrderProject[] {
  const ecocuero = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
  const acrilico = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ACRILICO_TRANSPARENTE')!;
  const poliamida = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'POLIAMIDA_BLANCA')!;

  const now = new Date().toISOString();

  return [
    {
      id: 'order-ref-200-ecocuero-20x10',
      projectName: 'Pedido 200 Etiquetas Ecocuero 20×10 mm',
      clientName: 'Cliente Textil — Colección Invierno',
      createdAt: now,
      updatedAt: now,
      notes:
        'Etiqueta de ecocuero suela 20 × 10 mm sin agujeros por defecto (opcionales desde el panel izquierdo) y marca grabada en el centro.',
      materialId: ecocuero.id,
      materialProfileSnapshot: structuredClone(ecocuero),
      labelDesign: createReference20x10LabelDesign(false),
      nestingConfig: {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 200,
        sheetWidthMm: 900,
        sheetHeightMm: 600,
        gapXMm: 2.0,
        gapYMm: 2.0,
        marginTopMm: 5.0,
        marginRightMm: 5.0,
        marginBottomMm: 5.0,
        marginLeftMm: 5.0,
        rotationMode: 'auto_optimize',
      },
      exportedFilesHistory: [],
    },
    {
      id: 'order-acrilico-30x15-100u',
      projectName: 'Tags Acrílico Transparente 30×15 mm (100 u.)',
      clientName: 'Marroquinería Sur',
      createdAt: now,
      updatedAt: now,
      notes: 'Etiqueta rígida con 1 agujero izquierdo Ø 2.5 mm para remache en plancha de 400×300 mm.',
      materialId: acrilico.id,
      materialProfileSnapshot: structuredClone(acrilico),
      labelDesign: {
        id: 'design-acrilico-30x15',
        name: 'Tag_Acrilico_30x15',
        shape: 'rounded_rect',
        widthMm: 30,
        heightMm: 15,
        cornerRadiusMm: 2.5,
        safetyMarginMm: 1.5,
        kerfCompensationMm: 0.12,
        holes: {
          preset: 'single_left',
          diameterMm: 2.5,
          edgeDistanceMm: 3.2,
          customHoles: [],
        },
        elements: [
          {
            id: 'el-border-1',
            name: 'Marco interior grabado',
            type: 'decorative_border',
            xMm: 17.5,
            yMm: 7.5,
            widthMm: 20,
            heightMm: 10.5,
            aspectRatio: 20 / 10.5,
            lockAspectRatio: false,
            rotationDeg: 0,
            locked: false,
            visible: true,
            insetMm: 2.0,
            strokeWidthMm: 0.25,
            dashed: false,
          },
          {
            id: 'el-text-2',
            name: 'Texto Marca',
            type: 'vector_text',
            xMm: 17.5,
            yMm: 7.5,
            widthMm: 15,
            heightMm: 2.6,
            aspectRatio: 15 / 2.6,
            lockAspectRatio: true,
            rotationDeg: 0,
            locked: false,
            visible: true,
            text: 'ARTESANAL',
            fontSizeMm: 2.4,
            letterSpacingMm: 0.4,
            fontStyle: 'sans_industrial',
            strokeWidthMm: 0.35,
          },
        ],
      },
      nestingConfig: {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 100,
        sheetWidthMm: 400,
        sheetHeightMm: 300,
        gapXMm: 2.0,
        gapYMm: 2.0,
      },
      exportedFilesHistory: [],
    },
    {
      id: 'order-poliamida-10x20-300u',
      projectName: 'Cinta Poliamida Blanca 30mm — Corte 300 u.',
      clientName: 'Indumentaria Deportiva',
      createdAt: now,
      updatedAt: now,
      notes: 'Flujo en cinta de 30 mm de ancho x 600 mm de tramo en mesa.',
      materialId: poliamida.id,
      materialProfileSnapshot: structuredClone(poliamida),
      labelDesign: {
        id: 'design-poliamida-26x12',
        name: 'Etiqueta_Textil_Poliamida',
        shape: 'rectangle',
        widthMm: 26,
        heightMm: 12,
        cornerRadiusMm: 0,
        safetyMarginMm: 1.5,
        kerfCompensationMm: 0,
        holes: {
          preset: 'none',
          diameterMm: 1.5,
          edgeDistanceMm: 2.0,
          customHoles: [],
        },
        elements: [
          {
            id: 'el-text-poli',
            name: 'Talle / Marca',
            type: 'vector_text',
            xMm: 13,
            yMm: 6,
            widthMm: 16,
            heightMm: 2.5,
            aspectRatio: 16 / 2.5,
            lockAspectRatio: true,
            rotationDeg: 0,
            locked: false,
            visible: true,
            text: 'TALLE M',
            fontSizeMm: 2.4,
            letterSpacingMm: 0.4,
            fontStyle: 'sans_industrial',
            strokeWidthMm: 0.3,
          },
        ],
      },
      nestingConfig: {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 300,
        sheetWidthMm: 30,
        sheetHeightMm: 600,
        gapXMm: 1.5,
        gapYMm: 1.5,
        marginTopMm: 2.0,
        marginBottomMm: 2.0,
        marginLeftMm: 2.0,
        marginRightMm: 2.0,
      },
      exportedFilesHistory: [],
    },
  ];
}

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadOrdersFromStorage(): OrderProject[] {
  try {
    const storage = (globalThis as { localStorage?: MinimalStorage }).localStorage;
    if (!storage) {
      return createInitialOrdersCatalog();
    }
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialOrdersCatalog();
      storage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return createInitialOrdersCatalog();
  } catch {
    return createInitialOrdersCatalog();
  }
}

export function saveOrdersToStorage(orders: OrderProject[]): void {
  try {
    const storage = (globalThis as { localStorage?: MinimalStorage }).localStorage;
    if (storage) {
      storage.setItem(STORAGE_KEY, JSON.stringify(orders));
    }
  } catch {
    // Ignorar errores de cuota en entornos restringidos
  }
}

export function upsertOrderProject(
  orders: OrderProject[],
  updatedOrder: OrderProject
): OrderProject[] {
  const now = new Date().toISOString();
  const orderWithTimestamp: OrderProject = {
    ...updatedOrder,
    updatedAt: now,
  };
  const idx = orders.findIndex((o) => o.id === updatedOrder.id);
  const next =
    idx >= 0
      ? orders.map((o, i) => (i === idx ? orderWithTimestamp : o))
      : [orderWithTimestamp, ...orders];
  saveOrdersToStorage(next);
  return next;
}

/**
 * Serializa un proyecto/pedido completo a JSON con preservación exacta de dimensiones en mm.
 */
export function serializeOrderProjectToJson(order: OrderProject): string {
  return JSON.stringify(
    {
      schemaVersion: '1.0.0',
      application: 'LaserHouse Studio',
      exportedAt: new Date().toISOString(),
      order,
    },
    null,
    2
  );
}

/**
 * Deserializa y valida un archivo de proyecto (.lhstudio.json) garantizando que todas las
 * dimensiones geométricas en milímetros, agujeros, elementos y configuración de material se conserven.
 */
export function deserializeOrderProjectFromJson(jsonString: string): OrderProject {
  const parsed = JSON.parse(jsonString);
  const candidate: OrderProject = parsed.order ? parsed.order : parsed;

  if (
    !candidate ||
    !candidate.labelDesign ||
    typeof candidate.labelDesign.widthMm !== 'number' ||
    typeof candidate.labelDesign.heightMm !== 'number' ||
    candidate.labelDesign.widthMm <= 0 ||
    candidate.labelDesign.heightMm <= 0 ||
    !candidate.nestingConfig
  ) {
    throw new Error(
      'El archivo de proyecto no contiene un diseño de etiqueta válido con dimensiones en milímetros.'
    );
  }

  return {
    ...candidate,
    labelDesign: {
      ...candidate.labelDesign,
      widthMm: roundMm(candidate.labelDesign.widthMm, 4),
      heightMm: roundMm(candidate.labelDesign.heightMm, 4),
      cornerRadiusMm: roundMm(candidate.labelDesign.cornerRadiusMm || 0, 4),
      safetyMarginMm: roundMm(candidate.labelDesign.safetyMarginMm || 1.2, 4),
      kerfCompensationMm: roundMm(candidate.labelDesign.kerfCompensationMm || 0, 4),
      holes: {
        preset: candidate.labelDesign.holes?.preset || 'none',
        diameterMm: roundMm(candidate.labelDesign.holes?.diameterMm || 1.6, 4),
        edgeDistanceMm: roundMm(candidate.labelDesign.holes?.edgeDistanceMm || 2.2, 4),
        customHoles: (candidate.labelDesign.holes?.customHoles || []).map((ch, idx) => ({
          id: ch.id || `hole-custom-${idx + 1}`,
          x: roundMm(ch.x, 4),
          y: roundMm(ch.y, 4),
          diameterMm: roundMm(ch.diameterMm || 1.6, 4),
        })),
      },
    },
    nestingConfig: {
      ...DEFAULT_NESTING_CONFIG,
      ...candidate.nestingConfig,
      requestedQuantity: Math.max(1, Math.floor(candidate.nestingConfig.requestedQuantity || 1)),
      sheetWidthMm: roundMm(candidate.nestingConfig.sheetWidthMm, 4),
      sheetHeightMm: roundMm(candidate.nestingConfig.sheetHeightMm, 4),
      gapXMm: roundMm(candidate.nestingConfig.gapXMm, 4),
      gapYMm: roundMm(candidate.nestingConfig.gapYMm, 4),
    },
  };
}

/**
 * Permite tomar un pedido existente (ej. 200 etiquetas de 20x10 mm) y generar
 * instantáneamente una repetición o cambio de cantidad (ej. 500 unidades)
 * conservando intacto el diseño geométrico y el perfil de material.
 */
export function duplicateOrderWithQuantity(
  sourceOrder: OrderProject,
  newQuantity: number,
  customProjectName?: string
): OrderProject {
  const now = new Date().toISOString();
  const cleanQty = Math.max(1, Math.floor(newQuantity));
  const clone: OrderProject = structuredClone(sourceOrder);
  clone.id = `order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  clone.projectName =
    customProjectName ||
    `${sourceOrder.labelDesign.name} (${cleanQty} u. — Repetición)`;
  clone.createdAt = now;
  clone.updatedAt = now;
  clone.nestingConfig = {
    ...clone.nestingConfig,
    requestedQuantity: cleanQty,
  };
  clone.exportedFilesHistory = [];
  return clone;
}
