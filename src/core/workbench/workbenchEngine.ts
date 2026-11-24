/**
 * Astra Studio — Motor Geométrico y de Planificación de Mesa de Trabajo (Estilo LightBurn)
 * Gestiona la compilación de múltiples trabajos y logos distintos sobre la plancha o rollo
 * de Ecocuero de 73 cm x 5 m (730 x 5000 mm, tiradas de hasta 600 mm en la Vank 9060),
 * empaquetado continuo Cero Desperdicio (intercalado de filas sin huecos entre trabajos),
 * relleno inteligente de la última fila, validación pre-vuelo y simulación de trayectoria láser.
 */

import {
  centerAllElementsGeometrically,
  compileLabelGeometry,
  fitAllElementsToAvailableSpace,
  roundMm,
} from '../geometry/geometryEngine';
import { supportsSharedCuts } from '../geometry/sharedCuts';
import { computeNestingLayout } from '../nesting/nestingEngine';
import { createBlankLabelDesign } from '../projects/projectManager';
import {
  BoundingBox,
  HolePreset,
  LabelDesign,
  LabelElement,
  LabelShapeType,
  MaterialProfile,
  Millimeters,
  NestingConfig,
  NestingResult,
} from '../types';
import {
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
  EcocueroRollMetrics,
  JobOriginAnchor,
  ToolpathSegment,
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
  WorkbenchPlacedInstance,
  WorkbenchSimulationResult,
  WorkbenchValidationIssue,
  WorkbenchValidationReport,
} from './workbenchTypes';

/**
 * Compila una grilla o flujo continuo de etiquetas en coordenadas locales [0..widthMm, 0..heightMm].
 * Si se indica `firstRowIndentMm > 0` y `usableSheetWidthMm`, la primera fila comienza desplazada
 * en `firstRowIndentMm` (continuando en el hueco libre de la última fila del trabajo anterior)
 * y a partir de la segunda fila vuelve al borde izquierdo `localX = 0` ocupando todo el ancho útil.
 */
export function compileJobInstancesGrid(
  design: LabelDesign,
  columns: number,
  rows: number,
  gapXMm: Millimeters,
  gapYMm: Millimeters,
  rotated90: boolean,
  maxPieces?: number,
  continuousFlowOptions?: {
    firstRowIndentMm: Millimeters;
    firstRowShelfHeightMm: Millimeters;
    usableSheetWidthMm: Millimeters;
  }
): {
  instances: WorkbenchPlacedInstance[];
  widthMm: Millimeters;
  heightMm: Millimeters;
  pieceCount: number;
  columnsUsed: number;
  rowsUsed: number;
  lastRowEndXMm: Millimeters;
  lastRowLocalYMm: Millimeters;
  pieceHeightMm: Millimeters;
} {
  const safeCols = Math.max(1, Math.round(columns));
  const safeRows = Math.max(1, Math.round(rows));
  const safeGapX = Math.max(0, roundMm(gapXMm));
  const safeGapY = Math.max(0, roundMm(gapYMm));

  const sample = compileLabelGeometry(design, {
    offsetXMm: 0,
    offsetYMm: 0,
    rotated90,
    instanceIdPrefix: 'sample',
  });

  const pieceW = sample.effectiveCutWidthMm;
  const pieceH = sample.effectiveCutHeightMm;
  const limit =
    maxPieces !== undefined ? Math.max(1, Math.round(maxPieces)) : safeCols * safeRows;

  const instances: WorkbenchPlacedInstance[] = [];
  let maxX = 0;
  let maxY = 0;
  let lastRowEndXMm = 0;
  let lastRowLocalYMm = 0;
  let maxColsSeen = 0;
  let rowsUsed = 1;

  if (continuousFlowOptions && continuousFlowOptions.firstRowIndentMm > 0) {
    const { firstRowIndentMm, firstRowShelfHeightMm, usableSheetWidthMm } =
      continuousFlowOptions;

    let cursorX = roundMm(firstRowIndentMm);
    let cursorY = 0;
    let currentRow = 0;
    let colsInCurrentRow = 0;

    for (let idx = 1; idx <= limit; idx++) {
      // Si la pieza no entra en el resto de la fila actual, saltar a la siguiente fila en X = 0
      if (cursorX > 0 && cursorX + pieceW > usableSheetWidthMm + 0.01) {
        const stepH =
          currentRow === 0
            ? Math.max(firstRowShelfHeightMm, pieceH)
            : pieceH;
        cursorX = 0;
        cursorY = roundMm(cursorY + stepH + safeGapY);
        currentRow++;
        colsInCurrentRow = 0;
      }

      const localX = roundMm(cursorX);
      const localY = roundMm(cursorY);
      const compiled = compileLabelGeometry(design, {
        offsetXMm: localX,
        offsetYMm: localY,
        rotated90,
        instanceIdPrefix: `wb_p${idx}`,
      });

      instances.push({
        instanceIndex: idx,
        localXMm: localX,
        localYMm: localY,
        widthMm: pieceW,
        heightMm: pieceH,
        rotated90,
        engraveItems: compiled.engravingItems,
        holeContours: compiled.holeContours,
        cutContour: compiled.outerCutContour,
      });

      colsInCurrentRow++;
      maxColsSeen = Math.max(maxColsSeen, colsInCurrentRow);
      rowsUsed = currentRow + 1;
      lastRowEndXMm = roundMm(localX + pieceW);
      lastRowLocalYMm = localY;
      maxX = Math.max(maxX, lastRowEndXMm);
      maxY = Math.max(maxY, roundMm(localY + pieceH));

      cursorX = roundMm(localX + pieceW + safeGapX);
    }
  } else {
    let idx = 0;
    for (let r = 0; r < safeRows; r++) {
      let colsInRow = 0;
      for (let c = 0; c < safeCols; c++) {
        if (idx >= limit) break;
        idx++;
        colsInRow++;
        const localX = roundMm(c * (pieceW + safeGapX));
        const localY = roundMm(r * (pieceH + safeGapY));
        const compiled = compileLabelGeometry(design, {
          offsetXMm: localX,
          offsetYMm: localY,
          rotated90,
          instanceIdPrefix: `wb_p${idx}`,
        });

        instances.push({
          instanceIndex: idx,
          localXMm: localX,
          localYMm: localY,
          widthMm: pieceW,
          heightMm: pieceH,
          rotated90,
          engraveItems: compiled.engravingItems,
          holeContours: compiled.holeContours,
          cutContour: compiled.outerCutContour,
        });

        lastRowEndXMm = roundMm(localX + pieceW);
        lastRowLocalYMm = localY;
        maxX = Math.max(maxX, lastRowEndXMm);
        maxY = Math.max(maxY, roundMm(localY + pieceH));
      }
      if (colsInRow > 0) {
        maxColsSeen = Math.max(maxColsSeen, colsInRow);
        rowsUsed = r + 1;
      }
    }
  }

  return {
    instances,
    widthMm: roundMm(maxX),
    heightMm: roundMm(maxY),
    pieceCount: instances.length,
    columnsUsed: Math.max(1, maxColsSeen),
    rowsUsed: Math.max(1, rowsUsed),
    lastRowEndXMm,
    lastRowLocalYMm,
    pieceHeightMm: pieceH,
  };
}

/**
 * Evalúa si rotar la etiqueta 90° reduce el avance vertical de rollo (Y) para la cantidad pedida.
 */
export function chooseOptimalRotationForMinRollAdvance(
  design: LabelDesign,
  requestedPieces: number,
  gapXMm: Millimeters,
  gapYMm: Millimeters,
  config: WorkbenchConfig
): 0 | 90 {
  if (design.fold) return 0;
  const usableWidth = Math.max(
    10,
    config.sheetWidthMm - config.sheetSafetyMarginMm * 2
  );
  const safeQty = Math.max(1, Math.round(requestedPieces));
  const safeGapX = Math.max(0, gapXMm);
  const safeGapY = Math.max(0, gapYMm);

  const s0 = compileLabelGeometry(design, {
    offsetXMm: 0,
    offsetYMm: 0,
    rotated90: false,
  });
  const w0 = Math.max(1, s0.effectiveCutWidthMm);
  const h0 = Math.max(1, s0.effectiveCutHeightMm);

  const cols0 = Math.max(1, Math.floor((usableWidth + safeGapX) / (w0 + safeGapX)));
  const rows0 = Math.ceil(safeQty / cols0);
  const advance0 = rows0 * h0 + Math.max(0, rows0 - 1) * safeGapY;

  const cols90 = Math.max(1, Math.floor((usableWidth + safeGapX) / (h0 + safeGapX)));
  const rows90 = Math.ceil(safeQty / cols90);
  const advance90 = rows90 * w0 + Math.max(0, rows90 - 1) * safeGapY;

  if (advance90 < advance0 - 0.1) {
    return 90;
  }
  return 0;
}

