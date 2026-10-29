import { describe, expect, it } from 'vitest';
import {
  centerAllElementsGeometrically,
  centerElementGeometrically,
  compileDesignElement,
  compileLabelGeometry,
  computeBoundingBox,
  computeGroupVisibleBoundingBox,
  computeSafeEngravingZone,
  fitAllElementsToAvailableSpace,
  fitElementToAvailableSpace,
  getElementNormalizedContentBounds,
  getElementVisibleBoundingBoxMm,
  nudgeElementMm,
  roundMm,
  validateLabelAndBatchGeometry,
} from '../geometry/geometryEngine';
import {
  computeEffectiveDpi,
  parseSvgLogoString,
  processRgbaBufferToBinaryMask,
} from '../image/imageProcessor';
import {
  createBlankLabelDesign,
  createReference20x10LabelDesign,
  deserializeOrderProjectFromJson,
  serializeOrderProjectToJson,
} from '../projects/projectManager';
import { computeNestingLayout, DEFAULT_NESTING_CONFIG } from '../nesting/nestingEngine';
import { exportProductionSvg } from '../exporters/svgExporter';
import { parseAndAuditLightBurnSvg } from '../exporters/fileFormatValidator';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { LabelDesign, LabelElement, OrderProject, Point2D, SvgLogoElement } from '../types';

