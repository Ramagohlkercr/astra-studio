import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeRotaryLayout,
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
  applyCalibrationToProfile,
  revertCalibrationOnProfile,
  computeDetailedLinearCalibration,
  computeLinearCalibratedSteps,
  addRotaryCalibrationRecord,
  loadRotaryCalibrationHistory,
  clearRotaryCalibrationHistory,
} from '../rotary/rotaryProfiles';
import {
  exportRotarySvg,
  exportRotaryDxf,
  exportRotaryTestPatternSvg,
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

  describe('1. Perfiles de accesorios y valores no verificados (Mandril Sanou)', () => {
    it('incluye perfil específico para el mandril Sanou y marca pasos como no verificados (ilustrativos)', () => {
      const profiles = loadRotaryAccessoryProfiles();
      const sanouChuck = profiles.find((p) => p.id === 'vank-sanou-chuck');

      expect(sanouChuck).toBeDefined();
      expect(sanouChuck?.type).toBe('chuck');
      expect(sanouChuck?.rollerDiameterMm).toBeUndefined();
      // 3200 pasos son un valor ilustrativo, no una calibración de hardware comprobada
      expect(sanouChuck?.stepsPerRotation).toBe(3200);
      expect(sanouChuck?.isCalibrated).toBe(false);
      expect(sanouChuck?.notes).toContain('ilustrativo');

      const roller = profiles.find((p) => p.id === 'vank-roller-standard');
      expect(roller?.isCalibrated).toBe(false);
    });

    it('sanitiza perfiles correctamente preservando estado de calibración y deshacer', () => {
      expect(sanitizeAccessoryProfile(null)).toBeNull();
      expect(sanitizeAccessoryProfile({})).toBeNull();
      expect(sanitizeAccessoryProfile({ id: '1', name: '' })).toBeNull();
      expect(sanitizeAccessoryProfile({ id: '1', name: 'Test', stepsPerRotation: -5 })).toBeNull();

      const validChuck = sanitizeAccessoryProfile({
        id: 'c1',
        name: 'Mandril Sanou K11',
        type: 'chuck',
        stepsPerRotation: 3245.2,
        rotationDirection: 'inverted',
        isCalibrated: true,
        previousStepsPerRotation: 3200,
      });
      expect(validChuck).toMatchObject({
        id: 'c1',
        name: 'Mandril Sanou K11',
        type: 'chuck',
        stepsPerRotation: 3245.2,
        rotationDirection: 'inverted',
        isCalibrated: true,
        previousStepsPerRotation: 3200,
      });
    });

    it('permite registrar, persistir y eliminar perfiles personalizados', () => {
      const custom = {
        id: 'custom-sanou-k11-80',
        name: 'Mandril Sanou K11 80mm',
        type: 'chuck' as const,
        stepsPerRotation: 3200,
        rotationDirection: 'normal' as const,
        isCalibrated: false,
      };
      const updated = saveRotaryAccessoryProfile(custom);
      expect(updated.some((p) => p.id === 'custom-sanou-k11-80')).toBe(true);

      const deleted = deleteRotaryAccessoryProfile('custom-sanou-k11-80');
      expect(deleted.some((p) => p.id === 'custom-sanou-k11-80')).toBe(false);
    });
  });

  describe('2. Asistente de calibración: Distinción entre Arco Superficial y Cuerda con Calibre', () => {
    it('calcula pasos corregidos con método angular 360°', () => {
      // Si con 3200 pasos dio 350° (quedó corto), necesita más pasos
      const steps = correctedRotarySteps(3200, 350);
      expect(steps).toBeCloseTo(3291.429, 2);

      // Si con 3200 pasos dio 370° (se pasó), necesita menos pasos
      const stepsOver = correctedRotarySteps(3200, 370);
      expect(stepsOver).toBeCloseTo(3113.514, 2);

      expect(correctedRotarySteps(3200, 0)).toBeNull();
      expect(correctedRotarySteps(0, 360)).toBeNull();
    });

    it('modo Cinta Flexible (surface_arc): mide longitud real directamente sobre la curva', () => {
      // Cota esperada: 50 mm. Medido sobre superficie con cinta: 52 mm (grabó más grande -> sobran pasos)
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 52,
        mode: 'surface_arc',
      });
      expect(res.valid).toBe(true);
      expect(res.effectiveRealArcMm).toBe(52);
      expect(res.ratio).toBeCloseTo(50 / 52, 4);
      expect(res.computedSteps).toBeCloseTo((3200 * 50) / 52, 3);
    });

    it('modo Calibre Rígido (caliper_chord): compensa la cuerda circular y evita ajuste erróneo de pasos', () => {
      // Cilindro D = 75 mm. Arco grabado exacto = 50.00 mm.
      // Cuerda medida con calibre: c = D * sin(s / D) = 75 * sin(50 / 75) = 46.3776 mm.
      const chordMeasured = 75 * Math.sin(50 / 75); // ~ 46.3776 mm

      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: chordMeasured,
        mode: 'caliper_chord',
        objectDiameterMm: 75,
      });

      expect(res.valid).toBe(true);
      // El arco calculado a partir de la cuerda debe ser exactamente 50 mm
      expect(res.effectiveRealArcMm).toBeCloseTo(50.0, 2);
      // La relación de corrección debe ser 1.0 (no alterar pasos porque la máquina grabó exacto)
      expect(res.ratio).toBeCloseTo(1.0, 3);
      expect(res.computedSteps).toBeCloseTo(3200, 1);

      // Comparación: si se usara el cálculo ingenuo (50 / 46.38), se provocaría un error de casi el 8%
      const naiveSteps = (3200 * 50) / chordMeasured;
      expect(naiveSteps).toBeGreaterThan(3440); // Más de 240 pasos de error destructivo evitado!
    });

    it('rechaza mediciones de calibre físicamente imposibles (cuerda >= diámetro)', () => {
      const res = computeDetailedLinearCalibration({
        currentSteps: 3200,
        expectedArcMm: 50,
        measuredValueMm: 76, // Cuerda 76 mm en diámetro 75 mm es imposible
        mode: 'caliper_chord',
        objectDiameterMm: 75,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('no puede ser igual o mayor al diámetro');
    });

    it('wrapper computeLinearCalibratedSteps mantiene retrocompatibilidad y soporta ambos modos', () => {
      const surfaceSteps = computeLinearCalibratedSteps(3200, 50, 52, 'surface_arc');
      expect(surfaceSteps).toBeCloseTo((3200 * 50) / 52, 3);

      const chord = 75 * Math.sin(50 / 75);
      const chordSteps = computeLinearCalibratedSteps(3200, 50, chord, 'caliper_chord', 75);
      expect(chordSteps).toBeCloseTo(3200, 1);
    });
  });

  describe('3. Persistencia de calibración y recuperación del valor anterior (Undo)', () => {
    it('actualiza el perfil en almacenamiento con isCalibrated: true y registra previousStepsPerRotation', () => {
      const { updatedProfiles, updatedProfile } = applyCalibrationToProfile(
        'vank-sanou-chuck',
        3248.5,
        'linear_caliper'
      );
      expect(updatedProfile).toBeDefined();
      expect(updatedProfile?.stepsPerRotation).toBe(3248.5);
      expect(updatedProfile?.previousStepsPerRotation).toBe(3200);
      expect(updatedProfile?.isCalibrated).toBe(true);
      expect(updatedProfile?.calibratedAtIso).toBeDefined();

      const inStorage = loadRotaryAccessoryProfiles().find((p) => p.id === 'vank-sanou-chuck');
      expect(inStorage?.stepsPerRotation).toBe(3248.5);
      expect(inStorage?.previousStepsPerRotation).toBe(3200);
    });

    it('permite revertir la calibración y recuperar el valor anterior de pasos', () => {
      // Aplicar primero una calibración
      applyCalibrationToProfile('vank-sanou-chuck', 3300, 'angular_360');

      // Revertir
      const { revertedProfile } = revertCalibrationOnProfile('vank-sanou-chuck');
      expect(revertedProfile).toBeDefined();
      expect(revertedProfile?.stepsPerRotation).toBe(3248.5); // o 3200 según estado anterior
      expect(revertedProfile?.previousStepsPerRotation).toBeUndefined();

      const inStorage = loadRotaryAccessoryProfiles().find((p) => p.id === 'vank-sanou-chuck');
      expect(inStorage?.previousStepsPerRotation).toBeUndefined();
    });

    it('registra en historial metadatos detallados de la calibración', () => {
      const record = addRotaryCalibrationRecord({
        accessoryId: 'vank-sanou-chuck',
        accessoryName: 'Mandril Sanou 3 Mordazas',
        method: 'linear_caliper',
        linearMode: 'caliper_chord',
        effectiveRealArcMm: 50.1,
        initialSteps: 3200,
        expectedValue: 50,
        measuredValue: 46.45,
        computedSteps: 3193.6,
        operatorNotes: 'Cuerda medida con calibre en probeta cilíndrica',
      });

      expect(record.id).toMatch(/^calib-/);
      expect(record.linearMode).toBe('caliper_chord');
      expect(record.effectiveRealArcMm).toBe(50.1);

      const history = loadRotaryCalibrationHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].computedSteps).toBe(3193.6);
    });
  });

  describe('4. Sentido de giro: Separar orientación documentada del efecto en máquina', () => {
    it('las instrucciones técnicas diferencian orientación documentada de la inversión física del motor', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const config: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        accessoryProfileId: 'vank-sanou-chuck',
        rotaryType: 'chuck',
        rotationDirection: 'inverted',
        objectDiameterMm: 80,
      };

      const instructions = buildRotaryInstructions(design, config);
      expect(instructions).toContain('Sentido de giro documentado: Invertido');
      expect(instructions).toContain('El archivo exportado conserva coordenadas CAD estándar');
      expect(instructions).toContain('Invert Direction');
    });

    it('el SVG exportado conserva coordenadas CAD sin alteración destructiva independientemente de rotationDirection', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const normalConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        rotationDirection: 'normal',
      };
      const invertedConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        rotationDirection: 'inverted',
      };

      const svgNormal = exportRotarySvg(design, normalConfig);
      const svgInverted = exportRotarySvg(design, invertedConfig);

      // Los trazados vectoriales tienen la misma geometría base (coordenadas estándar CAD)
      expect(svgNormal.widthMm).toBe(svgInverted.widthMm);
      expect(svgNormal.heightMm).toBe(svgInverted.heightMm);
      expect(svgNormal.engravePathCount).toBe(svgInverted.engravePathCount);
    });
  });

  describe('5. Conos en mandril Sanou: Diámetro de referencia y alerta de doble compensación en LightBurn', () => {
    it('incluye advertencia de doble compensación y cota exacta de diámetro de referencia para LightBurn', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const taperedConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        rotaryType: 'chuck',
        accessoryProfileId: 'vank-sanou-chuck',
        objectDiameterMm: 90, // boca
        endDiameterMm: 65, // base
        usefulLengthMm: 120,
      };

      const instructions = buildRotaryInstructions(design, taperedConfig);
      // Diámetro de referencia (90 + 65) / 2 = 77.5 ~ 78 mm
      expect(instructions).toContain('ATENCIÓN — CONFIGURACIÓN DE OBJETO CÓNICO EN LIGHTBURN (MANDRIL SANOU)');
      expect(instructions).toContain('ADVERTENCIA DE DOBLE COMPENSACIÓN');
      expect(instructions).toContain('NO active ninguna deformación cónica en LightBurn');
      expect(instructions).toContain('EXACTAMENTE 77.5 mm (diámetro de referencia)');
    });
  });

  describe('6. Sincronización del tipo Chuck con perfil persistente', () => {
    it('sincroniza tipo chuck con el perfil vank-sanou-chuck al cargar configuraciones antiguas', () => {
      const legacyRaw = {
        objectDiameterMm: 75,
        usefulLengthMm: 100,
        arcDeg: 360,
        rotaryType: 'chuck',
      };

      const sanitized = sanitizeRotaryConfig(legacyRaw);
      expect(sanitized).toBeDefined();
      expect(sanitized?.rotaryType).toBe('chuck');
      expect(sanitized?.accessoryProfileId).toBe('vank-sanou-chuck');
      // En mandril, rollerDiameterMm debe ser undefined
      expect(sanitized?.rollerDiameterMm).toBeUndefined();
    });

    it('sincroniza tipo roller con vank-roller-standard cuando no se especifica perfil', () => {
      const legacyRoller = {
        objectDiameterMm: 75,
        usefulLengthMm: 100,
        arcDeg: 360,
        rotaryType: 'roller',
      };

      const sanitized = sanitizeRotaryConfig(legacyRoller);
      expect(sanitized?.rotaryType).toBe('roller');
      expect(sanitized?.accessoryProfileId).toBe('vank-roller-standard');
    });
  });

  describe('7. Validación estricta en el patrón SVG de calibración', () => {
    it('rechaza generar el patrón SVG si la configuración es inválida', () => {
      const invalidDiameterConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 0, // inválido
      };
      expect(() => exportRotaryTestPatternSvg(invalidDiameterConfig, 50)).toThrow(
        /Configuración rotativa inválida/i
      );

      const overflowLengthConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        usefulLengthMm: 950, // supera los 900 mm de la Vank 9060
      };
      expect(() => exportRotaryTestPatternSvg(overflowLengthConfig, 50)).toThrow(
        /Configuración rotativa inválida/i
      );

      const invalidSquareConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
      };
      expect(() => exportRotaryTestPatternSvg(invalidSquareConfig, -10)).toThrow(
        /positivo/i
      );
    });

    it('genera patrón válido y documenta el procedimiento de medición con calibre vs cinta', () => {
      const validConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        accessoryProfileId: 'vank-sanou-chuck',
        rotaryType: 'chuck',
        objectDiameterMm: 75,
        usefulLengthMm: 100,
        arcDeg: 360,
      };

      const pattern = exportRotaryTestPatternSvg(validConfig, 50);
      expect(pattern.svgContent).toContain('cuadrado_calibracion_50mm');
      expect(pattern.instructionsText).toContain('CALIBRE RÍGIDO');
      expect(pattern.instructionsText).toContain('CINTA FLEXIBLE');
      expect(pattern.instructionsText).toContain('s = D * arcsin(c / D)');
    });
  });

  describe('8. Bloqueo de exportación sin grabado y pruebas de regresión', () => {
    it('rechaza exportar SVG si el diseño no tiene elementos de grabado visibles', () => {
      const emptyDesign = createMockDesign([]);
      expect(() => exportRotarySvg(emptyDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );

      const invisibleDesign = createMockDesign([createTextElement('t1', false)]);
      expect(() => exportRotarySvg(invisibleDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );
    });

    it('rechaza exportar DXF si el diseño no tiene trazados vectoriales o elementos', () => {
      const emptyDesign = createMockDesign([]);
      expect(() => exportRotaryDxf(emptyDesign, DEFAULT_ROTARY_CONFIG)).toThrow(
        /no contiene elementos de grabado visibles/i
      );
    });

    it('valida límites físicos de la Vank 9060 (ancho 900mm y aviso de diámetro)', () => {
      const overflowConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        usefulLengthMm: 950,
      };
      const l = computeRotaryLayout(overflowConfig, { widthMm: 40, heightMm: 20 });
      expect(l.valid).toBe(false);
      expect(l.errors.some((e) => e.includes('supera el ancho de la máquina'))).toBe(true);

      const largeDConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 280,
      };
      const l2 = computeRotaryLayout(largeDConfig, { widthMm: 40, heightMm: 20 });
      expect(l2.warnings.some((w) => w.includes('altura libre del eje Z'))).toBe(true);
    });

    it('distribuye múltiples copias equidistantes y mantiene retrocompatibilidad', () => {
      const design = createMockDesign([createTextElement('t1', true)]);
      const multiConfig: RotaryConfig = {
        ...DEFAULT_ROTARY_CONFIG,
        objectDiameterMm: 80,
        usefulLengthMm: 100,
        arcDeg: 360,
        repeatCount: 2,
      };

      const layout = computeRotaryLayout(multiConfig, design);
      expect(layout.valid).toBe(true);
      expect(layout.placements.length).toBe(2);
      expect(layout.placements[1].centerYMm - layout.placements[0].centerYMm).toBeCloseTo(layout.copyPitchMm, 2);

      const svg = exportRotarySvg(design, multiConfig);
      expect(svg.svgContent).toContain('data-rotary-copies="2"');
    });
  });
});