/**
 * Calcula la cantidad óptima de columnas para aprovechar el ancho útil de la plancha o rollo (ej. 730 mm para Ecocuero).
 */
export function computeOptimalColumnsForSheetWidth(
  design: LabelDesign,
  requestedPieces: number,
  gapXMm: Millimeters,
  rotated90: boolean,
  config: WorkbenchConfig
): { columns: number; rows: number } {
  const usableWidth = Math.max(
    10,
    config.sheetWidthMm - config.sheetSafetyMarginMm * 2
  );
  const sample = compileLabelGeometry(design, {
    offsetXMm: 0,
    offsetYMm: 0,
    rotated90,
    instanceIdPrefix: 'opt_sample',
  });
  const pieceW = Math.max(1, sample.effectiveCutWidthMm);
  const safeGapX = Math.max(0, gapXMm);
  const maxColsInSheet = Math.max(
    1,
    Math.floor((usableWidth + safeGapX) / (pieceW + safeGapX))
  );
  const safeQty = Math.max(1, Math.round(requestedPieces));
  const columns = Math.min(safeQty, maxColsInSheet);
  const rows = Math.max(1, Math.ceil(safeQty / columns));
  return { columns, rows };
}

/**
 * Crea un elemento de trabajo para la mesa a partir de una tanda de producción o de una etiqueta individual.
 */
export function createWorkbenchJobFromOrder(params: {
  design: LabelDesign;
  nesting: NestingResult;
  batchIndex?: number;
  mode: 'active_batch' | 'single_piece' | 'custom_grid' | 'roll_strip';
  customColumns?: number;
  customRows?: number;
  customQuantity?: number;
  projectName: string;
  clientName: string;
  orderId: string;
  existingJobs: WorkbenchJobItem[];
  config: WorkbenchConfig;
}): WorkbenchJobItem {
  const {
    design,
    nesting,
    batchIndex = 0,
    mode,
    customColumns,
    customRows,
    customQuantity,
    projectName,
    clientName,
    orderId,
    existingJobs,
    config,
  } = params;

  const batch = nesting.batches[batchIndex] || nesting.batches[0];
  let rotated90 = nesting.appliedRotationDeg === 90;
  const gapXMm = nesting.config.gapXMm;
  const gapYMm = nesting.config.gapYMm;

  let cols = 1;
  let rows = 1;
  let maxPieces = 1;

  if (mode === 'active_batch' && batch) {
    maxPieces = Math.max(1, customQuantity ?? batch.count);
    if (config.isRollMaterial) {
      if (config.autoRotateForMinRoll) {
        rotated90 =
          chooseOptimalRotationForMinRollAdvance(
            design,
            maxPieces,
            gapXMm,
            gapYMm,
            config
          ) === 90;
      }
      const opt = computeOptimalColumnsForSheetWidth(
        design,
        maxPieces,
        gapXMm,
        rotated90,
        config
      );
      cols = opt.columns;
      rows = opt.rows;
    } else {
      cols = Math.max(1, batch.columnsUsed);
      rows = Math.max(1, batch.rowsUsed);
    }
  } else if (mode === 'roll_strip') {
    maxPieces = Math.max(1, customQuantity ?? nesting.config.requestedQuantity ?? 50);
    if (config.autoRotateForMinRoll) {
      rotated90 =
        chooseOptimalRotationForMinRollAdvance(
          design,
          maxPieces,
          gapXMm,
          gapYMm,
          config
        ) === 90;
    }
    const opt = computeOptimalColumnsForSheetWidth(
      design,
      maxPieces,
      gapXMm,
      rotated90,
      config
    );
    cols = opt.columns;
    rows = opt.rows;
  } else if (mode === 'custom_grid') {
    cols = Math.max(1, customColumns ?? 5);
    rows = Math.max(1, customRows ?? 2);
    maxPieces = customQuantity ?? cols * rows;
  }

  const compiledGrid = compileJobInstancesGrid(
    design,
    cols,
    rows,
    gapXMm,
    gapYMm,
    rotated90,
    maxPieces
  );

  // Calcular posición inicial en la plancha sin superponerse con trabajos existentes
  const margin = config.sheetSafetyMarginMm;
  let targetX = roundMm(config.sheetOffsetXMm + margin);
  let targetY = roundMm(config.sheetOffsetYMm + margin);

  const visibleJobs = existingJobs.filter((j) => j.visible);
  if (visibleJobs.length > 0) {
    const lastJob = visibleJobs[visibleJobs.length - 1];
    const candidateRightX = roundMm(lastJob.xMm + lastJob.widthMm + Math.max(2, gapXMm));
    const maxSheetX = config.sheetOffsetXMm + config.sheetWidthMm - margin;

    if (candidateRightX + compiledGrid.widthMm <= maxSheetX) {
      targetX = candidateRightX;
      targetY = lastJob.yMm;
    } else {
      const lowestBottomY = Math.max(
        ...visibleJobs.map((j) => roundMm(j.yMm + j.heightMm))
      );
      targetX = roundMm(config.sheetOffsetXMm + margin);
      targetY = roundMm(lowestBottomY + Math.max(2, gapYMm));
    }
  }

  const cleanBaseName = projectName.replace(/\s*\(\d+\s*u\.\)$/, '');

  return {
    id: `wb-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${cleanBaseName} (${compiledGrid.pieceCount} u.)`,
    clientName: clientName || 'General',
    sourceOrderId: orderId,
    createdAt: new Date().toISOString(),
    labelDesign: structuredClone(design),
    xMm: targetX,
    yMm: targetY,
    widthMm: compiledGrid.widthMm,
    heightMm: compiledGrid.heightMm,
    blockRotationDeg: rotated90 ? 90 : 0,
    pieceCount: compiledGrid.pieceCount,
    columns: compiledGrid.columnsUsed,
    rows: compiledGrid.rowsUsed,
    gapXMm,
    gapYMm,
    firstRowIndentMm: 0,
    lastRowEndXMm: compiledGrid.lastRowEndXMm,
    lastRowLocalYMm: compiledGrid.lastRowLocalYMm,
    instances: compiledGrid.instances,
    locked: false,
    visible: true,
  };
}

/**
 * Crea un trabajo completo para la tirada en mesa directamente a partir de un archivo de logo subido (SVG, PNG o JPG),
 * ajustando y centrando el logo automáticamente a las medidas de etiqueta indicadas y calculando las columnas para el rollo de 73 cm.
 */
export function createWorkbenchJobFromUploadedLogo(params: {
  logoName: string;
  clientName?: string;
  element: LabelElement;
  widthMm?: Millimeters;
  heightMm?: Millimeters;
  shape?: LabelShapeType;
  holePreset?: HolePreset;
  quantity?: number;
  gapXMm?: Millimeters;
  gapYMm?: Millimeters;
  existingJobs: WorkbenchJobItem[];
  config: WorkbenchConfig;
}): WorkbenchJobItem {
  const {
    logoName,
    clientName = '',
    element,
    widthMm = 40,
    heightMm = 20,
    shape = 'rounded_rect',
    holePreset = 'none',
    quantity = 50,
    gapXMm = 2,
    gapYMm = 2,
    existingJobs,
    config,
  } = params;

  const baseDesign = createBlankLabelDesign(widthMm, heightMm, shape);
  baseDesign.name = logoName;
  baseDesign.holes = {
    ...baseDesign.holes,
    preset: holePreset,
  };

  const fittedElements = fitAllElementsToAvailableSpace(
    [element],
    baseDesign,
    0.85,
    'safe_zone_center'
  );
  const centeredElements = centerAllElementsGeometrically(
    fittedElements,
    baseDesign,
    'safe_zone_center'
  );
  baseDesign.elements = centeredElements;

  const opt = computeOptimalColumnsForSheetWidth(
    baseDesign,
    quantity,
    gapXMm,
    false,
    config
  );

  const compiledGrid = compileJobInstancesGrid(
    baseDesign,
    opt.columns,
    opt.rows,
    gapXMm,
    gapYMm,
    false,
    quantity
  );

  const margin = config.sheetSafetyMarginMm;
  let targetX = roundMm(config.sheetOffsetXMm + margin);
  let targetY = roundMm(config.sheetOffsetYMm + margin);

  const visibleJobs = existingJobs.filter((j) => j.visible);
  if (visibleJobs.length > 0) {
    const lastJob = visibleJobs[visibleJobs.length - 1];
    const candidateRightX = roundMm(lastJob.xMm + lastJob.widthMm + Math.max(2, gapXMm));
    const maxSheetX = config.sheetOffsetXMm + config.sheetWidthMm - margin;

    if (candidateRightX + compiledGrid.widthMm <= maxSheetX) {
      targetX = candidateRightX;
      targetY = lastJob.yMm;
    } else {
      const lowestBottomY = Math.max(
        ...visibleJobs.map((j) => roundMm(j.yMm + j.heightMm))
      );
      targetX = roundMm(config.sheetOffsetXMm + margin);
      targetY = roundMm(lowestBottomY + Math.max(2, gapYMm));
    }
  }

  return {
    id: `wb-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${logoName} (${compiledGrid.pieceCount} u.)`,
    clientName: clientName || logoName,
    sourceOrderId: `multi-upload-${Date.now()}`,
    createdAt: new Date().toISOString(),
    labelDesign: baseDesign,
    xMm: targetX,
    yMm: targetY,
    widthMm: compiledGrid.widthMm,
    heightMm: compiledGrid.heightMm,
    blockRotationDeg: 0,
    pieceCount: compiledGrid.pieceCount,
    columns: compiledGrid.columnsUsed,
    rows: compiledGrid.rowsUsed,
    gapXMm,
    gapYMm,
    firstRowIndentMm: 0,
    lastRowEndXMm: compiledGrid.lastRowEndXMm,
    lastRowLocalYMm: compiledGrid.lastRowLocalYMm,
    instances: compiledGrid.instances,
    locked: false,
    visible: true,
  };
}

