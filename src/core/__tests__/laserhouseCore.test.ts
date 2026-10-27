import { describe, expect, it } from 'vitest';
import {
  compileLabelGeometry,
  computeSafeEngravingZone,
  detectDuplicateCutSegments,
  fitElementIntoSafeZone,
  roundMm,
  validateLabelAndBatchGeometry,
} from '../geometry/geometryEngine';
import {
  computeNestingLayout,
  DEFAULT_NESTING_CONFIG,
} from '../nesting/nestingEngine';
import { exportProductionSvg } from '../exporters/svgExporter';
import { exportProductionDxf } from '../exporters/dxfExporter';
import {
  parseAndAuditDxfR12,
  parseAndAuditLightBurnSvg,
} from '../exporters/fileFormatValidator';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import {
  computeEffectiveDpi,
  DEFAULT_IMAGE_PROCESSING,
  parseSvgLogoString,
  processRgbaBufferToBinaryMask,
  traceBinaryMaskToNormalizedPaths,
} from '../image/imageProcessor';
import {
  createBlankLabelDesign,
  createInitialOrdersCatalog,
  createReference20x10LabelDesign,
  deserializeOrderProjectFromJson,
  duplicateOrderWithQuantity,
  MATERIAL_SHEET_PRESETS,
  serializeOrderProjectToJson,
} from '../projects/projectManager';
import { LabelDesign } from '../types';

describe('LaserHouse Studio — Motor Geométrico en Milímetros (Precisión Crítica)', () => {
  const testSizes: Array<{ w: number; h: number; shape: LabelDesign['shape'] }> = [
    { w: 10, h: 10, shape: 'square' },
    { w: 15, h: 15, shape: 'rounded_rect' },
    { w: 10, h: 20, shape: 'rectangle' },
    { w: 20, h: 20, shape: 'circle' },
    { w: 30, h: 15, shape: 'oval' },
    { w: 22.75, h: 11.35, shape: 'rounded_rect' }, // Medidas decimales
  ];

  it.each(testSizes)(
    'compila etiqueta de $w x $h mm ($shape) con dimensiones físicas exactas y contornos cerrados',
    ({ w, h, shape }) => {
      const base = createReference20x10LabelDesign(false);
      const design: LabelDesign = {
        ...base,
        shape,
        widthMm: w,
        heightMm: h,
        cornerRadiusMm: shape === 'rounded_rect' ? 1.5 : 0,
        kerfCompensationMm: 0,
      };

      const compiled = compileLabelGeometry(design);

      expect(compiled.nominalWidthMm).toBe(w);
      expect(compiled.nominalHeightMm).toBe(h);
      expect(compiled.outerCutContour.closed).toBe(true);
      expect(compiled.outerCutContour.svgPathD.trim().endsWith('Z')).toBe(true);
      expect(compiled.outerCutContour.boundingBox.width).toBeCloseTo(w, 3);
      expect(compiled.outerCutContour.boundingBox.height).toBeCloseTo(h, 3);
    }
  );

  it('aplica compensación de Kerf correctamente (expande corte exterior y contrae agujeros internos)', () => {
    const design = createReference20x10LabelDesign(false);
    design.widthMm = 20.5;
    design.heightMm = 10.25;
    design.kerfCompensationMm = 0.16; // 0.08 mm por lado
    design.holes = {
      preset: 'single_left',
      diameterMm: 2.0,
      edgeDistanceMm: 3.0,
      customHoles: [],
    };

    const compiled = compileLabelGeometry(design);
    expect(compiled.effectiveCutWidthMm).toBeCloseTo(20.66, 4);
    expect(compiled.effectiveCutHeightMm).toBeCloseTo(10.41, 4);
    expect(compiled.holeContours).toHaveLength(1);
    expect(compiled.holeContours[0].boundingBox.width).toBeCloseTo(1.84, 3);
  });

  it('conserva las dimensiones de bordes decorativos y logos raster cuando la etiqueta rota 90° en el anidado', () => {
    const catalog = createInitialOrdersCatalog();
    const acrilicoOrder = catalog[1]; // 30 x 15 mm con decorative_border
    const compiledRot90 = compileLabelGeometry(acrilicoOrder.labelDesign, {
      rotated90: true,
    });
    expect(compiledRot90.nominalWidthMm).toBe(15);
    expect(compiledRot90.nominalHeightMm).toBe(30);
    // El marco interior rotado 90° debe quedar dentro de 15 x 30 mm (ancho 10.5 mm, alto 20 mm)
    const borderItem = compiledRot90.engravingItems[0];
    expect(borderItem.boundingBox.width).toBeCloseTo(10.5, 2);
    expect(borderItem.boundingBox.height).toBeCloseTo(20, 2);
  });
});

