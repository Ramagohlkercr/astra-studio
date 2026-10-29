import { validateLabelAndBatchGeometry } from '../geometry/geometryEngine';
import {
  LabelDesign,
  MaterialProfile,
  NestingResult,
  OrderProject,
} from '../types';

export function generateProductionSummaryReport(params: {
  project?: Partial<OrderProject>;
  design: LabelDesign;
  material: MaterialProfile;
  nesting: NestingResult;
  batchIndex?: number;
}): { reportText: string; filenameSuggested: string } {
  const { project, design, material, nesting, batchIndex = 0 } = params;
  const batch = nesting.batches[batchIndex] || nesting.batches[0];
  const validation = validateLabelAndBatchGeometry(design, nesting, batchIndex);

  const fmtParam = (val: number | null) =>
    val === null || val === undefined ? 'PENDIENTE VALIDAR EN MÁQUINA' : String(val);

  const lines: string[] = [
    '===============================================================================',
    '  ASTRA STUDIO — HOJA TÉCNICA DE PRODUCCIÓN LÁSER',
    '===============================================================================',
    `Fecha generación    : ${new Date().toISOString()}`,
    `Proyecto / Pedido   : ${project?.projectName || design.name}`,
    `Cliente             : ${project?.clientName || 'Producción Interna Astra'}`,
    `Observaciones       : ${project?.notes || 'Sin observaciones adicionales'}`,
    '',
    '1. EQUIPAMIENTO OBJETIVO',
    '-------------------------------------------------------------------------------',
    `Máquina Láser       : Vank 9060 CO₂ (Área útil máx: ${nesting.config.machineBedWidthMm} × ${nesting.config.machineBedHeightMm} mm)`,
    `Controladora        : Ruida RDC8445S`,
    `Software compatible : LightBurn Pro (SVG 1:1 mm) / RDWorks V8 (DXF AC1009 mm)`,
    '',
    '2. ESPECIFICACIÓN DE ETIQUETA (MODELO GEOMÉTRICO EN MILÍMETROS)',
    '-------------------------------------------------------------------------------',
    `Nombre de diseño    : ${design.name}`,
    `Geometría / Forma   : ${design.shape}`,
    `Medida nominal      : ${design.widthMm} × ${design.heightMm} mm`,
    `Radio de esquina    : ${design.cornerRadiusMm} mm`,
    `Compensación Kerf   : ${design.kerfCompensationMm} mm (Corte efectivo: ${validation.effectiveCutDimensionsMm.width} × ${validation.effectiveCutDimensionsMm.height} mm)`,
    `Agujeros costura    : Preset "${design.holes.preset}" (${validation.totalProductiveHoleContours / Math.max(1, batch?.count || 1)} por etiqueta, Ø ${design.holes.diameterMm} mm, margen borde ${design.holes.edgeDistanceMm} mm)`,
    `Elementos grabado   : ${design.elements.filter((e) => e.visible).length} elemento(s) activo(s)`,
    '',
    '3. MATERIAL Y SEGURIDAD',
    '-------------------------------------------------------------------------------',
    `Material            : ${material.name} (${material.code})`,
    `Espesor             : ${material.thicknessMm} mm`,
    `Confirmación apto   : ${
      material.requiresCompositionConfirmation
        ? material.compositionConfirmedByOperator
          ? 'CONFIRMADO POR OPERADOR (Libre de PVC/Cloro)'
          : 'PENDIENTE CONFIRMACIÓN FÍSICA (Verificar libre de PVC antes de cortar)'
        : 'Estándar'
    }`,
  ];

  if (material.safetyWarning) {
    lines.push(`Advertencia         : ${material.safetyWarning}`);
  }

  lines.push(
    '',
    '4. PARÁMETROS DE OPERACIÓN (INGRESADOS POR EL OPERADOR)',
    '-------------------------------------------------------------------------------',
    `Capa 00 GRABADO (#000000) : Vel = ${fmtParam(material.engraveParams.speedMmPerSec)} mm/s | Pot Máx = ${fmtParam(material.engraveParams.maxPowerPercent)} % | Intervalo = ${material.engraveParams.lineIntervalMm ?? 0.1} mm`,
    `Capa 01 AGUJEROS (#0000FF): Vel = ${fmtParam(material.holesParams.speedMmPerSec)} mm/s | Pot Máx = ${fmtParam(material.holesParams.maxPowerPercent)} % | Pasadas = ${material.holesParams.passes}`,
    `Capa 02 CORTE (#FF0000)   : Vel = ${fmtParam(material.cutParams.speedMmPerSec)} mm/s | Pot Máx = ${fmtParam(material.cutParams.maxPowerPercent)} % | Pasadas = ${material.cutParams.passes}`,
    '',
    '5. DISTRIBUCIÓN AUTOMÁTICA Y TANDAS',
    '-------------------------------------------------------------------------------',
    `Plancha / Recorte   : ${nesting.config.sheetWidthMm} × ${nesting.config.sheetHeightMm} mm`,
    `Márgenes (S/D/I/Iz) : ${nesting.config.marginTopMm} / ${nesting.config.marginRightMm} / ${nesting.config.marginBottomMm} / ${nesting.config.marginLeftMm} mm`,
    `Separación X / Y    : ${nesting.config.gapXMm} mm / ${nesting.config.gapYMm} mm`,
    `Rotación aplicada   : ${nesting.appliedRotationDeg}°`,
    `Capacidad por placa : ${nesting.maxCapacityPerSheet} u. (${nesting.maxColumnsPerSheet} col × ${nesting.maxRowsPerSheet} filas)`,
    `Cantidad solicitada : ${nesting.totalRequestedQuantity} unidades`,
    `Cantidad exportada  : ${nesting.totalExportedQuantity} unidades`,
    `Total de tandas     : ${nesting.totalBatches}`,
    `Tanda actual        : ${batch ? `${batch.batchNumber} de ${batch.totalBatches} (${batch.count} u. | ${batch.columnsUsed} col × ${batch.rowsUsed} filas)` : 'N/A'}`,
    `Área ocupada tanda  : ${batch ? `${batch.occupiedBounds.width} × ${batch.occupiedBounds.height} mm (X: ${batch.occupiedBounds.minX}..${batch.occupiedBounds.maxX} mm, Y: ${batch.occupiedBounds.minY}..${batch.occupiedBounds.maxY} mm)` : 'N/A'}`,
    `Aprovechamiento     : ${batch ? `${batch.sheetUtilizationPercent}% del recorte (${batch.boundingBoxEfficiencyPercent}% eficiencia dentro de envolvente)` : '0%'}`,
    '',
    '6. VERIFICACIÓN GEOMÉTRICA AUTOMATIZADA',
    '-------------------------------------------------------------------------------',
    `Estado general      : ${validation.isValid ? 'APROBADO (GEOMETRÍA EXACTA)' : 'CON OBSERVACIONES / ERRORES'}`,
    `Contornos cerrados  : ${validation.allContoursClosed ? 'SÍ (100% cerrados)' : 'NO'}`,
    `Líneas duplicadas   : ${validation.duplicateCutSegmentsCount} (Requisito: 0)`,
    `Piezas superpuestas : ${validation.overlappingPiecesCount} (Requisito: 0)`,
    `Fuera de área útil  : ${validation.outOfBoundsPiecesCount} (Requisito: 0)`,
    `Contornos de corte  : ${validation.totalProductiveCutContours}`,
    `Contornos agujeros  : ${validation.totalProductiveHoleContours}`,
    '==============================================================================='
  );

  const cleanName =
    design.name
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Etiqueta_Astra';

  return {
    reportText: lines.join('\n') + '\n',
    filenameSuggested: `${cleanName}_${design.widthMm}x${design.heightMm}mm_${nesting.totalExportedQuantity}u_RESUMEN_PRODUCCION.txt`,
  };
}