/**
 * Permite editar directamente en la mesa de trabajo la cantidad, medidas (ancho x alto mm),
 * forma, orificios o logo de cualquier trabajo de la tirada, recalculando su grilla.
 */
export function updateWorkbenchJobDesignAndQuantity(
  job: WorkbenchJobItem,
  updates: {
    baseName?: string;
    clientName?: string;
    widthMm?: Millimeters;
    heightMm?: Millimeters;
    shape?: LabelShapeType;
    holePreset?: HolePreset;
    pieceCount?: number;
    columns?: number;
    rows?: number;
    gapXMm?: Millimeters;
    gapYMm?: Millimeters;
    blockRotationDeg?: 0 | 90;
    autoFitColumnsToRoll?: boolean;
    firstRowIndentMm?: Millimeters;
    firstRowShelfHeightMm?: Millimeters;
  },
  config?: WorkbenchConfig
): WorkbenchJobItem {
  const nextDesign = structuredClone(job.labelDesign);
  const dimensionsChanged =
    (updates.widthMm !== undefined && Math.abs(updates.widthMm - nextDesign.widthMm) > 0.01) ||
    (updates.heightMm !== undefined && Math.abs(updates.heightMm - nextDesign.heightMm) > 0.01) ||
    (updates.shape !== undefined && updates.shape !== nextDesign.shape) ||
    (updates.holePreset !== undefined && updates.holePreset !== nextDesign.holes.preset);

  if (updates.widthMm !== undefined) {
    nextDesign.widthMm = Math.max(5, Math.min(600, roundMm(updates.widthMm)));
  }
  if (updates.heightMm !== undefined) {
    nextDesign.heightMm = Math.max(5, Math.min(600, roundMm(updates.heightMm)));
  }
  if (updates.shape !== undefined) {
    nextDesign.shape = updates.shape;
    if (updates.shape === 'circle') {
      const d = Math.min(nextDesign.widthMm, nextDesign.heightMm);
      nextDesign.widthMm = d;
      nextDesign.heightMm = d;
    }
  }
  if (updates.holePreset !== undefined) {
    nextDesign.holes = {
      ...nextDesign.holes,
      preset: updates.holePreset,
    };
  }

  if (dimensionsChanged && nextDesign.elements.length > 0) {
    const fitted = fitAllElementsToAvailableSpace(
      nextDesign.elements,
      nextDesign,
      0.85,
      'safe_zone_center'
    );
    nextDesign.elements = centerAllElementsGeometrically(
      fitted,
      nextDesign,
      'safe_zone_center'
    );
  }

  const gapXMm = Math.max(0, roundMm(updates.gapXMm ?? job.gapXMm));
  const gapYMm = Math.max(0, roundMm(updates.gapYMm ?? job.gapYMm));
  const rot = updates.blockRotationDeg ?? job.blockRotationDeg;
  const targetPieces = Math.max(
    1,
    Math.min(10000, Math.round(updates.pieceCount ?? job.pieceCount))
  );

  let cols = Math.max(1, Math.round(updates.columns ?? job.columns));
  let rows = Math.max(1, Math.round(updates.rows ?? job.rows));

  if (
    config &&
    (updates.autoFitColumnsToRoll ||
      updates.pieceCount !== undefined ||
      dimensionsChanged)
  ) {
    const opt = computeOptimalColumnsForSheetWidth(
      nextDesign,
      targetPieces,
      gapXMm,
      rot === 90,
      config
    );
    cols = opt.columns;
    rows = opt.rows;
  } else if (updates.columns !== undefined && updates.rows === undefined) {
    rows = Math.max(1, Math.ceil(targetPieces / cols));
  }

  const maxCapacity = cols * rows;
  const effectivePieces =
    updates.pieceCount !== undefined
      ? targetPieces
      : updates.columns !== undefined || updates.rows !== undefined
        ? maxCapacity
        : Math.min(targetPieces, maxCapacity);

  if (effectivePieces > cols * rows) {
    rows = Math.ceil(effectivePieces / cols);
  }

  const usableSheetWidthMm = config
    ? Math.max(10, config.sheetWidthMm - config.sheetSafetyMarginMm * 2)
    : undefined;

  const firstRowIndentMm = updates.firstRowIndentMm ?? 0;
  const firstRowShelfHeightMm = updates.firstRowShelfHeightMm ?? 0;

  const compiled = compileJobInstancesGrid(
    nextDesign,
    cols,
    rows,
    gapXMm,
    gapYMm,
    rot === 90,
    effectivePieces,
    firstRowIndentMm > 0 && usableSheetWidthMm
      ? {
          firstRowIndentMm,
          firstRowShelfHeightMm,
          usableSheetWidthMm,
        }
      : undefined
  );

  const rawBaseName =
    updates.baseName?.trim() || job.name.replace(/\s*\(\d+\s*u\.\)$/, '');

  return {
    ...job,
    name: `${rawBaseName} (${compiled.pieceCount} u.)`,
    clientName: updates.clientName !== undefined ? updates.clientName : job.clientName,
    labelDesign: nextDesign,
    columns: compiled.columnsUsed,
    rows: compiled.rowsUsed,
    gapXMm,
    gapYMm,
    blockRotationDeg: rot,
    pieceCount: compiled.pieceCount,
    widthMm: compiled.widthMm,
    heightMm: compiled.heightMm,
    firstRowIndentMm,
    firstRowShelfHeightMm,
    lastRowEndXMm: compiled.lastRowEndXMm,
    lastRowLocalYMm: compiled.lastRowLocalYMm,
    instances: compiled.instances,
  };
}

/**
 * Recalcula las instancias de un trabajo en mesa tras cambiar filas, columnas, separación o rotación.
 */
export function updateWorkbenchJobGrid(
  job: WorkbenchJobItem,
  updates: {
    columns?: number;
    rows?: number;
    gapXMm?: Millimeters;
    gapYMm?: Millimeters;
    blockRotationDeg?: 0 | 90;
    pieceCount?: number;
  }
): WorkbenchJobItem {
  return updateWorkbenchJobDesignAndQuantity(job, updates);
}

/**
 * Acomoda todos los trabajos visibles dentro de la plancha.
 * - Si `optimizeColumnsForRoll` es true y `config.packingMode === 'continuous_zero_waste'`,
 *   intercala los trabajos en flujo continuo pieza por pieza: cada trabajo nuevo comienza
 *   directamente en el hueco vacío que dejó la última fila incompleta del trabajo anterior,
 *   y en su segunda fila vuelve al borde izquierdo de los 73 cm, logrando CERO HUECOS vacíos entre pedidos.
 * - Si `optimizeColumnsForRoll` es false (o `packingMode === 'rectangular_blocks'`), acomoda
 *   los bloques rectangulares sin solapamiento por estantes (Shelf Packing).
 */
