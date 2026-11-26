import * as THREE from 'three';
import {
  createChiseledVirolaBumpTexture,
  createHammeredCoatPbrTextures,
  createLeatherPbrTextures,
  createWoodPbrTextures,
  ProceduralPbrTextures,
} from './materialTextures';

export type RotaryVesselShape = 'auto' | 'tumbler' | 'thermos' | 'mate' | 'bottle';
export type RotarySurfaceMaterialKind =
  | 'auto'
  | 'hammered_green'
  | 'powder_black'
  | 'navy_coat'
  | 'leather'
  | 'stainless'
  | 'wood'
  | 'glass';

export interface ResolvedProductAppearance {
  shape: Exclude<RotaryVesselShape, 'auto'>;
  surface: Exclude<RotarySurfaceMaterialKind, 'auto'>;
  color: string;
  metalness: number;
  roughness: number;
  markHex: string;
  markEmissive: string;
  engraveIsAblatedMetal: boolean;
}

export function resolveRotaryVesselShape(
  requested: RotaryVesselShape,
  len: number,
  d0: number,
  d1: number,
  presetId?: string
): Exclude<RotaryVesselShape, 'auto'> {
  if (requested !== 'auto') return requested;
  if (presetId === 'mate_imperial') return 'mate';
  if (presetId === 'termo_stanley' || presetId === 'termo') return 'thermos';
  if (presetId === 'botella') return 'bottle';
  if (presetId === 'tumbler' || presetId === 'pinta_cerveza' || presetId === 'vaso') {
    return 'tumbler';
  }
  if (len >= 148) return 'thermos';
  if (Math.abs(d0 - d1) >= 4 && len <= 100 && d0 >= 58) return 'mate';
  if (Math.abs(d0 - d1) >= 4) return 'tumbler';
  if (len <= 105 && d0 >= 58) return 'mate';
  if (len >= 135 && d0 <= 82) return 'bottle';
  return 'tumbler';
}

/**
 * Resuelve el material y textura física realista según el producto elegido o preset manual.
 */
export function resolveProductAppearance(
  requestedShape: RotaryVesselShape,
  requestedSurface: RotarySurfaceMaterialKind,
  len: number,
  d0: number,
  d1: number,
  presetId?: string
): ResolvedProductAppearance {
  const shape = resolveRotaryVesselShape(requestedShape, len, d0, d1, presetId);

  let surface: Exclude<RotarySurfaceMaterialKind, 'auto'>;
  if (requestedSurface !== 'auto') {
    surface = requestedSurface;
  } else if (presetId === 'pinta_cerveza' || presetId === 'vaso') {
    surface = 'glass';
  } else if (presetId === 'termo') {
    surface = 'stainless';
  } else if (shape === 'mate') {
    surface = 'leather';
  } else if (shape === 'thermos') {
    surface = 'hammered_green';
  } else if (shape === 'bottle') {
    surface = 'navy_coat';
  } else {
    surface = 'powder_black';
  }

  switch (surface) {
    case 'hammered_green':
      return {
        shape,
        surface,
        color: '#1f4b34',
        metalness: 0.42,
        roughness: 0.48,
        markHex: '#f1f5f9',
        markEmissive: '#94a3b8',
        engraveIsAblatedMetal: true,
      };
    case 'navy_coat':
      return {
        shape,
        surface,
        color: '#113a57',
        metalness: 0.34,
        roughness: 0.54,
        markHex: '#f8fafc',
        markEmissive: '#cbd5e1',
        engraveIsAblatedMetal: true,
      };
    case 'leather':
      return {
        shape,
        surface,
        color: '#6e3f1d',
        metalness: 0.04,
        roughness: 0.84,
        markHex: '#1c0c04',
        markEmissive: '#000000',
        engraveIsAblatedMetal: false,
      };
    case 'stainless':
      return {
        shape,
        surface,
        color: '#9ca8b8',
        metalness: 0.9,
        roughness: 0.22,
        markHex: '#0f172a',
        markEmissive: '#000000',
        engraveIsAblatedMetal: false,
      };
    case 'wood':
      return {
        shape,
        surface,
        color: '#8f5b32',
        metalness: 0.04,
        roughness: 0.78,
        markHex: '#1b0d04',
        markEmissive: '#000000',
        engraveIsAblatedMetal: false,
      };
    case 'glass':
      return {
        shape,
        surface,
        color: '#bae6fd',
        metalness: 0.05,
        roughness: 0.08,
        markHex: '#f8fafc',
        markEmissive: '#e2e8f0',
        engraveIsAblatedMetal: false,
      };
    case 'powder_black':
    default:
      return {
        shape,
        surface: 'powder_black',
        color: '#1b2029',
        metalness: 0.3,
        roughness: 0.58,
        markHex: '#f1f5f9',
        markEmissive: '#94a3b8',
        engraveIsAblatedMetal: true,
      };
  }
}

