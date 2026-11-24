import { describe, expect, it } from 'vitest';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { computeNestingLayout } from '../nesting/nestingEngine';
import { createInitialOrdersCatalog } from '../projects/projectManager';
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../workbench/lbrn2Exporter';
import {
  buildRuidaUdpPackets,
  compileWorkbenchToRuidaRd,
  decodeRuidaAbsCoordMm,
  decodeRuidaPowerPercent,
  encodeRuidaAbsCoordMm,
  encodeRuidaPowerPercent,
  scrambleRuidaByte,
  unscrambleRuidaByte,
} from '../workbench/ruidaCompiler';
import {
  analyzeStepMaterialSavings,
  applyExtremeMaterialSavingToWorkbench,
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  buildOptimalSavingNestingConfig,
  computeEcocueroRollMetrics,
  computeJobOriginPointMm,
  createWorkbenchJobFromOrder,
  createWorkbenchJobFromUploadedLogo,
  evaluateBalancedLayoutPresets,
  fillLastRowFreeSlotsInWorkbench,
  simulateWorkbenchToolpath,
  updateWorkbenchJobDesignAndQuantity,
  updateWorkbenchJobGrid,
  validateWorkbenchState,
} from '../workbench/workbenchEngine';
import {
  createDefaultWorkbenchConfig,
  ECOCUERO_BED_PASS_HEIGHT_MM,
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
} from '../workbench/workbenchTypes';