export function autoArrangeWorkbenchJobs(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig,
  interJobGapMm = 2,
  optimizeColumnsForRoll = false
): WorkbenchJobItem[] {
  const margin = Math.max(0, config.sheetSafetyMarginMm);
  const startX = roundMm(config.sheetOffsetXMm + margin);
  const startY = roundMm(config.sheetOffsetYMm + margin);
  const maxRightX = roundMm(config.sheetOffsetXMm + config.sheetWidthMm - margin);
  const usableWidth = Math.max(10, roundMm(maxRightX - startX));

  const useContinuousStream =
    optimizeColumnsForRoll && config.packingMode !== 'rectangular_blocks';

  if (useContinuousStream) {
    let currentShelfY = startY;
    let currentIndentMm = 0; // Desplazamiento X local dentro de [0..usableWidth]
    let currentShelfMaxHeight = 0;

    return jobs.map((rawJob) => {
      if (!rawJob.visible || rawJob.locked) {
        return rawJob;
      }

      // Evaluar dimensiones de una pieza del trabajo
      const sample = compileLabelGeometry(rawJob.labelDesign, {
        offsetXMm: 0,
        offsetYMm: 0,
        rotated90: rawJob.blockRotationDeg === 90,
      });
      const pieceW = sample.effectiveCutWidthMm;
      const pieceH = sample.effectiveCutHeightMm;
      const gapX = Math.max(0, rawJob.gapXMm);
      const gapY = Math.max(0, rawJob.gapYMm);

      // Verificar si al menos 1 etiqueta de este trabajo entra en el hueco restante de la fila actual
      if (currentIndentMm > 0 && currentIndentMm + pieceW > usableWidth + 0.01) {
        // No entra ni 1 pieza en el resto de la fila: avanzar a una fila nueva limpia en X = 0
        currentShelfY = roundMm(
          currentShelfY + Math.max(currentShelfMaxHeight, pieceH) + Math.max(gapY, interJobGapMm)
        );
        currentIndentMm = 0;
        currentShelfMaxHeight = 0;
      }

      const rebuilt = updateWorkbenchJobDesignAndQuantity(
        rawJob,
        {
          pieceCount: rawJob.pieceCount,
          autoFitColumnsToRoll: true,
          firstRowIndentMm: currentIndentMm,
          firstRowShelfHeightMm: currentShelfMaxHeight,
        },
        config
      );

      const placed: WorkbenchJobItem = {
        ...rebuilt,
        xMm: startX,
        yMm: currentShelfY,
      };

      const lastRowLocalY = rebuilt.lastRowLocalYMm ?? 0;
      const lastRowEndX = rebuilt.lastRowEndXMm ?? rebuilt.widthMm;

      if (lastRowLocalY > 0) {
        // El trabajo envolvió hacia una o más filas nuevas debajo de currentShelfY
        currentShelfY = roundMm(currentShelfY + lastRowLocalY);
        currentShelfMaxHeight = pieceH;
      } else {
        // El trabajo entero quedó en la misma fila compartida
        currentShelfMaxHeight = Math.max(currentShelfMaxHeight, pieceH);
      }

      currentIndentMm = roundMm(lastRowEndX + Math.max(gapX, interJobGapMm));
      if (currentIndentMm + pieceW > usableWidth + 0.01) {
        currentShelfY = roundMm(
          currentShelfY + currentShelfMaxHeight + Math.max(gapY, interJobGapMm)
        );
        currentIndentMm = 0;
        currentShelfMaxHeight = 0;
      }

      return placed;
    });
  }

  // Modo bloques rectangulares (Shelf Packing clásico)
  let cursorX = startX;
  let cursorY = startY;
  let shelfHeight = 0;

  return jobs.map((rawJob) => {
    if (!rawJob.visible || rawJob.locked) {
      return rawJob;
    }

    const job = optimizeColumnsForRoll
      ? updateWorkbenchJobDesignAndQuantity(
          rawJob,
          {
            pieceCount: rawJob.pieceCount,
            autoFitColumnsToRoll: true,
            firstRowIndentMm: 0,
          },
          config
        )
      : rawJob.firstRowIndentMm
        ? updateWorkbenchJobDesignAndQuantity(
            rawJob,
            { firstRowIndentMm: 0 },
            config
          )
        : rawJob;

    if (cursorX > startX && cursorX + job.widthMm > maxRightX) {
      cursorX = startX;
      cursorY = roundMm(cursorY + shelfHeight + interJobGapMm);
      shelfHeight = 0;
    }

    const placed: WorkbenchJobItem = {
      ...job,
      xMm: cursorX,
      yMm: cursorY,
    };

    cursorX = roundMm(cursorX + job.widthMm + interJobGapMm);
    shelfHeight = Math.max(shelfHeight, job.heightMm);
    return placed;
  });
}

/**
 * Aplica en 1 clic la configuración de Ahorro Extremo de Material (Cero Desperdicio) a toda la mesa/rollo:
 * - Margen perimetral compacto (2 mm)
 * - Separación ultra-compacta entre piezas (0.5 mm)
 * - Evaluación automática de rotación 0° vs 90° por trabajo para menor avance de rollo
 * - Intercalado continuo de filas pieza por pieza sin huecos vacíos entre logos.
 */
export function applyExtremeMaterialSavingToWorkbench(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): { config: WorkbenchConfig; jobs: WorkbenchJobItem[] } {
  const nextConfig: WorkbenchConfig = {
    ...config,
    sheetSafetyMarginMm: 2,
    packingMode: 'continuous_zero_waste',
    savingPreset: 'extreme_zero_waste',
    autoRotateForMinRoll: true,
  };

  const compactJobs = jobs.map((job) => {
    if (!job.visible || job.locked) return job;
    const compactGap = 0.5;
    const bestRot = chooseOptimalRotationForMinRollAdvance(
      job.labelDesign,
      job.pieceCount,
      compactGap,
      compactGap,
      nextConfig
    );
    return updateWorkbenchJobDesignAndQuantity(
      job,
      {
        gapXMm: compactGap,
        gapYMm: compactGap,
        blockRotationDeg: bestRot,
        autoFitColumnsToRoll: true,
      },
      nextConfig
    );
  });

  const arranged = autoArrangeWorkbenchJobs(compactJobs, nextConfig, 1.5, true);
  return { config: nextConfig, jobs: arranged };
}

/**
 * Completa los lugares vacíos que quedan en la última fila de la tirada agregando
 * etiquetas extra al último trabajo activo, sin gastar ni 1 mm adicional de rollo.
 */
export function fillLastRowFreeSlotsInWorkbench(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): { jobs: WorkbenchJobItem[]; addedPieces: number } {
  const metrics = computeEcocueroRollMetrics(jobs, config);
  if (metrics.freeSlotsInLastRow <= 0) {
    return { jobs, addedPieces: 0 };
  }

  const visibleIndices = jobs
    .map((j, idx) => (j.visible && !j.locked ? idx : -1))
    .filter((idx) => idx >= 0);

  if (visibleIndices.length === 0) {
    return { jobs, addedPieces: 0 };
  }

  const lastIdx = visibleIndices[visibleIndices.length - 1];
  const targetJob = jobs[lastIdx];
  const addedPieces = metrics.freeSlotsInLastRow;

  const updatedJobs = jobs.map((j, idx) =>
    idx === lastIdx
      ? updateWorkbenchJobDesignAndQuantity(
          targetJob,
          {
            pieceCount: targetJob.pieceCount + addedPieces,
            autoFitColumnsToRoll: true,
          },
          config
        )
      : j
  );

  const arranged = autoArrangeWorkbenchJobs(
    updatedJobs,
    config,
    config.savingPreset === 'extreme_zero_waste' ? 1.5 : 4,
    true
  );

  return {
    jobs: arranged,
    addedPieces,
  };
}

/**
 * Calcula las métricas reales de consumo y ahorro del rollo de Ecocuero (73 cm de ancho x 5 m de largo).
 */
