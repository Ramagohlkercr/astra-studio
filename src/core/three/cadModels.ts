import * as THREE from 'three';

export type RotaryVesselShape = 'auto' | 'tumbler' | 'thermos' | 'mate' | 'bottle';

export function resolveRotaryVesselShape(
  requested: RotaryVesselShape,
  len: number,
  d0: number,
  d1: number
): Exclude<RotaryVesselShape, 'auto'> {
  if (requested !== 'auto') return requested;
  if (len >= 165) return 'thermos';
  if (Math.abs(d0 - d1) >= 4) return 'tumbler';
  if (len <= 115 && d0 >= 58) return 'mate';
  if (len >= 135 && d0 <= 82) return 'bottle';
  return 'tumbler';
}

export interface VesselModelParams {
  shape: Exclude<RotaryVesselShape, 'auto'>;
  r0: number;
  r1: number;
  len: number;
  color: string;
  metalness: number;
  roughness: number;
  brushedTex: THREE.Texture;
  mouthAtLeft: boolean;
}

/**
 * Construye el modelo 3D realista del objeto rotativo (Vaso Tumbler, Termo, Mate o Botella)
 * con LatheGeometry multi-perfil manteniendo la pared grabable exacta entre x = -len/2 (r0) y x = +len/2 (r1).
 */
export function buildRotaryVesselGroup(params: VesselModelParams): THREE.Group {
  const { shape, r0, r1, len, color, metalness, roughness, brushedTex, mouthAtLeft } = params;
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    roughnessMap: brushedTex.clone(),
  });
  const stainlessMat = new THREE.MeshStandardMaterial({
    color: '#dce3ec',
    metalness: 0.94,
    roughness: 0.17,
    roughnessMap: brushedTex.clone(),
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    metalness: 0.25,
    roughness: 0.52,
  });
  const innerDarkMat = new THREE.MeshStandardMaterial({
    color: '#090d14',
    metalness: 0.35,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });

  // Posiciones axiales (-len/2 a +len/2 son exactamente las cotas r0 -> r1 del barril)
  const dir = mouthAtLeft ? -1 : 1;
  const xBase = -dir * (len / 2);
  const rBase = mouthAtLeft ? r1 : r0;
  const xMouth = dir * (len / 2);
  const rMouth = mouthAtLeft ? r0 : r1;

  // Helper: LatheGeometry usa eje Y (v.y = coordenada axial en mundo X al rotar -PI/2 en Z)
  const addLathePart = (pts: Array<[number, number]>, mat: THREE.Material, segs = 72) => {
    const vecs = pts.map(([rad, axialX]) => new THREE.Vector2(Math.max(0.01, rad), axialX));
    const geo = new THREE.LatheGeometry(vecs, segs);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // 1. Cuerpo principal pintado/material exactamente sobre [-len/2 .. +len/2] (r0 -> r1)
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

  // Anillo inferior de acero inoxidable en la base del objeto
  addLathePart(
    [
      [0.01, xBase - dir * 5],
      [Math.max(4, rBase - 4), xBase - dir * 5],
      [rBase - 0.3, xBase - dir * 2.5],
      [rBase, xBase],
    ],
    stainlessMat
  );

  if (shape === 'tumbler') {
    // Borde superior inoxidable expuesto + labio redondeado + cavidad interna hueca real
    const lipLen = Math.min(14, len * 0.12);
    const innerR = Math.max(4, rMouth - 3.5);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth + 0.5, xMouth + dir * (lipLen * 0.65)],
        [rMouth - 0.6, xMouth + dir * lipLen],
        [innerR, xMouth + dir * lipLen],
        [innerR - 0.8, xMouth - dir * (len * 0.25)],
      ],
      stainlessMat
    );
    // Fondo oscuro interior para dar sensación de vaso hueco real
    const cavityDisk = new THREE.Mesh(
      new THREE.CircleGeometry(innerR - 0.8, 48),
      innerDarkMat
    );
    cavityDisk.rotation.y = mouthAtLeft ? -Math.PI / 2 : Math.PI / 2;
    cavityDisk.position.x = xMouth - dir * (len * 0.22);
    group.add(cavityDisk);
  } else if (shape === 'thermos') {
    // Hombro curvo inoxidable + cuello roscado + tapa térmica oscura arriba
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
    // Tapón / Tapa térmica con anillo de agarre
    addLathePart(
      [
        [neckR + 1.8, xMouth + dir * (shoulderLen + 4)],
        [neckR + 2.4, xMouth + dir * (shoulderLen + 14)],
        [neckR + 1.6, xMouth + dir * (shoulderLen + 26)],
        [neckR * 0.7, xMouth + dir * (shoulderLen + 28)],
        [0.01, xMouth + dir * (shoulderLen + 28)],
      ],
      capMat
    );
  } else if (shape === 'mate') {
    // Virola de alpaca/acero cincelada en la boca + hueco interno oscuro del mate
    const virolaLen = Math.min(16, len * 0.18);
    const innerR = Math.max(6, rMouth - 6);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth + 2.2, xMouth + dir * (virolaLen * 0.45)],
        [rMouth + 1.6, xMouth + dir * virolaLen],
        [innerR, xMouth + dir * virolaLen],
        [innerR * 0.75, xMouth - dir * (len * 0.18)],
      ],
      stainlessMat
    );
    // Reborde decorativo inferior de la virola
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(rMouth + 0.8, 1.3, 12, 64),
      stainlessMat
    );
    collar.rotation.y = Math.PI / 2;
    collar.position.x = xMouth;
    group.add(collar);

    const cavityDisk = new THREE.Mesh(
      new THREE.CircleGeometry(innerR * 0.75, 48),
      innerDarkMat
    );
    cavityDisk.rotation.y = mouthAtLeft ? -Math.PI / 2 : Math.PI / 2;
    cavityDisk.position.x = xMouth - dir * (len * 0.16);
    group.add(cavityDisk);
  } else {
    // Botella: hombro suave hacia cuello angosto + tapa roscada
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
      bodyMat
    );
    addLathePart(
      [
        [neckR + 1.5, xMouth + dir * (shoulderLen + 6)],
        [neckR + 2.1, xMouth + dir * (shoulderLen + 14)],
        [neckR + 1.5, xMouth + dir * (shoulderLen + 20)],
        [0.01, xMouth + dir * (shoulderLen + 20)],
      ],
      capMat
    );
  }

  return group;
}