export interface VesselModelParams {
  appearance: ResolvedProductAppearance;
  r0: number;
  r1: number;
  len: number;
  brushedTex: THREE.Texture;
  mouthAtLeft: boolean;
}

/**
 * Construye el modelo 3D fotorrealista del producto rotativo (Mate de Cuero y Alpaca,
 * Termo Stanley Martillado, Tumbler con tapa acrílica, Botella o Vaso de Cristal).
 */
export function buildRotaryVesselGroup(params: VesselModelParams): THREE.Group {
  const { appearance, r0, r1, len, brushedTex, mouthAtLeft } = params;
  const { shape, surface, color, metalness, roughness } = appearance;
  const group = new THREE.Group();

  let pbrTex: ProceduralPbrTextures | null = null;
  let bodyMat: THREE.Material;

  if (surface === 'glass') {
    bodyMat = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.05,
      roughness: 0.08,
      transparent: true,
      opacity: 0.38,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      reflectivity: 0.94,
      side: THREE.DoubleSide,
    });
  } else if (surface === 'leather') {
    pbrTex = createLeatherPbrTextures(color, true, [3, 2]);
    bodyMat = new THREE.MeshStandardMaterial({
      map: pbrTex.map,
      bumpMap: pbrTex.bumpMap,
      bumpScale: 1.35,
      roughnessMap: pbrTex.roughnessMap,
      metalness,
      roughness,
    });
  } else if (surface === 'wood') {
    pbrTex = createWoodPbrTextures(color, [2, 2]);
    bodyMat = new THREE.MeshStandardMaterial({
      map: pbrTex.map,
      bumpMap: pbrTex.bumpMap,
      bumpScale: 1.0,
      roughnessMap: pbrTex.roughnessMap,
      metalness,
      roughness,
    });
  } else if (surface === 'stainless') {
    bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      roughnessMap: brushedTex.clone(),
    });
  } else {
    // Verde Stanley martillado / Negro Coat / Azul Termo
    pbrTex = createHammeredCoatPbrTextures(color, [4, 3]);
    bodyMat = new THREE.MeshStandardMaterial({
      map: pbrTex.map,
      bumpMap: pbrTex.bumpMap,
      bumpScale: surface === 'hammered_green' ? 0.95 : 0.45,
      roughnessMap: pbrTex.roughnessMap,
      metalness,
      roughness,
    });
  }

  const stainlessMat = new THREE.MeshStandardMaterial({
    color: '#dce3ec',
    metalness: 0.94,
    roughness: 0.17,
    roughnessMap: brushedTex.clone(),
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    metalness: 0.25,
    roughness: 0.55,
  });
  const innerDarkMat = new THREE.MeshStandardMaterial({
    color: surface === 'leather' ? '#2c180c' : '#090d14',
    metalness: 0.25,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });

  const dir = mouthAtLeft ? -1 : 1;
  const xBase = -dir * (len / 2);
  const rBase = mouthAtLeft ? r1 : r0;
  const xMouth = dir * (len / 2);
  const rMouth = mouthAtLeft ? r0 : r1;

  const addLathePart = (pts: Array<[number, number]>, mat: THREE.Material, segs = 72) => {
    const vecs = pts.map(([rad, axialX]) => new THREE.Vector2(Math.max(0.01, rad), axialX));
    const geo = new THREE.LatheGeometry(vecs, segs);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = -Math.PI / 2;
    mesh.castShadow = surface !== 'glass';
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // 1. Barril principal grabable exacto [-len/2 .. +len/2]
  addLathePart(
    [
      [0.01, xBase - dir * 2],
      [Math.max(4, rBase - 3), xBase - dir * 2],
      [rBase, xBase],
      [rMouth, xMouth],
      [Math.max(3, rMouth - 3.2), xMouth],
    ],
    bodyMat
  );

  // Talón / base inferior (inoxidable en términos metálicos, vidrio sólido en vasos de vidrio, cuero redondeado en mate)
  if (surface !== 'leather') {
    addLathePart(
      [
        [0.01, xBase - dir * 5.5],
        [Math.max(4, rBase - 4.2), xBase - dir * 5.5],
        [rBase - 0.3, xBase - dir * 2.5],
        [rBase, xBase],
      ],
      surface === 'glass' ? bodyMat : stainlessMat
    );
  } else {
    // Base redondeada de cuero para Mate
    addLathePart(
      [
        [0.01, xBase - dir * 6],
        [Math.max(4, rBase - 7), xBase - dir * 5],
        [rBase - 1.5, xBase - dir * 2],
        [rBase, xBase],
      ],
      bodyMat
    );
  }

  if (shape === 'tumbler') {
    if (surface === 'glass') {
      // Vaso cervecero/cristal hueco con espesor real de pared de vidrio
      const innerR = Math.max(4, rMouth - 3);
      addLathePart(
        [
          [rMouth, xMouth],
          [rMouth, xMouth + dir * 4],
          [innerR, xMouth + dir * 4],
          [Math.max(3, rBase - 3.5), xBase + dir * 8],
          [0.01, xBase + dir * 8],
        ],
        bodyMat
      );
    } else {
      // Labio inoxidable expuesto + tapa acrílica ahumada translúcida + burlete negro
      const lipLen = Math.min(13, len * 0.11);
      const innerR = Math.max(4, rMouth - 3.5);
      addLathePart(
        [
          [rMouth, xMouth],
          [rMouth + 0.5, xMouth + dir * (lipLen * 0.65)],
          [rMouth - 0.4, xMouth + dir * lipLen],
          [innerR, xMouth + dir * lipLen],
          [innerR - 0.8, xMouth - dir * (len * 0.25)],
        ],
        stainlessMat
      );
      const cavityDisk = new THREE.Mesh(
        new THREE.CircleGeometry(innerR - 0.8, 48),
        innerDarkMat
      );
      cavityDisk.rotation.y = mouthAtLeft ? -Math.PI / 2 : Math.PI / 2;
      cavityDisk.position.x = xMouth - dir * (len * 0.2);
      group.add(cavityDisk);

      // Burlete de silicona negra + Tapa acrílica translúcida
      const gasket = new THREE.Mesh(
        new THREE.TorusGeometry(rMouth - 0.6, 1.5, 10, 56),
        capMat
      );
      gasket.rotation.y = Math.PI / 2;
      gasket.position.x = xMouth + dir * lipLen;
      group.add(gasket);

      const lidMat = new THREE.MeshPhysicalMaterial({
        color: '#334155',
        roughness: 0.14,
        metalness: 0.05,
        transparent: true,
        opacity: 0.48,
        clearcoat: 1,
      });
      addLathePart(
        [
          [rMouth + 0.8, xMouth + dir * (lipLen + 1)],
          [rMouth + 1.0, xMouth + dir * (lipLen + 5)],
          [rMouth - 2.5, xMouth + dir * (lipLen + 6)],
          [0.01, xMouth + dir * (lipLen + 6)],
        ],
        lidMat
      );
    }
  } else if (shape === 'thermos') {
    const shoulderLen = Math.min(26, len * 0.16);
    const neckR = Math.max(12, rMouth * 0.68);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth * 0.94, xMouth + dir * (shoulderLen * 0.35)],
        [neckR * 1.12, xMouth + dir * (shoulderLen * 0.72)],
        [neckR, xMouth + dir * shoulderLen],
        [neckR, xMouth + dir * (shoulderLen + 8)],
      ],
      stainlessMat
    );
    // Tapón / vaso-tapa Stanley con acanaladuras de agarre y aro metálico
    addLathePart(
      [
        [neckR + 2.2, xMouth + dir * (shoulderLen + 4)],
        [neckR + 3.0, xMouth + dir * (shoulderLen + 11)],
        [neckR + 2.0, xMouth + dir * (shoulderLen + 14)],
        [neckR + 3.0, xMouth + dir * (shoulderLen + 19)],
        [neckR + 1.8, xMouth + dir * (shoulderLen + 28)],
        [neckR * 0.72, xMouth + dir * (shoulderLen + 30)],
        [0.01, xMouth + dir * (shoulderLen + 30)],
      ],
      capMat
    );
  } else if (shape === 'mate') {
    // Virola cincelada de alpaca/acero inoxidable argentina en la boca
    const virolaBump = createChiseledVirolaBumpTexture();
    const virolaMat = new THREE.MeshStandardMaterial({
      color: '#e5ecf5',
      metalness: 0.95,
      roughness: 0.18,
      bumpMap: virolaBump,
      bumpScale: 1.85,
    });
    const virolaLen = Math.min(18, len * 0.24);
    const innerR = Math.max(6, rMouth - 6.5);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth + 2.4, xMouth + dir * (virolaLen * 0.45)],
        [rMouth + 1.8, xMouth + dir * virolaLen],
        [innerR, xMouth + dir * virolaLen],
        [innerR * 0.72, xMouth - dir * (len * 0.2)],
      ],
      virolaMat
    );
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(rMouth + 0.9, 1.4, 12, 64),
      virolaMat
    );
    collar.rotation.y = Math.PI / 2;
    collar.position.x = xMouth;
    group.add(collar);

    const cavityDisk = new THREE.Mesh(
      new THREE.CircleGeometry(innerR * 0.74, 48),
      innerDarkMat
    );
    cavityDisk.rotation.y = mouthAtLeft ? -Math.PI / 2 : Math.PI / 2;
    cavityDisk.position.x = xMouth - dir * (len * 0.16);
    group.add(cavityDisk);
  } else {
    // Botella con hombro curvo, tapón roscado y argolla deportiva superior
    const shoulderLen = Math.min(34, len * 0.22);
    const neckR = Math.max(10, rMouth * 0.42);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth * 0.86, xMouth + dir * (shoulderLen * 0.3)],
        [neckR * 1.25, xMouth + dir * (shoulderLen * 0.7)],
        [neckR, xMouth + dir * shoulderLen],
        [neckR, xMouth + dir * (shoulderLen + 10)],
      ],
      surface === 'glass' ? bodyMat : bodyMat
    );
    addLathePart(
      [
        [neckR + 1.6, xMouth + dir * (shoulderLen + 6)],
        [neckR + 2.2, xMouth + dir * (shoulderLen + 14)],
        [neckR + 1.6, xMouth + dir * (shoulderLen + 20)],
        [0.01, xMouth + dir * (shoulderLen + 20)],
      ],
      capMat
    );
    const bail = new THREE.Mesh(new THREE.TorusGeometry(neckR * 0.72, 1.8, 10, 32), capMat);
    bail.position.x = xMouth + dir * (shoulderLen + 24);
    group.add(bail);
  }

  return group;
}

