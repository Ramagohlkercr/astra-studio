import { describe, expect, it } from 'vitest';
import {
  centerAllElementsGeometrically,
  centerElementGeometrically,
  checkElementsFitSafeZone,
  compileLabelGeometry,
  computeBoundingBox,
  computeSafeEngravingZone,
  formatDimensionValue,
  getElementVisibleBoundingBoxMm,
  parseDimensionValue,
  roundMm,
} from '../geometry/geometryEngine';
import {
  computeNestingLayout,
  DEFAULT_NESTING_CONFIG,
} from '../nesting/nestingEngine';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import {
  createBlankLabelDesign,
  STANDARD_DIMENSION_PRESETS,
} from '../projects/projectManager';
import { exportProductionSvg } from '../exporters/svgExporter';
import { exportProductionDxf } from '../exporters/dxfExporter';
import {
  parseAndAuditLightBurnSvg,
  parseAndAuditDxfR12,
} from '../exporters/fileFormatValidator';
import { LabelDesign, LabelElement, NestingConfig, OrderProject } from '../types';

describe('Astra Studio — Verificación de Medidas Personalizadas (12 Casos Obligatorios)', () => {
  // 1. Creación de etiqueta 40 × 20 mm
  it('1. Permite crear una etiqueta con medidas nominales de 40 × 20 mm', () => {
    const design = createBlankLabelDesign(40, 20);
    expect(design.widthMm).toBe(40);
    expect(design.heightMm).toBe(20);

    const compiled = compileLabelGeometry(design);
    expect(compiled.outerCutContour.points.length).toBeGreaterThan(3);
    const box = computeBoundingBox(compiled.outerCutContour.points);
    expect(roundMm(box.width, 1)).toBe(40.0);
    expect(roundMm(box.height, 1)).toBe(20.0);
  });

  // 2. Modificación de medidas a 35 × 15 mm
  it('2. Modifica dinámicamente las dimensiones a 35 × 15 mm sin restricciones', () => {
    let design = createBlankLabelDesign(40, 20);
    // Operador cambia a 35 × 15 mm
    design = {
      ...design,
      widthMm: 35,
      heightMm: 15,
    };
    expect(design.widthMm).toBe(35);
    expect(design.heightMm).toBe(15);

    const compiled = compileLabelGeometry(design);
    const box = computeBoundingBox(compiled.outerCutContour.points);
    expect(roundMm(box.width, 1)).toBe(35.0);
    expect(roundMm(box.height, 1)).toBe(15.0);
  });

  // 3. Configuración en centímetros (4 × 2 cm, 3,5 × 1,5 cm, 1 × 1 cm, 2,75 × 1,25 cm, 6 × 4 cm)
  it('3. Parsea correctamente medidas en centímetros con punto o coma decimal', () => {
    // 4 × 2 cm = 40 × 20 mm
    const res1W = parseDimensionValue('4', 'cm');
    const res1H = parseDimensionValue('2', 'cm');
    expect(res1W.valid).toBe(true);
    expect(res1W.valueMm).toBe(40);
    expect(res1H.valid).toBe(true);
    expect(res1H.valueMm).toBe(20);

    // 3,5 × 1,5 cm = 35 × 15 mm (con coma)
    const res2W = parseDimensionValue('3,5', 'cm');
    const res2H = parseDimensionValue('1,5', 'cm');
    expect(res2W.valid).toBe(true);
    expect(res2W.valueMm).toBe(35);
    expect(res2H.valid).toBe(true);
    expect(res2H.valueMm).toBe(15);

    // 1 × 1 cm = 10 × 10 mm
    const res3W = parseDimensionValue('1', 'cm');
    const res3H = parseDimensionValue('1', 'cm');
    expect(res3W.valid).toBe(true);
    expect(res3W.valueMm).toBe(10);
    expect(res3H.valid).toBe(true);
    expect(res3H.valueMm).toBe(10);

    // 2,75 × 1,25 cm = 27,5 × 12,5 mm (con coma y 2 decimales)
    const res4W = parseDimensionValue('2,75', 'cm');
    const res4H = parseDimensionValue('1,25', 'cm');
    expect(res4W.valid).toBe(true);
    expect(res4W.valueMm).toBe(27.5);
    expect(res4H.valid).toBe(true);
    expect(res4H.valueMm).toBe(12.5);

    // 6 × 4 cm = 60 × 40 mm
    const res5W = parseDimensionValue('6', 'cm');
    const res5H = parseDimensionValue('4', 'cm');
    expect(res5W.valid).toBe(true);
    expect(res5W.valueMm).toBe(60);
    expect(res5H.valid).toBe(true);
    expect(res5H.valueMm).toBe(40);

    // Rechaza medidas imposibles o fuera de límites
    expect(parseDimensionValue('0', 'cm').valid).toBe(false);
    expect(parseDimensionValue('-5', 'mm').valid).toBe(false);
    expect(parseDimensionValue('abc', 'mm').valid).toBe(false);
    expect(parseDimensionValue('950', 'mm').valid).toBe(false); // > 900mm mesa Vank
  });

  // 4. Alternancia entre unidades (cm y mm) sin alterar la escala
  it('4. Alterna entre visualización mm y cm manteniendo las dimensiones internas estrictamente en mm', () => {
    const design = createBlankLabelDesign(40, 20);

    // En modo mm: 40 y 20
    const strMmW = formatDimensionValue(design.widthMm, 'mm');
    const strMmH = formatDimensionValue(design.heightMm, 'mm');
    expect(strMmW).toBe('40');
    expect(strMmH).toBe('20');

    // Al alternar a cm: 4 y 2
    const strCmW = formatDimensionValue(design.widthMm, 'cm');
    const strCmH = formatDimensionValue(design.heightMm, 'cm');
    expect(strCmW).toBe('4');
    expect(strCmH).toBe('2');

    // Re-parsear el valor en cm no altera la escala en mm
    const backToMmW = parseDimensionValue(strCmW, 'cm');
    const backToMmH = parseDimensionValue(strCmH, 'cm');
    expect(backToMmW.valueMm).toBe(40);
    expect(backToMmH.valueMm).toBe(20);
    expect(design.widthMm).toBe(40);
    expect(design.heightMm).toBe(20);
  });

  // 5. Modificar ancho manteniendo alto
  it('5. Modifica únicamente el ancho manteniendo intacto el alto', () => {
    let design = createBlankLabelDesign(40, 20);
    // Cambiar ancho de 40 a 50 mm
    design = {
      ...design,
      widthMm: 50,
    };
    expect(design.widthMm).toBe(50);
    expect(design.heightMm).toBe(20);

    const compiled = compileLabelGeometry(design);
    const box = computeBoundingBox(compiled.outerCutContour.points);
    expect(roundMm(box.width, 1)).toBe(50.0);
    expect(roundMm(box.height, 1)).toBe(20.0);
  });

  // 6. Modificar alto manteniendo ancho
  it('6. Modifica únicamente el alto manteniendo intacto el ancho', () => {
    let design = createBlankLabelDesign(40, 20);
    // Cambiar alto de 20 a 25 mm
    design = {
      ...design,
      heightMm: 25,
    };
    expect(design.widthMm).toBe(40);
    expect(design.heightMm).toBe(25);

    const compiled = compileLabelGeometry(design);
    const box = computeBoundingBox(compiled.outerCutContour.points);
    expect(roundMm(box.width, 1)).toBe(40.0);
    expect(roundMm(box.height, 1)).toBe(25.0);
  });

  // 7. Alternancia fluida entre medidas preestablecidas y personalizadas
  it('7. Alterna entre presets sugeridos y medidas personalizadas identificando el estado activo', () => {
    let design = createBlankLabelDesign(30, 15);

    // Coincide con preset estándar 30x15
    let matchedPreset = STANDARD_DIMENSION_PRESETS.find(
      (p) => Math.abs(p.widthMm - design.widthMm) < 0.05 && Math.abs(p.heightMm - design.heightMm) < 0.05
    );
    expect(matchedPreset?.id).toBe('30x15');

    // Cambiar a medida personalizada 42 × 22 mm
    design = {
      ...design,
      widthMm: 42,
      heightMm: 22,
    };
    matchedPreset = STANDARD_DIMENSION_PRESETS.find(
      (p) => Math.abs(p.widthMm - design.widthMm) < 0.05 && Math.abs(p.heightMm - design.heightMm) < 0.05
    );
    expect(matchedPreset).toBeUndefined(); // Es 'Personalizada'

    // Cambiar a preset 40x20
    design = {
      ...design,
      widthMm: 40,
      heightMm: 20,
    };
    matchedPreset = STANDARD_DIMENSION_PRESETS.find(
      (p) => Math.abs(p.widthMm - design.widthMm) < 0.05 && Math.abs(p.heightMm - design.heightMm) < 0.05
    );
    expect(matchedPreset?.id).toBe('40x20');
  });

  // 8. Comprobación de centrado de logo tras cambio de tamaño
  it('8. Mantiene el logo centrado geométricamente sin alterar su tamaño ni aspect ratio al cambiar dimensiones', () => {
    const initialDesign = createBlankLabelDesign(20, 10);
    const logoEl: LabelElement = {
      id: 'test-logo',
      name: 'Logo Cliente',
      type: 'logo_svg',
      xMm: 10,
      yMm: 5,
      widthMm: 12,
      heightMm: 6,
      aspectRatio: 2.0,
      lockAspectRatio: true,
      rotationDeg: 0,
      visible: true,
      locked: false,
      rawSvgContent: '<svg viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50"/></svg>',
      normalizedPaths: ['M 0 0 L 100 0 L 100 50 L 0 50 Z'],
      originalViewBox: { minX: 0, minY: 0, width: 100, height: 50 },
    };
    initialDesign.elements = [logoEl];

    // Cambiar a 40 × 20 mm
    const updatedDesign: LabelDesign = {
      ...initialDesign,
      widthMm: 40,
      heightMm: 20,
    };

    const centeredElements = centerAllElementsGeometrically(
      initialDesign.elements,
      updatedDesign,
      'label_center'
    );

    const updatedLogo = centeredElements[0];
    expect(updatedLogo).toBeDefined();

    // El centro físico de la nueva etiqueta es (20, 10)
    const box = getElementVisibleBoundingBoxMm(updatedLogo);
    const logoCenterX = (box.minX + box.maxX) / 2;
    const logoCenterY = (box.minY + box.maxY) / 2;

    expect(roundMm(logoCenterX, 2)).toBe(20.0);
    expect(roundMm(logoCenterY, 2)).toBe(10.0);

    // El ancho y alto del logo no se redujeron ni agrandaron silenciosamente
    expect(updatedLogo.widthMm).toBe(12);
    expect(updatedLogo.heightMm).toBe(6);

    // Cabe perfectamente dentro de la nueva zona segura de 40 × 20 mm
    const fitCheck = checkElementsFitSafeZone(centeredElements, updatedDesign);
    expect(fitCheck.fits).toBe(true);
  });

  // 9. Guardado y reapertura de proyecto con 40 × 20 mm
  it('9. Serializa, guarda y reabre un pedido con dimensiones 40 × 20 mm de forma íntegra', () => {
    const ecocuero = INITIAL_MATERIALS_CATALOG[0];
    const project: OrderProject = {
      id: 'order-test-40x20',
      projectName: 'Etiquetas Personalizadas 40x20',
      clientName: 'Cliente Marroquinería',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      materialId: ecocuero.id,
      materialProfileSnapshot: structuredClone(ecocuero),
      labelDesign: createBlankLabelDesign(40, 20),
      nestingConfig: {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 200,
      },
      exportedFilesHistory: [],
      notes: 'Pedido con dimensiones 40x20 mm',
    };

    const jsonString = JSON.stringify(project);
    const restoredProject: OrderProject = JSON.parse(jsonString);

    expect(restoredProject.labelDesign.widthMm).toBe(40);
    expect(restoredProject.labelDesign.heightMm).toBe(20);
    expect(restoredProject.projectName).toBe('Etiquetas Personalizadas 40x20');
  });

  // 10. Generación de distribución de 200 etiquetas 40 × 20 mm
  it('10. Calcula anidado de 200 etiquetas de 40 × 20 mm en mesa 900 × 600 mm respetando márgenes y espaciado', () => {
    const design = createBlankLabelDesign(40, 20);
    const nestingConfig: NestingConfig = {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 200,
      sheetWidthMm: 900,
      sheetHeightMm: 600,
      marginLeftMm: 10,
      marginRightMm: 10,
      marginTopMm: 10,
      marginBottomMm: 10,
      gapXMm: 2.0,
      gapYMm: 2.0,
      rotationMode: '0',
    };

    const result = computeNestingLayout(design, nestingConfig);
    expect(result.totalExportedQuantity).toBeGreaterThanOrEqual(200);

    const firstBatch = result.batches[0];
    expect(firstBatch.placedInstances.length).toBeGreaterThanOrEqual(200);

    // Verificar que ninguna etiqueta desborde el área útil con margen
    for (const p of firstBatch.placedInstances) {
      expect(p.xMm).toBeGreaterThanOrEqual(10.0);
      expect(p.yMm).toBeGreaterThanOrEqual(10.0);
      expect(p.xMm + 40).toBeLessThanOrEqual(900 - 10.0 + 0.1);
      expect(p.yMm + 20).toBeLessThanOrEqual(600 - 10.0 + 0.1);
    }
  });

  // 11. Verificación de exportación SVG y DXF
  it('11. Genera y audita exportaciones técnicas SVG (1:1 LightBurn) y DXF R12 para etiqueta 40 × 20 mm', () => {
    const design = createBlankLabelDesign(40, 20);
    const nestingConfig: NestingConfig = {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 50,
      sheetWidthMm: 900,
      sheetHeightMm: 600,
    };
    const nestingResult = computeNestingLayout(design, nestingConfig);
    const material = INITIAL_MATERIALS_CATALOG[0];

    // Exportar SVG
    const svgArtifact = exportProductionSvg(design, nestingResult, material, {
      mode: 'combined',
      batchIndex: 0,
    });
    expect(svgArtifact.svgContent).toContain('<svg');
    expect(svgArtifact.svgContent).toContain('viewBox="0 0 900 600"');

    // Auditar SVG con analizador de LightBurn
    const svgAudit = parseAndAuditLightBurnSvg(svgArtifact.svgContent);
    expect(svgAudit.isValid).toBe(true);
    expect(svgAudit.viewBoxMatchesMm1To1).toBe(true);
    expect(svgAudit.widthMm).toBe(900);
    expect(svgAudit.heightMm).toBe(600);
    expect(svgAudit.cutLayerCount).toBeGreaterThan(0);

    // Exportar DXF
    const dxfArtifact = exportProductionDxf(design, nestingResult, 0);
    expect(dxfArtifact.dxfContent).toContain('SECTION');
    expect(dxfArtifact.dxfContent).toContain('ENTITIES');

    // Auditar DXF R12
    const dxfAudit = parseAndAuditDxfR12(dxfArtifact.dxfContent);
    expect(dxfAudit.isValid).toBe(true);
    expect(dxfAudit.acadVer).toBe('AC1009');
    expect(dxfAudit.insUnits).toBe(4); // 4 = Milímetros
    expect(dxfAudit.totalPolylines).toBeGreaterThan(0);
    expect(dxfAudit.allCutAndHolesClosedFlag).toBe(true);
  });

  // 12. Comprobación de dimensiones de contorno individual
  it('12. Verifica dimensiones exactas del contorno de corte individual de 40 × 20 mm con y sin kerf', () => {
    // Sin kerf
    const designNoKerf = createBlankLabelDesign(40, 20);
    designNoKerf.kerfCompensationMm = 0;
    const compiledNoKerf = compileLabelGeometry(designNoKerf);
    expect(compiledNoKerf.outerCutContour.closed).toBe(true);
    const boxNoKerf = computeBoundingBox(compiledNoKerf.outerCutContour.points);
    expect(roundMm(boxNoKerf.width, 2)).toBe(40.0);
    expect(roundMm(boxNoKerf.height, 2)).toBe(20.0);

    // Con kerf de 0.1 mm (offset exterior = kerf / 2 = 0.05 mm por lado -> ancho efectivo 40.1 mm)
    const designKerf = createBlankLabelDesign(40, 20);
    designKerf.kerfCompensationMm = 0.1;
    const compiledKerf = compileLabelGeometry(designKerf);
    expect(compiledKerf.outerCutContour.closed).toBe(true);
    const boxKerf = computeBoundingBox(compiledKerf.outerCutContour.points);
    expect(roundMm(boxKerf.width, 2)).toBe(40.1);
    expect(roundMm(boxKerf.height, 2)).toBe(20.1);
  });
});
