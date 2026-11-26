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
  canUseWebGL,
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

  const [cameraPreset, setCameraPreset] = useState<Workbench3DCam>('iso');
  const [webglReady, setWebglReady] = useState<boolean>(() => canUseWebGL());

  const bedW = Math.max(200, config.machineBedWidthMm || 900);
  const bedH = Math.max(200, config.machineBedHeightMm || 600);

  // Posición instantánea del cabezal láser según progreso de simulación o Home top-right
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
  }, [simulation.segments, showSimulation, simProgress, bedW, bedH, config.userOriginXMm, config.userOriginYMm]);

  const applyPreset = (preset: Workbench3DCam) => {
    setCameraPreset(preset);
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;

    if (preset === 'iso') {
      cam.position.set(-bedW * 0.42, bedH * 1.18, bedH * 1.55);
      ctrls.target.set(0, 0, 0);
    } else if (preset === 'front') {
      cam.position.set(0, bedH * 0.42, bedH * 1.65);
      ctrls.target.set(0, 0, 0);
    } else {
      cam.position.set(0, Math.max(bedW, bedH) * 1.25, 25);
      ctrls.target.set(0, 0, 0);
    }
    ctrls.update();
    if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cam);
    }
  };

  // 1. Inicializar WebGLRenderer + OrbitControls
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070a0f');

    const camera = new THREE.PerspectiveCamera(
      38,
      (el.clientWidth || 720) / Math.max(1, el.clientHeight || 420),
      1,
      5000
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 80;
    controls.maxDistance = 2400;

    const hemi = new THREE.HemisphereLight('#e0f2fe', '#0f172a', 1.25);
    scene.add(hemi);

    const key = new THREE.DirectionalLight('#ffffff', 1.75);
    key.position.set(350, 620, 420);
    scene.add(key);

    const rim = new THREE.DirectionalLight('#38bdf8', 0.75);
    rim.position.set(-450, 260, -320);
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
            }
          })
        : null;
    ro?.observe(el);

    setWebglReady(true);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      disposeObject3D(worldRoot);
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      worldGroupRef.current = null;
    };
  }, []);

  // 2. Reconstruir mesa 900x600 mm, plancha/rollo, piezas anidadas y pórtico láser
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

    // Estructura metálica exterior Vank 9060
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(bedW + 44, 18, bedH + 44),
      new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.75, roughness: 0.4 })
    );
    chassis.position.set(0, -11, 0);
    root.add(chassis);

    // Cama alveolar 900x600 mm
    const honeycomb = new THREE.Mesh(
      new THREE.BoxGeometry(bedW, 3, bedH),
      new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.45, roughness: 0.75 })
    );
    honeycomb.position.set(0, -1.5, 0);
    root.add(honeycomb);

    const grid = new THREE.GridHelper(
      Math.max(bedW, bedH),
      Math.round(Math.max(bedW, bedH) / 50),
      '#1e40af',
      '#1e293b'
    );
    grid.position.set(0, 0.25, 0);
    root.add(grid);

    // Plancha / rollo de material (730x600 ecocuero, etc.)
    const sheetW = Math.min(bedW, Math.max(20, config.sheetWidthMm || 730));
    const sheetH = Math.min(bedH, Math.max(20, config.sheetHeightMm || 600));
    const matThickness = Math.max(1.2, Math.min(8, material.thicknessMm || 1.6));
    const sheetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(sheetW, matThickness, sheetH),
      new THREE.MeshStandardMaterial({
        color: material.visual.surfaceColor || '#92542b',
        roughness: 0.72,
        metalness: 0.08,
      })
    );
    sheetMesh.position.set(
      toWorldX(sheetW / 2),
      matThickness / 2,
      toWorldZ(sheetH / 2)
    );
    root.add(sheetMesh);

    const topSurfaceY = matThickness + 0.25;

    // Etiquetas anidadas en la mesa (contorno de corte rojo + área grabada + selección cian)
    const cutLineMat = new THREE.LineBasicMaterial({ color: '#ef4444' });
    const holeMat = new THREE.LineBasicMaterial({ color: '#3b82f6' });
    const engraveMat = new THREE.MeshStandardMaterial({
      color: material.visual.engraveColor || '#261408',
      roughness: 0.85,
    });
    const activeBorderMat = new THREE.LineBasicMaterial({ color: '#22d3ee' });

    for (const job of jobs) {
      if (!job.visible) continue;
      const isSelected = job.id === selectedJobId;

      if (isSelected) {
        const bx = toWorldX(job.xMm);
        const bz = toWorldZ(job.yMm);
        const selPts = [
          new THREE.Vector3(bx - 1, topSurfaceY + 0.6, bz - 1),
          new THREE.Vector3(bx + job.widthMm + 1, topSurfaceY + 0.6, bz - 1),
          new THREE.Vector3(bx + job.widthMm + 1, topSurfaceY + 0.6, bz + job.heightMm + 1),
          new THREE.Vector3(bx - 1, topSurfaceY + 0.6, bz + job.heightMm + 1),
          new THREE.Vector3(bx - 1, topSurfaceY + 0.6, bz - 1),
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

        // Contorno de corte exterior C02
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

        // Orificios C01
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

        // Indicador visual de área grabada C00 sobre cada pieza
        if (inst.engraveItems?.length) {
          const markW = Math.max(2, inst.widthMm * 0.56);
          const markH = Math.max(2, inst.heightMm * 0.45);
          const markMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(markW, markH),
            engraveMat
          );
          markMesh.rotation.x = -Math.PI / 2;
          markMesh.position.set(
            toWorldX(absX + inst.widthMm / 2),
            topSurfaceY + 0.15,
            toWorldZ(absY + inst.heightMm / 2)
          );
          root.add(markMesh);
        }
      }
    }

    // Pórtico X aluminio extruido y cabezal láser CO2
    const gantry = new THREE.Group();
    const beamBar = new THREE.Mesh(
      new THREE.BoxGeometry(bedW + 24, 14, 18),
      new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.78, roughness: 0.3 })
    );
    beamBar.position.set(0, 48, 0);
    gantry.add(beamBar);

    const headGroup = new THREE.Group();
    const headHousing = new THREE.Mesh(
      new THREE.BoxGeometry(26, 28, 26),
      new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.65, roughness: 0.3 })
    );
    headHousing.position.y = 40;
    headGroup.add(headHousing);

    const nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(8, 22, 20),
      new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.85, roughness: 0.25 })
    );
    nozzle.rotation.x = Math.PI;
    nozzle.position.y = 18;
    headGroup.add(nozzle);

    const laserRay = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.9, 14, 12),
      new THREE.MeshBasicMaterial({
        color: '#ef4444',
        transparent: true,
        opacity: 0.85,
      })
    );
    laserRay.position.y = 8;
    headGroup.add(laserRay);

    gantry.add(headGroup);
    root.add(gantry);

    gantryRef.current = gantry;
    headRef.current = headGroup;

    if (camera.position.lengthSq() < 1) {
      applyPreset(cameraPreset);
    } else {
      renderer.render(scene, camera);
    }
  }, [bedW, bedH, config.sheetWidthMm, config.sheetHeightMm, material, jobs, selectedJobId]);

  // 3. Mover pórtico Z y cabezal X en vivo durante simulación
  useEffect(() => {
    if (gantryRef.current && headRef.current) {
      gantryRef.current.position.z = laserPos.y - bedH / 2;
      headRef.current.position.x = laserPos.x - bedW / 2;
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
    <div className="relative w-full h-full bg-[#070a0f] overflow-hidden">
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

      {/* Telemetría en vivo abajo */}
      <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
        <span className="bg-slate-950/85 border border-slate-800 px-2.5 py-1 rounded text-slate-300">
          Mesa {bedW}×{bedH} mm · Plancha {config.sheetWidthMm}×{config.sheetHeightMm} mm · Cabezal X:{Math.round(laserPos.x)} Y:{Math.round(laserPos.y)} mm
        </span>
        <span className="bg-slate-950/85 border border-slate-800 px-2.5 py-1 rounded text-cyan-300">
          🖱 Arrastrar: Rotar 3D · Rueda: Zoom · Click derecho: Mover
        </span>
      </div>
    </div>
  );
};