export function computeEcocueroRollMetrics(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): EcocueroRollMetrics {
  const rollWidthMm = config.sheetWidthMm || ECOCUERO_ROLL_WIDTH_MM;
  const rollWidthCm = roundMm(rollWidthMm / 10, 1);
  const totalRollLengthMm = config.rollTotalLengthMm || ECOCUERO_ROLL_TOTAL_LENGTH_MM;
  const totalRollLengthCm = roundMm(totalRollLengthMm / 10, 1);

  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const bounds = computeWorkbenchOccupiedBounds(visibleJobs);
  if (!bounds || visibleJobs.length === 0) {
    return {
      rollWidthMm,
      rollWidthCm,
      totalRollLengthMm,
      totalRollLengthCm,
      usedLengthMm: 0,
      usedLengthCm: 0,
      remainingRollLengthCm: totalRollLengthCm,
      remainingRollLengthMeters: roundMm(totalRollLengthMm / 1000, 2),
      rollConsumptionPercent: 0,
      widthUtilizationPercent: 0,
      stripAreaEfficiencyPercent: 0,
      freeSlotsInLastRow: 0,
      freeWidthInLastRowMm: 0,
      freeWidthInLastRowCm: 0,
      savedRollLengthMm: 0,
      savedRollLengthCm: 0,
      estimatedRunsPerRoll: 0,
      exceedsSingleBedPass: false,
    };
  }

  const rawAdvanceMm = Math.max(
    0,
    bounds.maxY - config.sheetOffsetYMm + config.sheetSafetyMarginMm
  );
  const usedLengthMm = roundMm(rawAdvanceMm, 1);
  const usedLengthCm = roundMm(usedLengthMm / 10, 1);
  const remainingMm = Math.max(0, totalRollLengthMm - usedLengthMm);
  const remainingRollLengthCm = roundMm(remainingMm / 10, 1);
  const remainingRollLengthMeters = roundMm(remainingMm / 1000, 2);

  const rollConsumptionPercent = roundMm(
    Math.min(100, (usedLengthMm / Math.max(1, totalRollLengthMm)) * 100),
    1
  );
  const usableRollWidthMm = Math.max(
    1,
    rollWidthMm - config.sheetSafetyMarginMm * 2
  );
  const widthUtilizationPercent = roundMm(
    Math.min(100, (bounds.width / usableRollWidthMm) * 100),
    1
  );

  // Calcular área real de piezas vs área de la franja de rollo consumida
  let totalPiecesAreaMm2 = 0;
  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      totalPiecesAreaMm2 += inst.widthMm * inst.heightMm;
    }
  }
  const consumedStripAreaMm2 = Math.max(1, usableRollWidthMm * bounds.height);
  const stripAreaEfficiencyPercent = roundMm(
    Math.min(100, (totalPiecesAreaMm2 / consumedStripAreaMm2) * 100),
    1
  );

  // Calcular cuántos lugares vacíos quedan en la última fila del último trabajo sin gastar más rollo
  const lastJob = visibleJobs[visibleJobs.length - 1];
  const lastInst = lastJob.instances[lastJob.instances.length - 1];
  const lastRowEndAbsX = roundMm(
    lastJob.xMm + (lastJob.lastRowEndXMm ?? lastInst.localXMm + lastInst.widthMm)
  );
  const maxUsableAbsX = roundMm(
    config.sheetOffsetXMm + config.sheetWidthMm - config.sheetSafetyMarginMm
  );
  const freeWidthInLastRowMm = Math.max(0, roundMm(maxUsableAbsX - lastRowEndAbsX));
  const freeWidthInLastRowCm = roundMm(freeWidthInLastRowMm / 10, 1);
  const stepW = Math.max(1, lastInst.widthMm + Math.max(0, lastJob.gapXMm));
  const freeSlotsInLastRow = Math.max(
    0,
    Math.floor((freeWidthInLastRowMm + 0.01) / stepW)
  );

  // Calcular ahorro en mm frente a bloques separados tradicionales (margen 5mm, gap 2mm, sin flujo continuo)
  let traditionalStackedHeightMm = 10; // 5mm top + 5mm bottom margin
  const traditionalUsableW = Math.max(10, rollWidthMm - 10);
  for (const job of visibleJobs) {
    const pW = job.labelDesign.widthMm;
    const pH = job.labelDesign.heightMm;
    const tradCols = Math.max(1, Math.floor((traditionalUsableW + 2) / (pW + 2)));
    const tradRows = Math.ceil(job.pieceCount / tradCols);
    traditionalStackedHeightMm += tradRows * pH + Math.max(0, tradRows - 1) * 2 + 4;
  }
  traditionalStackedHeightMm = Math.max(0, traditionalStackedHeightMm - 4);
  const savedRollLengthMm = Math.max(
    0,
    roundMm(traditionalStackedHeightMm - usedLengthMm, 1)
  );
  const savedRollLengthCm = roundMm(savedRollLengthMm / 10, 1);

  const estimatedRunsPerRoll =
    usedLengthMm > 0 ? Math.floor(totalRollLengthMm / usedLengthMm) : 0;
  const exceedsSingleBedPass = usedLengthMm > config.machineBedHeightMm + 0.01;

  return {
    rollWidthMm,
    rollWidthCm,
    totalRollLengthMm,
    totalRollLengthCm,
    usedLengthMm,
    usedLengthCm,
    remainingRollLengthCm,
    remainingRollLengthMeters,
    rollConsumptionPercent,
    widthUtilizationPercent,
    stripAreaEfficiencyPercent,
    freeSlotsInLastRow,
    freeWidthInLastRowMm,
    freeWidthInLastRowCm,
    savedRollLengthMm,
    savedRollLengthCm,
    estimatedRunsPerRoll,
    exceedsSingleBedPass,
  };
}

/**
 * Analiza el potencial de ahorro de material en el Paso 5 (Producción) y Paso 6 (Exportar)
 * antes de exportar, permitiendo optimizar márgenes, separación, rotación y completar la última fila.
 */
export interface StepMaterialSavingAnalysis {
  currentAdvanceMm: Millimeters;
  currentAdvanceCm: number;
  optimizedAdvanceMm: Millimeters;
  optimizedAdvanceCm: number;
  savedAdvanceMm: Millimeters;
  savedAdvanceCm: number;
  freeSlotsInLastRow: number;
  freeWidthInLastRowMm: Millimeters;
  currentCols: number;
  currentRows: number;
  optimizedCols: number;
  optimizedRows: number;
  canUseSharedCuts: boolean;
  isAlreadyOptimal: boolean;
}

export function analyzeStepMaterialSavings(
  design: LabelDesign,
  nesting: NestingResult,
  batchIndex = 0
): StepMaterialSavingAnalysis {
  const batch = nesting.batches[batchIndex] || nesting.batches[0];
  const currentCols = batch?.columnsUsed ?? 1;
  const currentRows = batch?.rowsUsed ?? 1;
  const currentAdvanceMm = batch
    ? roundMm(batch.occupiedBounds.maxY + nesting.config.marginBottomMm, 1)
    : 0;
  const currentAdvanceCm = roundMm(currentAdvanceMm / 10, 1);

  const maxColsInSheet = Math.max(1, nesting.maxColumnsPerSheet);
  const batchCount = batch?.count ?? nesting.config.requestedQuantity;
  const lastRowCount = batchCount % maxColsInSheet;
  const freeSlotsInLastRow =
    lastRowCount === 0 ? 0 : Math.max(0, maxColsInSheet - lastRowCount);
  const freeWidthInLastRowMm = roundMm(
    freeSlotsInLastRow * (nesting.pieceWidthMm + nesting.config.gapXMm),
    1
  );

  const canUseSharedCuts =
    supportsSharedCuts(design) && design.kerfCompensationMm === 0;

  // Simular configuración de máximo ahorro en toda la plancha
  const optConfig = buildOptimalSavingNestingConfig(design, nesting.config, false);
  const optNesting = computeNestingLayout(design, optConfig);
  const optBatch = optNesting.batches[0];
  const optimizedAdvanceMm = optBatch
    ? roundMm(optBatch.occupiedBounds.maxY + optConfig.marginBottomMm, 1)
    : currentAdvanceMm;
  const optimizedAdvanceCm = roundMm(optimizedAdvanceMm / 10, 1);

  const savedAdvanceMm = Math.max(
    0,
    roundMm(currentAdvanceMm - optimizedAdvanceMm, 1)
  );
  const savedAdvanceCm = roundMm(savedAdvanceMm / 10, 1);

  const isAlreadyOptimal =
    nesting.config.layoutMode === 'sheet' &&
    nesting.config.marginLeftMm <= 2.1 &&
    nesting.config.gapXMm <= 0.51 &&
    savedAdvanceMm < 1.0;

  return {
    currentAdvanceMm,
    currentAdvanceCm,
    optimizedAdvanceMm,
    optimizedAdvanceCm,
    savedAdvanceMm,
    savedAdvanceCm,
    freeSlotsInLastRow,
    freeWidthInLastRowMm,
    currentCols,
    currentRows,
    optimizedCols: optBatch?.columnsUsed ?? currentCols,
    optimizedRows: optBatch?.rowsUsed ?? currentRows,
    canUseSharedCuts,
    isAlreadyOptimal,
  };
}

