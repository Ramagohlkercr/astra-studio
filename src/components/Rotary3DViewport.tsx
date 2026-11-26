import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotaryConfig, RotaryLayout, RotaryPhysicalSetupInfo, isTapered } from '../core/rotary/rotaryEngine';
import {
  buildRotaryWrappedCanvasTexture,
  canUseWebGL,
  createStudioRenderer,
  disposeObject3D,
} from '../core/three/threeUtils';

type CameraPreset = 'iso' | 'front' | 'top' | 'chuck';

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
  const [webglReady, setWebglReady] = useState<boolean>(() => canUseWebGL());

  // Convertir SVG 1:1 mm de grabado (#000000) en grabado acero inoxidable brillante (#f1f5f9) para alto contraste 3D
  const etchedSvgFor3D = useMemo(() => {
    if (!svgRaw) return null;
    return svgRaw.replace(/#000000/gi, '#f8fafc').replace(/#000\b/gi, '#f8fafc');
  }, [svgRaw]);

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
    if (preset === 'iso') {
      cam.position.set(-maxExtent * 0.65, maxExtent * 0.72, maxExtent * 1.45);
      ctrls.target.set(0, 0, 0);
    } else if (preset === 'front') {
      cam.position.set(0, 12, maxExtent * 1.65);
      ctrls.target.set(0, 0, 0);
    } else if (preset === 'top') {
      cam.position.set(0, maxExtent * 1.75, 18);
      ctrls.target.set(0, 0, 0);
    } else {
      cam.position.set(-dims.len * 0.95, dims.r0 * 1.2, maxExtent * 0.95);
      ctrls.target.set(-dims.len * 0.42, 0, 0);
    }
    ctrls.update();
    if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cam);
    }
  };

  // 1. Inicializar escena Three.js + luces + OrbitControls una sola vez
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#06090e');

    const camera = new THREE.PerspectiveCamera(
      36,
      (el.clientWidth || 560) / Math.max(1, el.clientHeight || 220),
      1,
      4000
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 1200;

    // Iluminación de estudio industrial (3 puntos)
    const hemi = new THREE.HemisphereLight('#bae6fd', '#0f172a', 1.15);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.85);
    keyLight.position.set(120, 220, 180);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 0.95);
    rimLight.position.set(-180, 90, -140);
    scene.add(rimLight);

    const assemblyRoot = new THREE.Group();
    scene.add(assemblyRoot);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    assemblyGroupRef.current = assemblyRoot;

    // Loop continuo para suavidad de OrbitControls
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
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      assemblyGroupRef.current = null;
    };
  }, []);

  // 2. Reconstruir geometría CAD del mandril Sanou / rodillos, vaso/termo cónico y textura UV 1:1 mm
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
    const focusY = Math.max(r0, r1) + 12; // Plano constante del foco láser arriba

    // Mesa de la Vank 9060 abajo
    const bedY = -Math.max(r0, r1) - 34;
    const grid = new THREE.GridHelper(460, 23, '#1e3a5f', '#0f172a');
    grid.position.y = bedY;
    root.add(grid);

    // Línea láser verde horizontal indicando generatriz nivelada a foco constante
    const focusLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len * 0.72, focusY, 0),
      new THREE.Vector3(len * 0.72, focusY, 0),
    ]);
    const focusLineMat = new THREE.LineBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.7,
    });
    root.add(new THREE.Line(focusLineGeo, focusLineMat));

    // Cabezal Láser Vank 9060 arriba del cilindro
    const headX = Math.max(-len * 0.45, Math.min(len * 0.45, config.axisOffsetMm || 0));
    const headGroup = new THREE.Group();
    headGroup.position.set(headX, focusY + 42, 0);

    const carriageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(24, 18, 22),
      new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.65, roughness: 0.35 })
    );
    headGroup.add(carriageMesh);

    const nozzleMesh = new THREE.Mesh(
      new THREE.ConeGeometry(8.5, 22, 24),
      new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.75, roughness: 0.25 })
    );
    nozzleMesh.rotation.x = Math.PI;
    nozzleMesh.position.y = -20;
    headGroup.add(nozzleMesh);

    // Rayo láser rojo hacia la generatriz superior (focusY)
    const beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.85, 11, 12),
      new THREE.MeshBasicMaterial({
        color: '#ef4444',
        transparent: true,
        opacity: 0.85,
      })
    );
    beamMesh.position.y = -36.5;
    headGroup.add(beamMesh);

    const spotMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#fde047' })
    );
    spotMesh.position.y = -42;
    headGroup.add(spotMesh);
    root.add(headGroup);

    // Grupo del eje inclinado (tilt para nivelar la generatriz superior cuando es cónico)
    // Pivotamos respecto al borde izquierdo superior (x = -len/2, y = focusY - r0)
    const axisFrame = new THREE.Group();
    const centerY = focusY - r0 - (len / 2) * Math.sin(alphaRad);
    axisFrame.position.set(0, centerY, 0);
    axisFrame.rotation.z = alphaRad;
    root.add(axisFrame);

    // Grupo giratorio alrededor de su eje longitudinal (+X)
    const spindle = new THREE.Group();
    spindle.rotation.x = (previewAngleRef.current * Math.PI) / 180;
    spindleGroupRef.current = spindle;
    axisFrame.add(spindle);

    if (config.rotaryType === 'chuck') {
      // Mandril Sanou 3 Mordazas (izquierda X = -len/2)
      const chuckX = -len / 2 - 22;

      const motorBody = new THREE.Mesh(
        new THREE.BoxGeometry(38, 64, 64),
        new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.5, roughness: 0.5 })
      );
      motorBody.position.set(chuckX - 32, 0, 0);
      axisFrame.add(motorBody);

      const chuckPlato = new THREE.Mesh(
        new THREE.CylinderGeometry(44, 44, 24, 48),
        new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.85, roughness: 0.25 })
      );
      chuckPlato.rotation.z = -Math.PI / 2;
      chuckPlato.position.set(chuckX, 0, 0);
      spindle.add(chuckPlato);

      // Anillo frontal del plato Sanou
      const chuckRing = new THREE.Mesh(
        new THREE.TorusGeometry(43, 1.8, 12, 48),
        new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.7, roughness: 0.3 })
      );
      chuckRing.rotation.y = Math.PI / 2;
      chuckRing.position.set(chuckX + 12, 0, 0);
      spindle.add(chuckRing);

      // 3 Mordazas escalonadas reales separadas 120° agarrando en r0
      const jawRadial = Math.max(14, r0 + 5);
      for (const deg of [0, 120, 240]) {
        const rad = (deg * Math.PI) / 180;
        const jawHolder = new THREE.Group();
        jawHolder.rotation.x = rad;

        const jaw = new THREE.Mesh(
          new THREE.BoxGeometry(20, 12, 10),
          new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.88, roughness: 0.22 })
        );
        jaw.position.set(chuckX + 20, jawRadial, 0);
        jawHolder.add(jaw);

        spindle.add(jawHolder);
      }
    } else {
      // Rodillos motrices paralelos abajo del objeto
      const rollerR = Math.max(8, (config.rollerDiameterMm ?? 18) / 2);
      const rollerOffsetZ = Math.max(rollerR + 8, r0 * 0.62);
      for (const zSign of [-1, 1]) {
        const roller = new THREE.Mesh(
          new THREE.CylinderGeometry(rollerR, rollerR, len + 20, 32),
          new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.7, roughness: 0.35 })
        );
        roller.rotation.z = -Math.PI / 2;
        roller.position.set(0, -r0 - rollerR, zSign * rollerOffsetZ);
        axisFrame.add(roller);
        rollersGroupRef.current.push(roller);
      }
    }

    // Cuerpo principal del objeto cilíndrico / cónico (d0 a izquierda -Y, d1 a derecha +Y -> rotation.z = -PI/2)
    const vesselGeo = new THREE.CylinderGeometry(r1, r0, len, 72, 1, false);
    const vesselMat = new THREE.MeshStandardMaterial({
      color: '#273549',
      metalness: 0.72,
      roughness: 0.32,
    });
    const vesselMesh = new THREE.Mesh(vesselGeo, vesselMat);
    vesselMesh.rotation.z = -Math.PI / 2;
    vesselMesh.castShadow = true;
    vesselMesh.receiveShadow = true;
    spindle.add(vesselMesh);

    // Aro superior metálico en X=+len/2 (boca o base inoxidable)
    const rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(r1, 1.3, 12, 64),
      new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.9, roughness: 0.18 })
    );
    rimMesh.rotation.y = Math.PI / 2;
    rimMesh.position.set(len / 2, 0, 0);
    spindle.add(rimMesh);

    // Malla envolvente con el arte SVG desenrollado 1:1 mm (mapeado sobre arcDeg desde la generatriz superior Y=0°)
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
      72,
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
      side: THREE.DoubleSide,
    });
    const wrapMesh = new THREE.Mesh(wrapGeo, wrapMat);
    wrapMesh.rotation.z = -Math.PI / 2;
    spindle.add(wrapMesh);

    // Línea de costura amarilla Y=0° girando con el objeto
    const seamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len / 2, r0 + 0.65, 0),
      new THREE.Vector3(len / 2, r1 + 0.65, 0),
    ]);
    const seamMat = new THREE.LineBasicMaterial({ color: '#fbbf24' });
    spindle.add(new THREE.Line(seamGeo, seamMat));

    // Calzo de nivelación ámbar debajo del extremo más angosto si es cónico
    if (layout.tapered && physicalSetup.tailstockLiftMm > 0) {
      const wedgeH = Math.max(6, physicalSetup.tailstockLiftMm);
      const wedgeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(24, wedgeH, 34),
        new THREE.MeshStandardMaterial({
          color: '#f59e0b',
          transparent: true,
          opacity: 0.72,
          roughness: 0.4,
        })
      );
      const liftX = physicalSetup.endToLift === 'end' ? len / 2 - 12 : -len / 2 + 12;
      const liftR = physicalSetup.endToLift === 'end' ? r1 : r0;
      wedgeMesh.position.set(liftX, focusY - liftR - wedgeH / 2 - 22, 0);
      root.add(wedgeMesh);
    }

    // Ubicar cámara inicial si todavía está en origen
    if (camera.position.lengthSq() < 1) {
      applyCameraPreset(cameraPreset);
    } else {
      renderer.render(scene, camera);
    }
  }, [dims, config.rotaryType, config.rollerDiameterMm, config.arcDeg, config.axisOffsetMm, etchedSvgFor3D, layout.canvasWidthMm, layout.canvasHeightMm, layout.tapered, physicalSetup.tailstockLiftMm, physicalSetup.endToLift]);

  // 3. Actualizar rotación del mandril/objeto al instante sin reconstruir mallas
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

  // 4. Sincronizar cambio de preset de cámara cuando el usuario presiona un botón
  useEffect(() => {
    if (webglReady) {
      applyCameraPreset(cameraPreset);
    }
  }, [dims.len, dims.d0, dims.d1, webglReady]);

  if (!webglReady) {
    return <>{fallbackSvgContent}</>;
  }

  return (
    <div className="relative w-full h-56 bg-[#06090e] rounded-lg border border-slate-800/90 overflow-hidden">
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="Visor 3D WebGL Mandril Sanou y Objeto Rotativo"
      />

      {/* Controles flotantes de cámara 3D */}
      <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1 bg-slate-950/85 backdrop-blur border border-slate-800 px-1.5 py-1 rounded-lg text-[10px]">
        <span className="text-cyan-300 font-bold px-1">Three.js 3D:</span>
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

      {/* Leyenda técnica en vivo */}
      <div className="absolute bottom-2 left-2 right-2 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
        <span className="bg-slate-950/80 border border-slate-800 px-2 py-0.5 rounded text-slate-300">
          🖱 Arrastrá para orbitar 3D · Rueda = Zoom
        </span>
        {layout.tapered && (
          <span className="bg-amber-950/85 border border-amber-600/60 px-2 py-0.5 rounded text-amber-300 font-bold">
            ▲ Suplementar +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
          </span>
        )}
      </div>
    </div>
  );
};
