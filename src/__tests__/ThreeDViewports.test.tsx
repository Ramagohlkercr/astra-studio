import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { canUseWebGL, disposeObject3D } from '../core/three/threeUtils';
import { Rotary3DViewport } from '../components/Rotary3DViewport';
import { Workbench3DViewport } from '../components/Workbench3DViewport';
import {
  computeRotaryLayout,
  computeRotaryPhysicalSetup,
  DEFAULT_ROTARY_CONFIG,
} from '../core/rotary/rotaryEngine';
import { createBlankLabelDesign } from '../core/projects/projectManager';
import { INITIAL_MATERIALS_CATALOG } from '../core/materials/materialsCatalog';
import { createDefaultWorkbenchConfig } from '../core/workbench/workbenchTypes';
import {
  buildRotaryVesselGroup,
  buildSanouChuckModels,
  buildTailstockSupportAssembly,
  resolveRotaryVesselShape,
} from '../core/three/cadModels';
import * as THREE from 'three';

describe('Visores 3D Three.js (Rotativo y Mesa Vank 9060)', () => {
  it('detecta entornos sin WebGL sin lanzar errores y libera Object3D sin fugas', () => {
    expect(canUseWebGL()).toBe(false);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.MeshStandardMaterial({ color: '#ffffff' })
    );
    group.add(mesh);
    expect(() => disposeObject3D(group)).not.toThrow();
  });

  it('construye modelados CAD multi-pieza (Tumbler, Termo, Mate, Botella, Sanou y soporte cónico)', () => {
    expect(resolveRotaryVesselShape('auto', 190, 82, 82)).toBe('thermos');
    expect(resolveRotaryVesselShape('auto', 120, 90, 65)).toBe('tumbler');
    expect(resolveRotaryVesselShape('auto', 85, 76, 76)).toBe('mate');
    expect(resolveRotaryVesselShape('auto', 145, 72, 72)).toBe('bottle');

    const dummyTex = new THREE.Texture();
    for (const shape of ['tumbler', 'thermos', 'mate', 'bottle'] as const) {
      const vg = buildRotaryVesselGroup({
        shape,
        r0: 45,
        r1: 32.5,
        len: 120,
        color: '#1b2029',
        metalness: 0.3,
        roughness: 0.6,
        brushedTex: dummyTex,
        mouthAtLeft: false,
      });
      expect(vg.children.length).toBeGreaterThanOrEqual(3);
      disposeObject3D(vg);
    }

    const chuck = buildSanouChuckModels(45, -82, dummyTex);
    expect(chuck.staticMotorGroup.children.length).toBeGreaterThan(1);
    expect(chuck.rotatingChuckGroup.children.length).toBeGreaterThanOrEqual(5);
    disposeObject3D(chuck.staticMotorGroup);
    disposeObject3D(chuck.rotatingChuckGroup);

    const jack = buildTailstockSupportAssembly(46, -80, 12);
    expect(jack.children.length).toBeGreaterThanOrEqual(5);
    disposeObject3D(jack);
    dummyTex.dispose();
  });

  it('renderiza el fallback de Rotary3DViewport y Workbench3DViewport sin WebGL', () => {
    const design = createBlankLabelDesign();
    const cfg = { ...DEFAULT_ROTARY_CONFIG, objectDiameterMm: 90, endDiameterMm: 65, usefulLengthMm: 120 };
    const layout = computeRotaryLayout(cfg, design);
    const physicalSetup = computeRotaryPhysicalSetup(cfg, design);

    render(
      <Rotary3DViewport
        config={cfg}
        layout={layout}
        physicalSetup={physicalSetup}
        svgRaw={null}
        previewRotationDeg={45}
        fallbackSvgContent={<div data-testid="rotary-fallback">Fallback SVG</div>}
      />
    );
    expect(screen.getByTestId('rotary-fallback')).toBeTruthy();

    const mat = INITIAL_MATERIALS_CATALOG[0];
    const wbCfg = createDefaultWorkbenchConfig(undefined, undefined, mat);
    render(
      <Workbench3DViewport
        config={wbCfg}
        jobs={[]}
        selectedJobId={null}
        material={mat}
        simulation={{
          segments: [],
          totalDistanceMm: 0,
          engraveDistanceMm: 0,
          cutDistanceMm: 0,
          rapidDistanceMm: 0,
          totalDurationSec: 0,
          engraveDurationSec: 0,
          holesDurationSec: 0,
          outerCutDurationSec: 0,
          rapidDurationSec: 0,
        }}
        simProgress={0}
        showSimulation={false}
      />
    );
    expect(screen.getByText(/Vista 3D WebGL no disponible/i)).toBeTruthy();
  });
});
