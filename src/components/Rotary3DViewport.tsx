import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotaryConfig, RotaryLayout, RotaryPhysicalSetupInfo, isTapered } from '../core/rotary/rotaryEngine';
import {
  buildRotaryEngravedTextures,
  canUseWebGL,
  createBrushedMetalTexture,
  createLaserGlowTexture,
  createStudioComposer,
  createStudioEnvironment,
  createStudioRenderer,
  disposeObject3D,
  StudioPostComposer,
} from '../core/three/threeUtils';
import {
  buildRollerRotaryAssembly,
  buildRotaryVesselGroup,
  buildSanouChuckModels,
  buildTailstockSupportAssembly,
  buildVankLaserHeadMeshGroup,
  resolveProductAppearance,
  RotarySurfaceMaterialKind,
  RotaryVesselShape,
} from '../core/three/cadModels';

type CameraPreset = 'iso' | 'front' | 'top' | 'chuck';

export const ROTARY_VESSEL_SHAPES: { id: RotaryVesselShape; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'tumbler', label: 'Tumbler' },
  { id: 'thermos', label: 'Termo' },
  { id: 'mate', label: 'Mate' },
  { id: 'bottle', label: 'Botella' },
  { id: 'can', label: 'Lata' },
];

export const ROTARY_SURFACE_OPTIONS: {
  id: RotarySurfaceMaterialKind;
  label: string;
  swatch: string;
}[] = [
  { id: 'auto', label: 'Auto', swatch: '#22d3ee' },
  { id: 'hammered_green', label: 'Verde Stanley', swatch: '#1f4b34' },
  { id: 'leather', label: 'Cuero', swatch: '#6e3f1d' },
  { id: 'powder_black', label: 'Negro', swatch: '#1b2029' },
  { id: 'navy_coat', label: 'Azul', swatch: '#113a57' },
  { id: 'stainless', label: 'Inox', swatch: '#9ca8b8' },
  { id: 'wood', label: 'Madera', swatch: '#8f5b32' },
  { id: 'glass', label: 'Cristal', swatch: '#bae6fd' },
  { id: 'emerald_glass', label: 'Vidrio Verde', swatch: '#14532d' },
];

interface Props {
  config: RotaryConfig;
  layout: RotaryLayout;
  physicalSetup: RotaryPhysicalSetupInfo;
  svgRaw: string | null;
  previewRotationDeg: number;
  isAutoRotating?: boolean;
  presetId?: string;
  vesselShape?: RotaryVesselShape;
  onVesselShapeChange?: (shape: RotaryVesselShape) => void;
  vesselSurface?: RotarySurfaceMaterialKind;
  onVesselSurfaceChange?: (surface: RotarySurfaceMaterialKind) => void;
  fallbackSvgContent?: React.ReactNode;
}

