import { roundMm } from '../geometry/geometryEngine';
import {
  BoundingBox,
  LabelDesign,
  Millimeters,
  NestingConfig,
  NestingResult,
  PlacedLabelInstance,
  ProductionBatch,
} from '../types';

export const DEFAULT_NESTING_CONFIG: NestingConfig = {
  requestedQuantity: 200,
  machineBedWidthMm: 900,
  machineBedHeightMm: 600,
  sheetWidthMm: 900,
  sheetHeightMm: 600,
  gapXMm: 2.0,
  gapYMm: 2.0,
  marginTopMm: 5.0,
  marginRightMm: 5.0,
  marginBottomMm: 5.0,
  marginLeftMm: 5.0,
  rotationMode: 'auto_optimize',
  centerInSheet: false,
  fillEntireSheetCapacity: false,
};

function calcGridCapacity(
  usableW: Millimeters,
  usableH: Millimeters,
  pieceW: Millimeters,
  pieceH: Millimeters,
  gapX: Millimeters,
  gapY: Millimeters
): { cols: number; rows: number; capacity: number } {
  if (usableW <= 0 || usableH <= 0 || pieceW <= 0 || pieceH <= 0) {
    return { cols: 0, rows: 0, capacity: 0 };
  }
  const effectiveGapX = Math.max(0, gapX);
  const effectiveGapY = Math.max(0, gapY);

  // n * pieceW + (n - 1) * gapX <= usableW  =>  n * (pieceW + gapX) <= usableW + gapX
  const eps = 1e-6;
  const cols = Math.max(0, Math.floor((usableW + effectiveGapX + eps) / (pieceW + effectiveGapX)));
  const rows = Math.max(0, Math.floor((usableH + effectiveGapY + eps) / (pieceH + effectiveGapY)));
  return {
    cols,
    rows,
    capacity: cols * rows,
  };
}

/**
 * Ejecuta el motor de distribución y anidado rectangular de alta precisión en milímetros reales.
 */