describe('LaserHouse Studio — Agujeros Opcionales (0, 1, 2, 4 y Personalizados)', () => {
  it('NO agrega agujeros automáticamente al crear una etiqueta nueva', () => {
    const blank = createBlankLabelDesign(25, 12, 'rounded_rect');
    expect(blank.holes.preset).toBe('none');
    const compiled = compileLabelGeometry(blank);
    expect(compiled.holeContours).toHaveLength(0);
  });

  it('soporta 0, 1, 2, 4 y agujeros personalizados con diámetro y distancia al borde editables', () => {
    const design = createBlankLabelDesign(30, 15, 'rounded_rect');

    // 1 agujero izquierdo
    design.holes = { preset: 'single_left', diameterMm: 2.2, edgeDistanceMm: 3.5, customHoles: [] };
    let compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(1);
    expect(compiled.holeContours[0].primitive).toEqual({
      kind: 'circle',
      cx: 3.5,
      cy: 7.5,
      r: 1.1,
    });

    // 2 agujeros horizontales
    design.holes = { preset: 'two_horizontal', diameterMm: 1.8, edgeDistanceMm: 2.5, customHoles: [] };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(2);
    expect(compiled.holeContours[0].boundingBox.minX).toBeCloseTo(2.5 - 0.9, 3);
    expect(compiled.holeContours[1].boundingBox.maxX).toBeCloseTo(30 - 2.5 + 0.9, 3);

    // 4 agujeros en esquinas
    design.holes = { preset: 'four_corners', diameterMm: 1.6, edgeDistanceMm: 2.4, customHoles: [] };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(4);

    // Agujeros personalizados (3 agujeros libres)
    design.holes = {
      preset: 'custom',
      diameterMm: 1.5,
      edgeDistanceMm: 2.0,
      customHoles: [
        { id: 'c1', x: 3.0, y: 4.0, diameterMm: 1.4 },
        { id: 'c2', x: 3.0, y: 11.0, diameterMm: 1.4 },
        { id: 'c3', x: 27.0, y: 7.5, diameterMm: 2.0 },
      ],
    };
    compiled = compileLabelGeometry(design);
    expect(compiled.holeContours).toHaveLength(3);
    expect(compiled.holeContours[2].boundingBox.width).toBeCloseTo(2.0, 3);
  });
});

