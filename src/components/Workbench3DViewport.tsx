import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MaterialProfile } from '../core/types';
import {
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchSimulationResult,
} from '../core/workbench/workbenchTypes';
import {
  buildFlatLabelEngravedTextures,
  canUseWebGL,
  createBrushedMetalTexture,
  createHoneycombBedTexture,
  createLaserGlowTexture,
  createStudioEnvironment,
  createStudioRenderer,
  disposeObject3D,
} from '../core/three/threeUtils';

type Workbench3DCam = 'iso' | 'front' | 'top';

interface Props {
  config: WorkbenchConfig;
  jobs: WorkbenchJobItem[];
  selectedJobId: string | null;
  material: MaterialProfile;
  simulation: WorkbenchSimulationResult;
  simProgress: number;
  showSimulation: boolean;
}

export const Workbench3DViewport: React.FC<Props> = ({
  config,
  jobs,
  selectedJobId,
  material,
  simulation,
  simProgress,
  showSimulation,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const worldGroupRef = useRef<THREE.Group | null>(null);
  const gantryRef = useRef<THREE.Group | null>(null);
  const headRef = useRef<THREE.Group | null>(null);
  const flareRef = useRef<THREE.Sprite | null>(null);
  const userMovedCameraRef = useRef<boolean>(false);

  const [cameraPreset, setCameraPreset] = useState<Workbench3DCam>('iso');
  const [webglReady, setWebglReady] = useState<boolean>(() => canUseWebGL());

  const bedW = Math.max(200, config.machineBedWidthMm || 900);
  const bedH = Math.max(200, config.machineBedHeightMm || 600);

  const laserPos = useMemo(() => {
    const segs = simulation.segments;
    if (showSimulation && segs.length > 0) {
      const idx = Math.min(
        segs.length - 1,
        Math.max(0, Math.floor(((simProgress || 0) / 100) * (segs.length - 1)))
      );
      const seg = segs[idx];
      return { x: seg.toX, y: seg.toY, firing: seg.kind !== 'rapid_move' };
    }
    return {
      x: Math.min(bedW, Math.max(0, config.userOriginXMm ?? bedW)),
      y: Math.min(bedH, Math.max(0, config.userOriginYMm ?? 0)),
      firing: false,
    };
  }, [
    simulation.segments,
    showSimulation,
    simProgress,
    bedW,
    bedH,
    config.userOriginXMm,
    config.userOriginYMm,
  ]);

  const applyPreset = (preset: Workbench3DCam) => {
    setCameraPreset(preset);
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;

    const aspectPad = Math.max(1, 1.45 / Math.max(0.7, cam.aspect));
    if (preset === 'iso') {
      cam.position.set(
        -bedW * 0.56 * aspectPad,
        bedH * 1.32 * aspectPad,
        bedH * 1.72 * aspectPad
      );
      ctrls.target.set(0, 0, 0);
    } else if (preset === 'front') {
      cam.position.set(0, bedH * 0.48 * aspectPad, bedH * 1.88 * aspectPad);
      ctrls.target.set(0, 0, 0);
    } else {
      cam.position.set(0, Math.max(bedW, bedH) * 1.38 * aspectPad, 25);
      ctrls.target.set(0, 0, 0);
    }
    ctrls.update();
    if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cam);
    }
  };

  // 1. Inicializar WebGLRenderer + RoomEnvironment PBR + iluminación con sombras reales + OrbitControls
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canUseWebGL()) {
      setWebglReady(false);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createStudioRenderer(el, el.clientWidth || 720, el.clientHeight || 420);
    } catch {
      setWebglReady(false);
      return;
    }

    const studioEnv = createStudioEnvironment(renderer);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#06090f');
    scene.fog = new THREE.FogExp2('#06090f', 0.00022);
    scene.environment = studioEnv.envMap;
    scene.environmentIntensity = 0.88;

    const camera = new THREE.PerspectiveCamera(
      37,
      (el.clientWidth || 720) / Math.max(1, el.clientHeight || 420),
      1,
      5000
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 90;
    controls.maxDistance = 2600;
    const onControlStart = () => {
      userMovedCameraRef.current = true;
    };
    controls.addEventListener('start', onControlStart);

    // Rig de iluminación de taller láser CO2 (luz principal cálida con sombras + recorte cian lateral)
    const hemi = new THREE.HemisphereLight('#e0f2fe', '#0f172a', 0.82);
    scene.add(hemi);

    const key = new THREE.DirectionalLight('#fffbeb', 1.95);
    key.position.set(380, 680, 440);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 60;
    key.shadow.camera.far = 2200;
    key.shadow.camera.left = -620;
    key.shadow.camera.right = 620;
    key.shadow.camera.top = 520;
    key.shadow.camera.bottom = -520;
    key.shadow.bias = -0.0005;
    scene.add(key);

    const rim = new THREE.DirectionalLight('#38bdf8', 1.15);
    rim.position.set(-480, 280, -340);
    scene.add(rim);

    const worldRoot = new THREE.Group();
    scene.add(worldRoot);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    worldGroupRef.current = worldRoot;

    let rafId = 0;
    const loop = () => {
      rafId = window.requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const entry of entries) {
              const w = Math.max(1, Math.round(entry.contentRect.width));
              const h = Math.max(1, Math.round(entry.contentRect.height));
              camera.aspect = w / h;
              camera.updateProjectionMatrix();
              renderer.setSize(w, h);
              if (!userMovedCameraRef.current) {
                const aspectPad = Math.max(1, 1.45 / Math.max(0.7, camera.aspect));
                camera.position.set(
                  -bedW * 0.56 * aspectPad,
                  bedH * 1.32 * aspectPad,
                  bedH * 1.72 * aspectPad
                );
                controls.target.set(0, 0, 0);
                controls.update();
              }
            }
          })
        : null;
    ro?.observe(el);

    setWebglReady(true);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      controls.removeEventListener('start', onControlStart);
      disposeObject3D(worldRoot);
      studioEnv.dispose();
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      worldGroupRef.current = null;
    };
  }, []);

  // 2. Reconstruir mesa 900x600 mm alveolar, rieles Y, plancha con relieve, piezas anidadas y pórtico láser
  useEffect(() => {
    const root = worldGroupRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!root || !renderer || !scene || !camera) return;

    disposeObject3D(root);
    root.clear();

    const toWorldX = (xMm: number) => xMm - bedW / 2;
    const toWorldZ = (yMm: number) => yMm - bedH / 2;

    const brushedTex = createBrushedMetalTexture();
    const honeycombTex = createHoneycombBedTexture();

    // Chasis metálico Vank 9060 con reflejos PBR
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(bedW + 56, 22, bedH + 56),
      new THREE.MeshStandardMaterial({
        color: '#111827',
        metalness: 0.82,
        roughness: 0.34,
        roughnessMap: brushedTex,
      })
    );
    chassis.position.set(0, -13, 0);
    chassis.receiveShadow = true;
    root.add(chassis);

    // Marco azul/cian anodizado del gabinete superior
    const trimFrame = new THREE.Mesh(
      new THREE.BoxGeometry(bedW + 60, 4, bedH + 60),
      new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.78, roughness: 0.28 })
    );
    trimFrame.position.set(0, -1.8, 0);
    root.add(trimFrame);

    // Rieles lineales laterales Y izquierdo y derecho
    const railMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      metalness: 0.9,
      roughness: 0.2,
    });
    for (const sideSign of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(10, 10, bedH + 24), railMat);
      rail.position.set(sideSign * (bedW / 2 + 16), 8, 0);
      rail.castShadow = true;
      root.add(rail);
    }

    // Cama alveolar 900x600 mm con textura procedural
    const honeycomb = new THREE.Mesh(
      new THREE.BoxGeometry(bedW, 3, bedH),
      new THREE.MeshStandardMaterial({
        map: honeycombTex,
        metalness: 0.45,
        roughness: 0.7,
      })
    );
    honeycomb.position.set(0, -1.2, 0);
    honeycomb.receiveShadow = true;
    root.add(honeycomb);

    // Plancha / rollo del material activo recibiendo sombras del pórtico
    const sheetW = Math.min(bedW, Math.max(20, config.sheetWidthMm || 730));
    const sheetH = Math.min(bedH, Math.max(20, config.sheetHeightMm || 600));
    const matThickness = Math.max(1.4, Math.min(8, material.thicknessMm || 1.8));
    const sheetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(sheetW, matThickness, sheetH),
      new THREE.MeshStandardMaterial({
        color: material.visual.surfaceColor || '#92542b',
        roughness: 0.68,
        metalness: 0.08,
      })
    );
    sheetMesh.position.set(
      toWorldX(sheetW / 2),
      matThickness / 2 + 0.3,
      toWorldZ(sheetH / 2)
    );
    sheetMesh.receiveShadow = true;
    sheetMesh.castShadow = true;
    root.add(sheetMesh);

    const topSurfaceY = matThickness + 0.55;

    const cutLineMat = new THREE.LineBasicMaterial({ color: '#ef4444' });
    const holeMat = new THREE.LineBasicMaterial({ color: '#3b82f6' });
    const activeBorderMat = new THREE.LineBasicMaterial({ color: '#22d3ee' });
    const jobTextureDisposers: Array<() => void> = [];

    for (const job of jobs) {
      if (!job.visible) continue;
      const isSelected = job.id === selectedJobId;

      // Compilar textura PBR real (color láser quemado + bajorrelieve bumpMap) 1 sola vez por trabajo
      const labelMaps = buildFlatLabelEngravedTextures(
        job.labelDesign,
        material.visual.engraveColor || '#261408',
        () => renderer.render(scene, camera)
      );
      jobTextureDisposers.push(labelMaps.dispose);

      const jobEngraveMat = new THREE.MeshStandardMaterial({
        map: labelMaps.colorTexture,
        bumpMap: labelMaps.bumpTexture,
        bumpScale: 1.8,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.88,
        metalness: 0.08,
      });

      const baseGeo = new THREE.PlaneGeometry(
        Math.max(1, job.labelDesign.widthMm),
        Math.max(1, job.labelDesign.heightMm)
      );

      if (isSelected) {
        const bx = toWorldX(job.xMm);
        const bz = toWorldZ(job.yMm);
        const selPts = [
          new THREE.Vector3(bx - 1, topSurfaceY + 0.7, bz - 1),
          new THREE.Vector3(bx + job.widthMm + 1, topSurfaceY + 0.7, bz - 1),
          new THREE.Vector3(bx + job.widthMm + 1, topSurfaceY + 0.7, bz + job.heightMm + 1),
          new THREE.Vector3(bx - 1, topSurfaceY + 0.7, bz + job.heightMm + 1),
          new THREE.Vector3(bx - 1, topSurfaceY + 0.7, bz - 1),
        ];
        root.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(selPts),
            activeBorderMat
          )
        );
      }

      for (const inst of job.instances) {
        const absX = job.xMm + inst.localXMm;
        const absY = job.yMm + inst.localYMm;

        if (inst.cutContour?.points?.length > 1) {
          const pts = inst.cutContour.points.map(
            (p) =>
              new THREE.Vector3(
                toWorldX(absX + p.x),
                topSurfaceY + 0.25,
                toWorldZ(absY + p.y)
              )
          );
          pts.push(pts[0].clone());
          root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cutLineMat));
        }

        for (const hole of inst.holeContours ?? []) {
          if (!hole.points || hole.points.length < 2) continue;
          const hPts = hole.points.map(
            (p) =>
              new THREE.Vector3(
                toWorldX(absX + p.x),
                topSurfaceY + 0.3,
                toWorldZ(absY + p.y)
              )
          );
          hPts.push(hPts[0].clone());
          root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), holeMat));
        }

        // Proyección física del logo real grabado sobre la etiqueta
        if (inst.engraveItems?.length) {
          const markMesh = new THREE.Mesh(baseGeo, jobEngraveMat);
          markMesh.rotation.order = 'YXZ';
          markMesh.rotation.x = -Math.PI / 2;
          if (inst.rotated90) {
            markMesh.rotation.y = -Math.PI / 2;
          }
          markMesh.position.set(
            toWorldX(absX + inst.widthMm / 2),
            topSurfaceY + 0.18,
            toWorldZ(absY + inst.heightMm / 2)
          );
          markMesh.receiveShadow = true;
          root.add(markMesh);
        }
      }
    }

    // Pórtico X de aluminio extruido con proyección de sombra real sobre la plancha
    const gantry = new THREE.Group();
    const beamBar = new THREE.Mesh(
      new THREE.BoxGeometry(bedW + 34, 15, 20),
      new THREE.MeshStandardMaterial({
        color: '#475569',
        metalness: 0.86,
        roughness: 0.26,
        roughnessMap: brushedTex.clone(),
      })
    );
    beamBar.position.set(0, 50, 0);
    beamBar.castShadow = true;
    gantry.add(beamBar);

    const gantryGuideRail = new THREE.Mesh(new THREE.BoxGeometry(bedW + 26, 4, 4), railMat);
    gantryGuideRail.position.set(0, 52, 11);
    gantry.add(gantryGuideRail);

    const headGroup = new THREE.Group();
    const headHousing = new THREE.Mesh(
      new THREE.BoxGeometry(28, 30, 28),
      new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.78, roughness: 0.25 })
    );
    headHousing.position.y = 42;
    headHousing.castShadow = true;
    headGroup.add(headHousing);

    const brassRing = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 9.5, 5, 24),
      new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 0.9, roughness: 0.22 })
    );
    brassRing.position.y = 25;
    headGroup.add(brassRing);

    const nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(8.5, 20, 24),
      new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.88, roughness: 0.22 })
    );
    nozzle.rotation.x = Math.PI;
    nozzle.position.y = 14;
    nozzle.castShadow = true;
    headGroup.add(nozzle);

    const laserRay = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.95, 13, 14),
      new THREE.MeshBasicMaterial({
        color: '#ef4444',
        transparent: true,
        opacity: 0.88,
      })
    );
    laserRay.position.y = 7.5;
    headGroup.add(laserRay);

    const flare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createLaserGlowTexture(),
        color: '#fecaca',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flare.scale.set(20, 20, 1);
    flare.position.y = topSurfaceY + 1.5;
    headGroup.add(flare);

    gantry.add(headGroup);
    root.add(gantry);

    gantryRef.current = gantry;
    headRef.current = headGroup;
    flareRef.current = flare;

    if (camera.position.lengthSq() < 1) {
      applyPreset(cameraPreset);
    } else {
      renderer.render(scene, camera);
    }

    return () => {
      jobTextureDisposers.forEach((fn) => fn());
    };
  }, [bedW, bedH, config.sheetWidthMm, config.sheetHeightMm, material, jobs, selectedJobId]);

  // 3. Mover pórtico y cabezal láser en vivo
  useEffect(() => {
    if (gantryRef.current && headRef.current) {
      gantryRef.current.position.z = laserPos.y - bedH / 2;
      headRef.current.position.x = laserPos.x - bedW / 2;
    }
    if (flareRef.current) {
      flareRef.current.scale.set(
        laserPos.firing ? 28 : 16,
        laserPos.firing ? 28 : 16,
        1
      );
    }
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [laserPos, bedW, bedH]);

  if (!webglReady) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#070a0f] text-xs text-slate-400 p-6 text-center">
        Vista 3D WebGL no disponible en este entorno headless. Cambiá a Rollo 73 cm o Mesa 900×600.
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#06090f] overflow-hidden">
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="Vista 3D WebGL Mesa Vank 9060"
      />

      {/* Presets flotantes de cámara */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-slate-950/85 backdrop-blur border border-slate-800 px-2 py-1 rounded-lg text-[11px]">
        <span className="text-cyan-300 font-bold mr-1">🧊 Vank 9060 3D:</span>
        {(
          [
            { id: 'iso', label: 'Isométrica' },
            { id: 'front', label: 'Frontal' },
            { id: 'top', label: 'Aérea Z' },
          ] as const
        ).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => applyPreset(c.id)}
            className={`px-2 py-0.5 rounded font-semibold transition ${
              cameraPreset === c.id
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/60'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Telemetría compacta en una sola fila */}
      <div className="absolute bottom-2.5 left-3 right-3 z-10 pointer-events-none flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="bg-slate-950/85 border border-slate-800 px-2.5 py-1 rounded text-slate-300 truncate">
          Mesa {bedW}×{bedH} mm · Plancha {config.sheetWidthMm}×{config.sheetHeightMm} mm · X:{Math.round(laserPos.x)} Y:{Math.round(laserPos.y)} mm
        </span>
        <span className="bg-slate-950/85 border border-slate-800 px-2.5 py-1 rounded text-cyan-300 shrink-0 hidden sm:inline">
          🖱 Orbitar · Zoom · Pan
        </span>
      </div>
    </div>
  );
};