export function computeNestingLayout(
  label: LabelDesign,
  config: NestingConfig
): NestingResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const positive = [label.widthMm, label.heightMm, config.sheetWidthMm, config.sheetHeightMm, config.machineBedWidthMm, config.machineBedHeightMm];
  const nonnegative = [config.gapXMm, config.gapYMm, config.marginTopMm, config.marginRightMm, config.marginBottomMm, config.marginLeftMm, label.kerfCompensationMm];
  if (positive.some(n => !Number.isFinite(n) || n <= 0) || nonnegative.some(n => !Number.isFinite(n) || n < 0) ||
      !Number.isSafeInteger(config.requestedQuantity) || config.requestedQuantity < 1 || config.requestedQuantity > 100000) {
    return {config, appliedRotationDeg:0, pieceWidthMm:0, pieceHeightMm:0, maxColumnsPerSheet:0, maxRowsPerSheet:0,
      maxCapacityPerSheet:0,totalRequestedQuantity:config.requestedQuantity,totalExportedQuantity:0,totalBatches:0,batches:[],
      orientationComparison:{deg0Capacity:0,deg0Cols:0,deg0Rows:0,deg90Capacity:0,deg90Cols:0,deg90Rows:0},warnings,
      errors:['Configuración inválida: dimensiones positivas finitas, márgenes y separaciones no negativos y cantidad entera de 1 a 100000.']};
  }

  const requestedQty = Math.max(1, Math.floor(config.requestedQuantity || 1));
  const kerf = Math.max(0, label.kerfCompensationMm || 0);

  // Dimensiones efectivas de cada pieza incluyendo compensación de kerf exterior
  const baseW = roundMm(label.widthMm + kerf);
  const baseH = roundMm(label.heightMm + kerf);

  const usableW = roundMm(
    config.sheetWidthMm - config.marginLeftMm - config.marginRightMm
  );
  const usableH = roundMm(
    config.sheetHeightMm - config.marginTopMm - config.marginBottomMm
  );

  if (config.sheetWidthMm > config.machineBedWidthMm || config.sheetHeightMm > config.machineBedHeightMm) {
    errors.push(
      `El tamaño del material (${config.sheetWidthMm} × ${config.sheetHeightMm} mm) supera el área útil de la máquina Vank 9060 (${config.machineBedWidthMm} × ${config.machineBedHeightMm} mm).`
    );
  }

  if (config.gapXMm < 0.5 || config.gapYMm < 0.5) {
    warnings.push(
      `La separación configurada (${config.gapXMm} × ${config.gapYMm} mm) es menor a 0.5 mm. En corte láser se recomienda >= 1.5 mm para evitar daño térmico o líneas compartidas.`
    );
  }

  const deg0 = calcGridCapacity(usableW, usableH, baseW, baseH, config.gapXMm, config.gapYMm);
  const deg90 = calcGridCapacity(usableW, usableH, baseH, baseW, config.gapXMm, config.gapYMm);

  if (config.layoutMode === 'blocks' || ['5x10', '10x5', '5x5'].includes(config.layoutMode ?? '')) {
    const fixed = config.layoutMode !== 'blocks';
    const columns = fixed ? (config.layoutMode === '10x5' ? 10 : 5) : requestedQty <= 25 ? 5 : 10;
    const rows = config.layoutMode === '5x10' ? 10 : 5;
    for (const grid of [deg0, deg90]) {
      grid.cols = Math.min(grid.cols, columns);
      if (fixed) grid.rows = Math.min(grid.rows, rows);
      grid.capacity = grid.cols * grid.rows;
    }
  }

  let appliedRotationDeg: 0 | 90 = 0;
  if (config.rotationMode === '90') {
    appliedRotationDeg = 90;
  } else if (config.rotationMode === '0') {
    appliedRotationDeg = 0;
  } else {
    // auto_optimize: elegir la orientación que permita más piezas por plancha
    if (deg90.capacity > deg0.capacity) {
      appliedRotationDeg = 90;
    } else {
      appliedRotationDeg = 0;
    }
  }

  const rotated90 = appliedRotationDeg === 90;
  const pieceW = rotated90 ? baseH : baseW;
  const pieceH = rotated90 ? baseW : baseH;
  const chosenGrid = rotated90 ? deg90 : deg0;

  if (chosenGrid.capacity === 0) {
    errors.push(
      `La etiqueta (${pieceW} × ${pieceH} mm) no entra en el área útil disponible (${usableW} × ${usableH} mm) con los márgenes actuales.`
    );
    return {
      config,
      appliedRotationDeg,
      pieceWidthMm: pieceW,
      pieceHeightMm: pieceH,
      maxColumnsPerSheet: 0,
      maxRowsPerSheet: 0,
      maxCapacityPerSheet: 0,
      totalRequestedQuantity: requestedQty,
      totalExportedQuantity: 0,
      totalBatches: 0,
      batches: [],
      orientationComparison: {
        deg0Capacity: deg0.capacity,
        deg0Cols: deg0.cols,
        deg0Rows: deg0.rows,
        deg90Capacity: deg90.capacity,
        deg90Cols: deg90.cols,
        deg90Rows: deg90.rows,
      },
      warnings,
      errors,
    };
  }

  const maxCols = chosenGrid.cols;
  const maxRows = chosenGrid.rows;
  const maxCap = chosenGrid.capacity;

  const totalToProduce = config.fillEntireSheetCapacity
    ? Math.max(requestedQty, Math.ceil(requestedQty / maxCap) * maxCap)
    : requestedQty;

  const totalBatches = Math.ceil(totalToProduce / maxCap);
  if (totalBatches > 1) {
    warnings.push(
      `La cantidad solicitada (${totalToProduce} u.) requiere ${totalBatches} tandas (capacidad máxima por plancha: ${maxCap} u.).`
    );
  }

  const batches: ProductionBatch[] = [];
  let globalIndex = 1;
  const sheetAreaMm2 = Math.max(1, config.sheetWidthMm * config.sheetHeightMm);
  const singlePieceAreaMm2 = pieceW * pieceH;

  for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
    const remaining = totalToProduce - (globalIndex - 1);
    const batchCount = Math.min(maxCap, remaining);

    // Calcular filas y columnas reales ocupadas en esta tanda
    const colsInBatch = Math.min(maxCols, batchCount);
    const rowsInBatch = Math.ceil(batchCount / maxCols);

    const blockWidthMm = roundMm(
      colsInBatch * pieceW + Math.max(0, colsInBatch - 1) * config.gapXMm
    );
    const blockHeightMm = roundMm(
      rowsInBatch * pieceH + Math.max(0, rowsInBatch - 1) * config.gapYMm
    );

    const startXMm = config.centerInSheet
      ? roundMm(config.marginLeftMm + (usableW - blockWidthMm) / 2)
      : roundMm(config.marginLeftMm);

    const startYMm = config.centerInSheet
      ? roundMm(config.marginTopMm + (usableH - blockHeightMm) / 2)
      : roundMm(config.marginTopMm);

    const placedInstances: PlacedLabelInstance[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < batchCount; i++) {
      const row = Math.floor(i / maxCols);
      const col = i % maxCols;

      const xMm = roundMm(startXMm + col * (pieceW + config.gapXMm));
      const yMm = roundMm(startYMm + row * (pieceH + config.gapYMm));

      const bbox: BoundingBox = {
        minX: xMm,
        minY: yMm,
        maxX: roundMm(xMm + pieceW),
        maxY: roundMm(yMm + pieceH),
        width: pieceW,
        height: pieceH,
      };

      if (bbox.minX < minX) minX = bbox.minX;
      if (bbox.minY < minY) minY = bbox.minY;
      if (bbox.maxX > maxX) maxX = bbox.maxX;
      if (bbox.maxY > maxY) maxY = bbox.maxY;

      placedInstances.push({
        instanceIndex: globalIndex++,
        batchIndex: bIdx,
        indexInBatch: i,
        row,
        col,
        xMm: roundMm(xMm + kerf / 2),
        yMm: roundMm(yMm + kerf / 2),
        widthMm: pieceW,
        heightMm: pieceH,
        rotated90,
        boundingBox: bbox,
      });
    }

    const occupiedBounds: BoundingBox =
      placedInstances.length > 0
        ? {
            minX: roundMm(minX),
            minY: roundMm(minY),
            maxX: roundMm(maxX),
            maxY: roundMm(maxY),
            width: roundMm(maxX - minX),
            height: roundMm(maxY - minY),
          }
        : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

    const totalBatchPieceArea = batchCount * singlePieceAreaMm2;
    const sheetUtilizationPercent = roundMm((totalBatchPieceArea / sheetAreaMm2) * 100, 2);
    const bboxArea = Math.max(1, occupiedBounds.width * occupiedBounds.height);
    const boundingBoxEfficiencyPercent = roundMm((totalBatchPieceArea / bboxArea) * 100, 2);

    batches.push({
      batchNumber: bIdx + 1,
      totalBatches,
      count: batchCount,
      columnsUsed: colsInBatch,
      rowsUsed: rowsInBatch,
      placedInstances,
      occupiedBounds,
      sheetUtilizationPercent,
      boundingBoxEfficiencyPercent,
    });
  }

  return {
    config,
    appliedRotationDeg,
    pieceWidthMm: pieceW,
    pieceHeightMm: pieceH,
    maxColumnsPerSheet: maxCols,
    maxRowsPerSheet: maxRows,
    maxCapacityPerSheet: maxCap,
    totalRequestedQuantity: requestedQty,
    totalExportedQuantity: totalToProduce,
    totalBatches,
    batches,
    orientationComparison: {
      deg0Capacity: deg0.capacity,
      deg0Cols: deg0.cols,
      deg0Rows: deg0.rows,
      deg90Capacity: deg90.capacity,
      deg90Cols: deg90.cols,
      deg90Rows: deg90.rows,
    },
    warnings,
    errors,
  };
}