export function buildSanouChuckModels(
  rClamped: number,
  chuckX: number,
  brushedTex: THREE.Texture
): { staticMotorGroup: THREE.Group; rotatingChuckGroup: THREE.Group } {
  const staticMotorGroup = new THREE.Group();
  const rotatingChuckGroup = new THREE.Group();

  const housingMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    metalness: 0.65,
    roughness: 0.42,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#a3b1c2',
    metalness: 0.94,
    roughness: 0.2,
    roughnessMap: brushedTex.clone(),
  });
  const jawMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    metalness: 0.92,
    roughness: 0.18,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    metalness: 0.82,
    roughness: 0.26,
  });

  const motorCore = new THREE.Mesh(new THREE.BoxGeometry(40, 58, 58), housingMat);
  motorCore.position.set(chuckX - 36, 0, 0);
  motorCore.castShadow = true;
  staticMotorGroup.add(motorCore);

  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(34, 62, 3), housingMat);
    fin.position.set(chuckX - 36, 0, i * 11);
    staticMotorGroup.add(fin);
  }

  const spindleNeck = new THREE.Mesh(
    new THREE.CylinderGeometry(24, 24, 16, 36),
    steelMat
  );
  spindleNeck.rotation.z = -Math.PI / 2;
  spindleNeck.position.set(chuckX - 14, 0, 0);
  rotatingChuckGroup.add(spindleNeck);

  const platoPts = [
    new THREE.Vector2(18, -12),
    new THREE.Vector2(46, -12),
    new THREE.Vector2(47, -8),
    new THREE.Vector2(47, 10),
    new THREE.Vector2(44, 12.5),
    new THREE.Vector2(10, 12.5),
  ];
  const platoGeo = new THREE.LatheGeometry(platoPts, 64);
  const platoMesh = new THREE.Mesh(platoGeo, steelMat);
  platoMesh.rotation.z = -Math.PI / 2;
  platoMesh.position.set(chuckX, 0, 0);
  platoMesh.castShadow = true;
  rotatingChuckGroup.add(platoMesh);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(44.5, 1.7, 12, 64), accentMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(chuckX + 12.4, 0, 0);
  rotatingChuckGroup.add(ring);

  const jawShape = new THREE.Shape();
  jawShape.moveTo(0, 0);
  jawShape.lineTo(24, 0);
  jawShape.lineTo(24, 7);
  jawShape.lineTo(16, 7);
  jawShape.lineTo(16, 13);
  jawShape.lineTo(9, 13);
  jawShape.lineTo(9, 19);
  jawShape.lineTo(0, 19);
  jawShape.closePath();

  const jawGeo = new THREE.ExtrudeGeometry(jawShape, {
    depth: 10,
    bevelEnabled: true,
    bevelThickness: 0.7,
    bevelSize: 0.6,
    bevelSegments: 2,
  });
  jawGeo.translate(0, 0, -5);

  const jawClampRadius = Math.max(12, rClamped);
  for (const deg of [0, 120, 240]) {
    const holder = new THREE.Group();
    holder.rotation.x = (deg * Math.PI) / 180;

    const jaw = new THREE.Mesh(jawGeo, jawMat);
    jaw.position.set(chuckX + 11, jawClampRadius, 0);
    jaw.castShadow = true;
    holder.add(jaw);

    rotatingChuckGroup.add(holder);
  }

  return { staticMotorGroup, rotatingChuckGroup };
}