/**
 * Construye un cabezal Mandril Sanou K11 realista con motor NEMA con aletas de enfriamiento,
 * plato torneado con ranuras, anillo indicador azul y 3 mordazas escalonadas con bisel CAD.
 */
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

  // Cuerpo motor NEMA + aletas de disipación + placa base
  const motorCore = new THREE.Mesh(new THREE.BoxGeometry(40, 58, 58), housingMat);
  motorCore.position.set(chuckX - 36, 0, 0);
  motorCore.castShadow = true;
  staticMotorGroup.add(motorCore);

  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(34, 62, 3), housingMat);
    fin.position.set(chuckX - 36, 0, i * 11);
    staticMotorGroup.add(fin);
  }

  // Brida trasera del eje
  const spindleNeck = new THREE.Mesh(
    new THREE.CylinderGeometry(24, 24, 16, 36),
    steelMat
  );
  spindleNeck.rotation.z = -Math.PI / 2;
  spindleNeck.position.set(chuckX - 14, 0, 0);
  rotatingChuckGroup.add(spindleNeck);

  // Plato Sanou torneado con perfil escalonado LatheGeometry
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

  // Anillo cian de seguridad en el frente del plato
  const ring = new THREE.Mesh(new THREE.TorusGeometry(44.5, 1.7, 12, 64), accentMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(chuckX + 12.4, 0, 0);
  rotatingChuckGroup.add(ring);

  // Perfil CNC extruido de mordaza escalonada de 3 niveles con bisel
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

/**
 * Construye un soporte regulable articulado (contrapunta / nivelador con tornillo de bronce y ruedas)
 * debajo del extremo angosto en piezas cónicas.
 */
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

  // Perilla moleteada ámbar de altura Z
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 5, 24), brassMat);
  knob.position.set(xPos, bedY + 12, 0);
  g.add(knob);

  // Cuna en V con doble ruedita apoyando el cono
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

/**
 * Construye el cabezal láser CO2 de la Vank 9060 con bloque de espejo superior,
 * tubo porta-lente, tuerca de bronce, boquilla cónica azul anodizada y conector de aire.
 */
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

  // Carro lineal y bloque espejo #3 arriba
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(28, 18, 26), bodyMat);
  carriage.castShadow = true;
  headGroup.add(carriage);

  const mirrorCube = new THREE.Mesh(new THREE.BoxGeometry(18, 16, 18), blueAnodizedMat);
  mirrorCube.position.set(0, -1, 16);
  mirrorCube.castShadow = true;
  headGroup.add(mirrorCube);

  // Tubo porta-lente vertical
  const lensBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(9.2, 9.2, 14, 28),
    blueAnodizedMat
  );
  lensBarrel.position.y = -14;
  lensBarrel.castShadow = true;
  headGroup.add(lensBarrel);

  // Anillo moleteado de ajuste en bronce
  const brassCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(10.8, 10.8, 4.5, 28),
    brassMat
  );
  brassCollar.position.y = -21;
  headGroup.add(brassCollar);

  // Boquilla cónica azul anodizada
  const nozzle = new THREE.Mesh(
    new THREE.ConeGeometry(8.8, 19, 28),
    blueAnodizedMat
  );
  nozzle.rotation.x = Math.PI;
  nozzle.position.y = -32;
  nozzle.castShadow = true;
  headGroup.add(nozzle);

  // Racor lateral para aire comprimido (Air Assist)
  const airFitting = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 8, 12),
    brassMat
  );
  airFitting.rotation.z = Math.PI / 2;
  airFitting.position.set(10, -28, 0);
  headGroup.add(airFitting);

  // Haz rojo + resplandor focal aditivo en la punta
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
