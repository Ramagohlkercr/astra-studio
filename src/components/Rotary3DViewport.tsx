import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotaryConfig, RotaryLayout, RotaryPhysicalSetupInfo, isTapered } from '../core/rotary/rotaryEngine';
import {
  buildRotaryWrappedCanvasTexture,
  canUseWebGL,
  createBrushedMetalTexture,
  createLaserGlowTexture,
  createStudioEnvironment,
  createStudioRenderer,
  disposeObject3D,
} from '../core/three/threeUtils';

type CameraPreset = 'iso' | 'front' | 'top' | 'chuck';
type VesselFinish = 'powder_black' | 'stainless' | 'navy_coat' | 'wood';

const VESSEL_FINISHES: Record<
  VesselFinish,
  { label: string; color: string; metalness: number; roughness: number; markHex: string; markEmissive: string }
> = {
  powder_black: {
    label: 'Negro Mate',
    color: '#1b2029',
    metalness: 0.28,
    roughness: 0.62,
    markHex: '#f1f5f9',
    markEmissive: '#94a3b8',
  },
  stainless: {
    label: 'Acero Inox',
    color: '#94a3b8',
    metalness: 0.88,
    roughness: 0.24,
    markHex: '#0f172a',
    markEmissive: '#000000',
  },
  navy_coat: {
    label: 'Azul Termo',
    color: '#0f3954',
    metalness: 0.32,
    roughness: 0.55,
    markHex: '#f8fafc',
    markEmissive: '#cbd5e1',
  },
  wood: {
    label: 'Madera',
    color: '#8f5f36',
    metalness: 0.05,
    roughness: 0.78,
    markHex: '#1f0f05',
    markEmissive: '#000000',
  },
};

interface Props {
  config: RotaryConfig;
  layout: RotaryLayout;
  physicalSetup: RotaryPhysicalSetupInfo;
  svgRaw: string | null;
  previewRotationDeg: number;
  fallbackSvgContent?: React.ReactNode;
}