describe('Astra Studio — Las 16 Pruebas Obligatorias del Asistente CAD/CAM', () => {
  // 1. Logo con márgenes transparentes
  it('1. detecta límites visibles y centra ignorando márgenes transparentes del lienzo', () => {
    // Simular imagen de 100x100 px con contenido solo en [30..70, 20..60] (márgenes asimétricos)
    const w = 100, h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (x >= 30 && x <= 70 && y >= 20 && y <= 60) {
          rgba[idx] = 20; // R
          rgba[idx + 1] = 20; // G
          rgba[idx + 2] = 20; // B
          rgba[idx + 3] = 255; // Alfa opaco
        } else {
          rgba[idx + 3] = 0; // Transparente
        }
      }
    }

    const { contentBoundsNormalized } = processRgbaBufferToBinaryMask(rgba, w, h, {
      mode: 'raster',
      threshold: 128,
      brightness: 0,
      contrast: 0,
      invert: false,
      removeBackground: false,
      backgroundTolerance: 10,
      turdSize: 0.5,
    });

    expect(contentBoundsNormalized.minX).toBeCloseTo(0.3, 2);
    expect(contentBoundsNormalized.maxX).toBeCloseTo(0.71, 2);
    expect(contentBoundsNormalized.minY).toBeCloseTo(0.2, 2);
    expect(contentBoundsNormalized.maxY).toBeCloseTo(0.61, 2);

    const design = createBlankLabelDesign(30, 20, 'rounded_rect');
    const el: LabelElement = {
      id: 'logo-raster-transp',
      name: 'Logo Asimétrico',
      type: 'logo_raster',
      xMm: 15,
      yMm: 10,
      widthMm: 10,
      heightMm: 10,
      aspectRatio: 1,
      lockAspectRatio: true,
      rotationDeg: 0,
      locked: false,
      visible: true,
      originalDataUrl: 'data:image/png;base64,mock',
      processedDataUrl: 'data:image/png;base64,mock',
      pixelWidth: 100,
      pixelHeight: 100,
      processing: {
        mode: 'raster',
        threshold: 128,
        brightness: 0,
        contrast: 0,
        invert: false,
        removeBackground: false,
        backgroundTolerance: 10,
        turdSize: 0.5,
      },
      vectorizedPathsNormalized: [],
      effectiveDpi: 254,
      contentBoundsNormalized,
    };

    const centered = centerElementGeometrically(el, design, 'label_center');
    const visBox = getElementVisibleBoundingBoxMm(centered);
    const visCenterX = (visBox.minX + visBox.maxX) / 2;
    const visCenterY = (visBox.minY + visBox.maxY) / 2;

    expect(visCenterX).toBeCloseTo(15.0, 1);
    expect(visCenterY).toBeCloseTo(10.0, 1);
  });

  // 2. Logo asimétrico
  it('2. alinea centro geométrico y permite micro-desplazamiento óptico de 0.1 mm y 0.01 mm', () => {
    const design = createBlankLabelDesign(40, 20, 'rounded_rect');
    const el: LabelElement = {
      id: 'asym-logo',
      name: 'Asimétrico',
      type: 'logo_svg',
      xMm: 10,
      yMm: 8,
      widthMm: 16,
      heightMm: 8,
      aspectRatio: 2,
      lockAspectRatio: true,
      rotationDeg: 0,
      locked: false,
      visible: true,
      rawSvgContent: '<svg viewBox="0 0 40 20"><path d="M 0 0 L 10 0 L 10 20 L 0 20 Z" /></svg>',
      normalizedPaths: ['M 0 0 L 10 0 L 10 20 L 0 20 Z'],
      originalViewBox: { minX: 0, minY: 0, width: 40, height: 20 },
      contentBoundsNormalized: {
        minX: 0,
        minY: 0,
        maxX: 0.25,
        maxY: 1.0,
        width: 0.25,
        height: 1.0,
        centerNormX: 0.125,
        centerNormY: 0.5,
      },
    };

    const centered = centerElementGeometrically(el, design, 'label_center');
    const visBox = getElementVisibleBoundingBoxMm(centered);
    expect((visBox.minX + visBox.maxX) / 2).toBeCloseTo(20.0, 1);

    // Ajuste óptico de 0.1 mm a la derecha y 0.01 mm hacia arriba
    const nudged01 = nudgeElementMm(centered, 0.1, 0, design);
    expect(nudged01.xMm).toBeCloseTo(centered.xMm + 0.1, 3);

    const nudged001 = nudgeElementMm(nudged01, 0, -0.01, design);
    expect(nudged001.yMm).toBeCloseTo(centered.yMm - 0.01, 3);
  });

  // 3. Logo con agujeros interiores
  it('3. conserva agujeros y huecos interiores (letras O, A, B) con fill-rule evenodd', () => {
    const hollowSvg = `<svg viewBox="0 0 50 50">
      <path d="M 5 5 L 45 5 L 45 45 L 5 45 Z M 15 15 L 35 15 L 35 35 L 15 35 Z" />
    </svg>`;
    const parsed = parseSvgLogoString(hollowSvg);
    expect(parsed.normalizedPaths.length).toBeGreaterThan(0);

    const el: SvgLogoElement = {
      id: 'hollow-el',
      name: 'Hueco',
      type: 'logo_svg',
      xMm: 15,
      yMm: 10,
      widthMm: 10,
      heightMm: 10,
      aspectRatio: 1,
      lockAspectRatio: true,
      rotationDeg: 0,
      locked: false,
      visible: true,
      rawSvgContent: hollowSvg,
      normalizedPaths: parsed.normalizedPaths,
      originalViewBox: parsed.originalViewBox,
      contentBoundsNormalized: parsed.contentBoundsNormalized,
    };

    const compiled = compileDesignElement(el);
    expect(compiled).not.toBeNull();
    expect(compiled?.fillRule).toBe('evenodd');
    expect(compiled?.filled).toBe(true);
  });

  // 4. Logo con varios elementos
  it('4. conserva composición relativa y centra el grupo completo', () => {
    const design = createBlankLabelDesign(50, 25, 'rounded_rect');
    const el1: LabelElement = {
      id: 'el-icon',
      name: 'Icono',
      type: 'logo_svg',
      xMm: 15,
      yMm: 12.5,
      widthMm: 8,
      heightMm: 8,
      aspectRatio: 1,
      lockAspectRatio: true,
      rotationDeg: 0,
      locked: false,
      visible: true,
      rawSvgContent: '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" /></svg>',
      normalizedPaths: ['M 0 0 L 10 0 L 10 10 L 0 10 Z'],
      originalViewBox: { minX: 0, minY: 0, width: 10, height: 10 },
    };

    const el2: LabelElement = {
      id: 'el-text',
      name: 'Texto',
      type: 'vector_text',
      xMm: 28,
      yMm: 12.5,
      widthMm: 14,
      heightMm: 3,
      aspectRatio: 4.66,
      lockAspectRatio: false,
      rotationDeg: 0,
      locked: false,
      visible: true,
      text: 'STUDIO',
      fontSizeMm: 2.5,
      letterSpacingMm: 0.3,
      fontStyle: 'sans_industrial',
      strokeWidthMm: 0.3,
    };

    const initialDistance = el2.xMm - el1.xMm; // 13 mm de separación relativa
    const groupCentered = centerAllElementsGeometrically([el1, el2], design, 'label_center');

    const newDist = groupCentered[1].xMm - groupCentered[0].xMm;
    expect(newDist).toBeCloseTo(initialDistance, 3); // Composición relativa conservada

    const groupBBox = computeGroupVisibleBoundingBox(groupCentered);
    const groupCenterX = (groupBBox.minX + groupBBox.maxX) / 2;
    const groupCenterY = (groupBBox.minY + groupBBox.maxY) / 2;

    expect(groupCenterX).toBeCloseTo(25.0, 1);
    expect(groupCenterY).toBeCloseTo(12.5, 1);
  });

  // 5. Etiqueta de 20 × 10 mm sin perforaciones
  it('5. compila etiqueta de 20x10 mm sin perforaciones con 0 agujeros y cotas exactas', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.holes.preset = 'none';

    const compiled = compileLabelGeometry(design);
    expect(compiled.nominalWidthMm).toBe(20);
    expect(compiled.nominalHeightMm).toBe(10);
    expect(compiled.holeContours.length).toBe(0);
    expect(compiled.outerCutContour.closed).toBe(true);
  });

  // 6. Etiqueta de 20 × 10 mm con dos perforaciones
  it('6. compila etiqueta de 20x10 mm con 2 perforaciones a 2.5 mm del borde', () => {
    const design = createReference20x10LabelDesign();
    design.holes = {
      preset: 'two_horizontal',
      diameterMm: 2.0,
      edgeDistanceMm: 2.5,
      customHoles: [],
    };

    const compiled = compileLabelGeometry(design);
    expect(compiled.holeContours.length).toBe(2);
    expect(compiled.holeContours[0].boundingBox.minX).toBeGreaterThanOrEqual(1.4);
    expect(compiled.holeContours[1].boundingBox.maxX).toBeLessThanOrEqual(18.6);

    const safeZone = computeSafeEngravingZone(design);
    expect(safeZone.minX).toBeGreaterThan(3.0);
    expect(safeZone.maxX).toBeLessThan(17.0);
  });

  // 7. Etiqueta circular
  it('7. compila etiqueta circular e inscribe zona de grabado segura', () => {
    const design = createBlankLabelDesign(30, 30, 'circle');
    const compiled = compileLabelGeometry(design);

    expect(compiled.nominalWidthMm).toBe(30);
    expect(compiled.nominalHeightMm).toBe(30);
    expect(compiled.outerCutContour.points.length).toBeGreaterThan(20);

    const safeZone = computeSafeEngravingZone(design);
    // El rectángulo seguro debe estar contenido dentro del círculo r=15
    const cx = 15, cy = 15;
    const maxR = Math.hypot(safeZone.maxX - cx, safeZone.maxY - cy);
    expect(maxR).toBeLessThan(15.0); // No invade perímetro circular
  });

  // 8. Etiqueta ovalada
  it('8. compila etiqueta ovalada de 40x20 mm con contorno elíptico cerrado', () => {
    const design = createBlankLabelDesign(40, 20, 'oval');
    const compiled = compileLabelGeometry(design);

    expect(compiled.outerCutContour.closed).toBe(true);
    expect(compiled.outerCutContour.points.length).toBeGreaterThan(20);
  });

  // 9. Logo rotado y escalado
  it('9. calcula envolvente precisa para logo rotado a 45 grados', () => {
    const el: LabelElement = {
      id: 'rotated-logo',
      name: 'Rotado 45',
      type: 'logo_svg',
      xMm: 20,
      yMm: 15,
      widthMm: 10,
      heightMm: 10,
      aspectRatio: 1,
      lockAspectRatio: true,
      rotationDeg: 45,
      locked: false,
      visible: true,
      rawSvgContent: '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" /></svg>',
      normalizedPaths: ['M 0 0 L 10 0 L 10 10 L 0 10 Z'],
      originalViewBox: { minX: 0, minY: 0, width: 10, height: 10 },
    };

    const compiled = compileDesignElement(el);
    expect(compiled).not.toBeNull();
    // Un cuadrado de 10x10 rotado 45° mide 10 * sqrt(2) ≈ 14.14 mm
    expect(compiled?.boundingBox.width).toBeCloseTo(14.14, 1);
    expect(compiled?.boundingBox.height).toBeCloseTo(14.14, 1);
  });

  // 10. Cambio de tamaño después de centrar
  it('10. permite cambiar dimensiones tras centrar manteniendo la simetría', () => {
    const design = createBlankLabelDesign(30, 15, 'rounded_rect');
    const el = createReference20x10LabelDesign().elements[0];
    const centered = centerElementGeometrically(el, design, 'label_center');

    // Cambiar ancho de 10 a 16 mm manteniendo proporción
    const aspect = centered.aspectRatio || 1.5;
    const resized: LabelElement = {
      ...centered,
      widthMm: 16,
      heightMm: roundMm(16 / aspect, 2),
    };
    const reCentered = centerElementGeometrically(resized, design, 'label_center');
    const box = getElementVisibleBoundingBoxMm(reCentered);

    expect((box.minX + box.maxX) / 2).toBeCloseTo(15.0, 1);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(7.5, 1);
  });

  // 11. Grabado demasiado grande
  it('11. detecta grabado que excede los bordes y lo auto-ajusta a la zona segura', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.elements[0].widthMm = 28; // Excede 20 mm
    design.elements[0].heightMm = 14;
    if (design.elements[0].type === 'vector_text') {
      design.elements[0].fontSizeMm = 6;
    }

    const nesting = computeNestingLayout(design, DEFAULT_NESTING_CONFIG);
    const badReport = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(badReport.engraveInvasionCount).toBeGreaterThan(0);
    expect(badReport.isValid).toBe(false);

    // Ajustar al espacio disponible
    design.elements[0] = fitElementToAvailableSpace(design.elements[0], design, 0.85);
    const fixedReport = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(fixedReport.engraveInvasionCount).toBe(0);
    expect(fixedReport.isValid).toBe(true);
  });

  // 12. Grabado muy cerca de un agujero
  it('12. detecta invasión sobre orificios y lo resuelve automáticamente', () => {
    const design = createReference20x10LabelDesign();
    design.holes = {
      preset: 'two_horizontal',
      diameterMm: 2.0,
      edgeDistanceMm: 2.5,
      customHoles: [],
    };
    // Colocar grabado en x=3 (pisando agujero izquierdo en x=2.5)
    design.elements[0].xMm = 3.0;
    design.elements[0].yMm = 5.0;

    const nesting = computeNestingLayout(design, DEFAULT_NESTING_CONFIG);
    const report = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(report.engraveInvasionCount).toBeGreaterThan(0);

    // Auto-ajustar a zona segura
    design.elements[0] = fitElementToAvailableSpace(design.elements[0], design, 0.85, 'safe_zone_center');
    const fixed = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(fixed.engraveInvasionCount).toBe(0);
  });

  // 13. Centrado exacto del contenido visible
  it('13. calcula el centro geométrico visible con precisión < 0.001 mm', () => {
    const design = createBlankLabelDesign(40, 20, 'rectangle');
    const el = createReference20x10LabelDesign().elements[0];
    const centered = centerElementGeometrically(el, design, 'label_center');
    const box = getElementVisibleBoundingBoxMm(centered);

    const centerDistX = Math.abs((box.minX + box.maxX) / 2 - 20.0);
    const centerDistY = Math.abs((box.minY + box.maxY) / 2 - 10.0);

    expect(centerDistX).toBeLessThan(0.001);
    expect(centerDistY).toBeLessThan(0.001);
  });

  // 14. Exportación SVG sin cambios de escala (1:1 mm)
  it('14. exporta SVG 1:1 en mm sin deformación ni escalado de DPI erróneo', () => {
    const design = createReference20x10LabelDesign();
    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      sheetWidthMm: 200,
      sheetHeightMm: 200,
      requestedQuantity: 10,
    });
    const material = INITIAL_MATERIALS_CATALOG[0];

    const artifact = exportProductionSvg(design, nesting, material, {
      mode: 'combined',
      batchIndex: 0,
    });
    const audit = parseAndAuditLightBurnSvg(artifact.svgContent);

    expect(audit.isValid).toBe(true);
    expect(audit.viewBoxMatchesMm1To1).toBe(true);
    expect(audit.hasInvalidNumbersOrNaN).toBe(false);
  });

  // 15. Guardado y recuperación del centrado
  it('15. serializa y deserializa el proyecto conservando idénticas coordenadas y centrado', () => {
    const design = createReference20x10LabelDesign();
    const project: OrderProject = {
      id: 'order-test-persist',
      projectName: 'Proyecto Persistencia',
      clientName: 'Cliente Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: 'Notas',
      materialId: 'ECOCUERO_SUELA',
      materialProfileSnapshot: INITIAL_MATERIALS_CATALOG[0],
      labelDesign: design,
      nestingConfig: DEFAULT_NESTING_CONFIG,
      exportedFilesHistory: [],
    };

    const json = serializeOrderProjectToJson(project);
    const restored = deserializeOrderProjectFromJson(json);

    expect(restored.labelDesign.widthMm).toBe(design.widthMm);
    expect(restored.labelDesign.heightMm).toBe(design.heightMm);
    expect(restored.labelDesign.elements[0].xMm).toBe(design.elements[0].xMm);
    expect(restored.labelDesign.elements[0].yMm).toBe(design.elements[0].yMm);
  });

  // 16. Lotes de 200 y 500 unidades sin colisiones
  it('16. anida lotes de 200 y 500 unidades con conteo exacto y 0 colisiones', () => {
    const design = createReference20x10LabelDesign();

    // 200 unidades
    const nesting200 = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      sheetWidthMm: 600,
      sheetHeightMm: 400,
      requestedQuantity: 200,
    });
    expect(nesting200.totalExportedQuantity).toBe(200);
    const report200 = validateLabelAndBatchGeometry(design, nesting200, 0);
    expect(report200.overlappingPiecesCount).toBe(0);
    expect(report200.outOfBoundsPiecesCount).toBe(0);
    expect(report200.isValid).toBe(true);

    // 500 unidades
    const nesting500 = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      sheetWidthMm: 600,
      sheetHeightMm: 400,
      requestedQuantity: 500,
    });
    expect(nesting500.totalExportedQuantity).toBe(500);
    const report500 = validateLabelAndBatchGeometry(design, nesting500, 0);
    expect(report500.overlappingPiecesCount).toBe(0);
    expect(report500.outOfBoundsPiecesCount).toBe(0);
    expect(report500.isValid).toBe(true);
  });
});