export const Rotary3DViewport: React.FC<Props> = ({
  config,
  layout,
  physicalSetup,
  svgRaw,
  previewRotationDeg,
  isAutoRotating = false,
  presetId,
  vesselShape: controlledShape,
  onVesselShapeChange,
  vesselSurface: controlledSurface,
  onVesselSurfaceChange,
  fallbackSvgContent,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<StudioPostComposer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const assemblyGroupRef = useRef<THREE.Group | null>(null);
  const spindleGroupRef = useRef<THREE.Group | null>(null);
  const rollersGroupRef = useRef<THREE.Mesh[]>([]);
  const laserHeadRef = useRef<THREE.Group | null>(null);
  const flareRef = useRef<THREE.Sprite | null>(null);

  const targetAngleRadRef = useRef<number>((previewRotationDeg * Math.PI) / 180);
  const currentAngleRadRef = useRef<number>((previewRotationDeg * Math.PI) / 180);
  const angularVelRef = useRef<number>(0);
  const autoScanRef = useRef<boolean>(isAutoRotating);
  const designScanMetaRef = useRef<{ baseX: number; halfSpanX: number }>({
    baseX: config.axisOffsetMm || 0,
    halfSpanX: Math.max(8, layout.effectiveDesignWidthMm * 0.42),
  });

  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [internalSurface, setInternalSurface] =
    useState<RotarySurfaceMaterialKind>('auto');
  const [internalShape, setInternalShape] = useState<RotaryVesselShape>('auto');
  const vesselShape = controlledShape ?? internalShape;
  const vesselSurface = controlledSurface ?? internalSurface;
  const setVesselShape = (next: RotaryVesselShape) => {
    setInternalShape(next);
    onVesselShapeChange?.(next);
  };
  const setVesselSurface = (next: RotarySurfaceMaterialKind) => {
    setInternalSurface(next);
    onVesselSurfaceChange?.(next);
  };
  const [webglReady, setWebglReady] = useState<boolean>(() => canUseWebGL());
  const lastCameraExtentRef = useRef<number>(0);

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

  const appearance = useMemo(
    () =>
      resolveProductAppearance(
        vesselShape,
        vesselSurface,
        dims.len,
        dims.d0,
        dims.d1,
        presetId
      ),
    [vesselShape, vesselSurface, dims, presetId]
  );

  useEffect(() => {
    autoScanRef.current = isAutoRotating;
    designScanMetaRef.current = {
      baseX: Math.max(-dims.len * 0.42, Math.min(dims.len * 0.42, config.axisOffsetMm || 0)),
      halfSpanX: Math.min(dims.len * 0.36, Math.max(6, layout.effectiveDesignWidthMm * 0.45)),
    };
  }, [isAutoRotating, dims.len, config.axisOffsetMm, layout.effectiveDesignWidthMm]);

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;

    const isBottle = appearance.shape === 'bottle';
    const maxExtent = Math.max(isBottle ? dims.len * 1.48 : dims.len, dims.d0, dims.d1, 90);
    const targetShiftX = isBottle
      ? (config.chuckSide === 'left_rim' ? -dims.len * 0.22 : dims.len * 0.22)
      : -dims.len * 0.04;
    const aspectPad = Math.max(1, 1.55 / Math.max(0.75, cam.aspect));
    if (preset === 'iso') {
      cam.position.set(
        -maxExtent * 0.72 * aspectPad + targetShiftX,
        maxExtent * 0.76 * aspectPad,
        maxExtent * 1.68 * aspectPad
      );
      ctrls.target.set(targetShiftX, 6, 0);
    } else if (preset === 'front') {
      cam.position.set(targetShiftX, 14, maxExtent * 1.82 * aspectPad);
      ctrls.target.set(targetShiftX, 6, 0);
    } else if (preset === 'top') {
      cam.position.set(targetShiftX, maxExtent * 1.98 * aspectPad, 16);
      ctrls.target.set(targetShiftX, 0, 0);
    } else {
      cam.position.set(-dims.len * 0.96, dims.r0 * 1.15, maxExtent * 1.12);
      ctrls.target.set(-dims.len * 0.42, 0, 0);
    }
    ctrls.update();
    composerRef.current?.render();
  };

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
    scene.fog = new THREE.FogExp2('#070b12', 0.0005);
    scene.environment = studioEnv.envMap;
    scene.environmentIntensity = 0.92;

    const camera = new THREE.PerspectiveCamera(
      35,
      (el.clientWidth || 560) / Math.max(1, el.clientHeight || 220),
      1,
      4000
    );

    const composer = createStudioComposer(renderer, scene, camera);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 1200;

    const hemi = new THREE.HemisphereLight('#dbeafe', '#0f172a', 0.9);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fffbeb', 2.1);
    keyLight.position.set(150, 270, 200);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 900;
    keyLight.shadow.camera.left = -240;
    keyLight.shadow.camera.right = 240;
    keyLight.shadow.camera.top = 220;
    keyLight.shadow.camera.bottom = -220;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 1.45);
    rimLight.position.set(-220, 100, -180);
    scene.add(rimLight);

    const bounceLight = new THREE.PointLight('#fbbf24', 0.65, 520, 1.4);
    bounceLight.position.set(0, -110, 110);
    scene.add(bounceLight);

    const assemblyRoot = new THREE.Group();
    scene.add(assemblyRoot);

    rendererRef.current = renderer;
    composerRef.current = composer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    assemblyGroupRef.current = assemblyRoot;

    let rafId = 0;
    let scanPhase = 0;
    const animate = () => {
      rafId = window.requestAnimationFrame(animate);

      let diff = targetAngleRadRef.current - currentAngleRadRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      angularVelRef.current = angularVelRef.current * 0.72 + diff * 0.19;
      if (Math.abs(diff) > 0.0005 || Math.abs(angularVelRef.current) > 0.0005) {
        currentAngleRadRef.current += angularVelRef.current;
      } else {
        currentAngleRadRef.current = targetAngleRadRef.current;
        angularVelRef.current = 0;
      }

      if (spindleGroupRef.current) {
        spindleGroupRef.current.rotation.x = currentAngleRadRef.current;
      }
      for (const r of rollersGroupRef.current) {
        r.rotation.x = -currentAngleRadRef.current * 2.2;
      }

      if (laserHeadRef.current) {
        if (autoScanRef.current) {
          scanPhase += 0.14;
          const { baseX, halfSpanX } = designScanMetaRef.current;
          laserHeadRef.current.position.x = baseX + Math.sin(scanPhase) * halfSpanX;
          if (flareRef.current) {
            const pulse = 15 + Math.abs(Math.sin(scanPhase * 3.1)) * 7;
            flareRef.current.scale.set(pulse, pulse, 1);
          }
        } else {
          laserHeadRef.current.position.x = designScanMetaRef.current.baseX;
          if (flareRef.current) {
            flareRef.current.scale.set(13, 13, 1);
          }
        }
      }

      controls.update();
      composer.render();
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
              composer.setSize(w, h);
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
      composer.dispose();
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      composerRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      assemblyGroupRef.current = null;
    };
  }, []);

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
    const bedY = -Math.max(r0, r1) - 38;

    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(820, 820),
      new THREE.ShadowMaterial({ opacity: 0.48 })
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = bedY + 0.1;
    shadowFloor.receiveShadow = true;
    root.add(shadowFloor);

    const grid = new THREE.GridHelper(540, 27, '#1e3a5f', '#0f172a');
    grid.position.y = bedY;
    root.add(grid);

    const focusLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len * 0.78, focusY, 0),
      new THREE.Vector3(len * 0.78, focusY, 0),
    ]);
    root.add(
      new THREE.Line(
        focusLineGeo,
        new THREE.LineBasicMaterial({ color: '#22c55e', transparent: true, opacity: 0.8 })
      )
    );

    const headX = Math.max(-len * 0.45, Math.min(len * 0.45, config.axisOffsetMm || 0));
    const glowTex = createLaserGlowTexture();
    const { headGroup, flareSprite } = buildVankLaserHeadMeshGroup(14, glowTex);
    headGroup.position.set(headX, focusY + 55.5, 0);
    laserHeadRef.current = headGroup;
    flareRef.current = flareSprite;
    root.add(headGroup);

    const axisFrame = new THREE.Group();
    const centerY = focusY - r0 - (len / 2) * Math.sin(alphaRad);
    axisFrame.position.set(0, centerY, 0);
    axisFrame.rotation.z = alphaRad;
    root.add(axisFrame);

    const spindle = new THREE.Group();
    spindle.rotation.x = currentAngleRadRef.current;
    spindleGroupRef.current = spindle;
    axisFrame.add(spindle);

    const brushedTex = createBrushedMetalTexture();

    if (config.rotaryType === 'chuck') {
      const chuckX = -len / 2 - 22;
      const { staticMotorGroup, rotatingChuckGroup } = buildSanouChuckModels(
        r0,
        chuckX,
        brushedTex
      );
      axisFrame.add(staticMotorGroup);
      spindle.add(rotatingChuckGroup);
    } else {
      const rollerR = Math.max(8, (config.rollerDiameterMm ?? 18) / 2);
      const rollerOffsetZ = Math.max(rollerR + 8, r0 * 0.62);
      const { staticBaseGroup, rollersGroup } = buildRollerRotaryAssembly(
        r0,
        rollerR,
        len,
        rollerOffsetZ,
        brushedTex
      );
      axisFrame.add(staticBaseGroup);
      rollersGroupRef.current.push(...rollersGroup);
    }

    // Producto modelado 3D + textura física realista correspondiente (Cuero Mate, Verde Stanley, Cristal, Coat)
    const vesselGroup = buildRotaryVesselGroup({
      appearance,
      r0,
      r1,
      len,
      brushedTex,
      mouthAtLeft: config.chuckSide === 'left_rim',
      presetId,
    });
    spindle.add(vesselGroup);

    // Grabado real envuelto en 2048x2048 con contraste PBR y relieve acorde a cada material
    const arcRad = ((Math.min(360, Math.max(1, config.arcDeg || 360))) * Math.PI) / 180;
    const isGlassFinish =
      appearance.surface === 'glass' || appearance.surface === 'emerald_glass';
    const finishKind = appearance.engraveIsAblatedMetal
      ? 'ablated_metal'
      : isGlassFinish
        ? 'frosted_glass'
        : appearance.surface === 'stainless'
          ? 'anodized_dark'
          : 'char_burn';

    const engravedMaps = buildRotaryEngravedTextures(
      svgRaw,
      layout.canvasWidthMm,
      layout.canvasHeightMm,
      appearance.markHex,
      () => composerRef.current?.render(),
      finishKind
    );
    const wrapGeo = new THREE.CylinderGeometry(
      r1 + 0.28,
      r0 + 0.28,
      len,
      128,
      1,
      true,
      -Math.PI / 2,
      arcRad
    );
    const wrapMat = new THREE.MeshStandardMaterial({
      map: engravedMaps.colorTexture,
      bumpMap: engravedMaps.bumpTexture,
      bumpScale: finishKind === 'char_burn' ? 3.2 : appearance.engraveIsAblatedMetal ? 2.6 : 1.9,
      transparent: true,
      alphaTest: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      roughness: appearance.engraveIsAblatedMetal ? 0.16 : isGlassFinish ? 0.88 : 0.9,
      metalness: appearance.engraveIsAblatedMetal ? 0.96 : 0.04,
      envMapIntensity: appearance.engraveIsAblatedMetal ? 1.45 : 0.85,
      emissive: appearance.markEmissive,
      emissiveIntensity: isGlassFinish ? 0.28 : appearance.engraveIsAblatedMetal ? 0.14 : 0.04,
      side: THREE.FrontSide,
    });
    const wrapMesh = new THREE.Mesh(wrapGeo, wrapMat);
    wrapMesh.rotation.z = -Math.PI / 2;
    wrapMesh.receiveShadow = true;
    spindle.add(wrapMesh);

    // Marcadores discretos de encuadre axial (Frame) sobre la generatriz superior del objeto
    const xDesignMin = -len / 2 + layout.offsetXMm;
    const xDesignMax = xDesignMin + layout.effectiveDesignWidthMm;
    const rFrame0 = r0 + ((r1 - r0) * (layout.offsetXMm / Math.max(1, len))) + 0.65;
    const rFrame1 =
      r0 +
      ((r1 - r0) * ((layout.offsetXMm + layout.effectiveDesignWidthMm) / Math.max(1, len))) +
      0.65;
    const frameGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xDesignMin, rFrame0, -2.5),
      new THREE.Vector3(xDesignMin, rFrame0, 2.5),
      new THREE.Vector3(xDesignMax, rFrame1, 2.5),
      new THREE.Vector3(xDesignMax, rFrame1, -2.5),
      new THREE.Vector3(xDesignMin, rFrame0, -2.5),
    ]);
    spindle.add(
      new THREE.Line(
        frameGeo,
        new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.55 })
      )
    );

    const seamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len / 2, r0 + 0.72, 0),
      new THREE.Vector3(len / 2, r1 + 0.72, 0),
    ]);
    spindle.add(new THREE.Line(seamGeo, new THREE.LineBasicMaterial({ color: '#fbbf24' })));

    if (layout.tapered && physicalSetup.tailstockLiftMm > 0) {
      const supportX =
        physicalSetup.endToLift === 'end' ? len / 2 - 14 : -len / 2 + 14;
      const liftR = physicalSetup.endToLift === 'end' ? r1 : r0;
      const undersideWorldY = focusY - liftR * 2;
      if (undersideWorldY > bedY + 14) {
        const tailstockJack = buildTailstockSupportAssembly(
          supportX,
          bedY,
          undersideWorldY
        );
        root.add(tailstockJack);
      }
    }

    if (camera.position.lengthSq() < 1) {
      applyCameraPreset(cameraPreset);
    } else {
      composerRef.current?.render();
    }

    return () => {
      engravedMaps.dispose();
    };
  }, [
    dims,
    appearance,
    presetId,
    config.rotaryType,
    config.rollerDiameterMm,
    config.arcDeg,
    config.axisOffsetMm,
    config.chuckSide,
    svgRaw,
    layout.canvasWidthMm,
    layout.canvasHeightMm,
    layout.offsetXMm,
    layout.effectiveDesignWidthMm,
    layout.tapered,
    physicalSetup.tailstockLiftMm,
    physicalSetup.endToLift,
  ]);

  useEffect(() => {
    targetAngleRadRef.current = (previewRotationDeg * Math.PI) / 180;
  }, [previewRotationDeg]);

  useEffect(() => {
    if (!webglReady) return;
    const maxExtent = Math.max(dims.len, dims.d0, dims.d1, 90);
    const prev = lastCameraExtentRef.current;
    // Solo re-encuadrar automáticamente al iniciar o ante saltos grandes de escala (>1.7x);
    // al arrastrar sliders o ajustar medidas en vivo, conservar la vista actual para ver crecer/achicar el modelo 3D.
    if (prev === 0 || maxExtent / prev > 1.7 || prev / maxExtent > 1.7) {
      lastCameraExtentRef.current = maxExtent;
      applyCameraPreset(cameraPreset);
    }
  }, [dims.len, dims.d0, dims.d1, webglReady]);

  useEffect(() => {
    if (webglReady && (presetId || vesselShape !== 'auto')) {
      lastCameraExtentRef.current = Math.max(dims.len, dims.d0, dims.d1, 90);
      applyCameraPreset(cameraPreset);
    }
  }, [presetId, vesselShape]);

  if (!webglReady) {
    return <>{fallbackSvgContent}</>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Barra superior compacta: Cámaras + Producto CAD + Textura Realista */}
      <div className="flex flex-col gap-1 bg-slate-950/90 border border-slate-800 px-2 py-1 rounded-lg text-[10px]">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
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

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-400 font-semibold">Pieza:</span>
            {ROTARY_VESSEL_SHAPES.map((s) => {
              const active = vesselShape === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setVesselShape(s.id)}
                  className={`px-1.5 py-0.5 rounded font-medium transition ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/50'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 pt-0.5 border-t border-slate-800/80">
          <span className="text-slate-400 font-semibold mr-0.5">Textura:</span>
          {ROTARY_SURFACE_OPTIONS.map((opt) => {
            const active = vesselSurface === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setVesselSurface(opt.id)}
                className={`px-1.5 py-0.5 rounded font-medium flex items-center gap-1 transition ${
                  active
                    ? 'bg-slate-800 text-white border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full border border-white/30"
                  style={{ backgroundColor: opt.swatch }}
                />
                <span>{opt.label}</span>
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

        <div className="absolute bottom-2 left-2 right-2 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
          <span className="bg-slate-950/85 border border-slate-800 px-2 py-0.5 rounded text-cyan-200 font-semibold">
            {appearance.compositionLabel}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="bg-slate-950/85 border border-emerald-500/40 px-2 py-0.5 rounded text-emerald-300 font-semibold">
              {layout.tapered
                ? `Ø ${dims.d0}→${dims.d1} × ${dims.len} mm`
                : `Ø ${dims.d0} × ${dims.len} mm`}
            </span>
            {layout.tapered && (
              <span className="bg-amber-950/85 border border-amber-600/60 px-2 py-0.5 rounded text-amber-300 font-bold">
                ▲ +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
