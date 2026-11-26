import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeRotaryLayout,
  computeRotaryPhysicalSetup,
  DEFAULT_ROTARY_CONFIG,
  RotaryConfig,
  sanitizeRotaryConfig,
  correctedRotarySteps,
} from '../rotary/rotaryEngine';
import {
  DEFAULT_ROTARY_ACCESSORY_PROFILES,
  loadRotaryAccessoryProfiles,
  saveRotaryAccessoryProfile,
  deleteRotaryAccessoryProfile,
  sanitizeAccessoryProfile,
  recordProposedCalibration,
  confirmPhysicalVerification,
  revertCalibrationOnProfile,
  computeDetailedLinearCalibration,
  computeLinearCalibratedSteps,
  addRotaryCalibrationRecord,
  loadRotaryCalibrationHistory,
  clearRotaryCalibrationHistory,
  loadRotaryRecipes,
  saveRotaryRecipe,
  deleteRotaryRecipe,
  RotaryJobRecipe,
} from '../rotary/rotaryProfiles';
import {
  compileRotaryToRuidaRd,
  exportRotarySvg,
  exportRotaryDxf,
  exportRotaryTestPatternSvg,
  exportRotaryToLbrn2,
  buildRotaryInstructions,
} from '../exporters/rotaryExporter';
import { LabelDesign, LabelElement } from '../types';

function createMockDesign(elements: LabelElement[] = []): LabelDesign {
  return {
    id: 'test-rotary-label',
    name: 'Logo Botella',
    shape: 'rectangle',
    widthMm: 40,
    heightMm: 30,
    cornerRadiusMm: 0,
    safetyMarginMm: 2,
    kerfCompensationMm: 0,
    holes: { preset: 'none', diameterMm: 2, edgeDistanceMm: 2, customHoles: [] },
    elements,
  };
}

function createTextElement(id = 'text-1', visible = true): LabelElement {
  return {
    id,
    name: 'Texto Marca',
    type: 'vector_text',
    xMm: 20,
    yMm: 15,
    widthMm: 30,
    heightMm: 10,
    aspectRatio: 3,
    lockAspectRatio: true,
    rotationDeg: 0,
    locked: false,
    visible,
    text: 'ASTRA',
    fontSizeMm: 8,
    letterSpacingMm: 0.5,
    fontStyle: 'sans_industrial',
    strokeWidthMm: 0.3,
  };
}