export const Rotary3DViewport: React.FC<Props> = ({
  config,
  layout,
  physicalSetup,
  svgRaw,
  previewRotationDeg,
  fallbackSvgContent,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const assemblyGroupRef = useRef<THREE.Group | null>(null);
  const spindleGroupRef = useRef<THREE.Group | null>(null);
  const rollersGroupRef = useRef<THREE.Mesh[]>([]);
  const previewAngleRef = useRef<number>(previewRotationDeg);

  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [vesselFinish, setVesselFinish] = useState<VesselFinish>('powder_black');
  const [webglReady, setWebglReady] = useState<boolean>(() => canUseWebGL());

  const finish = VESSEL_FINISHES[vesselFinish];

  // Adaptar color del trazado SVG desenrollado al contraste real sobre el acabado seleccionado
  const etchedSvgFor3D = useMemo(() => {
    if (!svgRaw) return null;
    return svgRaw
      .replace(/#000000/gi, finish.markHex)
      .replace(/#000\b/gi, finish.markHex);
  }, [svgRaw, finish.markHex]);

  const dims = useMemo(() => {
    const len = Math.max(20, Math.min(900, config.usefulLengthMm || 120));
    const d0 = Math.max(5, Math.min(300, config.objectDiameterMm || 80));
    const d1 = isTapered(config)
      ? Math.max(5, Math.min(300, config.endDiameterMm || d0))
      : d0;
    const r0 = d0 / 2;
    const r1 = d1 / 2;
    const alphaRad = isTapered(config) ? Math.atan2(r0 - r1, len) : 0;
    return { len, d0, d1, r0, r1, alphaRad };
  }, [config]);

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;

    const maxExtent = Math.max(dims.len, dims.d0, dims.d1, 90);
    const aspectPad = Math.max(1, 1.55 / Math.max(0.75, cam.aspect));
    if (preset === 'iso') {
      cam.position.set(
        -maxExtent * 0.72 * aspectPad,
        maxExtent * 0.78 * aspectPad,
        maxExtent * 1.62 * aspectPad
      );
      ctrls.target.set(-dims.len * 0.06, 6, 0);
    } else if (preset === 'front') {
      cam.position.set(0, 14, maxExtent * 1.78 * aspectPad);
      ctrls.target.set(-dims.len * 0.04, 6, 0);
    } else if (preset === 'top') {
      cam.position.set(0, maxExtent * 1.95 * aspectPad, 16);
      ctrls.target.set(-dims.len * 0.04, 0, 0);
    } else {
      cam.position.set(-dims.len * 0.95, dims.r0 * 1.15, maxExtent * 1.12);
      ctrls.target.set(-dims.len * 0.42, 0, 0);
    }
    ctrls.update();
    if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cam);
    }
  };

  // 1. Inicializar WebGLRenderer + RoomEnvironment PBR + iluminación de estudio 3 puntos + OrbitControls
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canUseWebGL()) {
      setWebglReady(false);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createStudioRenderer(el, el.clientWidth || 560, el.clientHeight || 220);
    } catch {
      setWebglReady(false);
      return;
    }

    const studioEnv = createStudioEnvironment(renderer);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b12');
    scene.fog = new THREE.FogExp2('#070b12', 0.00055);
    scene.environment = studioEnv.envMap;
    scene.environmentIntensity = 0.85;

    const camera = new THREE.PerspectiveCamera(
      35,
      (el.clientWidth || 560) / Math.max(1, el.clientHeight || 220),
      1,
      4000
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 1200;

    // Rig de iluminación cinematográfica de taller CAD/CAM
    const hemi = new THREE.HemisphereLight('#dbeafe', '#0f172a', 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fffbeb', 2.05);
    keyLight.position.set(140, 260, 190);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 900;
    keyLight.shadow.camera.left = -220;
    keyLight.shadow.camera.right = 220;
    keyLight.shadow.camera.top = 200;
    keyLight.shadow.camera.bottom = -200;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    // Luz de recorte cian desde atrás para definir cilindros y mordazas
    const rimLight = new THREE.DirectionalLight('#38bdf8', 1.4);
    rimLight.position.set(-200, 95, -170);
    scene.add(rimLight);

    // Luz cálida inferior sutil para lectura de mordazas y calzo Z
    const bounceLight = new THREE.PointLight('#fbbf24', 0.65, 520, 1.4);
    bounceLight.position.set(0, -110, 110);
    scene.add(bounceLight);

    const assemblyRoot = new THREE.Group();
    scene.add(assemblyRoot);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    assemblyGroupRef.current = assemblyRoot;

    let rafId = 0;
    const animate = () => {
      rafId = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const entry of entries) {
              const w = Math.max(1, Math.round(entry.contentRect.width));
              const h = Math.max(1, Math.round(entry.contentRect.height));
              camera.aspect = w / h;
              camera.updateProjectionMatrix();
              renderer.setSize(w, h);
            }
          })
        : null;
    ro?.observe(el);

    setWebglReady(true);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      disposeObject3D(assemblyRoot);
      studioEnv.dispose();
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      assemblyGroupRef.current = null;
    };
  }, []);

  // 2. Reconstruir geometría CAD PBR del mandril Sanou / rodillos, vaso/termo cónico y textura UV 1:1 mm
  useEffect(() => {
    const root = assemblyGroupRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!root || !renderer || !scene || !camera) return;

    disposeObject3D(root);
    root.clear();
    rollersGroupRef.current = [];

    const { len, r0, r1, alphaRad } = dims;
    const focusY = Math.max(r0, r1) + 14;

    // Piso receptor de sombras + grilla sutil de la mesa Vank
    const bedY = -Math.max(r0, r1) - 36;
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760),
      new THREE.ShadowMaterial({ opacity: 0.48 })
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = bedY + 0.1;
    shadowFloor.receiveShadow = true;
    root.add(shadowFloor);

    const grid = new THREE.GridHelper(520, 26, '#1e3a5f', '#0f172a');
    grid.position.y = bedY;
    root.add(grid);

    // Línea láser verde de generatriz nivelada a foco constante
    const focusLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len * 0.72, focusY, 0),
      new THREE.Vector3(len * 0.72, focusY, 0),
    ]);
    const focusLineMat = new THREE.LineBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.78,
    });
    root.add(new THREE.Line(focusLineGeo, focusLineMat));

    // Cabezal Láser Vank 9060 con boquilla azul anodizada, collar de bronce y flare rojo aditivo
    const headX = Math.max(-len * 0.45, Math.min(len * 0.45, config.axisOffsetMm || 0));
    const headGroup = new THREE.Group();
    headGroup.position.set(headX, focusY + 42, 0);

    const carriageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(26, 18, 24),
      new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.75, roughness: 0.3 })
    );
    carriageMesh.castShadow = true;
    headGroup.add(carriageMesh);

    const brassCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 9.5, 5, 24),
      new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 0.9, roughness: 0.22 })
    );
    brassCollar.position.y = -11;
    headGroup.add(brassCollar);

    const nozzleMesh = new THREE.Mesh(
      new THREE.ConeGeometry(8.5, 21, 28),
      new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.82, roughness: 0.22 })
    );
    nozzleMesh.rotation.x = Math.PI;
    nozzleMesh.position.y = -21;
    nozzleMesh.castShadow = true;
    headGroup.add(nozzleMesh);

    // Haz rojo + punto focal brillante
    const beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.85, 11.5, 16),
      new THREE.MeshBasicMaterial({
        color: '#ef4444',
        transparent: true,
        opacity: 0.9,
      })
    );
    beamMesh.position.y = -36.5;
    headGroup.add(beamMesh);

    const glowTex = createLaserGlowTexture();
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
    flareSprite.position.y = -42;
    headGroup.add(flareSprite);
    root.add(headGroup);

    // Marco inclinado para nivelación trigonométrica de conos
    const axisFrame = new THREE.Group();
    const centerY = focusY - r0 - (len / 2) * Math.sin(alphaRad);
    axisFrame.position.set(0, centerY, 0);
    axisFrame.rotation.z = alphaRad;
    root.add(axisFrame);

    // Grupo rotatorio principal
    const spindle = new THREE.Group();
    spindle.rotation.x = (previewAngleRef.current * Math.PI) / 180;
    spindleGroupRef.current = spindle;
    axisFrame.add(spindle);

    const brushedTex = createBrushedMetalTexture();

    if (config.rotaryType === 'chuck') {
      const chuckX = -len / 2 - 22;

      const motorBody = new THREE.Mesh(
        new THREE.BoxGeometry(38, 62, 62),
        new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.65, roughness: 0.45 })
      );
      motorBody.position.set(chuckX - 33, 0, 0);
      motorBody.castShadow = true;
      axisFrame.add(motorBody);

      // Plato Sanou K11 torneado metálico con reflejos reales RoomEnvironment
      const chuckPlato = new THREE.Mesh(
        new THREE.CylinderGeometry(45, 45, 24, 64),
        new THREE.MeshStandardMaterial({
          color: '#94a3b8',
          metalness: 0.92,
          roughness: 0.22,
          roughnessMap: brushedTex,
        })
      );
      chuckPlato.rotation.z = -Math.PI / 2;
      chuckPlato.position.set(chuckX, 0, 0);
      chuckPlato.castShadow = true;
      spindle.add(chuckPlato);

      const chuckRing = new THREE.Mesh(
        new THREE.TorusGeometry(44.2, 1.9, 14, 64),
        new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.85, roughness: 0.25 })
      );
      chuckRing.rotation.y = Math.PI / 2;
      chuckRing.position.set(chuckX + 12.2, 0, 0);
      spindle.add(chuckRing);

      // 3 Mordazas escalonadas de acero mecanizado separadas 120°
      const jawRadial = Math.max(14, r0 + 4);
      const jawMat = new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        metalness: 0.92,
        roughness: 0.2,
      });
      for (const deg of [0, 120, 240]) {
        const rad = (deg * Math.PI) / 180;
        const jawHolder = new THREE.Group();
        jawHolder.rotation.x = rad;

        const baseJaw = new THREE.Mesh(new THREE.BoxGeometry(18, 15, 11), jawMat);
        baseJaw.position.set(chuckX + 18, jawRadial + 4, 0);
        baseJaw.castShadow = true;
        jawHolder.add(baseJaw);

        const gripStep = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 9), jawMat);
        gripStep.position.set(chuckX + 26, jawRadial - 1.5, 0);
        gripStep.castShadow = true;
        jawHolder.add(gripStep);

        spindle.add(jawHolder);
      }
    } else {
      const rollerR = Math.max(8, (config.rollerDiameterMm ?? 18) / 2);
      const rollerOffsetZ = Math.max(rollerR + 8, r0 * 0.62);
      for (const zSign of [-1, 1]) {
        const roller = new THREE.Mesh(
          new THREE.CylinderGeometry(rollerR, rollerR, len + 20, 40),
          new THREE.MeshStandardMaterial({
            color: '#0ea5e9',
            metalness: 0.72,
            roughness: 0.35,
            roughnessMap: brushedTex,
          })
        );
        roller.rotation.z = -Math.PI / 2;
        roller.position.set(0, -r0 - rollerR, zSign * rollerOffsetZ);
        roller.castShadow = true;
        axisFrame.add(roller);
        rollersGroupRef.current.push(roller);
      }
    }

    // Cuerpo del vaso / termo con el acabado elegido y reflejos PBR
    const vesselGeo = new THREE.CylinderGeometry(r1, r0, len, 80, 1, false);
    const vesselMat = new THREE.MeshStandardMaterial({
      color: finish.color,
      metalness: finish.metalness,
      roughness: finish.roughness,
      roughnessMap: brushedTex.clone(),
    });
    const vesselMesh = new THREE.Mesh(vesselGeo, vesselMat);
    vesselMesh.rotation.z = -Math.PI / 2;
    vesselMesh.castShadow = true;
    vesselMesh.receiveShadow = true;
    spindle.add(vesselMesh);

    // Aro inoxidable en el labio superior (boca/base)
    const rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(r1, 1.4, 14, 72),
      new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.95, roughness: 0.14 })
    );
    rimMesh.rotation.y = Math.PI / 2;
    rimMesh.position.set(len / 2, 0, 0);
    spindle.add(rimMesh);

    // Malla UV con el grabado láser 1:1 mm sobre la pared
    const arcRad = ((Math.min(360, Math.max(1, config.arcDeg || 360))) * Math.PI) / 180;
    const texture = buildRotaryWrappedCanvasTexture(
      etchedSvgFor3D,
      layout.canvasWidthMm,
      layout.canvasHeightMm,
      () => renderer.render(scene, camera)
    );
    const wrapGeo = new THREE.CylinderGeometry(
      r1 + 0.35,
      r0 + 0.35,
      len,
      80,
      1,
      true,
      -Math.PI / 2,
      arcRad
    );
    const wrapMat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.25,
      metalness: 0.85,
      emissive: finish.markEmissive,
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    });
    const wrapMesh = new THREE.Mesh(wrapGeo, wrapMat);
    wrapMesh.rotation.z = -Math.PI / 2;
    spindle.add(wrapMesh);

    // Línea de costura amarilla Y = 0°
    const seamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len / 2, r0 + 0.7, 0),
      new THREE.Vector3(len / 2, r1 + 0.7, 0),
    ]);
    const seamMat = new THREE.LineBasicMaterial({ color: '#fbbf24' });
    spindle.add(new THREE.Line(seamGeo, seamMat));

    // Soporte de nivelación Z en conos
    if (layout.tapered && physicalSetup.tailstockLiftMm > 0) {
      const wedgeH = Math.max(6, physicalSetup.tailstockLiftMm);
      const wedgeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(24, wedgeH, 36),
        new THREE.MeshStandardMaterial({
          color: '#f59e0b',
          metalness: 0.4,
          roughness: 0.35,
          transparent: true,
          opacity: 0.82,
        })
      );
      const liftX = physicalSetup.endToLift === 'end' ? len / 2 - 12 : -len / 2 + 12;
      const liftR = physicalSetup.endToLift === 'end' ? r1 : r0;
      wedgeMesh.position.set(liftX, focusY - liftR - wedgeH / 2 - 22, 0);
      wedgeMesh.castShadow = true;
      root.add(wedgeMesh);
    }

    if (camera.position.lengthSq() < 1) {
      applyCameraPreset(cameraPreset);
    } else {
      renderer.render(scene, camera);
    }
  }, [
    dims,
    finish,
    config.rotaryType,
    config.rollerDiameterMm,
    config.arcDeg,
    config.axisOffsetMm,
    etchedSvgFor3D,
    layout.canvasWidthMm,
    layout.canvasHeightMm,
    layout.tapered,
    physicalSetup.tailstockLiftMm,
    physicalSetup.endToLift,
  ]);

  // 3. Giro en tiempo real del husillo sin reconstruir la escena
  useEffect(() => {
    previewAngleRef.current = previewRotationDeg;
    const rad = (previewRotationDeg * Math.PI) / 180;
    if (spindleGroupRef.current) {
      spindleGroupRef.current.rotation.x = rad;
    }
    for (const r of rollersGroupRef.current) {
      r.rotation.x = -rad * 2.2;
    }
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [previewRotationDeg]);

  useEffect(() => {
    if (webglReady) {
      applyCameraPreset(cameraPreset);
    }
  }, [dims.len, dims.d0, dims.d1, webglReady]);

  if (!webglReady) {
    return <>{fallbackSvgContent}</>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Barra superior compacta sin superposiciones: Cámaras + Acabado PBR */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 bg-slate-950/90 border border-slate-800 px-2 py-1 rounded-lg text-[10px]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-cyan-300 font-bold mr-0.5">Cámara:</span>
          {(
            [
              { id: 'iso', label: 'Isométrica' },
              { id: 'front', label: 'Frontal' },
              { id: 'top', label: 'Superior Z' },
              { id: 'chuck', label: 'Mandril' },
            ] as const
          ).map((camOpt) => (
            <button
              key={camOpt.id}
              type="button"
              onClick={() => applyCameraPreset(camOpt.id)}
              className={`px-1.5 py-0.5 rounded font-semibold transition ${
                cameraPreset === camOpt.id
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {camOpt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(Object.keys(VESSEL_FINISHES) as VesselFinish[]).map((key) => {
            const item = VESSEL_FINISHES[key];
            const active = vesselFinish === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setVesselFinish(key)}
                title={`Acabado visual: ${item.label}`}
                className={`px-1.5 py-0.5 rounded font-medium flex items-center gap-1 transition ${
                  active
                    ? 'bg-slate-800 text-white border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full border border-white/30"
                  style={{ backgroundColor: item.color }}
                />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative w-full h-56 bg-[#070b12] rounded-lg border border-slate-800/90 overflow-hidden shadow-inner">
        <div
          ref={containerRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          aria-label="Visor 3D WebGL Mandril Sanou y Objeto Rotativo"
        />

        {/* Leyenda técnica en vivo */}
        <div className="absolute bottom-2 left-2 right-2 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
          <span className="bg-slate-950/80 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
            🖱 Arrastrar: Orbitar 3D · Rueda: Zoom
          </span>
          {layout.tapered && (
            <span className="bg-amber-950/85 border border-amber-600/60 px-2 py-0.5 rounded text-amber-300 font-bold">
              ▲ Suplementar +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