/**
 * Construye una NestingConfig optimizada para máximo aprovechamiento del ancho de plancha/rollo.
 */
export function buildOptimalSavingNestingConfig(
  design: LabelDesign,
  currentConfig: NestingConfig,
  useSharedCutsIfPossible = false
): NestingConfig {
  const canShare =
    useSharedCutsIfPossible &&
    supportsSharedCuts(design) &&
    design.kerfCompensationMm === 0;
  const compactGap = canShare ? 0 : 0.5;
  const compactMargin = 2.0;

  // Evaluar si 0° o 90° consume menor avance vertical Y para la cantidad solicitada
  const usableW = Math.max(10, currentConfig.sheetWidthMm - compactMargin * 2);
  const kerf = Math.max(0, design.kerfCompensationMm || 0);
  const w0 = roundMm(design.widthMm + kerf);
  const h0 = roundMm(design.heightMm + kerf);
  const qty = Math.max(1, currentConfig.requestedQuantity);

  const cols0 = Math.max(1, Math.floor((usableW + compactGap) / (w0 + compactGap)));
  const rows0 = Math.ceil(qty / cols0);
  const adv0 = rows0 * h0 + Math.max(0, rows0 - 1) * compactGap;

  const cols90 = Math.max(1, Math.floor((usableW + compactGap) / (h0 + compactGap)));
  const rows90 = Math.ceil(qty / cols90);
  const adv90 = rows90 * w0 + Math.max(0, rows90 - 1) * compactGap;

  const bestRotationMode: NestingConfig['rotationMode'] = design.fold
    ? '0'
    : adv90 < adv0 - 0.1
      ? '90'
      : '0';

  return {
    ...currentConfig,
    layoutMode: 'sheet',
    sharedCutLines: canShare,
    gapXMm: compactGap,
    gapYMm: compactGap,
    marginTopMm: compactMargin,
    marginRightMm: compactMargin,
    marginBottomMm: compactMargin,
    marginLeftMm: compactMargin,
    rotationMode: bestRotationMode,
    centerInSheet: false,
  };
}

/**
 * Calcula la caja envolvente absoluta ocupada por todas las piezas visibles en la mesa.
 */
export function computeWorkbenchOccupiedBounds(jobs: WorkbenchJobItem[]): BoundingBox | null {
  const visible = jobs.filter((j) => j.visible && j.instances.length > 0);
  if (visible.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const job of visible) {
    for (const inst of job.instances) {
      const ix = roundMm(job.xMm + inst.localXMm);
      const iy = roundMm(job.yMm + inst.localYMm);
      minX = Math.min(minX, ix);
      minY = Math.min(minY, iy);
      maxX = Math.max(maxX, roundMm(ix + inst.widthMm));
      maxY = Math.max(maxY, roundMm(iy + inst.heightMm));
    }
  }

  return {
    minX: roundMm(minX),
    minY: roundMm(minY),
    maxX: roundMm(maxX),
    maxY: roundMm(maxY),
    width: roundMm(maxX - minX),
    height: roundMm(maxY - minY),
  };
}

/**
 * Calcula las coordenadas en mm del punto de origen del trabajo (verde en LightBurn)
 * según la grilla de 9 puntos y el modo Start From.
 */
export function computeJobOriginPointMm(
  bounds: BoundingBox | null,
  config: WorkbenchConfig
): { x: Millimeters; y: Millimeters } {
  if (config.startFromMode === 'absolute_coords') {
    return { x: 0, y: 0 };
  }
  const box = bounds ?? {
    minX: config.sheetOffsetXMm,
    minY: config.sheetOffsetYMm,
    maxX: config.sheetOffsetXMm + config.sheetWidthMm,
    maxY: config.sheetOffsetYMm + config.sheetHeightMm,
    width: config.sheetWidthMm,
    height: config.sheetHeightMm,
  };

  const anchor: JobOriginAnchor = config.jobOriginAnchor;
  let x = box.minX;
  let y = box.minY;

  if (anchor.includes('center')) {
    x = roundMm(box.minX + box.width / 2);
  } else if (anchor.includes('right')) {
    x = box.maxX;
  }

  if (anchor.startsWith('middle')) {
    y = roundMm(box.minY + box.height / 2);
  } else if (anchor.startsWith('bottom')) {
    y = box.maxY;
  }

  if (anchor === 'center') {
    x = roundMm(box.minX + box.width / 2);
    y = roundMm(box.minY + box.height / 2);
  }

  return { x, y };
}

/**
 * Sincroniza las capas de la mesa con los parámetros guardados en un MaterialProfile.
 */
export function syncLayersWithMaterialProfile(
  layers: WorkbenchLayerConfig[],
  material: MaterialProfile
): WorkbenchLayerConfig[] {
  return layers.map((layer) => {
    if (layer.role === 'ENGRAVE') {
      return {
        ...layer,
        speedMmPerSec: material.engraveParams.speedMmPerSec,
        maxPowerPercent: material.engraveParams.maxPowerPercent,
        minPowerPercent: material.engraveParams.minPowerPercent,
        passes: material.engraveParams.passes,
        lineIntervalMm: material.engraveParams.lineIntervalMm ?? layer.lineIntervalMm,
        operatorValidated: material.engraveParams.operatorValidated,
      };
    }
    if (layer.role === 'HOLES') {
      return {
        ...layer,
        speedMmPerSec: material.holesParams.speedMmPerSec,
        maxPowerPercent: material.holesParams.maxPowerPercent,
        minPowerPercent: material.holesParams.minPowerPercent,
        passes: material.holesParams.passes,
        operatorValidated: material.holesParams.operatorValidated,
      };
    }
    if (layer.role === 'CUT') {
      return {
        ...layer,
        speedMmPerSec: material.cutParams.speedMmPerSec,
        maxPowerPercent: material.cutParams.maxPowerPercent,
        minPowerPercent: material.cutParams.minPowerPercent,
        passes: material.cutParams.passes,
        operatorValidated: material.cutParams.operatorValidated,
      };
    }
    return layer;
  });
}

/**
 * Aplica los parámetros actuales de las capas C00/C01/C02 de vuelta al MaterialProfile para persistencia.
 */
export function applyWorkbenchLayersToMaterialProfile(
  layers: WorkbenchLayerConfig[],
  material: MaterialProfile
): MaterialProfile {
  const next = structuredClone(material);
  const c00 = layers.find((l) => l.role === 'ENGRAVE');
  const c01 = layers.find((l) => l.role === 'HOLES');
  const c02 = layers.find((l) => l.role === 'CUT');

  if (c00) {
    next.engraveParams = {
      ...next.engraveParams,
      speedMmPerSec: c00.speedMmPerSec,
      maxPowerPercent: c00.maxPowerPercent,
      minPowerPercent: c00.minPowerPercent,
      passes: c00.passes,
      lineIntervalMm: c00.lineIntervalMm,
      operatorValidated:
        c00.speedMmPerSec !== null &&
        c00.speedMmPerSec > 0 &&
        c00.maxPowerPercent !== null &&
        c00.maxPowerPercent > 0,
    };
  }
  if (c01) {
    next.holesParams = {
      ...next.holesParams,
      speedMmPerSec: c01.speedMmPerSec,
      maxPowerPercent: c01.maxPowerPercent,
      minPowerPercent: c01.minPowerPercent,
      passes: c01.passes,
      operatorValidated:
        c01.speedMmPerSec !== null &&
        c01.speedMmPerSec > 0 &&
        c01.maxPowerPercent !== null &&
        c01.maxPowerPercent > 0,
    };
  }
  if (c02) {
    next.cutParams = {
      ...next.cutParams,
      speedMmPerSec: c02.speedMmPerSec,
      maxPowerPercent: c02.maxPowerPercent,
      minPowerPercent: c02.minPowerPercent,
      passes: c02.passes,
      operatorValidated:
        c02.speedMmPerSec !== null &&
        c02.speedMmPerSec > 0 &&
        c02.maxPowerPercent !== null &&
        c02.maxPowerPercent > 0,
    };
  }

  return next;
}

/**
 * Valida integralmente la mesa de trabajo antes de exportar o enviar a la Vank 9060.
 * Verifica colisiones reales pieza por pieza entre trabajos distintos para permitir el intercalado continuo de filas.
 */