describe('Módulo Rotativo — Auditoría y Correcciones Mandril Sanou (Vank 9060 / Ruida)', () => {
  beforeEach(() => {
    clearRotaryCalibrationHistory();
  });

  describe('1. Separación de los 3 estados de calibración y no validación prematura', () => {
    it('inicia en estado uncalibrated con pasos orientativos e ilustrativos', () => {
      const profiles = loadRotaryAccessoryProfiles();
      const sanou = profiles.find((p) => p.id === 'vank-sanou-chuck');

      expect(sanou).toBeDefined();
      expect(sanou?.calibrationStatus).toBe('uncalibrated');
      expect(sanou?.isCalibrated).toBe(false);
      expect(sanou?.stepsPerRotation).toBe(3200);
      expect(sanou?.notes).toContain('ilustrativo');
    });

    it('pasar a calculated_pending al calcular propuesta sin marcarlo como verificado físicamente', () => {
      const res = recordProposedCalibration('vank-sanou-chuck', 3245.2, 'angular_360', {
        expectedValue: 360,
        measuredValue: 355,
      });

      expect(res.success).toBe(true);
      expect(res.updatedProfile?.calibrationStatus).toBe('calculated_pending');
      expect(res.updatedProfile?.proposedStepsPerRotation).toBe(3245.2);
      expect(res.updatedProfile?.isCalibrated).toBe(false); // NO verificado aún
    });

    it('alcanza verified_physical sólo mediante confirmación explícita de prueba en máquina real', () => {
      // 1. Proponer
      recordProposedCalibration('vank-sanou-chuck', 3245.2, 'linear_caliper');

      // 2. Confirmación explícita con evidencia
      const confirmed = confirmPhysicalVerification('vank-sanou-chuck', {
        method: 'linear_caliper',
        expectedValue: 50,
        measuredValue: 46.38,
        effectiveRealArcMm: 50.0,
        linearMode: 'caliper_chord',
        operatorNotes: 'Prueba física grabada en probeta Ø75mm y verificada con calibre digital.',
      });

      expect(confirmed.success).toBe(true);
      expect(confirmed.updatedProfile?.calibrationStatus).toBe('verified_physical');
      expect(confirmed.updatedProfile?.isCalibrated).toBe(true);
      expect(confirmed.updatedProfile?.stepsPerRotation).toBe(3245.2);
      expect(confirmed.updatedProfile?.verificationEvidence).toBeDefined();
      expect(confirmed.updatedProfile?.verificationEvidence?.verifiedAtIso).toBeDefined();
      expect(confirmed.updatedProfile?.verificationEvidence?.operatorNotes).toContain('Ø75mm');
    });

    it('rechaza degradar perfiles a verified_physical si no contienen evidencia real', () => {
      const fakeCalibrated = sanitizeAccessoryProfile({
        id: 'fake-p',
        name: 'Perfil Falso',
        type: 'chuck',
        stepsPerRotation: 3200,
        calibrationStatus: 'verified_physical',
        // Sin verificationEvidence ni calibratedAtIso
      });
      // Debe ser degradado a uncalibrated
      expect(fakeCalibrated?.calibrationStatus).toBe('uncalibrated');
      expect(fakeCalibrated?.isCalibrated).toBe(false);
    });
  });

  describe('2. Asistente de calibración: Cuerda vs. Arco y restricciones geométricas', () => {
    it('modo Calibre Rígido (caliper_chord): compensa la cuerda circular en cilindros rectos', () => {
      // Cilindro D = 75 mm. Arco grabado exacto = 50.00 mm.
      // Cuerda medida con calibre: c = D * sin(s / D) = 75 * sin(50 / 75) = 46.3776 mm.
      const chordMeasured = 75 * Math.sin(50 / 75);

      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: chordMeasured,
        mode: 'caliper_chord',
        objectDiameterMm: 75,
        isTapered: false,
      });

      expect(res.valid).toBe(true);
      expect(res.effectiveRealArcMm).toBeCloseTo(50.0, 2);
      expect(res.ratio).toBeCloseTo(1.0, 3);
      expect(res.computedSteps).toBeCloseTo(3200, 1);
    });

    it('restringe calibre rígido en conos: rechaza caliper_chord en objetos cónicos', () => {
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 45,
        mode: 'caliper_chord',
        objectDiameterMm: 75,
        isTapered: true, // ¡Es un cono!
      });

      expect(res.valid).toBe(false);
      expect(res.error).toContain('no es unívoca en conos');
    });

    it('permite medición con cinta flexible (surface_arc) en objetos cónicos y cilíndricos', () => {
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 52,
        mode: 'surface_arc',
        objectDiameterMm: 75,
        isTapered: true,
      });

      expect(res.valid).toBe(true);
      expect(res.effectiveRealArcMm).toBe(52);
      expect(res.ratio).toBeCloseTo(50 / 52, 4);
      expect(res.computedSteps).toBeCloseTo((3200 * 50) / 52, 3);
    });

    it('emite advertencia cuando la cuerda supera el 85% del diámetro (ángulo > 115°)', () => {
      // D = 50 mm, c = 45 mm (45 / 50 = 0.90 > 0.85)
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 45,
        mode: 'caliper_chord',
        objectDiameterMm: 50,
      });

      expect(res.valid).toBe(true);
      expect(res.warning).toContain('supera el 85% del diámetro');
    });

    it('rechaza cuerdas físicamente imposibles (c >= D)', () => {
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 75,
        mode: 'caliper_chord',
        objectDiameterMm: 75,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('no puede ser igual o mayor al diámetro');
    });
  });

  describe('3. exportRotaryTestPatternSvg: cálculo previo de dimensión adaptada y validación posterior', () => {
    it('calcula primero una dimensión de patrón que entre en el objeto y la valida después', () => {
      // Objeto pequeño: largo 30 mm, diámetro 20 mm (~62.8 mm de circunferencia)
      // Se solicita un patrón nominal de 50 mm, que no cabe en 30 mm.
      const smallConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 20,
        usefulLengthMm: 30,
        arcDeg: 360,
      };

      // No debe lanzar error por pedir 50 mm: calcula sq primero (30 * 0.75 = 22.5 mm) y valida
      const pattern = exportRotaryTestPatternSvg(smallConfig, 50);
      expect(pattern.targetSquareMm).toBe(22.5);
      expect(pattern.svgContent).toContain('cuadrado_calibracion_22.5mm');
      expect(pattern.svgContent).toContain('COTA X (AXIAL): 22.50 mm');
      expect(pattern.widthMm).toBe(30);
    });

    it('rechaza generar el patrón SVG si la configuración es físicamente inválida', () => {
      const invalidD: RotaryConfig = { ...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 0 };
      expect(() => exportRotaryTestPatternSvg(invalidD, 50)).toThrow(/diámetro del objeto debe ser mayor a 0/i);

      const overflowL: RotaryConfig = { ...DEFAULT_ROTARY_CONFIG, usefulLengthMm: 950 };
      expect(() => exportRotaryTestPatternSvg(overflowL, 50)).toThrow(/supera el ancho de la máquina/i);

      const invalidSq: RotaryConfig = { ...DEFAULT_ROTARY_CONFIG };
      expect(() => exportRotaryTestPatternSvg(invalidSq, -10)).toThrow(/positivo/i);
    });
  });

  describe('4. Revisión de compensación cónica frente a LightBurn DSP oficial', () => {
    it('compara matemáticamente y documenta tanto Astra Studio Pre-warp como LightBurn DSP Taper Warp', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const coneConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        rotaryType: 'chuck',
        accessoryProfileId: 'vank-sanou-chuck',
        objectDiameterMm: 90,
        endDiameterMm: 65,
        usefulLengthMm: 120,
      };

      const instructions = buildRotaryInstructions(design, coneConfig);
      // Documenta método Astra Studio
      expect(instructions).toContain('MÉTODO ASTRA STUDIO (ARTE PRE-COMPENSADO EN SVG)');
      expect(instructions).toContain('EXACTAMENTE 77.5 mm (diámetro de referencia)');
      expect(instructions).toContain('ADVERTENCIA DE DOBLE COMPENSACIÓN');

      // Documenta método LightBurn DSP oficial
      expect(instructions).toContain('MÉTODO LIGHTBURN DSP ALTERNATIVO');
      expect(instructions).toContain('DIÁMETRO MAYOR del cono (Ø 90 mm)');
      expect(instructions).toContain('RotaryModeDSP');
    });
  });

  describe('5. Persistencia robusta, historial y deshacer (Undo)', () => {
    it('permite revertir la calibración recuperando el valor anterior', () => {
      // 1. Proponer y verificar
      recordProposedCalibration('vank-sanou-chuck', 3320, 'angular_360');
      confirmPhysicalVerification('vank-sanou-chuck', {
        method: 'angular_360',
        expectedValue: 360,
        measuredValue: 360,
      });

      // 2. Revertir
      const { revertedProfile } = revertCalibrationOnProfile('vank-sanou-chuck');
      expect(revertedProfile?.stepsPerRotation).toBe(3200);
      expect(revertedProfile?.calibrationStatus).toBe('uncalibrated');
      expect(revertedProfile?.isCalibrated).toBe(false);
    });

    it('sincroniza tipo chuck con el perfil vank-sanou-chuck al cargar proyectos antiguos', () => {
      const legacyRaw = {
        objectDiameterMm: 75,
        usefulLengthMm: 100,
        arcDeg: 360,
        rotaryType: 'chuck',
      };
      const sanitized = sanitizeRotaryConfig(legacyRaw);
      expect(sanitized?.rotaryType).toBe('chuck');
      expect(sanitized?.accessoryProfileId).toBe('vank-sanou-chuck');
      expect(sanitized?.rollerDiameterMm).toBeUndefined();
    });
  });

  describe('6. Calculadora física de nivelación de foco Z en conos y exportación directa a LightBurn (.lbrn2)', () => {
    it('calcula ángulo de inclinación de pared, suplemento de nivelación Z y exporta proyecto nativo .lbrn2 rotativo', () => {
      const design = createMockDesign([createTextElement('t-rot', true)]);
      const tumblerConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        rotaryType: 'chuck',
        accessoryProfileId: 'vank-sanou-chuck',
        stepsPerRotation: 3200,
        objectDiameterMm: 90,
        endDiameterMm: 65,
        usefulLengthMm: 120,
        repeatCount: 2,
      };

      const phys = computeRotaryPhysicalSetup(tumblerConfig, design, {
        mode: 'image',
        speedMmPerSec: 600,
        maxPowerPercent: 30,
        minPowerPercent: 30,
        lineIntervalMm: 0.073,
        passes: 1,
        airAssist: true,
        bidirectional: true,
        crossHatch: false,
        overscanPercent: 2.5,
      });

      // Nivelación geométrica de generatriz superior: L * sin(atan2((90-65)/2, 120)) = 12.43 mm; ángulo = 5.95°
      expect(phys.tailstockLiftMm).toBeCloseTo(12.43, 2);
      expect(phys.wallTiltAngleDeg).toBeCloseTo(5.95, 2);
      expect(phys.endToLift).toBe('end');
      expect(phys.estimatedDurationSec).toBeGreaterThan(0);
      expect(phys.stepResolutionUm).toBeGreaterThan(0);

      const lbrn2 = exportRotaryToLbrn2(design, tumblerConfig, {
        mode: 'image',
        speedMmPerSec: 600,
        maxPowerPercent: 30,
        minPowerPercent: 30,
        lineIntervalMm: 0.073,
        passes: 1,
        airAssist: true,
        bidirectional: true,
        crossHatch: false,
        overscanPercent: 2.5,
      });

      expect(lbrn2.filename).toContain('_LightBurn.lbrn2');
      expect(lbrn2.shapeCount).toBeGreaterThan(0);
      expect(lbrn2.lbrn2Content).toContain('<CutSetting type="Image">');
      expect(lbrn2.lbrn2Content).toContain('<speed Value="600"/>');
      expect(lbrn2.lbrn2Content).toContain('<maxPower Value="30"/>');
      expect(lbrn2.lbrn2Content).toContain('<interval Value="0.073"/>');
      expect(lbrn2.lbrn2Content).toContain('Object Diameter = Ø 77.5 mm');
    });
  });

  describe('7. Orientación del logo (0/90/180/270°), Recetas Rotativas y Compilador Binario .RD', () => {
    it('intercambia ancho axial y alto circunferencial cuando designRotationDeg = 90', () => {
      const design = createMockDesign([createTextElement('t-rot', true)]);
      const cfg90: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 80,
        usefulLengthMm: 150,
        designRotationDeg: 90,
      };
      const layout90 = computeRotaryLayout(cfg90, design);
      expect(layout90.appliedDesignRotationDeg).toBe(90);
      expect(layout90.effectiveDesignWidthMm).toBe(design.heightMm);
      expect(layout90.effectiveDesignHeightMm).toBe(design.widthMm);
    });

    it('guarda, lee y elimina recetas rotativas persistentes', () => {
      const recipe: RotaryJobRecipe = {
        id: 'recipe-termo-stanley',
        name: 'Termo 1L Negro',
        rotaryType: 'chuck',
        objectDiameterMm: 90,
        endDiameterMm: 65,
        usefulLengthMm: 140,
        repeatCount: 1,
        designRotationDeg: 90,
        chuckSide: 'left_base',
        layerMode: 'fill',
        speedMmPerSec: 350,
        maxPowerPercent: 28,
        minPowerPercent: 22,
        lineIntervalMm: 0.073,
        passes: 1,
        airAssist: true,
        bidirectional: true,
        updatedAtIso: '2026-11-26T12:00:00Z',
      };
      const saved = saveRotaryRecipe(recipe);
      expect(saved.some((r) => r.id === recipe.id)).toBe(true);
      expect(loadRotaryRecipes().length).toBeGreaterThanOrEqual(1);
      const afterDelete = deleteRotaryRecipe(recipe.id);
      expect(afterDelete.some((r) => r.id === recipe.id)).toBe(false);
    });

    it('bloquea compilación .RD sin velocidad/potencia real y compila binario Ruida D8 00..D7 al configurarlos', () => {
      const design = createMockDesign([createTextElement('t-rot', true)]);
      const cfg: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 80,
        usefulLengthMm: 120,
      };

      expect(() =>
        compileRotaryToRuidaRd(design, cfg, {
          mode: 'line',
          speedMmPerSec: null,
          maxPowerPercent: 30,
          minPowerPercent: 25,
          lineIntervalMm: 0.08,
          passes: 1,
          airAssist: true,
          bidirectional: true,
          crossHatch: false,
          overscanPercent: 2.5,
        })
      ).toThrow(/Velocidad/i);

      const compiled = compileRotaryToRuidaRd(design, cfg, {
        mode: 'line',
        speedMmPerSec: 300,
        maxPowerPercent: 28,
        minPowerPercent: 22,
        lineIntervalMm: 0.08,
        passes: 1,
        airAssist: true,
        bidirectional: true,
        crossHatch: false,
        overscanPercent: 2.5,
      });

      expect(compiled.filenameSuggested.endsWith('_Rotativo_Vank9060.rd')).toBe(
        true
      );
      expect(compiled.rdBytes.length).toBeGreaterThan(20);
      expect(compiled.commandCount).toBeGreaterThan(0);
    });
  });
});