describe('LaserHouse Studio — Distribución Automática y Dimensiones de Material Reales', () => {
  const quantities = [1, 25, 100, 200, 500, 1000];

  it.each(quantities)(
    'distribuye exactamente %i unidades sin superposición ni piezas fuera de la mesa Vank 9060 (900x600 mm)',
    (qty) => {
      const design = createReference20x10LabelDesign(true);
      const config = {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: qty,
        sheetWidthMm: 900,
        sheetHeightMm: 600,
        gapXMm: 2.0,
        gapYMm: 2.0,
        marginTopMm: 5.0,
        marginRightMm: 5.0,
        marginBottomMm: 5.0,
        marginLeftMm: 5.0,
      };

      const nesting = computeNestingLayout(design, config);
      expect(nesting.errors).toHaveLength(0);
      expect(nesting.totalRequestedQuantity).toBe(qty);
      expect(nesting.totalExportedQuantity).toBe(qty);

      const sumAcrossBatches = nesting.batches.reduce((acc, b) => acc + b.count, 0);
      expect(sumAcrossBatches).toBe(qty);

      const validation = validateLabelAndBatchGeometry(design, nesting, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.overlappingPiecesCount).toBe(0);
      expect(validation.outOfBoundsPiecesCount).toBe(0);
      expect(validation.duplicateCutSegmentsCount).toBe(0);
      expect(validation.allContoursClosed).toBe(true);
    }
  );

  it.each(MATERIAL_SHEET_PRESETS)(
    'calcula capacidad exacta y sin colisiones para recorte de material $label ($widthMm x $heightMm mm)',
    ({ widthMm, heightMm }) => {
      const design = createReference20x10LabelDesign(false);
      const nesting = computeNestingLayout(design, {
        ...DEFAULT_NESTING_CONFIG,
        requestedQuantity: 150,
        sheetWidthMm: widthMm,
        sheetHeightMm: heightMm,
        gapXMm: 2.0,
        gapYMm: 2.0,
        marginTopMm: 5.0,
        marginRightMm: 5.0,
        marginBottomMm: 5.0,
        marginLeftMm: 5.0,
      });

      expect(nesting.maxCapacityPerSheet).toBeGreaterThan(0);
      expect(nesting.totalExportedQuantity).toBe(150);
      const validation = validateLabelAndBatchGeometry(design, nesting, 0);
      expect(validation.isValid).toBe(true);
      expect(validation.outOfBoundsPiecesCount).toBe(0);
      expect(validation.overlappingPiecesCount).toBe(0);
    }
  );

  it('optimiza rotación 0° vs 90° automáticamente para maximizar piezas en recortes asimétricos', () => {
    const design = createReference20x10LabelDesign(false);
    design.widthMm = 30;
    design.heightMm = 12;

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 3,
      sheetWidthMm: 28,
      sheetHeightMm: 120,
      marginLeftMm: 2,
      marginRightMm: 2,
      marginTopMm: 2,
      marginBottomMm: 2,
      gapXMm: 2,
      gapYMm: 2,
      rotationMode: 'auto_optimize',
    });

    expect(nesting.orientationComparison.deg0Capacity).toBe(0);
    expect(nesting.orientationComparison.deg90Capacity).toBeGreaterThanOrEqual(3);
    expect(nesting.appliedRotationDeg).toBe(90);
    expect(nesting.totalExportedQuantity).toBe(3);
  });
});

describe('LaserHouse Studio — Validación Independiente LightBurn SVG y RDWorks DXF R12', () => {
  it('audita con lector independiente los archivos SVG y DXF de 200 etiquetas de 20x10 mm verificando escala 1:1, capas y cierre de vértices', () => {
    const design = createReference20x10LabelDesign(true);
    const material = INITIAL_MATERIALS_CATALOG.find((m) => m.id === 'ECOCUERO_SUELA')!;
    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 200,
    });

    const svgCombined = exportProductionSvg(design, nesting, material, {
      mode: 'combined',
      batchIndex: 0,
    });
    const dxfArtifact = exportProductionDxf(design, nesting, 0);

    // Auditoría independiente SVG (LightBurn)
    const svgAudit = parseAndAuditLightBurnSvg(svgCombined.svgContent);
    expect(svgAudit.isValid).toBe(true);
    expect(svgAudit.errors).toHaveLength(0);
    expect(svgAudit.viewBoxMatchesMm1To1).toBe(true);
    expect(svgAudit.widthMm).toBe(900);
    expect(svgAudit.heightMm).toBe(600);
    expect(svgAudit.cutLayerCount).toBe(200);
    expect(svgAudit.holesLayerCount).toBe(400);
    expect(svgAudit.engraveLayerCount).toBe(400);
    expect(svgAudit.allCutAndHolePathsClosed).toBe(true);
    expect(svgAudit.hasNonProductiveGuides).toBe(false);

    // Auditoría independiente DXF R12 (RDWorks)
    const dxfAudit = parseAndAuditDxfR12(dxfArtifact.dxfContent);
    expect(dxfAudit.isValid).toBe(true);
    expect(dxfAudit.errors).toHaveLength(0);
    expect(dxfAudit.acadVer).toBe('AC1009');
    expect(dxfAudit.insUnits).toBe(4);
    expect(dxfAudit.cutPolylinesCount).toBe(200);
    expect(dxfAudit.holePolylinesCount).toBe(400);
    expect(dxfAudit.allCutAndHolesClosedFlag).toBe(true);
    expect(dxfAudit.allCutAndHolesZeroGapLoop).toBe(true);
    // Verificar que las coordenadas crudas de la primera etiqueta en DXF miden exactamente 20 x 10 mm
    expect(dxfAudit.firstCutPieceSizeMm).toEqual({ width: 20, height: 10 });
  });

  it('detecta líneas de corte duplicadas si dos piezas se colocan con separación 0 mm', () => {
    const design = createReference20x10LabelDesign(false);
    design.shape = 'rectangle';
    design.cornerRadiusMm = 0;

    const c1 = compileLabelGeometry(design, { offsetXMm: 10, offsetYMm: 10 }).outerCutContour;
    const c2 = compileLabelGeometry(design, { offsetXMm: 30, offsetYMm: 10 }).outerCutContour;

    const dupCount = detectDuplicateCutSegments([c1, c2]);
    expect(dupCount).toBe(1);
  });
});