describe('Módulo Mesa de Trabajo y Plancha Vank 9060 (Estilo LightBurn / Ruida RDC8445S)', () => {
  const sampleOrder = createInitialOrdersCatalog()[0];
  const material = INITIAL_MATERIALS_CATALOG[0];
  const nesting = computeNestingLayout(
    sampleOrder.labelDesign,
    sampleOrder.nestingConfig
  );

  it('1. Crea trabajos en plancha desde tanda completa o pieza suelta y evita colisiones iniciales', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job1 = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      batchIndex: 0,
      mode: 'single_piece',
      projectName: 'Etiqueta Suelta',
      clientName: 'Cliente A',
      orderId: sampleOrder.id,
      existingJobs: [],
      config,
    });

    expect(job1.pieceCount).toBe(1);
    expect(job1.widthMm).toBeCloseTo(20, 1);
    expect(job1.heightMm).toBeCloseTo(10, 1);
    expect(job1.xMm).toBe(config.sheetSafetyMarginMm);
    expect(job1.yMm).toBe(config.sheetSafetyMarginMm);

    const job2 = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      batchIndex: 0,
      mode: 'single_piece',
      projectName: 'Segunda Etiqueta',
      clientName: 'Cliente B',
      orderId: sampleOrder.id,
      existingJobs: [job1],
      config,
    });

    expect(job2.xMm).toBeGreaterThan(job1.xMm + job1.widthMm);
  });

  it('2. Acomoda automáticamente múltiples pedidos en una misma plancha (Auto-Arrange) sin superposición', () => {
    const config = createDefaultWorkbenchConfig(300, 200, material);
    const baseJob = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'custom_grid',
      customColumns: 4,
      customRows: 2,
      projectName: 'Lote A',
      clientName: 'Cliente 1',
      orderId: 'ord-1',
      existingJobs: [],
      config,
    });

    // Forzar superposición colocando 3 bloques en (0,0)
    const overlappingJobs = [
      { ...baseJob, id: 'j1', xMm: 10, yMm: 10 },
      { ...baseJob, id: 'j2', xMm: 10, yMm: 10 },
      { ...baseJob, id: 'j3', xMm: 10, yMm: 10 },
    ];

    const beforeValidation = validateWorkbenchState(overlappingJobs, config);
    expect(beforeValidation.overlappingJobsCount).toBeGreaterThan(0);
    expect(beforeValidation.isValidForExport).toBe(false);

    const arranged = autoArrangeWorkbenchJobs(overlappingJobs, config, 4);
    const afterValidation = validateWorkbenchState(arranged, config);
    expect(afterValidation.overlappingJobsCount).toBe(0);
    expect(afterValidation.outOfSheetJobsCount).toBe(0);
    expect(afterValidation.isValidForExport).toBe(true);
  });

  it('3. Actualiza grilla de columnas, filas y rotación de 90° de un trabajo en plancha', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Prueba Grid',
      clientName: 'Cliente',
      orderId: 'ord-grid',
      existingJobs: [],
      config,
    });

    const expanded = updateWorkbenchJobGrid(job, {
      columns: 5,
      rows: 3,
      pieceCount: 15,
    });
    expect(expanded.pieceCount).toBe(15);
    expect(expanded.columns).toBe(5);
    expect(expanded.rows).toBe(3);

    const rotated = updateWorkbenchJobGrid(expanded, {
      blockRotationDeg: 90,
    });
    expect(rotated.blockRotationDeg).toBe(90);
    expect(rotated.instances[0].rotated90).toBe(true);
  });

  it('4. Calcula exactamente los 9 puntos de Origen del Trabajo (Job Origin) estilo LightBurn', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const bounds = {
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 80,
      width: 100,
      height: 60,
    };

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'top_left' })
    ).toEqual({ x: 10, y: 20 });

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'center' })
    ).toEqual({ x: 60, y: 50 });

    expect(
      computeJobOriginPointMm(bounds, { ...config, jobOriginAnchor: 'bottom_right' })
    ).toEqual({ x: 110, y: 80 });

    expect(
      computeJobOriginPointMm(bounds, {
        ...config,
        startFromMode: 'absolute_coords',
        jobOriginAnchor: 'center',
      })
    ).toEqual({ x: 0, y: 0 });
  });

  it('5. Bloquea envío directo a Ruida si las capas tienen velocidad/potencia sin configurar (null)', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Seguridad Ruida',
      clientName: 'Cliente',
      orderId: 'ord-sec',
      existingJobs: [],
      config,
    });

    // Por defecto el catálogo no inventa potencias ni velocidades (son null)
    const valUnconfigured = validateWorkbenchState([job], config);
    expect(valUnconfigured.isValidForExport).toBe(true);
    expect(valUnconfigured.isValidForMachineSend).toBe(false);
    expect(valUnconfigured.unconfiguredLayersCount).toBeGreaterThan(0);

    expect(() => compileWorkbenchToRuidaRd([job], config)).toThrow(
      /bloqueada por seguridad/i
    );

    // Configurar parámetros validados por el operador en las capas activas
    const configuredConfig = {
      ...config,
      layers: config.layers.map((l) =>
        l.role === 'ENGRAVE'
          ? { ...l, speedMmPerSec: 220, maxPowerPercent: 18, minPowerPercent: 12 }
          : l.role === 'HOLES'
            ? { ...l, speedMmPerSec: 18, maxPowerPercent: 55, minPowerPercent: 45 }
            : { ...l, speedMmPerSec: 22, maxPowerPercent: 60, minPowerPercent: 50 }
      ),
    };

    const valConfigured = validateWorkbenchState([job], configuredConfig);
    expect(valConfigured.isValidForMachineSend).toBe(true);
    expect(valConfigured.unconfiguredLayersCount).toBe(0);

    // Verificar persistencia hacia el perfil del material
    const updatedMat = applyWorkbenchLayersToMaterialProfile(
      configuredConfig.layers,
      material
    );
    expect(updatedMat.engraveParams.speedMmPerSec).toBe(220);
    expect(updatedMat.cutParams.maxPowerPercent).toBe(60);
    expect(updatedMat.cutParams.operatorValidated).toBe(true);
  });

  it('6. Advierte si la capa de Corte Exterior (C02) tiene prioridad anterior al Grabado (C00)', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Orden Capas',
      clientName: 'Cliente',
      orderId: 'ord-prio',
      existingJobs: [],
      config,
    });

    const invertedPriorityConfig = {
      ...config,
      layers: config.layers.map((l) =>
        l.role === 'CUT'
          ? { ...l, priority: 0, speedMmPerSec: 20, maxPowerPercent: 50 }
          : l.role === 'ENGRAVE'
            ? { ...l, priority: 2, speedMmPerSec: 200, maxPowerPercent: 20 }
            : { ...l, priority: 1, speedMmPerSec: 20, maxPowerPercent: 50 }
      ),
    };

    const report = validateWorkbenchState([job], invertedPriorityConfig);
    expect(
      report.issues.some((i) => i.code === 'UNSAFE_LAYER_ORDER_CUT_BEFORE_ENGRAVE')
    ).toBe(true);
  });

  it('7. Simula trayectoria del cabezal láser y exporta proyecto nativo LightBurn (.lbrn2) y SVG de plancha', () => {
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const configuredConfig = {
      ...config,
      layers: config.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 200 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 20 : 55,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 45,
      })),
    };

    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'custom_grid',
      customColumns: 2,
      customRows: 2,
      projectName: 'Pedido LightBurn',
      clientName: 'Cliente LB',
      orderId: 'ord-lb',
      existingJobs: [],
      config: configuredConfig,
    });

    const sim = simulateWorkbenchToolpath([job], configuredConfig);
    expect(sim.segments.length).toBeGreaterThan(4);
    expect(sim.totalDurationSec).toBeGreaterThan(0);
    expect(sim.totalDistanceMm).toBeGreaterThan(0);

    const lbrn2 = exportWorkbenchToLbrn2([job], configuredConfig, 'Mesa_Prueba');
    expect(lbrn2.filenameSuggested).toBe('Mesa_Prueba_LightBurn.lbrn2');
    expect(lbrn2.pieceCount).toBe(4);
    expect(lbrn2.lbrn2Content).toContain('<LightBurnProject');
    expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Scan">');
    expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Cut">');
    expect(lbrn2.lbrn2Content).toContain('<Shape Type="Path"');

    const svg = exportWorkbenchToSvg([job], configuredConfig, 'Mesa_Prueba');
    expect(svg.pieceCount).toBe(4);
    expect(svg.svgContent).toContain('width="600mm" height="400mm"');
    expect(svg.svgContent).toContain('id="CAPA_00_GRABADO"');
    expect(svg.svgContent).toContain('id="CAPA_02_CORTE"');
  });

  it('8. Codifica coordenadas, potencias, scrambling 0x88 y compila archivo binario Ruida (.RD) + paquetes UDP', () => {
    // 1. Coordenadas en micrómetros (35 bits)
    for (const mm of [0, 10.5, 40, 250.125, 900, 600]) {
      const encoded = encodeRuidaAbsCoordMm(mm);
      expect(encoded).toHaveLength(5);
      expect(encoded.every((b) => (b & 0x80) === 0)).toBe(true);
      expect(decodeRuidaAbsCoordMm(encoded)).toBeCloseTo(mm, 3);
    }

    // 2. Potencia láser (14 bits: 0..100%)
    for (const pct of [0, 15, 25.5, 50, 85, 100]) {
      const encP = encodeRuidaPowerPercent(pct);
      expect(encP).toHaveLength(2);
      expect(decodeRuidaPowerPercent(encP)).toBeCloseTo(pct, 1);
    }

    // 3. Biyección perfecta de scrambling Ruida (0x00..0xFF)
    for (let b = 0; b <= 255; b++) {
      const s = scrambleRuidaByte(b);
      expect(unscrambleRuidaByte(s)).toBe(b);
    }

    // 4. Compilación completa de archivo .RD y empaquetado UDP con checksum 16-bit
    const config = createDefaultWorkbenchConfig(600, 400, material);
    const configuredConfig = {
      ...config,
      ruidaJobName: 'VANK01',
      layers: config.layers.map((l) => ({
        ...l,
        speedMmPerSec: l.role === 'ENGRAVE' ? 200 : 25,
        maxPowerPercent: l.role === 'ENGRAVE' ? 20 : 60,
        minPowerPercent: l.role === 'ENGRAVE' ? 15 : 50,
      })),
    };

    const job = createWorkbenchJobFromOrder({
      design: sampleOrder.labelDesign,
      nesting,
      mode: 'single_piece',
      projectName: 'Prueba RD',
      clientName: 'Cliente RD',
      orderId: 'ord-rd',
      existingJobs: [],
      config: configuredConfig,
    });

    const rdArtifact = compileWorkbenchToRuidaRd([job], configuredConfig);
    expect(rdArtifact.ruidaJobName).toBe('VANK01');
    expect(rdArtifact.filenameSuggested).toBe('VANK01_Vank9060.rd');
    expect(rdArtifact.rdBytes.length).toBeGreaterThan(40);
    // Verificar inicio D8 00 y fin D7 en bytes sin ofuscar
    expect(rdArtifact.rawUnscrambledBytes[0]).toBe(0xd8);
    expect(rdArtifact.rawUnscrambledBytes[1]).toBe(0x00);
    expect(
      rdArtifact.rawUnscrambledBytes[rdArtifact.rawUnscrambledBytes.length - 1]
    ).toBe(0xd7);

    const packets = buildRuidaUdpPackets(rdArtifact.rdBytes, 500);
    expect(packets.length).toBeGreaterThanOrEqual(1);
    for (const pkt of packets) {
      const expectedChecksum =
        pkt.slice(2).reduce((acc, b) => (acc + b) & 0xffff, 0) & 0xffff;
      const headerChecksum = (pkt[0] << 8) | pkt[1];
      expect(headerChecksum).toBe(expectedChecksum);
    }
  });

  it('9. Toma automáticamente 73 cm de ancho (730 mm) y 5 m de rollo (5000 mm) cuando el material es Ecocuero', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG.find(
      (m) => m.id === 'ECOCUERO_SUELA'
    )!;
    const ecoConfig = createDefaultWorkbenchConfig(
      undefined,
      undefined,
      ecocueroMat
    );

    expect(ecoConfig.sheetWidthMm).toBe(ECOCUERO_ROLL_WIDTH_MM); // 730 mm (73 cm)
    expect(ecoConfig.sheetHeightMm).toBe(ECOCUERO_BED_PASS_HEIGHT_MM); // 600 mm (60 cm por tirada)
    expect(ecoConfig.isRollMaterial).toBe(true);
    expect(ecoConfig.rollTotalLengthMm).toBe(ECOCUERO_ROLL_TOTAL_LENGTH_MM); // 5000 mm (5 m)
  });

  it('10. Permite subir y combinar varios trabajos con distintos logos, medidas y cantidades en la misma tirada de 73 cm', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const config = createDefaultWorkbenchConfig(undefined, undefined, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    // Logo 1: 100 etiquetas de 40x20 mm (4x2 cm)
    const job1 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Alfa',
      element: sampleElement,
      widthMm: 40,
      heightMm: 20,
      quantity: 100,
      existingJobs: [],
      config,
    });

    // En 730 mm con 5 mm de margen a cada lado (720 mm útiles) y gap 2 mm:
    // floor((720 + 2) / (40 + 2)) = 17 columnas por fila -> 100 etiquetas ocupan 6 filas
    expect(job1.columns).toBe(17);
    expect(job1.rows).toBe(6);
    expect(job1.pieceCount).toBe(100);

    // Logo 2: 150 etiquetas de 30x15 mm
    const job2 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Beta',
      element: sampleElement,
      widthMm: 30,
      heightMm: 15,
      quantity: 150,
      existingJobs: [job1],
      config,
    });
    // floor((720 + 2) / (30 + 2)) = 22 columnas por fila -> 150 etiquetas ocupan 7 filas
    expect(job2.columns).toBe(22);
    expect(job2.rows).toBe(7);
    expect(job2.pieceCount).toBe(150);

    // Logo 3: Cambiar medida y cantidad dinámicamente a 80 etiquetas de 50x25 mm con 2 agujeros
    const job3Raw = createWorkbenchJobFromUploadedLogo({
      logoName: 'Marca_Gamma',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 20,
      existingJobs: [job1, job2],
      config,
    });
    const job3 = updateWorkbenchJobDesignAndQuantity(
      job3Raw,
      {
        widthMm: 50,
        heightMm: 25,
        holePreset: 'two_horizontal',
        pieceCount: 80,
        autoFitColumnsToRoll: true,
      },
      config
    );
    expect(job3.pieceCount).toBe(80);
    expect(job3.labelDesign.widthMm).toBe(50);
    expect(job3.labelDesign.heightMm).toBe(25);
    expect(job3.labelDesign.holes.preset).toBe('two_horizontal');

    const arranged = autoArrangeWorkbenchJobs([job1, job2, job3], config, 4, true);
    const validation = validateWorkbenchState(arranged, config);

    expect(validation.isValidForExport).toBe(true);
    expect(validation.totalJobs).toBe(3);
    expect(validation.totalPieces).toBe(330); // 100 + 150 + 80 en la misma tirada
    expect(validation.overlappingJobsCount).toBe(0);
    expect(validation.outOfSheetJobsCount).toBe(0);

    // Verificar métricas de consumo del rollo de 73 cm x 5 m (500 cm)
    const metrics = computeEcocueroRollMetrics(arranged, config);
    expect(metrics.rollWidthCm).toBe(73);
    expect(metrics.totalRollLengthCm).toBe(500);
    expect(metrics.usedLengthCm).toBeGreaterThan(35);
    expect(metrics.usedLengthCm).toBeLessThan(55); // Entra sobrado en los 60 cm de una tirada en mesa Vank 9060
    expect(metrics.remainingRollLengthCm).toBeCloseTo(
      500 - metrics.usedLengthCm,
      1
    );
    expect(metrics.exceedsSingleBedPass).toBe(false);
  });

  it('11. Ahorro Extremo Cero Desperdicio: intercala trabajos en flujo continuo sin huecos entre logos y completa la última fila sin gastar ni 1 mm más de rollo', () => {
    const ecocueroMat = INITIAL_MATERIALS_CATALOG[0];
    const baseCfg = createDefaultWorkbenchConfig(undefined, undefined, ecocueroMat);
    const sampleElement = sampleOrder.labelDesign.elements[0];

    // 3 pedidos de 50 etiquetas de 20x10 mm cada uno (150 etiquetas en total)
    const j1 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_1',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [],
      config: baseCfg,
    });
    const j2 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_2',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [j1],
      config: baseCfg,
    });
    const j3 = createWorkbenchJobFromUploadedLogo({
      logoName: 'Logo_Cliente_3',
      element: sampleElement,
      widthMm: 20,
      heightMm: 10,
      quantity: 50,
      existingJobs: [j1, j2],
      config: baseCfg,
    });

    // Aplicar Ahorro Extremo (Margen 2mm, Gap 0.5mm, Flujo continuo pieza a pieza)
    const { config: extremeCfg, jobs: extremeJobs } =
      applyExtremeMaterialSavingToWorkbench([j1, j2, j3], baseCfg);

    // Verificar que el Trabajo #2 continúa en la misma fila donde terminó el Trabajo #1 (firstRowIndentMm > 0)
    expect(extremeJobs[1].firstRowIndentMm).toBeGreaterThan(0);
    expect(extremeJobs[1].yMm).toBeGreaterThanOrEqual(extremeJobs[0].yMm);
    expect(extremeJobs[1].yMm).toBeLessThan(
      extremeJobs[0].yMm + extremeJobs[0].heightMm
    );
    expect(extremeJobs[2].firstRowIndentMm).toBeGreaterThan(0);
    expect(extremeJobs[2].yMm).toBeGreaterThan(extremeJobs[0].yMm);

    const val = validateWorkbenchState(extremeJobs, extremeCfg);
    expect(val.isValidForExport).toBe(true);
    expect(val.overlappingJobsCount).toBe(0); // 0 colisiones reales entre las 150 piezas

    const metricsBeforeFill = computeEcocueroRollMetrics(extremeJobs, extremeCfg);
    expect(metricsBeforeFill.freeSlotsInLastRow).toBeGreaterThan(0);
    const rollUsedBeforeFillMm = metricsBeforeFill.usedLengthMm;

    // Completar el hueco libre de la última fila con etiquetas gratis de rollo
    const { jobs: filledJobs, addedPieces } = fillLastRowFreeSlotsInWorkbench(
      extremeJobs,
      extremeCfg
    );
    expect(addedPieces).toBe(metricsBeforeFill.freeSlotsInLastRow);

    const metricsAfterFill = computeEcocueroRollMetrics(filledJobs, extremeCfg);
    // El avance de rollo consumido es EXACTAMENTE EL MISMO (0.0 mm extra de rollo)
    expect(metricsAfterFill.usedLengthMm).toBeCloseTo(rollUsedBeforeFillMm, 1);
    expect(metricsAfterFill.freeSlotsInLastRow).toBe(0);

    // Verificar también el optimizador de ahorro de Paso 5 / Paso 6 antes de exportar
    const stepOptCfg = buildOptimalSavingNestingConfig(
      sampleOrder.labelDesign,
      sampleOrder.nestingConfig,
      false
    );
    const stepOptNesting = computeNestingLayout(
      sampleOrder.labelDesign,
      stepOptCfg
    );
    const stepAnalysis = analyzeStepMaterialSavings(
      sampleOrder.labelDesign,
      stepOptNesting,
      0
    );
    expect(stepAnalysis.isAlreadyOptimal).toBe(true);
  });

  it('12. Caso Real Captura 100 u. (20x10 mm): evita dejar 32 lugares vacíos en la 3ra fila (44x3) formando un rectángulo 100% lleno (0 lugares vacíos) dentro de los 73 cm', () => {
    const design = sampleOrder.labelDesign; // 20 x 10 mm
    const optCfg = buildOptimalSavingNestingConfig(
      design,
      {
        ...sampleOrder.nestingConfig,
        requestedQuantity: 100,
        sheetWidthMm: 730,
        sheetHeightMm: 600,
      },
      false,
      'zero_waste'
    );

    const res = computeNestingLayout(design, optCfg);
    const batch = res.batches[0];

    expect(batch.count).toBe(100);
    // 0 lugares vacíos en la última fila: columnsUsed * rowsUsed === 100 exactos
    expect(batch.columnsUsed * batch.rowsUsed).toBe(100);
    // Entra dentro del rollo de 73 cm (730 mm)
    expect(batch.occupiedBounds.maxX).toBeLessThanOrEqual(730);
    // El área del bloque es mucho menor que los 26706 mm2 del armado desbalanceado 44x3
    const blockAreaMm2 =
      batch.occupiedBounds.width * batch.occupiedBounds.height;
    expect(blockAreaMm2).toBeLessThan(21500);
  });

  it('13. Evalúa las 3 opciones de Equilibrio (Espacio en Plancha + Velocidad de Máquina): Equilibrio 25x4 (0 vacíos), Velocidad 34x3 (3 filas) y Compacto 20x5 (0 vacíos)', () => {
    const design = sampleOrder.labelDesign; // 20 x 10 mm
    const presets = evaluateBalancedLayoutPresets(design, {
      ...sampleOrder.nestingConfig,
      requestedQuantity: 100,
      sheetWidthMm: 730,
      sheetHeightMm: 600,
    });

    expect(presets).toHaveLength(3);
    const eq = presets.find((p) => p.id === 'equilibrium')!;
    const spd = presets.find((p) => p.id === 'max_speed')!;
    const cmp = presets.find((p) => p.id === 'compact_block')!;

    // Equilibrio Ideal: 25 col x 4 filas (0 lugares vacíos, 100% lleno)
    expect(eq.cols).toBe(25);
    expect(eq.rows).toBe(4);
    expect(eq.emptySlots).toBe(0);
    expect(eq.blockFillPercent).toBe(100);

    // Velocidad Máxima: 34 col x 3 filas (solo 3 filas verticales = menor tiempo de máquina)
    expect(spd.cols).toBe(34);
    expect(spd.rows).toBe(3);
    expect(spd.estimatedMachineTimeSec).toBeLessThan(eq.estimatedMachineTimeSec);

    // Bloque Compacto: 20 col x 5 filas (0 lugares vacíos, mayor sobrante libre al costado)
    expect(cmp.cols).toBe(20);
    expect(cmp.rows).toBe(5);
    expect(cmp.emptySlots).toBe(0);
    expect(cmp.freeSideWidthCm).toBeGreaterThan(eq.freeSideWidthCm);
  });
});
