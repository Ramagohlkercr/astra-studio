import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { ClosedContour } from '../types';
import {
  createChiseledVirolaBumpTexture,
  createHammeredCoatPbrTextures,
  createLeatherPbrTextures,
  createWoodPbrTextures,
  ProceduralPbrTextures,
} from './materialTextures';

export type RotaryVesselShape = 'auto' | 'tumbler' | 'thermos' | 'mate' | 'bottle' | 'can';
export type RotarySurfaceMaterialKind =
  | 'auto'
  | 'hammered_green'
  | 'powder_black'
  | 'navy_coat'
  | 'leather'
  | 'stainless'
  | 'wood'
  | 'glass'
  | 'emerald_glass';

export interface ResolvedProductAppearance {
  shape: Exclude<RotaryVesselShape, 'auto'>;
  surface: Exclude<RotarySurfaceMaterialKind, 'auto'>;
  color: string;
  metalness: number;
  roughness: number;
  markHex: string;
  markEmissive: string;
  engraveIsAblatedMetal: boolean;
  compositionLabel: string;
}

const csgEvaluator = new Evaluator();
csgEvaluator.useGroups = false;

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
  if (presetId === 'lata') return 'can';
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
 * Resuelve la composición material real de cada producto según su naturaleza física.
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
  } else if (presetId === 'botella') {
    surface = 'emerald_glass';
  } else if (presetId === 'termo' || presetId === 'lata' || shape === 'can') {
    surface = 'stainless';
  } else if (shape === 'mate') {
    surface = 'leather';
  } else if (shape === 'thermos') {
    surface = 'hammered_green';
  } else if (shape === 'bottle') {
    surface = 'emerald_glass';
  } else {
    surface = 'powder_black';
  }

  switch (surface) {
    case 'hammered_green':
      return {
        shape,
        surface,
        color: '#1f4b34',
        metalness: 0.44,
        roughness: 0.46,
        markHex: '#f1f5f9',
        markEmissive: '#94a3b8',
        engraveIsAblatedMetal: true,
        compositionLabel: 'Acero Inox 18/8 · Pintura Martillada',
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
        compositionLabel: 'Acero Bicapa · Powder Coat Azul',
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
        compositionLabel:
          shape === 'mate'
            ? 'Calabaza + Cuero Vacuno + Virola Alpaca'
            : 'Cuero Vacuno Cosido',
      };
    case 'stainless':
      return {
        shape,
        surface,
        color: shape === 'can' ? '#cdd5df' : '#9ca8b8',
        metalness: shape === 'can' ? 0.96 : 0.9,
        roughness: shape === 'can' ? 0.16 : 0.22,
        markHex: '#0f172a',
        markEmissive: '#000000',
        engraveIsAblatedMetal: false,
        compositionLabel:
          shape === 'can' ? 'Aluminio Cepillado' : 'Acero Inoxidable 304',
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
        compositionLabel: 'Madera Natural Torneada',
      };
    case 'emerald_glass':
      return {
        shape,
        surface,
        color: '#14532d',
        metalness: 0.06,
        roughness: 0.07,
        markHex: '#ecfdf5',
        markEmissive: '#d1fae5',
        engraveIsAblatedMetal: false,
        compositionLabel: 'Vidrio Esmeralda + Corcho + Cápsula',
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
        compositionLabel: 'Vidrio Cristal Soda-Cálcico',
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
        compositionLabel: 'Acero Inox 18/8 · Powder Coat + Tapa CSG',
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
  presetId?: string;
}

/**
 * Construye una tapa acrílica booleana real (ranura de sorbo + hueco de sorbete) usando three-bvh-csg.
 */
function buildTumblerCsgAcrylicLid(
  rMouth: number,
  xLidCenter: number,
  dir: number,
  lidMat: THREE.Material
): THREE.Mesh {
  const outerGeo = new THREE.CylinderGeometry(rMouth + 0.8, rMouth + 0.4, 5.5, 48);
  outerGeo.rotateZ(-Math.PI / 2);
  const lidBrush = new Brush(outerGeo);
  lidBrush.updateMatrixWorld();

  // Ranura ovalada de sorbo perforada en el borde superior de la tapa
  const sipCutGeo = new THREE.BoxGeometry(8, 5, 11);
  sipCutGeo.translate(0, rMouth * 0.64, 0);
  const sipBrush = new Brush(sipCutGeo);
  sipBrush.updateMatrixWorld();

  // Orificio circular central para sorbete térmico
  const strawGeo = new THREE.CylinderGeometry(3.8, 3.8, 8, 20);
  strawGeo.rotateZ(-Math.PI / 2);
  const strawBrush = new Brush(strawGeo);
  strawBrush.updateMatrixWorld();

  try {
    const afterSip = csgEvaluator.evaluate(lidBrush, sipBrush, SUBTRACTION);
    afterSip.updateMatrixWorld();
    const afterStraw = csgEvaluator.evaluate(afterSip, strawBrush, SUBTRACTION);
    outerGeo.dispose();
    sipCutGeo.dispose();
    strawGeo.dispose();
    afterSip.geometry.dispose();

    const mesh = new THREE.Mesh(afterStraw.geometry, lidMat);
    mesh.position.x = xLidCenter + dir * 2.7;
    return mesh;
  } catch {
    outerGeo.dispose();
    sipCutGeo.dispose();
    strawGeo.dispose();
    const fallback = new THREE.Mesh(
      new THREE.CylinderGeometry(rMouth + 0.8, rMouth + 0.4, 5.5, 48),
      lidMat
    );
    fallback.rotation.z = -Math.PI / 2;
    fallback.position.x = xLidCenter + dir * 2.7;
    return fallback;
  }
}

/**
 * Construye el modelo 3D fotorrealista multi-material de cada producto respetando su composición real.
 */
export function buildRotaryVesselGroup(params: VesselModelParams): THREE.Group {
  const { appearance, r0, r1, len, brushedTex, mouthAtLeft, presetId } = params;
  const { shape, surface, color, metalness, roughness } = appearance;
  const group = new THREE.Group();
  const isGlass = surface === 'glass' || surface === 'emerald_glass';

  let pbrTex: ProceduralPbrTextures | null = null;
  let bodyMat: THREE.Material;

  if (isGlass) {
    bodyMat = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.05,
      roughness: 0.06,
      transparent: true,
      opacity: surface === 'emerald_glass' ? 0.68 : 0.34,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      reflectivity: 0.96,
      ior: 1.52,
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
    mesh.castShadow = !isGlass;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // 1. Barril principal grabable exacto [-len/2 .. +len/2]
  if (isGlass) {
    // Vaso/botella de vidrio con espesor real hueco + base maciza pesada de vidrio
    const wallThick = Math.min(3.5, Math.max(2.2, Math.min(rBase, rMouth) * 0.08));
    addLathePart(
      [
        [0.01, xBase - dir * 5],
        [Math.max(4, rBase - 3), xBase - dir * 5],
        [rBase, xBase],
        [rMouth, xMouth],
        [rMouth - wallThick, xMouth],
        [Math.max(3, rBase - wallThick - 1.2), xBase + dir * 12],
        [0.01, xBase + dir * 12],
      ],
      bodyMat
    );
  } else {
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
  }

  // Talón / base inferior auténtico según composición
  if (!isGlass && surface !== 'leather') {
    addLathePart(
      [
        [0.01, xBase - dir * 5.5],
        [Math.max(4, rBase - 4.2), xBase - dir * 5.5],
        [rBase - 0.3, xBase - dir * 2.5],
        [rBase, xBase],
      ],
      stainlessMat
    );
  } else if (surface === 'leather') {
    // Base cosida de cuero curvado + 4 tiras/costuras longitudinales reales
    addLathePart(
      [
        [0.01, xBase - dir * 6],
        [Math.max(4, rBase - 7), xBase - dir * 5],
        [rBase - 1.5, xBase - dir * 2],
        [rBase, xBase],
      ],
      bodyMat
    );
    const ribMat = new THREE.MeshStandardMaterial({
      color: '#4a260f',
      metalness: 0.05,
      roughness: 0.85,
    });
    for (const deg of [45, 135, 225, 315]) {
      const rad = (deg * Math.PI) / 180;
      const midR = (r0 + r1) / 2;
      const rib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, len * 0.96, 8),
        ribMat
      );
      rib.rotation.z = -Math.PI / 2;
      rib.position.set(0, Math.cos(rad) * (midR + 0.15), Math.sin(rad) * (midR + 0.15));
      group.add(rib);
    }
  }

  // 2. Anatomía superior específica por producto
  if (shape === 'tumbler') {
    if (!isGlass) {
      const lipLen = Math.min(13, len * 0.11);
      const innerR = Math.max(4, rMouth - 3.5);
      addLathePart(
        [
          [rMouth, xMouth],
          [rMouth + 0.5, xMouth + dir * (lipLen * 0.65)],
          [rMouth - 0.4, xMouth + dir * lipLen],
          [innerR, xMouth + dir * lipLen],
          [innerR - 0.8, xMouth - dir * (len * 0.28)],
          [0.01, xMouth - dir * (len * 0.28)],
        ],
        stainlessMat
      );

      // Junta silicona negra + Tapa acrílica booleana CSG real (ranura sorbo + orificio sorbete)
      const gasket = new THREE.Mesh(
        new THREE.TorusGeometry(rMouth - 0.6, 1.4, 10, 56),
        capMat
      );
      gasket.rotation.y = Math.PI / 2;
      gasket.position.x = xMouth + dir * lipLen;
      group.add(gasket);

      const lidMat = new THREE.MeshPhysicalMaterial({
        color: '#334155',
        roughness: 0.12,
        metalness: 0.05,
        transparent: true,
        opacity: 0.52,
        clearcoat: 1,
        ior: 1.49,
      });
      group.add(buildTumblerCsgAcrylicLid(rMouth, xMouth + dir * lipLen, dir, lidMat));
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
        [neckR, xMouth + dir * (shoulderLen + 9)],
      ],
      stainlessMat
    );

    // Rosca helicoidal física real alrededor del cuello de acero inoxidable
    const threadPts: THREE.Vector3[] = [];
    const turns = 2.2;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const a = t * turns * Math.PI * 2;
      const ax = xMouth + dir * (shoulderLen + 1.5 + t * 6.5);
      threadPts.push(new THREE.Vector3(ax, Math.cos(a) * (neckR + 0.9), Math.sin(a) * (neckR + 0.9)));
    }
    const threadGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(threadPts), 48, 0.75, 8, false);
    group.add(new THREE.Mesh(threadGeo, stainlessMat));

    // Manija ergonómica lateral si corresponde al preset Termo Media Manija
    if (presetId === 'termo') {
      const handleCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xMouth - dir * 24, rMouth - 1, 0),
        new THREE.Vector3(xMouth - dir * 32, rMouth + 18, 0),
        new THREE.Vector3(xBase + dir * 32, rBase + 18, 0),
        new THREE.Vector3(xBase + dir * 24, rBase - 1, 0),
      ]);
      const handleMesh = new THREE.Mesh(
        new THREE.TubeGeometry(handleCurve, 28, 3.6, 12, false),
        capMat
      );
      handleMesh.castShadow = true;
      group.add(handleMesh);
    }

    // Tapón / vaso-tapa térmico oscuro con acanaladuras de agarre y aro superior inox
    addLathePart(
      [
        [neckR + 2.2, xMouth + dir * (shoulderLen + 5)],
        [neckR + 3.1, xMouth + dir * (shoulderLen + 12)],
        [neckR + 2.0, xMouth + dir * (shoulderLen + 15)],
        [neckR + 3.1, xMouth + dir * (shoulderLen + 20)],
        [neckR + 1.8, xMouth + dir * (shoulderLen + 29)],
        [neckR * 0.72, xMouth + dir * (shoulderLen + 31)],
        [0.01, xMouth + dir * (shoulderLen + 31)],
      ],
      capMat
    );
  } else if (shape === 'mate') {
    // Virola de alpaca/acero cincelada
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
      ],
      virolaMat
    );
    const collar = new THREE.Mesh(new THREE.TorusGeometry(rMouth + 0.9, 1.4, 12, 64), virolaMat);
    collar.rotation.y = Math.PI / 2;
    collar.position.x = xMouth;
    group.add(collar);

    // Interior real de calabaza natural curada / algarrobo hueco por LatheGeometry
    const gourdWood = createWoodPbrTextures('#5c381c', [2, 2]);
    const gourdMat = new THREE.MeshStandardMaterial({
      map: gourdWood.map,
      bumpMap: gourdWood.bumpMap,
      bumpScale: 1.1,
      roughnessMap: gourdWood.roughnessMap,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    addLathePart(
      [
        [innerR, xMouth + dir * virolaLen],
        [innerR + 2.5, xMouth + dir * 2],
        [innerR * 0.88, xBase + dir * 14],
        [0.01, xBase + dir * 10],
      ],
      gourdMat
    );
  } else if (shape === 'can') {
    // Lata 330 ml de aluminio con cuello cónico superior y anilla pull-tab
    const neckR = Math.max(10, rMouth * 0.84);
    addLathePart(
      [
        [rMouth, xMouth],
        [neckR, xMouth + dir * 10],
        [neckR + 0.8, xMouth + dir * 12],
        [neckR - 1.8, xMouth + dir * 12],
        [0.01, xMouth + dir * 10.5],
      ],
      stainlessMat
    );
    const pullTab = new THREE.Mesh(new THREE.TorusGeometry(5.5, 1.0, 8, 24), stainlessMat);
    pullTab.rotation.y = Math.PI / 2;
    pullTab.position.set(xMouth + dir * 11.4, neckR * 0.35, 0);
    group.add(pullTab);
  } else {
    // Botella (Vidrio Esmeralda con cápsula mate + corcho natural OR deportiva con argolla)
    const shoulderLen = Math.min(34, len * 0.22);
    const neckR = Math.max(10, rMouth * 0.4);
    addLathePart(
      [
        [rMouth, xMouth],
        [rMouth * 0.86, xMouth + dir * (shoulderLen * 0.3)],
        [neckR * 1.25, xMouth + dir * (shoulderLen * 0.7)],
        [neckR, xMouth + dir * shoulderLen],
        [neckR, xMouth + dir * (shoulderLen + 14)],
      ],
      bodyMat
    );
    if (isGlass) {
      // Cápsula metálica oscura + corcho de madera natural asomando
      const capsuleMat = new THREE.MeshStandardMaterial({
        color: '#1e1b24',
        metalness: 0.45,
        roughness: 0.42,
      });
      const corkTex = createWoodPbrTextures('#b58454', [2, 1]);
      const corkMat = new THREE.MeshStandardMaterial({
        map: corkTex.map,
        bumpMap: corkTex.bumpMap,
        bumpScale: 1.2,
        roughness: 0.9,
      });
      addLathePart(
        [
          [neckR + 1.1, xMouth + dir * (shoulderLen + 4)],
          [neckR + 1.2, xMouth + dir * (shoulderLen + 15)],
          [neckR - 1.5, xMouth + dir * (shoulderLen + 15)],
        ],
        capsuleMat
      );
      addLathePart(
        [
          [neckR - 1.6, xMouth + dir * (shoulderLen + 14)],
          [neckR - 1.6, xMouth + dir * (shoulderLen + 23)],
          [0.01, xMouth + dir * (shoulderLen + 23)],
        ],
        corkMat
      );
    } else {
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
  }

  return group;
}

/**
 * Extrude una etiqueta física biselada con sus agujeros C01 perforados realmente mediante three-bvh-csg (SUBTRACTION).
 */
export function buildPhysicalCutLabelGeometry(
  cutContour: ClosedContour,
  holeContours: ClosedContour[],
  thicknessMm: number
): THREE.BufferGeometry {
  const pts = cutContour.points;
  const shape = new THREE.Shape();
  if (pts.length >= 3) {
    // Centrar localmente respecto al centro del contorno para facilitar InstancedMesh
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    shape.moveTo(pts[0].x - cx, -(pts[0].y - cy));
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].x - cx, -(pts[i].y - cy));
    }
    shape.closePath();

    const baseGeo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.6, thicknessMm),
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.14,
      bevelSegments: 2,
    });
    baseGeo.rotateX(-Math.PI / 2);

    if (!holeContours?.length) return baseGeo;

    // Perforar cada orificio C01 mediante CSG booleano real
    let currentBrush = new Brush(baseGeo);
    currentBrush.updateMatrixWorld();
    const toDispose: THREE.BufferGeometry[] = [];

    for (const hole of holeContours) {
      if (!hole.points || hole.points.length < 3) continue;
      let hMinX = Infinity, hMaxX = -Infinity, hMinY = Infinity, hMaxY = -Infinity;
      for (const hp of hole.points) {
        if (hp.x < hMinX) hMinX = hp.x;
        if (hp.x > hMaxX) hMaxX = hp.x;
        if (hp.y < hMinY) hMinY = hp.y;
        if (hp.y > hMaxY) hMaxY = hp.y;
      }
      const hRadius = Math.max(0.35, Math.max(hMaxX - hMinX, hMaxY - hMinY) / 2);
      const hx = (hMinX + hMaxX) / 2 - cx;
      const hz = (hMinY + hMaxY) / 2 - cy;

      const drillGeo = new THREE.CylinderGeometry(hRadius, hRadius, thicknessMm + 4, 16);
      drillGeo.translate(hx, thicknessMm / 2, hz);
      const drillBrush = new Brush(drillGeo);
      drillBrush.updateMatrixWorld();

      try {
        const nextBrush = csgEvaluator.evaluate(currentBrush, drillBrush, SUBTRACTION);
        toDispose.push(currentBrush.geometry, drillGeo);
        currentBrush = nextBrush;
        currentBrush.updateMatrixWorld();
      } catch {
        drillGeo.dispose();
      }
    }

    for (const g of toDispose) g.dispose();
    return currentBrush.geometry;
  }

  return new THREE.BoxGeometry(10, Math.max(0.6, thicknessMm), 10);
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

  // Motor NEMA biselado con RoundedBoxGeometry
  const motorCore = new THREE.Mesh(
    new RoundedBoxGeometry(40, 58, 58, 3, 4),
    housingMat
  );
  motorCore.position.set(chuckX - 36, 0, 0);
  motorCore.castShadow = true;
  staticMotorGroup.add(motorCore);

  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(
      new RoundedBoxGeometry(34, 62, 3, 2, 0.8),
      housingMat
    );
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
  const platoMesh = new THREE.Mesh(new THREE.LatheGeometry(platoPts, 64), steelMat);
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
  const slotMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    metalness: 0.75,
    roughness: 0.5,
  });

  for (const deg of [0, 120, 240]) {
    const holder = new THREE.Group();
    holder.rotation.x = (deg * Math.PI) / 180;

    // Guía radial en la cara del plato Sanou
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 34, 4.8),
      slotMat
    );
    slot.position.set(chuckX + 11.4, 27, 0);
    holder.add(slot);

    const jaw = new THREE.Mesh(jawGeo, jawMat);
    jaw.position.set(chuckX + 11, jawClampRadius, 0);
    jaw.castShadow = true;
    holder.add(jaw);

    rotatingChuckGroup.add(holder);
  }

  // Tomas laterales de llave cuadrada Sanou en el cuerpo del mandril
  for (const deg of [60, 180, 300]) {
    const rad = (deg * Math.PI) / 180;
    const keySocket = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 3, 16),
      slotMat
    );
    keySocket.rotation.x = rad;
    keySocket.position.set(chuckX - 1, Math.cos(rad) * 46.2, Math.sin(rad) * 46.2);
    rotatingChuckGroup.add(keySocket);
  }

  return { staticMotorGroup, rotatingChuckGroup };
}