describe('LaserHouse Studio — Pruebas con Logos Reales, Huecos Internos y Protección de Corte/Agujeros', () => {
  it('vectoriza PNG con transparencia y PNG con fondo blanco conservando agujeros/huecos internos (ej. letra O / anillo)', () => {
    const w = 24;
    const h = 24;
    const rgbaWhiteBg = new Uint8ClampedArray(w * h * 4);
    const rgbaTranspBg = new Uint8ClampedArray(w * h * 4);

    // Dibujar un anillo negro (radio exterior 9, hueco interior blanco/transparente radio 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dist = Math.hypot(x - 12, y - 12);
        const isRing = dist <= 9 && dist >= 4;

        // En PNG con fondo blanco
        const valW = isRing ? 15 : 255;
        rgbaWhiteBg[idx] = valW;
        rgbaWhiteBg[idx + 1] = valW;
        rgbaWhiteBg[idx + 2] = valW;
        rgbaWhiteBg[idx + 3] = 255;

        // En PNG con fondo transparente
        rgbaTranspBg[idx] = 15;
        rgbaTranspBg[idx + 1] = 15;
        rgbaTranspBg[idx + 2] = 15;
        rgbaTranspBg[idx + 3] = isRing ? 255 : 0;
      }
    }

    const maskWhite = processRgbaBufferToBinaryMask(rgbaWhiteBg, w, h, DEFAULT_IMAGE_PROCESSING);
    const maskTransp = processRgbaBufferToBinaryMask(rgbaTranspBg, w, h, DEFAULT_IMAGE_PROCESSING);

    expect(maskTransp.hasTransparency).toBe(true);
    expect(maskWhite.darkPixelCount).toBe(maskTransp.darkPixelCount);

    // Al vectorizar un anillo deben obtenerse exactamente 2 contornos cerrados: el exterior y el hueco interno
    const pathsWhite = traceBinaryMaskToNormalizedPaths(maskWhite.binaryMask, w, h, 0.5);
    const pathsTransp = traceBinaryMaskToNormalizedPaths(maskTransp.binaryMask, w, h, 0.5);

    expect(pathsWhite.length).toBe(2);
    expect(pathsTransp.length).toBe(2);
    expect(pathsWhite.every((p) => p.endsWith('Z'))).toBe(true);
    expect(computeEffectiveDpi(300, 25.4)).toBeCloseTo(300, 1);
  });

  it('detecta cuando un logo invade un agujero o la línea de corte y lo corrige con fitElementIntoSafeZone', () => {
    const design = createBlankLabelDesign(20, 10, 'rounded_rect');
    design.holes = {
      preset: 'two_horizontal',
      diameterMm: 2.0,
      edgeDistanceMm: 2.5,
      customHoles: [],
    };
    // Hacer que el elemento de grabado sea demasiado ancho (19 mm en etiqueta de 20 mm), pisando ambos agujeros laterales
    design.elements[0].widthMm = 19;
    design.elements[0].heightMm = 8;
    if (design.elements[0].type === 'vector_text') {
      design.elements[0].fontSizeMm = 5;
    }

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 10,
    });

    const badValidation = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(badValidation.engraveInvasionCount).toBeGreaterThan(0);
    expect(badValidation.isValid).toBe(false);

    // Aplicar ajuste automático a zona segura
    const safeZone = computeSafeEngravingZone(design);
    expect(safeZone.minX).toBeGreaterThan(2.5);
    expect(safeZone.maxX).toBeLessThan(17.5);

    design.elements[0] = fitElementIntoSafeZone(design.elements[0], design, 0.8);
    const fixedValidation = validateLabelAndBatchGeometry(design, nesting, 0);
    expect(fixedValidation.engraveInvasionCount).toBe(0);
    expect(fixedValidation.isValid).toBe(true);
  });

  it('parsea SVG con elipses, líneas abiertas y arcos elípticos A/a sin generar NaN', () => {
    const complexSvg = `<svg viewBox="0 0 100 50">
      <path d="M 10 25 A 15 15 0 1 0 40 25 A 15 15 0 1 0 10 25 Z" />
      <ellipse cx="70" cy="25" rx="12" ry="8" />
      <line x1="5" y1="45" x2="95" y2="45" />
    </svg>`;
    const parsed = parseSvgLogoString(complexSvg);
    expect(parsed.normalizedPaths).toHaveLength(3);

    const design = createBlankLabelDesign(30, 15, 'rounded_rect');
    design.elements = [
      {
        id: 'el-complex-svg',
        name: 'SVG Complejo',
        type: 'logo_svg',
        xMm: 15,
        yMm: 7.5,
        widthMm: 20,
        heightMm: 10,
        aspectRatio: 2,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: complexSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
      },
    ];

    const nesting = computeNestingLayout(design, {
      ...DEFAULT_NESTING_CONFIG,
      requestedQuantity: 5,
    });
    const mat = INITIAL_MATERIALS_CATALOG[0];
    const svgOut = exportProductionSvg(design, nesting, mat);
    const audit = parseAndAuditLightBurnSvg(svgOut.svgContent);
    expect(audit.isValid).toBe(true);
    expect(audit.hasInvalidNumbersOrNaN).toBe(false);
  });

  it('conserva exactamente todas las dimensiones, agujeros y cantidades al guardar y abrir un proyecto (.lhstudio.json)', () => {
    const catalog = createInitialOrdersCatalog();
    const original = structuredClone(catalog[0]);
    original.labelDesign.widthMm = 24.65;
    original.labelDesign.heightMm = 13.4;
    original.labelDesign.kerfCompensationMm = 0.14;
    original.labelDesign.holes = {
      preset: 'custom',
      diameterMm: 1.8,
      edgeDistanceMm: 2.5,
      customHoles: [{ id: 'h1', x: 3.25, y: 6.7, diameterMm: 1.75 }],
    };
    original.nestingConfig.sheetWidthMm = 600;
    original.nestingConfig.sheetHeightMm = 400;
    original.nestingConfig.requestedQuantity = 350;

    const jsonStr = serializeOrderProjectToJson(original);
    const restored = deserializeOrderProjectFromJson(jsonStr);

    expect(restored.labelDesign.widthMm).toBe(24.65);
    expect(restored.labelDesign.heightMm).toBe(13.4);
    expect(restored.labelDesign.kerfCompensationMm).toBe(0.14);
    expect(restored.labelDesign.holes.preset).toBe('custom');
    expect(restored.labelDesign.holes.customHoles[0]).toEqual({
      id: 'h1',
      x: 3.25,
      y: 6.7,
      diameterMm: 1.75,
    });
    expect(restored.nestingConfig.sheetWidthMm).toBe(600);
    expect(restored.nestingConfig.sheetHeightMm).toBe(400);
    expect(restored.nestingConfig.requestedQuantity).toBe(350);

    const duplicated = duplicateOrderWithQuantity(restored, 500);
    expect(duplicated.nestingConfig.requestedQuantity).toBe(500);
    expect(duplicated.labelDesign.widthMm).toBe(roundMm(24.65));
  });
});