export function validateWorkbenchState(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): WorkbenchValidationReport {
  const issues: WorkbenchValidationIssue[] = [];
  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const totalPieces = visibleJobs.reduce((acc, j) => acc + j.pieceCount, 0);
  const occupiedBoundsMm = computeWorkbenchOccupiedBounds(visibleJobs);
  const jobOriginPointMm = computeJobOriginPointMm(occupiedBoundsMm, config);

  if (visibleJobs.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_WORKBENCH',
      message: 'No hay trabajos activos en la mesa. Subí uno o varios logos o enviá una etiqueta a la plancha.',
    });
  }

  let outOfSheetJobsCount = 0;
  let outOfMachineBedJobsCount = 0;
  let overlappingJobsCount = 0;

  const sheetMinX = config.sheetOffsetXMm;
  const sheetMinY = config.sheetOffsetYMm;
  const sheetMaxX = roundMm(config.sheetOffsetXMm + config.sheetWidthMm);
  const sheetMaxY = roundMm(config.sheetOffsetYMm + config.sheetHeightMm);

  if (
    sheetMinX < 0 ||
    sheetMinY < 0 ||
    sheetMaxX > config.machineBedWidthMm + 0.01 ||
    sheetMaxY > config.machineBedHeightMm + 0.01
  ) {
    issues.push({
      severity: 'error',
      code: 'SHEET_EXCEEDS_MACHINE_BED',
      message: `La plancha (${config.sheetWidthMm}×${config.sheetHeightMm} mm) excede el área útil de la Vank 9060 (${config.machineBedWidthMm}×${config.machineBedHeightMm} mm).`,
    });
  }

  for (const job of visibleJobs) {
    const jMaxX = roundMm(job.xMm + job.widthMm);
    const jMaxY = roundMm(job.yMm + job.heightMm);

    if (
      job.xMm < -0.01 ||
      job.yMm < -0.01 ||
      jMaxX > config.machineBedWidthMm + 0.01 ||
      jMaxY > config.machineBedHeightMm + 0.01
    ) {
      outOfMachineBedJobsCount++;
      issues.push({
        severity: 'error',
        code: 'JOB_OUTSIDE_MACHINE_BED',
        message: `El trabajo "${job.name}" supera el límite de tirada de la mesa Vank 9060 (${config.machineBedWidthMm}×${config.machineBedHeightMm} mm). Reducí la cantidad de esta tirada o presioná "Ahorro Extremo 73 cm".`,
      });
    } else if (
      job.xMm < sheetMinX - 0.01 ||
      job.yMm < sheetMinY - 0.01 ||
      jMaxX > sheetMaxX + 0.01 ||
      jMaxY > sheetMaxY + 0.01
    ) {
      outOfSheetJobsCount++;
      issues.push({
        severity: 'error',
        code: 'JOB_OUTSIDE_MATERIAL_SHEET',
        message: `El trabajo "${job.name}" sobresale del ancho de la plancha/rollo (${config.sheetWidthMm}×${config.sheetHeightMm} mm). Presioná "Ahorro Extremo 73 cm".`,
      });
    }
  }

  // Verificar colisiones reales a nivel pieza entre trabajos distintos
  for (let i = 0; i < visibleJobs.length; i++) {
    for (let k = i + 1; k < visibleJobs.length; k++) {
      const a = visibleJobs[i];
      const b = visibleJobs[k];
      const eps = 0.05;
      // Primero descarte rápido por envolvente del trabajo
      const boxOverlapX =
        a.xMm < b.xMm + b.widthMm - eps && a.xMm + a.widthMm > b.xMm + eps;
      const boxOverlapY =
        a.yMm < b.yMm + b.heightMm - eps && a.yMm + a.heightMm > b.yMm + eps;

      if (!boxOverlapX || !boxOverlapY) continue;

      // Si las envolventes se tocan (ej. comparten fila en flujo continuo), verificar si alguna pieza real se pisa
      let pieceCollisionFound = false;
      for (const instA of a.instances) {
        const ax1 = a.xMm + instA.localXMm;
        const ay1 = a.yMm + instA.localYMm;
        const ax2 = ax1 + instA.widthMm;
        const ay2 = ay1 + instA.heightMm;

        for (const instB of b.instances) {
          const bx1 = b.xMm + instB.localXMm;
          const by1 = b.yMm + instB.localYMm;
          const bx2 = bx1 + instB.widthMm;
          const by2 = by1 + instB.heightMm;

          if (
            ax1 < bx2 - eps &&
            ax2 > bx1 + eps &&
            ay1 < by2 - eps &&
            ay2 > by1 + eps
          ) {
            pieceCollisionFound = true;
            break;
          }
        }
        if (pieceCollisionFound) break;
      }

      if (pieceCollisionFound) {
        overlappingJobsCount++;
        issues.push({
          severity: 'error',
          code: 'WORKBENCH_JOBS_OVERLAP',
          message: `Superposición detectada en la plancha entre "${a.name}" y "${b.name}". Presioná "Ahorro Extremo 73 cm".`,
        });
      }
    }
  }

  let hasEngraveGeometry = false;
  let hasHolesGeometry = false;
  let hasCutGeometry = false;

  for (const job of visibleJobs) {
    for (const inst of job.instances) {
      if (inst.engraveItems.length > 0) hasEngraveGeometry = true;
      if (inst.holeContours.length > 0) hasHolesGeometry = true;
      if (inst.cutContour) hasCutGeometry = true;
    }
  }

  let unconfiguredLayersCount = 0;
  let activeOutputLayersCount = 0;

  for (const layer of config.layers) {
    const hasGeo =
      (layer.role === 'ENGRAVE' && hasEngraveGeometry) ||
      (layer.role === 'HOLES' && hasHolesGeometry) ||
      (layer.role === 'CUT' && hasCutGeometry);

    if (!layer.outputEnabled || !hasGeo) continue;
    activeOutputLayersCount++;

    const validSpeed =
      layer.speedMmPerSec !== null &&
      Number.isFinite(layer.speedMmPerSec) &&
      layer.speedMmPerSec > 0 &&
      layer.speedMmPerSec <= 1000;
    const validMaxPower =
      layer.maxPowerPercent !== null &&
      Number.isFinite(layer.maxPowerPercent) &&
      layer.maxPowerPercent > 0 &&
      layer.maxPowerPercent <= 100;

    if (!validSpeed || !validMaxPower) {
      unconfiguredLayersCount++;
      issues.push({
        severity: 'warning',
        code: 'LAYER_PARAMS_UNCONFIGURED',
        message: `La capa ${layer.code} (${layer.name}) requiere velocidad (mm/s) y potencia máx. (%) ingresadas por el operador antes de enviar a la Ruida.`,
      });
    }
  }

  if (visibleJobs.length > 0 && activeOutputLayersCount === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_ACTIVE_OUTPUT_LAYERS',
      message: 'Todas las capas con geometría tienen la salida (Output) desactivada.',
    });
  }

  const engraveLayer = config.layers.find((l) => l.role === 'ENGRAVE');
  const holesLayer = config.layers.find((l) => l.role === 'HOLES');
  const cutLayer = config.layers.find((l) => l.role === 'CUT');

  if (cutLayer && cutLayer.outputEnabled && hasCutGeometry) {
    if (
      engraveLayer &&
      engraveLayer.outputEnabled &&
      hasEngraveGeometry &&
      cutLayer.priority < engraveLayer.priority
    ) {
      issues.push({
        severity: 'warning',
        code: 'UNSAFE_LAYER_ORDER_CUT_BEFORE_ENGRAVE',
        message:
          'Advertencia de orden: La capa CORTE EXTERIOR (C02) está configurada antes que GRABADO (C00). La pieza puede caer o moverse antes de grabarse.',
      });
    }
    if (
      holesLayer &&
      holesLayer.outputEnabled &&
      hasHolesGeometry &&
      cutLayer.priority < holesLayer.priority
    ) {
      issues.push({
        severity: 'warning',
        code: 'UNSAFE_LAYER_ORDER_CUT_BEFORE_HOLES',
        message:
          'Advertencia de orden: La capa CORTE EXTERIOR (C02) está antes que ORIFICIOS INTERNOS (C01). Se recomienda cortar siempre de adentro hacia afuera.',
      });
    }
  }

  const hasFatalGeometricError = issues.some((i) => i.severity === 'error');

  return {
    isValidForExport: !hasFatalGeometricError && visibleJobs.length > 0,
    isValidForMachineSend:
      !hasFatalGeometricError &&
      visibleJobs.length > 0 &&
      unconfiguredLayersCount === 0 &&
      activeOutputLayersCount > 0,
    totalJobs: visibleJobs.length,
    totalPieces,
    occupiedBoundsMm,
    jobOriginPointMm,
    outOfSheetJobsCount,
    outOfMachineBedJobsCount,
    overlappingJobsCount,
    unconfiguredLayersCount,
    issues,
  };
}