/**
 * Ensamblaje CNC realista para Rotativo de Rodillos Motrices (Roller):
 * riel de aluminio anodizado, motor NEMA lateral, poleas, correa dentada,
 * ejes de acero cepillado y anillos de goma antideslizante rotando en sincronía.
 */
export function buildRollerRotaryAssembly(
  r0: number,
  rollerR: number,
  len: number,
  rollerOffsetZ: number,
  brushedTex: THREE.Texture
): {
  staticBaseGroup: THREE.Group;
  rollersGroup: THREE.Mesh[];
} {
  const staticBaseGroup = new THREE.Group();
  const rollersGroup: THREE.Mesh[] = [];

  const frameMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    metalness: 0.78,
    roughness: 0.34,
  });
  const anodizedMat = new THREE.MeshStandardMaterial({
    color: '#0284c7',
    metalness: 0.84,
    roughness: 0.24,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    metalness: 0.9,
    roughness: 0.22,
    roughnessMap: brushedTex.clone(),
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    metalness: 0.05,
    roughness: 0.88,
  });

  const rollerLen = len + 26;
  const rollerY = -r0 - rollerR;
  const basePlateY = rollerY - rollerR - 8;

  // Base longitudinal de aluminio extruido con patines de goma
  const baseRail = new THREE.Mesh(
    new RoundedBoxGeometry(rollerLen + 36, 8, rollerOffsetZ * 2 + 28, 2, 2),
    frameMat
  );
  baseRail.position.set(0, basePlateY, 0);
  baseRail.castShadow = true;
  baseRail.receiveShadow = true;
  staticBaseGroup.add(baseRail);

  // Placas laterales de soporte con rodamientos
  for (const xSide of [-rollerLen / 2 - 4, rollerLen / 2 + 4]) {
    const endPlate = new THREE.Mesh(
      new RoundedBoxGeometry(7, rollerR * 2 + 12, rollerOffsetZ * 2 + 24, 2, 1.5),
      anodizedMat
    );
    endPlate.position.set(xSide, rollerY, 0);
    endPlate.castShadow = true;
    staticBaseGroup.add(endPlate);
  }

  // Motor NEMA + correa cerrada de transmisión en extremo izquierdo
  const motorX = -rollerLen / 2 - 22;
  const motorBody = new THREE.Mesh(
    new RoundedBoxGeometry(28, 32, 32, 2, 2.5),
    frameMat
  );
  motorBody.position.set(motorX, rollerY - 4, 0);
  motorBody.castShadow = true;
  staticBaseGroup.add(motorBody);

  const beltWidth = rollerOffsetZ * 2 + 6;
  const belt = new THREE.Mesh(
    new RoundedBoxGeometry(4, 14, beltWidth, 2, 3),
    rubberMat
  );
  belt.position.set(-rollerLen / 2 - 11, rollerY, 0);
  staticBaseGroup.add(belt);

  // Dos rodillos motrices de acero + bujes de goma antideslizante + polea dentada
  for (const zSign of [-1, 1]) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(rollerR * 0.72, rollerR * 0.72, rollerLen + 14, 32),
      steelMat
    );
    roller.rotation.z = -Math.PI / 2;
    roller.position.set(0, rollerY, zSign * rollerOffsetZ);
    roller.castShadow = true;

    // Aros de goma negra de agarre a lo largo del rodillo
    const ringCount = 5;
    for (let i = 0; i < ringCount; i++) {
      const rx = -rollerLen * 0.4 + (rollerLen * 0.8 * i) / (ringCount - 1);
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(rollerR, rollerR, 8, 32),
        rubberMat
      );
      grip.position.y = rx; // local Y = eje X mundial tras rotación Z -90°
      roller.add(grip);
    }

    // Polea de arrastre izquierda
    const pulley = new THREE.Mesh(
      new THREE.CylinderGeometry(rollerR + 2.5, rollerR + 2.5, 6, 24),
      anodizedMat
    );
    pulley.position.y = -rollerLen / 2 - 11;
    roller.add(pulley);

    staticBaseGroup.add(roller);
    rollersGroup.push(roller);
  }

  return { staticBaseGroup, rollersGroup };
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
  const basePlate = new THREE.Mesh(
    new RoundedBoxGeometry(28, 6, 42, 2, 1.5),
    baseMat
  );
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

  const cradle = new THREE.Mesh(
    new RoundedBoxGeometry(16, 6, 30, 2, 1.5),
    baseMat
  );
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

  const carriage = new THREE.Mesh(
    new RoundedBoxGeometry(28, 18, 26, 3, 2.5),
    bodyMat
  );
  carriage.castShadow = true;
  headGroup.add(carriage);

  const mirrorCube = new THREE.Mesh(
    new RoundedBoxGeometry(18, 16, 18, 2, 2),
    blueAnodizedMat
  );
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
      opacity: 0.95,
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