export function buildTailstockSupportAssembly(
  xPos: number,
  bedY: number,
  undersideY: number
): THREE.Group {
  const g = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    metalness: 0.7,
    roughness: 0.35,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    metalness: 0.88,
    roughness: 0.25,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    metalness: 0.55,
    roughness: 0.35,
  });

  const height = Math.max(10, undersideY - bedY);
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(28, 6, 42), baseMat);
  basePlate.position.set(xPos, bedY + 3, 0);
  basePlate.castShadow = true;
  g.add(basePlate);

  const screwH = Math.max(6, height - 12);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, screwH, 20), brassMat);
  screw.position.set(xPos, bedY + 6 + screwH / 2, 0);
  screw.castShadow = true;
  g.add(screw);

  const knob = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 5, 24), brassMat);
  knob.position.set(xPos, bedY + 12, 0);
  g.add(knob);

  const cradle = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 30), baseMat);
  cradle.position.set(xPos, undersideY - 7, 0);
  g.add(cradle);

  for (const zOff of [-10, 10]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 14, 20), wheelMat);
    roller.rotation.z = -Math.PI / 2;
    roller.position.set(xPos, undersideY - 3, zOff);
    g.add(roller);
  }

  return g;
}

export function buildVankLaserHeadMeshGroup(
  beamLength: number,
  glowTex: THREE.Texture
): { headGroup: THREE.Group; flareSprite: THREE.Sprite } {
  const headGroup = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    metalness: 0.78,
    roughness: 0.28,
  });
  const blueAnodizedMat = new THREE.MeshStandardMaterial({
    color: '#0284c7',
    metalness: 0.85,
    roughness: 0.2,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: '#eab308',
    metalness: 0.9,
    roughness: 0.22,
  });

  const carriage = new THREE.Mesh(new THREE.BoxGeometry(28, 18, 26), bodyMat);
  carriage.castShadow = true;
  headGroup.add(carriage);

  const mirrorCube = new THREE.Mesh(new THREE.BoxGeometry(18, 16, 18), blueAnodizedMat);
  mirrorCube.position.set(0, -1, 16);
  mirrorCube.castShadow = true;
  headGroup.add(mirrorCube);

  const lensBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(9.2, 9.2, 14, 28),
    blueAnodizedMat
  );
  lensBarrel.position.y = -14;
  lensBarrel.castShadow = true;
  headGroup.add(lensBarrel);

  const brassCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(10.8, 10.8, 4.5, 28),
    brassMat
  );
  brassCollar.position.y = -21;
  headGroup.add(brassCollar);

  const nozzle = new THREE.Mesh(
    new THREE.ConeGeometry(8.8, 19, 28),
    blueAnodizedMat
  );
  nozzle.rotation.x = Math.PI;
  nozzle.position.y = -32;
  nozzle.castShadow = true;
  headGroup.add(nozzle);

  const airFitting = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 8, 12),
    brassMat
  );
  airFitting.rotation.z = Math.PI / 2;
  airFitting.position.set(10, -28, 0);
  headGroup.add(airFitting);

  const rayStartY = -41.5;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.9, beamLength, 16),
    new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.9,
    })
  );
  beam.position.y = rayStartY - beamLength / 2;
  headGroup.add(beam);

  const flareSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: '#ffedd5',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  flareSprite.scale.set(14, 14, 1);
  flareSprite.position.y = rayStartY - beamLength;
  headGroup.add(flareSprite);

  return { headGroup, flareSprite };
}