function polylineLengthMm(pts: { x: Millimeters; y: Millimeters }[]): Millimeters {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return roundMm(len);
}

/**
 * Simula el recorrido completo del cabezal láser sobre la mesa de la Vank 9060,
 * respetando el orden de prioridad de las capas y calculando tiempos estimados.
 */
export function simulateWorkbenchToolpath(
  jobs: WorkbenchJobItem[],
  config: WorkbenchConfig
): WorkbenchSimulationResult {
  const visibleJobs = jobs.filter((j) => j.visible && j.instances.length > 0);
  const segments: ToolpathSegment[] = [];

  const bounds = computeWorkbenchOccupiedBounds(visibleJobs);
  const origin = computeJobOriginPointMm(bounds, config);

  let headX = origin.x;
  let headY = origin.y;
  let elapsedSec = 0;

  let engraveDistanceMm = 0;
  let cutDistanceMm = 0;
  let rapidDistanceMm = 0;

  let engraveDurationSec = 0;
  let holesDurationSec = 0;
  let outerCutDurationSec = 0;
  let rapidDurationSec = 0;

  const RAPID_SPEED_MM_S = 250;

  const sortedLayers = [...config.layers]
    .filter((l) => l.outputEnabled)
    .sort((a, b) => a.priority - b.priority);

  let segCounter = 0;

  const pushRapidMove = (targetX: Millimeters, targetY: Millimeters) => {
    const dist = roundMm(Math.hypot(targetX - headX, targetY - headY));
    if (dist < 0.05) {
      headX = targetX;
      headY = targetY;
      return;
    }
    const dur = Math.max(0.01, dist / RAPID_SPEED_MM_S);
    segCounter++;
    segments.push({
      id: `seg-rapid-${segCounter}`,
      kind: 'rapid_move',
      layerCode: 'G0',
      hexColor: '#38BDF8',
      fromX: headX,
      fromY: headY,
      toX: targetX,
      toY: targetY,
      points: [
        { x: headX, y: headY },
        { x: targetX, y: targetY },
      ],
      distanceMm: dist,
      durationSec: dur,
      startTimeSec: elapsedSec,
      endTimeSec: elapsedSec + dur,
    });
    headX = targetX;
    headY = targetY;
    elapsedSec += dur;
    rapidDistanceMm = roundMm(rapidDistanceMm + dist);
    rapidDurationSec += dur;
  };

  for (const layer of sortedLayers) {
    const passes = Math.max(1, layer.passes);

    if (layer.role === 'ENGRAVE') {
      const speed =
        layer.speedMmPerSec && layer.speedMmPerSec > 0 ? layer.speedMmPerSec : 200;
      const interval = Math.max(0.04, layer.lineIntervalMm || 0.1);

      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          if (inst.engraveItems.length === 0) continue;

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;

          for (const item of inst.engraveItems) {
            minX = Math.min(minX, job.xMm + item.boundingBox.minX);
            minY = Math.min(minY, job.yMm + item.boundingBox.minY);
            maxX = Math.max(maxX, job.xMm + item.boundingBox.maxX);
            maxY = Math.max(maxY, job.yMm + item.boundingBox.maxY);
          }

          if (!Number.isFinite(minX)) continue;

          const scanWidth = Math.max(1, roundMm(maxX - minX));
          const scanHeight = Math.max(0.5, roundMm(maxY - minY));
          const realScanLines = Math.max(1, Math.ceil(scanHeight / interval));
          const totalScanDist = roundMm(scanWidth * realScanLines * passes);
          const turnaroundTime = realScanLines * 0.018 * passes;
          const totalScanDur = Math.max(0.05, totalScanDist / speed + turnaroundTime);

          pushRapidMove(roundMm(minX), roundMm(minY));

          const visualRows = Math.min(8, Math.max(3, Math.ceil(scanHeight / 1.5)));
          const pts: { x: Millimeters; y: Millimeters }[] = [{ x: roundMm(minX), y: roundMm(minY) }];
          for (let r = 0; r < visualRows; r++) {
            const y = roundMm(minY + (scanHeight * r) / Math.max(1, visualRows - 1));
            if (r % 2 === 0) {
              pts.push({ x: roundMm(minX), y });
              pts.push({ x: roundMm(maxX), y });
            } else {
              pts.push({ x: roundMm(maxX), y });
              pts.push({ x: roundMm(minX), y });
            }
          }

          const lastPt = pts[pts.length - 1];
          segCounter++;
          segments.push({
            id: `seg-eng-${segCounter}`,
            kind: 'engrave_scan',
            layerCode: layer.code,
            hexColor: layer.hexColor,
            fromX: roundMm(minX),
            fromY: roundMm(minY),
            toX: lastPt.x,
            toY: lastPt.y,
            points: pts,
            distanceMm: totalScanDist,
            durationSec: totalScanDur,
            startTimeSec: elapsedSec,
            endTimeSec: elapsedSec + totalScanDur,
          });

          headX = lastPt.x;
          headY = lastPt.y;
          elapsedSec += totalScanDur;
          engraveDistanceMm = roundMm(engraveDistanceMm + totalScanDist);
          engraveDurationSec += totalScanDur;
        }
      }
    } else if (layer.role === 'HOLES') {
      const speed =
        layer.speedMmPerSec && layer.speedMmPerSec > 0 ? layer.speedMmPerSec : 20;

      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          for (const hole of inst.holeContours) {
            if (hole.points.length === 0) continue;
            const absPts = hole.points.map((p) => ({
              x: roundMm(job.xMm + p.x),
              y: roundMm(job.yMm + p.y),
            }));
            absPts.push({ ...absPts[0] });

            pushRapidMove(absPts[0].x, absPts[0].y);

            const len = roundMm(polylineLengthMm(absPts) * passes);
            const dur = Math.max(0.03, len / speed);
            segCounter++;
            segments.push({
              id: `seg-hole-${segCounter}`,
              kind: 'hole_cut',
              layerCode: layer.code,
              hexColor: layer.hexColor,
              fromX: absPts[0].x,
              fromY: absPts[0].y,
              toX: absPts[0].x,
              toY: absPts[0].y,
              points: absPts,
              distanceMm: len,
              durationSec: dur,
              startTimeSec: elapsedSec,
              endTimeSec: elapsedSec + dur,
            });

            elapsedSec += dur;
            cutDistanceMm = roundMm(cutDistanceMm + len);
            holesDurationSec += dur;
          }
        }
      }
    } else if (layer.role === 'CUT') {
      const speed =
        layer.speedMmPerSec && layer.speedMmPerSec > 0 ? layer.speedMmPerSec : 25;

      for (const job of visibleJobs) {
        for (const inst of job.instances) {
          const contour = inst.cutContour;
          if (!contour || contour.points.length === 0) continue;

          const absPts = contour.points.map((p) => ({
            x: roundMm(job.xMm + p.x),
            y: roundMm(job.yMm + p.y),
          }));
          absPts.push({ ...absPts[0] });

          pushRapidMove(absPts[0].x, absPts[0].y);

          const len = roundMm(polylineLengthMm(absPts) * passes);
          const dur = Math.max(0.05, len / speed);
          segCounter++;
          segments.push({
            id: `seg-cut-${segCounter}`,
            kind: 'outer_cut',
            layerCode: layer.code,
            hexColor: layer.hexColor,
            fromX: absPts[0].x,
            fromY: absPts[0].y,
            toX: absPts[0].x,
            toY: absPts[0].y,
            points: absPts,
            distanceMm: len,
            durationSec: dur,
            startTimeSec: elapsedSec,
            endTimeSec: elapsedSec + dur,
          });

          elapsedSec += dur;
          cutDistanceMm = roundMm(cutDistanceMm + len);
          outerCutDurationSec += dur;
        }
      }
    }
  }

  if (segments.length > 0) {
    pushRapidMove(origin.x, origin.y);
  }

  return {
    segments,
    totalDistanceMm: roundMm(engraveDistanceMm + cutDistanceMm + rapidDistanceMm),
    engraveDistanceMm,
    cutDistanceMm,
    rapidDistanceMm,
    totalDurationSec: roundMm(elapsedSec, 1),
    engraveDurationSec: roundMm(engraveDurationSec, 1),
    holesDurationSec: roundMm(holesDurationSec, 1),
    outerCutDurationSec: roundMm(outerCutDurationSec, 1),
    rapidDurationSec: roundMm(rapidDurationSec, 1),
  };
}
