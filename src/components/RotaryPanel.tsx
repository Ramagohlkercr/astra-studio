import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Compass,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  FlaskConical,
  Layers,
  Pause,
  Play,
  RotateCw,
  Ruler,
  Save,
  Send,
  Sliders,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  Wifi,
  X,
} from 'lucide-react';
import {
  computeRotaryLayout,
  computeRotaryPhysicalSetup,
  correctedRotarySteps,
  DEFAULT_ROTARY_LAYER_PARAMS,
  diameterAtX,
  estimateRotaryBatchDuration,
  isTapered,
  RotaryConfig,
  RotaryEngraveLayerParams,
  RotaryType,
} from '../core/rotary/rotaryEngine';
import {
  addRotaryCalibrationRecord,
  CalibrationStatus,
  computeDetailedLinearCalibration,
  confirmPhysicalVerification,
  deleteRotaryAccessoryProfile,
  deleteRotaryRecipe,
  LinearMeasurementMode,
  loadRotaryAccessoryProfiles,
  loadRotaryCalibrationHistory,
  loadRotaryRecipes,
  recordProposedCalibration,
  revertCalibrationOnProfile,
  RotaryAccessoryProfile,
  RotaryCalibrationRecord,
  RotaryDirection,
  RotaryJobRecipe,
  saveRotaryAccessoryProfile,
  saveRotaryRecipe,
} from '../core/rotary/rotaryProfiles';
import {
  compileRotaryToRuidaRd,
  exportRotaryDxf,
  exportRotaryGuideSvg,
  exportRotarySvg,
  exportRotaryTestPatternSvg,
  exportRotaryToLbrn2,
} from '../core/exporters/rotaryExporter';
import { RuidaUploadProgress } from '../core/workbench/ruidaCompiler';
import {
  probeVankRuidaConnection,
  uploadRdBytesToVankRuida,
} from '../core/workbench/ruidaTransportClient';
import { VANK_9060_DEFAULT_IP } from '../core/workbench/workbenchTypes';
import { LogoOutputFile } from '../core/exporters/logoFolder';
import { roundMm } from '../core/geometry/geometryEngine';
import { LabelDesign } from '../core/types';
import {
  ROTARY_SURFACE_OPTIONS,
  ROTARY_VESSEL_SHAPES,
  Rotary3DViewport,
} from './Rotary3DViewport';
import {
  RotarySurfaceMaterialKind,
  RotaryVesselShape,
} from '../core/three/cadModels';

interface Props {
  design: LabelDesign;
  config: RotaryConfig;
  onConfigChange: (c: RotaryConfig) => void;
  onDesignChange?: (d: LabelDesign) => void;
  onSave: (files: LogoOutputFile[]) => void;
  onClose: () => void;
}

/** Medidas orientativas de objetos frecuentes de taller: medí siempre el objeto real con calibre antes de producir. */
export const ROTARY_PRESETS: {
  id: string;
  label: string;
  category: string;
  patch: Partial<RotaryConfig>;
}[] = [
  {
    id: 'termo_stanley',
    label: 'Termo Acero 1L (tipo Stanley) Ø 90 × 150 mm',
    category: 'Termos',
    patch: {
      rotaryType: 'chuck',
      objectDiameterMm: 90,
      endDiameterMm: undefined,
      usefulLengthMm: 150,
    },
  },
  {
    id: 'termo',
    label: 'Termo Media Manija Ø 73 × 150 mm',
    category: 'Termos',
    patch: {
      rotaryType: 'chuck',
      objectDiameterMm: 73,
      endDiameterMm: undefined,
      usefulLengthMm: 150,
    },
  },
  {
    id: 'mate_imperial',
    label: 'Mate Imperial / Camionero Cónico Ø 85 → 68 mm',
    category: 'Mates',
    patch: {
      rotaryType: 'chuck',
      objectDiameterMm: 85,
      endDiameterMm: 68,
      usefulLengthMm: 75,
    },
  },
  {
    id: 'tumbler',
    label: 'Tumbler Térmico 20 oz Cónico Ø 90 → 65 mm',
    category: 'Vasos Térmicos',
    patch: {
      rotaryType: 'chuck',
      objectDiameterMm: 90,
      endDiameterMm: 65,
      usefulLengthMm: 120,
    },
  },
  {
    id: 'pinta_cerveza',
    label: 'Vaso Cervecero / Pinta Cónica Ø 82 → 62 mm',
    category: 'Vasos',
    patch: {
      rotaryType: 'chuck',
      objectDiameterMm: 82,
      endDiameterMm: 62,
      usefulLengthMm: 125,
    },
  },
  {
    id: 'vaso',
    label: 'Vaso Recto / Cilindro Ø 75 × 90 mm',
    category: 'Vasos',
    patch: {
      objectDiameterMm: 75,
      endDiameterMm: undefined,
      usefulLengthMm: 90,
    },
  },
  {
    id: 'botella',
    label: 'Botella de Vino / Gin Ø 75 × 140 mm',
    category: 'Botellas',
    patch: {
      objectDiameterMm: 75,
      endDiameterMm: undefined,
      usefulLengthMm: 140,
    },
  },
  {
    id: 'lata',
    label: 'Lata 330 ml Ø 66 × 90 mm',
    category: 'Latas',
    patch: {
      objectDiameterMm: 66,
      endDiameterMm: undefined,
      usefulLengthMm: 90,
    },
  },
];

function formatDurationSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return 'Definir Vel.';
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins === 0) return `${rem}s`;
  return `${mins}m ${rem.toString().padStart(2, '0')}s`;
}

export function RotaryPanel({
  design,
  config,
  onConfigChange,
  onDesignChange,
  onSave,
  onClose,
}: Props) {
  const setConfig = (update: (c: RotaryConfig) => RotaryConfig) =>
    onConfigChange(update(config));

  const [rotaryLogoWStr, setRotaryLogoWStr] = useState<string>(() =>
    String(roundMm(design.widthMm, 2))
  );
  const [rotaryLogoHStr, setRotaryLogoHStr] = useState<string>(() =>
    String(roundMm(design.heightMm, 2))
  );
  const editingRotaryLogoSizeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!editingRotaryLogoSizeRef.current) {
      setRotaryLogoWStr(String(roundMm(design.widthMm, 2)));
      setRotaryLogoHStr(String(roundMm(design.heightMm, 2)));
    }
  }, [design.widthMm, design.heightMm]);

  const applyRotaryLogoDimensions = (targetW: number, targetH: number) => {
    if (!onDesignChange) return;
    const safeW = roundMm(Math.max(2, Math.min(800, targetW)), 2);
    const safeH = roundMm(Math.max(2, Math.min(800, targetH)), 2);
    const sx = safeW / Math.max(0.1, design.widthMm);
    const sy = safeH / Math.max(0.1, design.heightMm);
    const uniformScale = Math.min(sx, sy);

    const nextDesign: LabelDesign = {
      ...design,
      widthMm: safeW,
      heightMm: safeH,
      cornerRadiusMm: roundMm((design.cornerRadiusMm || 0) * uniformScale, 2),
      safetyMarginMm: roundMm((design.safetyMarginMm || 0) * uniformScale, 2),
      elements: design.elements.map((el) => {
        const nextW = roundMm(el.widthMm * sx, 2);
        const nextH = roundMm(el.heightMm * sy, 2);
        const scaledEl = {
          ...el,
          xMm: roundMm(el.xMm * sx, 2),
          yMm: roundMm(el.yMm * sy, 2),
          widthMm: nextW,
          heightMm: nextH,
          aspectRatio: roundMm(nextW / Math.max(0.1, nextH), 4),
        };
        if (el.type === 'vector_text') {
          return {
            ...scaledEl,
            fontSizeMm: roundMm(Math.max(1, el.fontSizeMm * uniformScale), 2),
          };
        }
        return scaledEl;
      }),
    };
    onDesignChange(nextDesign);
  };

  const handleRotaryLogoWidthInput = (raw: string) => {
    setRotaryLogoWStr(raw);
    const numVal = Number(raw.replace(',', '.'));
    if (!Number.isFinite(numVal) || numVal < 2 || raw.trim() === '') return;
    const aspect = design.widthMm / Math.max(0.1, design.heightMm);
    const nextH = roundMm(numVal / aspect, 2);
    setRotaryLogoHStr(String(nextH));
    applyRotaryLogoDimensions(numVal, nextH);
  };

  const handleRotaryLogoHeightInput = (raw: string) => {
    setRotaryLogoHStr(raw);
    const numVal = Number(raw.replace(',', '.'));
    if (!Number.isFinite(numVal) || numVal < 2 || raw.trim() === '') return;
    const aspect = design.widthMm / Math.max(0.1, design.heightMm);
    const nextW = roundMm(numVal * aspect, 2);
    setRotaryLogoWStr(String(nextW));
    applyRotaryLogoDimensions(nextW, numVal);
  };

  const handleFitLogoToRotaryObject = () => {
    const swaps =
      config.designRotationDeg === 90 || config.designRotationDeg === 270;
    const maxAxial = Math.max(5, config.usefulLengthMm * 0.78);
    const maxCirc = Math.max(
      5,
      (Math.PI * layout.referenceDiameterMm * Math.min(config.arcDeg, 160)) /
        360
    );
    const maxW = swaps ? maxCirc : maxAxial;
    const maxH = swaps ? maxAxial : maxCirc;
    const factor = Math.min(
      maxW / Math.max(0.1, design.widthMm),
      maxH / Math.max(0.1, design.heightMm)
    );
    applyRotaryLogoDimensions(design.widthMm * factor, design.heightMm * factor);
  };

  // Pestaña activa del panel lateral derecho (1 vista enfocada a la vez para máxima claridad)
  const [sidebarTab, setSidebarTab] = useState<
    'object' | 'laser_c00' | 'calibration'
  >('object');

  // Vista del visor izquierdo: 'split' (3D Mandril arriba + 2D Desenrollado abajo), '3d_chuck', '2d_unwrapped'
  const [canvasMode, setCanvasMode] = useState<
    'split' | '3d_chuck' | '2d_unwrapped'
  >('split');
  const [rotary3DViewStyle, setRotary3DViewStyle] = useState<
    'webgl' | 'schematic'
  >('webgl');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [vesselShape, setVesselShape] = useState<RotaryVesselShape>('auto');
  const [vesselSurface, setVesselSurface] =
    useState<RotarySurfaceMaterialKind>('auto');
  const [productionBatchQty, setProductionBatchQty] = useState<number>(1);
  const [isConicalMode, setIsConicalMode] = useState<boolean>(() => isTapered(config));
  const [endDiameterStr, setEndDiameterStr] = useState<string>(() =>
    config.endDiameterMm !== undefined ? String(config.endDiameterMm) : ''
  );
  const lastEndDiameterRef = useRef<number | undefined>(config.endDiameterMm);

  useEffect(() => {
    const tapered = isTapered(config);
    setIsConicalMode(tapered);
    if (config.endDiameterMm !== undefined) {
      lastEndDiameterRef.current = config.endDiameterMm;
      setEndDiameterStr(String(config.endDiameterMm));
    }
  }, [config.endDiameterMm]);

  // Ángulo de rotación interactivo para girar el vaso/termo 360° (215° muestra el logo frente a cámara e iluminado)
  const [previewRotationDeg, setPreviewRotationDeg] = useState<number>(215);
  const [isAutoRotating, setIsAutoRotating] = useState<boolean>(false);

  useEffect(() => {
    if (!isAutoRotating) return;
    const timer = window.setInterval(() => {
      setPreviewRotationDeg((deg) => (deg + 5) % 360);
    }, 80);
    return () => window.clearInterval(timer);
  }, [isAutoRotating]);

  // Parámetros de Capa C00 (Grabado Rotativo estilo LightBurn Pro 2.2)
  const [layerParams, setLayerParams] = useState<RotaryEngraveLayerParams>(
    () => ({
      ...DEFAULT_ROTARY_LAYER_PARAMS,
    })
  );

  // Perfiles de hardware persistentes
  const [profiles, setProfiles] = useState<RotaryAccessoryProfile[]>(() =>
    loadRotaryAccessoryProfiles()
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    if (
      config.accessoryProfileId &&
      profiles.some((p) => p.id === config.accessoryProfileId)
    ) {
      return config.accessoryProfileId;
    }
    const match = profiles.find((p) => p.type === config.rotaryType);
    return (
      match?.id ||
      (config.rotaryType === 'chuck'
        ? 'vank-sanou-chuck'
        : 'vank-roller-standard')
    );
  });
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [isAddingProfile, setIsAddingProfile] = useState<boolean>(false);

  // Asistente de calibración (3 estados estrictos)
  const [calibMethod, setCalibMethod] = useState<'angular' | 'linear'>(
    'angular'
  );
  const [measuredDegrees, setMeasuredDegrees] = useState<number>(360);
  const [linearMode, setLinearMode] =
    useState<LinearMeasurementMode>('caliper_chord');
  const [expectedLinearMm, setExpectedLinearMm] = useState<number>(50);
  const [measuredLinearMm, setMeasuredLinearMm] = useState<number>(50);
  const [calibHistory, setCalibHistory] = useState<RotaryCalibrationRecord[]>(
    () => loadRotaryCalibrationHistory()
  );

  const [withDxf, setWithDxf] = useState(false);
  const [withGuides, setWithGuides] = useState(false);
  const [withLbrn2, setWithLbrn2] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Recetas rotativas persistentes (Objeto + Capa C00)
  const [recipes, setRecipes] = useState<RotaryJobRecipe[]>(() =>
    loadRotaryRecipes()
  );
  const [recipeNameInput, setRecipeNameInput] = useState<string>('');

  // Conexión directa UDP con Vank 9060 (Ruida RDC8445S)
  const [ruidaIp, setRuidaIp] = useState<string>(VANK_9060_DEFAULT_IP);
  const [ruidaPort] = useState<number>(50200);
  const [rotaryJobName, setRotaryJobName] = useState<string>('ROTAT01');
  const [ruidaStatus, setRuidaStatus] = useState<{
    probing?: boolean;
    sending?: boolean;
    reachable?: boolean;
    udpHandshakeOk?: boolean;
    latencyMs?: number | null;
    progress?: RuidaUploadProgress | null;
    message?: string;
  } | null>(null);

  const activeProfile = profiles.find((p) => p.id === selectedProfileId);

  const angularCorrection = correctedRotarySteps(
    config.stepsPerRotation ?? 3200,
    measuredDegrees
  );

  const detailedLinearResult = useMemo(() => {
    return computeDetailedLinearCalibration({
      currentSteps: config.stepsPerRotation ?? 3200,
      expectedArcMm: expectedLinearMm,
      measuredValueMm: measuredLinearMm,
      mode: linearMode,
      objectDiameterMm: config.objectDiameterMm,
      isTapered: isTapered(config),
    });
  }, [
    config.stepsPerRotation,
    expectedLinearMm,
    measuredLinearMm,
    linearMode,
    config.objectDiameterMm,
    config.endDiameterMm,
  ]);

  const hasVisibleEngraving = useMemo(() => {
    return (
      Array.isArray(design.elements) &&
      design.elements.some((el) => el.visible)
    );
  }, [design.elements]);

  const layout = useMemo(
    () => computeRotaryLayout(config, design),
    [config, design]
  );

  const physicalSetup = useMemo(
    () => computeRotaryPhysicalSetup(config, design, layerParams),
    [config, design, layerParams]
  );

  const batchTime = useMemo(
    () =>
      estimateRotaryBatchDuration(
        physicalSetup.estimatedDurationSec,
        productionBatchQty
      ),
    [physicalSetup.estimatedDurationSec, productionBatchQty]
  );

  const previewResult = useMemo(() => {
    if (!layout.valid || !hasVisibleEngraving)
      return { url: null, svgRaw: null, error: null };
    try {
      const exported = exportRotarySvg(design, config);
      return {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          exported.svgContent
        )}`,
        svgRaw: exported.svgContent,
        error: null,
      };
    } catch (e) {
      return {
        url: null,
        svgRaw: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [layout.valid, hasVisibleEngraving, design, config]);

  const preview = previewResult.url;
  const rasterOnly = design.elements.some(
    (el) =>
      el.visible &&
      el.type === 'logo_raster' &&
      (el.processing.mode !== 'vector' ||
        !el.vectorizedPathsNormalized.length)
  );
  useEffect(() => {
    if (rasterOnly) setWithDxf(false);
  }, [rasterOnly]);

  const num =
    (
      key:
        | 'objectDiameterMm'
        | 'usefulLengthMm'
        | 'arcDeg'
        | 'repeatCount'
        | 'axisOffsetMm'
        | 'angularOffsetDeg'
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setConfig((c) => ({
        ...c,
        [key]: e.target.value === '' ? NaN : Number(e.target.value),
      }));
  const val = (v: number | undefined, fallback: number | string = '') =>
    v === undefined || Number.isNaN(v) ? fallback : v;

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) {
      setConfig((c) => ({
        ...c,
        accessoryProfileId: p.id,
        rotaryType: p.type,
        rollerDiameterMm:
          p.type === 'roller' ? (p.rollerDiameterMm ?? 50.0) : undefined,
        stepsPerRotation: p.stepsPerRotation,
        rotationDirection: p.rotationDirection,
      }));
    }
  };

  const handleToggleRotaryType = (newType: RotaryType) => {
    const matchingProfile = profiles.find((p) => p.type === newType);
    const newProfId =
      matchingProfile?.id ||
      (newType === 'chuck' ? 'vank-sanou-chuck' : 'vank-roller-standard');
    setSelectedProfileId(newProfId);
    setConfig((c) => ({
      ...c,
      rotaryType: newType,
      accessoryProfileId: newProfId,
      rollerDiameterMm:
        newType === 'roller'
          ? (matchingProfile?.rollerDiameterMm ?? 50.0)
          : undefined,
      stepsPerRotation: matchingProfile?.stepsPerRotation ?? c.stepsPerRotation,
      rotationDirection:
        matchingProfile?.rotationDirection ?? c.rotationDirection,
    }));
  };

  const handleSaveProfile = () => {
    if (!newProfileName.trim()) return;
    const newProf: RotaryAccessoryProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      type: config.rotaryType,
      rollerDiameterMm:
        config.rotaryType === 'roller'
          ? (config.rollerDiameterMm ?? 50.0)
          : undefined,
      stepsPerRotation: config.stepsPerRotation ?? 3200,
      rotationDirection: config.rotationDirection || 'normal',
      calibrationStatus: 'uncalibrated',
      isCalibrated: false,
      isBuiltIn: false,
    };
    const updated = saveRotaryAccessoryProfile(newProf);
    setProfiles(updated);
    setSelectedProfileId(newProf.id);
    setConfig((c) => ({ ...c, accessoryProfileId: newProf.id }));
    setNewProfileName('');
    setIsAddingProfile(false);
  };

  const handleDeleteProfile = (id: string) => {
    const updated = deleteRotaryAccessoryProfile(id);
    setProfiles(updated);
    if (selectedProfileId === id) {
      handleSelectProfile(updated[0]?.id || 'vank-sanou-chuck');
    }
  };

  // 1. Proponer calibración angular (Pasa a estado calculated_pending)
  const handleProposeAngularCalib = () => {
    if (angularCorrection === null) return;
    const oldSteps = config.stepsPerRotation ?? 3200;
    const targetProfileId = config.accessoryProfileId || selectedProfileId;

    const res = recordProposedCalibration(
      targetProfileId,
      angularCorrection,
      'angular_360',
      {
        expectedValue: 360,
        measuredValue: measuredDegrees,
      }
    );
    if (!res.success) {
      setSaveError(res.error || 'Error al registrar propuesta de calibración.');
      return;
    }
    setProfiles(res.updatedProfiles);
    setConfig((c) => ({
      ...c,
      stepsPerRotation: angularCorrection,
      accessoryProfileId: targetProfileId,
    }));

    const record = addRotaryCalibrationRecord({
      accessoryId: targetProfileId,
      accessoryName:
        res.updatedProfile?.name ||
        profiles.find((p) => p.id === targetProfileId)?.name,
      method: 'angular_360',
      initialSteps: oldSteps,
      expectedValue: 360,
      measuredValue: measuredDegrees,
      computedSteps: angularCorrection,
      operatorNotes: `Propuesta calculada por giro 360° (${measuredDegrees}° medidos). Pendiente de prueba en máquina.`,
    });
    setCalibHistory((h) => [record, ...h]);
    setStatusBanner(
      `Propuesta guardada: ${angularCorrection} pasos/vuelta (Estado: Pendiente de verificar en la Vank 9060).`
    );
  };

  // Confirmar verificación física real en máquina (Pasa a verified_physical)
  const handleConfirmVerificationAngular = () => {
    const targetProfileId = config.accessoryProfileId || selectedProfileId;
    const stepsToVerify =
      activeProfile?.proposedStepsPerRotation ||
      config.stepsPerRotation ||
      3200;

    const res = confirmPhysicalVerification(targetProfileId, {
      method: 'angular_360',
      expectedValue: 360,
      measuredValue: measuredDegrees,
      operatorNotes: `Verificado físicamente en la Vank 9060 por el operador: giro exacto de 360° con ${stepsToVerify} pasos/vuelta.`,
    });
    if (!res.success) {
      setSaveError(res.error || 'Error al confirmar verificación física.');
      return;
    }
    setProfiles(res.updatedProfiles);
    setConfig((c) => ({ ...c, stepsPerRotation: stepsToVerify }));

    const record = addRotaryCalibrationRecord({
      accessoryId: targetProfileId,
      accessoryName: res.updatedProfile?.name,
      method: 'angular_360',
      initialSteps: config.stepsPerRotation ?? 3200,
      expectedValue: 360,
      measuredValue: 360,
      computedSteps: stepsToVerify,
      operatorNotes: `VERIFICACIÓN FÍSICA CONFIRMADA por operador en Vank 9060 (${stepsToVerify} pasos).`,
    });
    setCalibHistory((h) => [record, ...h]);
    setStatusBanner(
      `✓ Verificación física confirmada: ${stepsToVerify} pasos/vuelta validados en máquina.`
    );
  };

  // 2. Proponer calibración lineal (Pasa a estado calculated_pending)
  const handleProposeLinearCalib = () => {
    if (!detailedLinearResult.valid) return;
    const newSteps = detailedLinearResult.computedSteps;
    const oldSteps = config.stepsPerRotation ?? 3200;
    const targetProfileId = config.accessoryProfileId || selectedProfileId;

    const res = recordProposedCalibration(
      targetProfileId,
      newSteps,
      'linear_caliper',
      {
        expectedValue: expectedLinearMm,
        measuredValue: measuredLinearMm,
        effectiveRealArcMm: detailedLinearResult.effectiveRealArcMm,
        linearMode,
      }
    );
    if (!res.success) {
      setSaveError(res.error || 'Error al registrar propuesta lineal.');
      return;
    }
    setProfiles(res.updatedProfiles);
    setConfig((c) => ({
      ...c,
      stepsPerRotation: newSteps,
      accessoryProfileId: targetProfileId,
    }));

    const record = addRotaryCalibrationRecord({
      accessoryId: targetProfileId,
      accessoryName:
        res.updatedProfile?.name ||
        profiles.find((p) => p.id === targetProfileId)?.name,
      method: 'linear_caliper',
      linearMode,
      effectiveRealArcMm: detailedLinearResult.effectiveRealArcMm,
      initialSteps: oldSteps,
      expectedValue: expectedLinearMm,
      measuredValue: measuredLinearMm,
      computedSteps: newSteps,
      operatorNotes:
        linearMode === 'caliper_chord'
          ? `Propuesta por calibre rígido: cuerda ${measuredLinearMm}mm -> arco ${detailedLinearResult.effectiveRealArcMm}mm en Ø${config.objectDiameterMm}mm. Pendiente de verificar.`
          : `Propuesta por cinta flexible: arco superficial ${measuredLinearMm}mm. Pendiente de verificar.`,
    });
    setCalibHistory((h) => [record, ...h]);
    setStatusBanner(
      `Propuesta lineal guardada: ${newSteps} pasos/vuelta (Pendiente de verificar en probeta).`
    );
  };

  // Confirmar verificación física real de calibración lineal (Pasa a verified_physical)
  const handleConfirmVerificationLinear = () => {
    const targetProfileId = config.accessoryProfileId || selectedProfileId;
    const stepsToVerify =
      activeProfile?.proposedStepsPerRotation ||
      config.stepsPerRotation ||
      3200;

    const res = confirmPhysicalVerification(targetProfileId, {
      method: 'linear_caliper',
      linearMode,
      effectiveRealArcMm: detailedLinearResult.effectiveRealArcMm,
      expectedValue: expectedLinearMm,
      measuredValue: measuredLinearMm,
      operatorNotes: `Verificado físicamente en probeta con ${stepsToVerify} pasos/vuelta: dimensión nominal obtenida con precisión.`,
    });
    if (!res.success) {
      setSaveError(res.error || 'Error al confirmar verificación lineal.');
      return;
    }
    setProfiles(res.updatedProfiles);
    setConfig((c) => ({ ...c, stepsPerRotation: stepsToVerify }));

    const record = addRotaryCalibrationRecord({
      accessoryId: targetProfileId,
      accessoryName: res.updatedProfile?.name,
      method: 'linear_caliper',
      linearMode,
      effectiveRealArcMm: expectedLinearMm,
      initialSteps: config.stepsPerRotation ?? 3200,
      expectedValue: expectedLinearMm,
      measuredValue: expectedLinearMm,
      computedSteps: stepsToVerify,
      operatorNotes: `VERIFICACIÓN FÍSICA CONFIRMADA por operador con patrón métrico (${stepsToVerify} pasos).`,
    });
    setCalibHistory((h) => [record, ...h]);
    setStatusBanner(
      `✓ Verificación física lineal confirmada: ${stepsToVerify} pasos/vuelta.`
    );
  };

  const handleRevertProfileCalibration = () => {
    const targetProfileId = config.accessoryProfileId || selectedProfileId;
    const res = revertCalibrationOnProfile(targetProfileId);
    if (!res.success) {
      setSaveError(res.error || 'Error al revertir calibración.');
      return;
    }
    setProfiles(res.updatedProfiles);
    if (res.revertedProfile) {
      setConfig((c) => ({
        ...c,
        stepsPerRotation: res.revertedProfile?.stepsPerRotation,
      }));
    }
    setStatusBanner('Calibración revertida al estado anterior.');
  };

  // Guardar paquete de archivos de producción (.SVG + .TXT + opcional .LBRN2, .DXF, Guías T1)
  const save = () => {
    if (!hasVisibleEngraving) {
      setSaveError(
        'El diseño no contiene elementos de grabado visibles para exportar.'
      );
      return;
    }
    const files: LogoOutputFile[] = [];
    try {
      const art = exportRotarySvg(design, config, layerParams);
      files.push(
        { name: art.svgFilename, content: art.svgContent },
        { name: art.instructionsFilename, content: art.instructionsText }
      );
      if (withLbrn2) {
        const lb = exportRotaryToLbrn2(design, config, layerParams);
        files.push({ name: lb.filename, content: lb.lbrn2Content });
      }
      if (withDxf) {
        const d = exportRotaryDxf(design, config);
        files.push({ name: d.filename, content: d.dxfContent });
      }
      if (withGuides) {
        const g = exportRotaryGuideSvg(design, config);
        files.push({ name: g.filename, content: g.svgContent });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaveError(null);
    onSave(files);
  };

  // Abrir proyecto rotativo directamente en LightBurn Pro 2.2 (.lbrn2)
  const handleOpenInLightBurn = async () => {
    if (!hasVisibleEngraving) {
      setSaveError(
        'El diseño no contiene elementos de grabado visibles para exportar.'
      );
      return;
    }
    try {
      const lb = exportRotaryToLbrn2(design, config, layerParams);
      if (isTauri()) {
        const res = await invoke<{
          saved_path: string;
          launched_lightburn: boolean;
          message: string;
        }>('open_lbrn2_in_lightburn', {
          folderName: `${design.name.trim() || 'Rotativo'}_Vank9060`,
          filename: lb.filename,
          lbrn2Content: lb.lbrn2Content,
        });
        setStatusBanner(res.message);
        return;
      }
      onSave([{ name: lb.filename, content: lb.lbrn2Content }]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveTestPattern = () => {
    try {
      const pat = exportRotaryTestPatternSvg(config, 50);
      onSave([
        { name: pat.filename, content: pat.svgContent },
        { name: pat.instructionsFilename, content: pat.instructionsText },
      ]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  // Recetas Rotativas: guardar, aplicar y eliminar combinaciones reales Objeto + Capa C00
  const handleSaveRecipe = () => {
    if (
      layerParams.speedMmPerSec === null ||
      layerParams.maxPowerPercent === null
    ) {
      setSaveError(
        'Ingresá Velocidad (mm/s) y Potencia Máx (%) reales antes de guardar la receta.'
      );
      return;
    }
    setSaveError(null);
    const label =
      recipeNameInput.trim() ||
      `${design.name.trim() || 'Trabajo'} · Ø${config.objectDiameterMm}mm`;
    const recipe: RotaryJobRecipe = {
      id: `recipe-${Date.now()}`,
      name: label,
      rotaryType: config.rotaryType,
      objectDiameterMm: config.objectDiameterMm,
      endDiameterMm: config.endDiameterMm,
      usefulLengthMm: config.usefulLengthMm,
      repeatCount: config.repeatCount ?? 1,
      designRotationDeg: config.designRotationDeg ?? 0,
      chuckSide: config.chuckSide ?? 'left_base',
      layerMode: layerParams.mode,
      speedMmPerSec: layerParams.speedMmPerSec,
      maxPowerPercent: layerParams.maxPowerPercent,
      minPowerPercent:
        layerParams.minPowerPercent ?? layerParams.maxPowerPercent,
      lineIntervalMm: layerParams.lineIntervalMm,
      passes: layerParams.passes,
      airAssist: layerParams.airAssist,
      bidirectional: layerParams.bidirectional,
      updatedAtIso: new Date().toISOString(),
    };
    const next = saveRotaryRecipe(recipe);
    setRecipes(next);
    setRecipeNameInput('');
    setStatusBanner(`Receta rotativa "${label}" guardada localmente.`);
  };

  const handleApplyRecipe = (r: RotaryJobRecipe) => {
    if (r.rotaryType !== config.rotaryType) {
      handleToggleRotaryType(r.rotaryType);
    }
    setConfig((c) => ({
      ...c,
      rotaryType: r.rotaryType,
      objectDiameterMm: r.objectDiameterMm,
      endDiameterMm: r.endDiameterMm,
      usefulLengthMm: r.usefulLengthMm,
      repeatCount: r.repeatCount,
      designRotationDeg: r.designRotationDeg,
      chuckSide: r.chuckSide ?? c.chuckSide,
    }));
    setLayerParams((p) => ({
      ...p,
      mode: r.layerMode,
      speedMmPerSec: r.speedMmPerSec,
      maxPowerPercent: r.maxPowerPercent,
      minPowerPercent: r.minPowerPercent,
      lineIntervalMm: r.lineIntervalMm,
      passes: r.passes,
      airAssist: r.airAssist,
      bidirectional: r.bidirectional ?? p.bidirectional,
    }));
    setStatusBanner(`Receta "${r.name}" aplicada al objeto y Capa C00.`);
  };

  const handleDeleteRecipe = (id: string) => {
    setRecipes(deleteRotaryRecipe(id));
  };

  // Prueba real UDP/40200 y ping hacia Ruida RDC8445S (Vank 9060)
  const handleProbeRuidaConnection = async () => {
    setRuidaStatus({ probing: true, message: `Probando ${ruidaIp}:${ruidaPort}…` });
    try {
      const res = await probeVankRuidaConnection({
        ip: ruidaIp,
        port: ruidaPort,
      });
      setRuidaStatus({
        reachable: res.reachable,
        udpHandshakeOk: res.udp_handshake_ok,
        latencyMs: res.latency_ms,
        message: res.message,
      });
    } catch (e) {
      setRuidaStatus({
        reachable: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Compilar trabajo rotativo vectorial/texto a binario .RD nativo (para USB o envío directo UDP)
  const handleRotaryRdAction = async (mode: 'download' | 'send') => {
    setSaveError(null);
    if (!hasVisibleEngraving) {
      setSaveError(
        'El diseño no contiene elementos de grabado visibles para exportar.'
      );
      return;
    }
    if (
      layerParams.speedMmPerSec === null ||
      layerParams.maxPowerPercent === null
    ) {
      setSidebarTab('laser_c00');
      setSaveError(
        'Ingresá Velocidad (mm/s) y Potencia Máx (%) en la pestaña "2. Velocidad y Potencia" antes de compilar el .RD.'
      );
      return;
    }
    try {
      const compiled = compileRotaryToRuidaRd(
        design,
        config,
        layerParams,
        rotaryJobName
      );
      if (mode === 'download') {
        const blob = new Blob([new Uint8Array(compiled.rdBytes)], {
          type: 'application/octet-stream',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = compiled.filenameSuggested;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        setStatusBanner(
          `✓ Archivo binario Ruida "${compiled.filenameSuggested}" generado (${compiled.rdBytes.length} bytes).`
        );
        return;
      }

      setRuidaStatus({
        sending: true,
        progress: null,
        message: `Enviando ${compiled.filenameSuggested} a ${ruidaIp}:${ruidaPort}…`,
      });
      const res = await uploadRdBytesToVankRuida({
        ip: ruidaIp,
        port: ruidaPort,
        rdBytes: compiled.rdBytes,
        jobName: compiled.ruidaJobName,
        onProgress: (progress) =>
          setRuidaStatus((prev) => ({
            ...prev,
            sending: true,
            progress,
            message: `Enviando paquete ${progress.current_packet}/${progress.total_packets} (${progress.percent}%)…`,
          })),
      });
      setRuidaStatus({ reachable: res.success, message: res.message });
      setStatusBanner(res.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      setRuidaStatus({ reachable: false, message: msg });
    }
  };

  const field =
    'w-full bg-slate-950 border border-slate-700 px-2.5 py-1.5 rounded-lg text-xs text-white font-mono focus:border-cyan-500 focus:outline-none';

  // Dimensiones para el simulador visual 3D del Mandril Sanou + Objeto Cilíndrico/Cónico
  const sim3d = useMemo(() => {
    const len = Math.max(20, Math.min(900, config.usefulLengthMm || 100));
    const d0 = Math.max(5, Math.min(300, config.objectDiameterMm || 75));
    const d1 = isTapered(config)
      ? Math.max(5, Math.min(300, config.endDiameterMm || d0))
      : d0;
    return { len, d0, d1 };
  }, [config]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotary-title"
      className="fixed inset-0 z-50 bg-[#070a0e]/95 backdrop-blur-sm flex flex-col text-slate-100 select-none"
    >
      {/* 1. CABECERA SUPERIOR LIMPIA Y DESPEJADA */}
      <header className="h-13 bg-[#11161f] border-b border-slate-800/90 px-4 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <RotateCw className="w-4 h-4" />
          </div>
          <h3
            id="rotary-title"
            className="text-sm font-bold text-white truncate"
          >
            Accesorio Rotativo — Vank 9060
          </h3>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-slate-800/90 text-cyan-300 border border-slate-700">
            {config.rotaryType === 'chuck' ? 'Mandril Sanou' : 'Rodillos'} · Eje Y
          </span>
          {activeProfile?.calibrationStatus === 'verified_physical' ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ✓ {activeProfile.stepsPerRotation} pasos/vuelta
            </span>
          ) : activeProfile?.calibrationStatus === 'calculated_pending' ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
              Pendiente de verificar ({activeProfile.proposedStepsPerRotation || config.stepsPerRotation} pasos)
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700/80">
              {config.stepsPerRotation ?? 3200} pasos/vuelta (sin calibrar)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
        >
          <X className="w-3.5 h-3.5 shrink-0" />
          <span>Cerrar</span>
        </button>
      </header>

      {/* 2. CUERPO PRINCIPAL DE 2 COLUMNAS: VISOR 3D + 2D DESENROLLADO (IZQUIERDA) + CONTROLES (DERECHA) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* =====================================================================
            COLUMNA IZQUIERDA: SIMULADOR 3D DE MANDRIL SANOU + LIENZO 2D DESENROLLADO
           ===================================================================== */}
        <div className="flex-1 flex flex-col bg-[#080b10] min-w-0 overflow-hidden">
          {/* Sub-barra del visor */}
          <div className="py-1 px-2.5 bg-[#0e131b] border-b border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[11px] shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCanvasMode('split')}
                className={`px-2 py-0.5 rounded font-bold border transition whitespace-nowrap ${
                  canvasMode === 'split'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                🔀 3D + 2D
              </button>
              <button
                type="button"
                onClick={() => setCanvasMode('3d_chuck')}
                className={`px-2 py-0.5 rounded font-bold border transition whitespace-nowrap ${
                  canvasMode === '3d_chuck'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                🧊 Mandril 3D
              </button>
              <button
                type="button"
                onClick={() => setCanvasMode('2d_unwrapped')}
                className={`px-2 py-0.5 rounded font-bold border transition whitespace-nowrap ${
                  canvasMode === '2d_unwrapped'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                📐 Desenrollado 1:1
              </button>
            </div>

            {/* Control interactivo + Play/Pause para girar el vaso/termo 360° */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setIsAutoRotating((v) => !v)}
                title={
                  isAutoRotating
                    ? 'Pausar rotación 3D'
                    : 'Animar giro continuo 360°'
                }
                className="p-0.5 rounded hover:bg-slate-800 text-cyan-300 transition"
              >
                {isAutoRotating ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </button>
              <span className="text-[10px] text-slate-300 font-semibold whitespace-nowrap">
                Giro 360°:
              </span>
              <input
                type="range"
                aria-label="Giro 360°"
                min={0}
                max={360}
                step={5}
                value={previewRotationDeg}
                onChange={(e) => {
                  setIsAutoRotating(false);
                  setPreviewRotationDeg(Number(e.target.value));
                }}
                className="w-16 accent-cyan-400 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => {
                  setIsAutoRotating(false);
                  setPreviewRotationDeg(0);
                }}
                title="Volver a costura Y = 0°"
                className="font-mono text-[10px] text-cyan-300 font-bold w-8 text-right hover:text-white"
              >
                {previewRotationDeg}°
              </button>
            </div>
          </div>

          {/* ÁREA VISUAL CENTRAL: MANDRIL SANOU 3D + LIENZO 2D DESENROLLADO */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 flex flex-col">
            {/* VISOR A: SIMULADOR FÍSICO DEL MANDRIL SANOU / RODILLOS Y NIVELACIÓN DE FOCO Z */}
            {(canvasMode === 'split' || canvasMode === '3d_chuck') && (
              <div className="bg-[#0b1018] border border-slate-800 rounded-xl p-3 flex flex-col justify-between shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-mono text-[10px] font-bold">
                      {config.rotaryType === 'chuck'
                        ? 'MANDRIL SANOU 3 MORDAZAS (CHUCK)'
                        : 'RODILLOS MOTRICES (ROLLER)'}
                    </span>
                    <span className="text-xs font-bold text-white">
                      {layout.tapered
                        ? `Objeto Cónico Ø ${config.objectDiameterMm} mm → Ø ${config.endDiameterMm} mm (Cargar en LightBurn: Ø ${layout.referenceDiameterMm} mm)`
                        : `Objeto Cilíndrico Ø ${config.objectDiameterMm} mm (Circunferencia: ${layout.circumferenceMm} mm)`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {layout.tapered && (
                      <span className="px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-600/60 font-mono text-[10px] font-bold">
                        📐 Nivelar Foco Z: +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
                      </span>
                    )}
                    <div className="flex bg-slate-900 border border-slate-800 rounded-md p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setRotary3DViewStyle('webgl')}
                        className={`px-2 py-0.5 rounded font-bold transition ${
                          rotary3DViewStyle === 'webgl'
                            ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        🧊 WebGL 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => setRotary3DViewStyle('schematic')}
                        className={`px-2 py-0.5 rounded font-semibold transition ${
                          rotary3DViewStyle === 'schematic'
                            ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        📐 Esquema
                      </button>
                    </div>
                  </div>
                </div>

                {/* Simulador Real Three.js 3D WebGL con fallback / vista lateral SVG */}
                {(() => {
                  const schematicView = (
                    <div className="h-44 w-full bg-[#06090e] rounded-lg border border-slate-800/90 flex items-center justify-center p-2">
                      <svg
                        viewBox="0 0 620 185"
                        className="w-full h-full max-h-full select-none"
                      >
                    <defs>
                      <linearGradient
                        id="rot-cylinder-grad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#475569" />
                        <stop offset="28%" stopColor="#94a3b8" />
                        <stop offset="55%" stopColor="#334155" />
                        <stop offset="100%" stopColor="#0f172a" />
                      </linearGradient>
                      <linearGradient
                        id="rot-chuck-grad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#1e293b" />
                        <stop offset="50%" stopColor="#64748b" />
                        <stop offset="100%" stopColor="#0f172a" />
                      </linearGradient>
                    </defs>

                    {/* Línea horizontal de Foco Láser Constante (Generatriz Superior Y=0) */}
                    <line
                      x1="40"
                      y1="44"
                      x2="585"
                      y2="44"
                      stroke="#22c55e"
                      strokeWidth="1"
                      strokeDasharray="5 3"
                    />
                    <text
                      x="580"
                      y="38"
                      textAnchor="end"
                      fill="#4ade80"
                      fontSize="9.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      GENERATRIZ SUPERIOR A FOCO LÁSER CONSTANTE (LÁSER ARRIBA)
                    </text>

                    {/* Cabezal Láser CO2 Vank 9060 arriba */}
                    <g transform="translate(310, 6)">
                      <rect
                        x="-14"
                        y="0"
                        width="28"
                        height="16"
                        rx="2"
                        fill="#1e293b"
                        stroke="#38bdf8"
                        strokeWidth="1.2"
                      />
                      <polygon
                        points="-9,16 9,16 3,30 -3,30"
                        fill="#0284c7"
                        stroke="#7dd3fc"
                        strokeWidth="1"
                      />
                      <line
                        x1="0"
                        y1="30"
                        x2="0"
                        y2="38"
                        stroke="#ef4444"
                        strokeWidth="2"
                      />
                      <circle cx="0" cy="38" r="3" fill="#fef08a" />
                      <text
                        x="20"
                        y="14"
                        fill="#38bdf8"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        CABEZAL VANK 9060 (EJE X ↔)
                      </text>
                    </g>

                    {/* Mandril Sanou 3 Mordazas animado con previewRotationDeg */}
                    {config.rotaryType === 'chuck' ? (
                      <g transform="translate(55, 38)">
                        <rect
                          x="0"
                          y="12"
                          width="56"
                          height="104"
                          rx="4"
                          fill="#0f172a"
                          stroke="#475569"
                          strokeWidth="1.5"
                        />
                        <rect
                          x="56"
                          y="4"
                          width="28"
                          height="120"
                          rx="3"
                          fill="url(#rot-chuck-grad)"
                          stroke="#94a3b8"
                          strokeWidth="1.5"
                        />
                        {[0, 120, 240].map((jawOffset) => {
                          const rad =
                            ((previewRotationDeg + jawOffset) * Math.PI) / 180;
                          const cy = 64 - 50 * Math.cos(rad);
                          const isFront = Math.sin(rad) >= -0.1;
                          return (
                            <rect
                              key={jawOffset}
                              x="84"
                              y={cy - 8}
                              width={isFront ? 22 : 16}
                              height="16"
                              rx="2"
                              fill={isFront ? '#e2e8f0' : '#475569'}
                              stroke="#1e293b"
                              strokeWidth="1.2"
                              opacity={isFront ? 0.95 : 0.45}
                            />
                          );
                        })}
                        <text
                          x="28"
                          y="68"
                          textAnchor="middle"
                          fill="#38bdf8"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          SANOU
                        </text>
                      </g>
                    ) : (
                      /* Rodillos motrices animados */
                      <g transform="translate(155, 138)">
                        {[45, 255].map((cx) => (
                          <g
                            key={cx}
                            transform={`translate(${cx}, 16) rotate(${previewRotationDeg})`}
                          >
                            <circle
                              r="16"
                              fill="#1e293b"
                              stroke="#38bdf8"
                              strokeWidth="2"
                            />
                            <line
                              x1="-12"
                              y1="0"
                              x2="12"
                              y2="0"
                              stroke="#7dd3fc"
                              strokeWidth="1.5"
                            />
                            <line
                              x1="0"
                              y1="-12"
                              x2="0"
                              y2="12"
                              stroke="#7dd3fc"
                              strokeWidth="1.5"
                            />
                          </g>
                        ))}
                        <text
                          x="150"
                          y="20"
                          textAnchor="middle"
                          fill="#38bdf8"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          RODILLOS MOTRICES{' '}
                          {config.rollerDiameterMm
                            ? `(Ø ${config.rollerDiameterMm} mm)`
                            : ''}
                        </text>
                      </g>
                    )}

                    {/* Cuerpo del Objeto Cilíndrico o Cónico animado con giro 360° */}
                    {(() => {
                      const maxD = Math.max(sim3d.d0, sim3d.d1, 40);
                      const h0 = Math.max(26, Math.min(106, (sim3d.d0 / maxD) * 96));
                      const h1 = Math.max(26, Math.min(106, (sim3d.d1 / maxD) * 96));
                      const xStart = 163;
                      const xEnd = 475;
                      const yTop = 44;
                      const yBot0 = yTop + h0;
                      const yBot1 = yTop + h1;
                      const cy0 = yTop + h0 / 2;
                      const cy1 = yTop + h1 / 2;

                      const designRatioW = Math.min(
                        1,
                        layout.effectiveDesignWidthMm /
                          Math.max(1, config.usefulLengthMm)
                      );
                      const designBoxW = Math.max(
                        18,
                        (xEnd - xStart) * designRatioW
                      );
                      const axisRatio = Math.max(
                        -0.4,
                        Math.min(
                          0.4,
                          (config.axisOffsetMm || 0) /
                            Math.max(1, config.usefulLengthMm)
                        )
                      );
                      const designBoxX =
                        xStart +
                        (xEnd - xStart - designBoxW) / 2 +
                        (xEnd - xStart) * axisRatio;

                      // Proyección de la costura de origen Y = 0°
                      const seamRad = (previewRotationDeg * Math.PI) / 180;
                      const seamCos = Math.cos(seamRad);
                      const seamY0 = cy0 - (h0 / 2) * seamCos;
                      const seamY1 = cy1 - (h1 / 2) * seamCos;
                      const seamFront = Math.sin(seamRad) >= -0.05;

                      // Copias proyectadas alrededor del cilindro
                      const copies = Math.max(1, Math.round(config.repeatCount || 1));
                      const sectorDeg = (config.arcDeg || 360) / copies;
                      const startAng = config.angularOffsetDeg || 0;
                      const designRot = config.designRotationDeg ?? 0;

                      const chuckSideLeft =
                        (config.chuckSide ?? 'left_base') === 'left_base';

                      return (
                        <g>
                          <polygon
                            points={`${xStart},${yTop} ${xEnd},${yTop} ${xEnd},${yBot1} ${xStart},${yBot0}`}
                            fill="url(#rot-cylinder-grad)"
                            stroke="#e2e8f0"
                            strokeWidth="1.5"
                          />
                          {/* Elipse extremo izquierdo X=0 */}
                          <ellipse
                            cx={xStart}
                            cy={cy0}
                            rx="7"
                            ry={h0 / 2}
                            fill="#334155"
                            stroke="#cbd5e1"
                            strokeWidth="1.2"
                          />
                          {/* Elipse extremo derecho X=L */}
                          <ellipse
                            cx={xEnd}
                            cy={cy1}
                            rx="7"
                            ry={h1 / 2}
                            fill="#1e293b"
                            stroke="#cbd5e1"
                            strokeWidth="1.2"
                          />

                          {/* Línea de costura Y=0° girando sobre la pared */}
                          <line
                            x1={xStart}
                            y1={seamY0}
                            x2={xEnd}
                            y2={seamY1}
                            stroke={seamFront ? '#fbbf24' : '#64748b'}
                            strokeWidth={seamFront ? '1.6' : '1'}
                            strokeDasharray="4 3"
                            opacity={seamFront ? 0.9 : 0.35}
                          />

                          {/* Etiquetas de Base vs Boca según colocación en mandril */}
                          <text
                            x={xStart + 6}
                            y={yTop + 12}
                            fill="#38bdf8"
                            fontSize="8"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {chuckSideLeft ? 'BASE (X=0)' : 'BOCA (X=0)'}
                          </text>
                          <text
                            x={xEnd - 6}
                            y={yTop + 12}
                            textAnchor="end"
                            fill="#38bdf8"
                            fontSize="8"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {chuckSideLeft ? 'BOCA' : 'BASE'}
                          </text>

                          {/* Logos/Copias proyectados girando alrededor del cilindro */}
                          {Array.from({ length: copies }).map((_, idx) => {
                            const phiDeg =
                              startAng + idx * sectorDeg + previewRotationDeg;
                            const phiRad = (phiDeg * Math.PI) / 180;
                            const cosP = Math.cos(phiRad);
                            const sinP = Math.sin(phiRad);
                            const avgH = (h0 + h1) / 2;
                            const centerY =
                              (cy0 + cy1) / 2 - (avgH / 2) * 0.72 * cosP;
                            const front = cosP >= 0 || sinP >= -0.15;
                            const apparentScaleY = Math.max(
                              0.22,
                              Math.abs(Math.sin(phiRad)) * 0.3 +
                                Math.max(0.25, Math.abs(cosP)) * 0.7
                            );
                            const rawBoxH = Math.min(h0, h1) * 0.42;
                            const boxH = Math.max(11, rawBoxH * apparentScaleY);
                            const activeLaser = cosP > 0.85;
                            const cxLogo = designBoxX + designBoxW / 2;
                            const cyLogo = Math.max(
                              yTop + boxH / 2 + 2,
                              Math.min(
                                Math.min(yBot0, yBot1) - boxH / 2 - 2,
                                centerY
                              )
                            );

                            return (
                              <g
                                key={idx}
                                opacity={front ? 0.95 : 0.22}
                              >
                                <rect
                                  x={designBoxX}
                                  y={cyLogo - boxH / 2}
                                  width={designBoxW}
                                  height={boxH}
                                  rx="3"
                                  fill={
                                    activeLaser
                                      ? 'rgba(34, 211, 238, 0.28)'
                                      : 'rgba(148, 163, 184, 0.14)'
                                  }
                                  stroke={
                                    activeLaser ? '#22d3ee' : '#64748b'
                                  }
                                  strokeWidth={activeLaser ? '1.6' : '1'}
                                  strokeDasharray="3 2"
                                />
                                {front && (
                                  <g
                                    transform={`translate(${cxLogo}, ${cyLogo}) rotate(${designRot})`}
                                  >
                                    <text
                                      x="0"
                                      y="3.5"
                                      textAnchor="middle"
                                      fill="#ffffff"
                                      fontSize="9.5"
                                      fontFamily="monospace"
                                      fontWeight="bold"
                                    >
                                      {copies > 1
                                        ? `#${idx + 1} ${design.name.slice(0, 10)} ↑`
                                        : `${design.name.slice(0, 14)} ↑`}
                                    </text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* Cotas de Diámetro Izquierdo, Derecho y Largo Axial */}
                          <text
                            x={xStart + 10}
                            y={yBot0 + 14}
                            fill="#fbbf24"
                            fontSize="9.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            X=0: Ø {config.objectDiameterMm} mm
                          </text>
                          <text
                            x={xEnd - 10}
                            y={yBot1 + 14}
                            textAnchor="end"
                            fill="#fbbf24"
                            fontSize="9.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            X={config.usefulLengthMm}mm: Ø{' '}
                            {isTapered(config)
                              ? config.endDiameterMm
                              : config.objectDiameterMm}{' '}
                            mm
                          </text>

                          {/* Suplemento de nivelación si es cónico */}
                          {layout.tapered && (
                            <g>
                              <polygon
                                points={`${xEnd - 25},164 ${xEnd + 35},164 ${xEnd + 35},${yBot1 + 18}`}
                                fill="rgba(245, 158, 11, 0.25)"
                                stroke="#f59e0b"
                                strokeWidth="1.2"
                              />
                              <text
                                x="612"
                                y="177"
                                textAnchor="end"
                                fill="#fcd34d"
                                fontSize="9"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                ▲ Suplementar +{physicalSetup.tailstockLiftMm} mm
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })()}
                  </svg>
                </div>
                  );
                  return rotary3DViewStyle === 'webgl' ? (
                    <Rotary3DViewport
                      config={config}
                      layout={layout}
                      physicalSetup={physicalSetup}
                      svgRaw={previewResult.svgRaw}
                      previewRotationDeg={previewRotationDeg}
                      isAutoRotating={isAutoRotating}
                      presetId={selectedPresetId}
                      vesselShape={vesselShape}
                      onVesselShapeChange={setVesselShape}
                      vesselSurface={vesselSurface}
                      onVesselSurfaceChange={setVesselSurface}
                      fallbackSvgContent={schematicView}
                    />
                  ) : (
                    schematicView
                  );
                })()}
              </div>
            )}

            {/* VISOR B: LIENZO 2D DESENROLLADO A ESCALA REAL 1:1 MM (CON REGLAS, COSTURA Y COPIAS) */}
            {(canvasMode === 'split' || canvasMode === '2d_unwrapped') && (
              <div className="flex-1 bg-[#0b1018] border border-slate-800 rounded-xl p-3 flex flex-col justify-between min-h-[250px]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/60 font-mono text-[10px] font-bold">
                      LIENZO DESENROLLADO 1:1 MM
                    </span>
                    <span className="text-xs font-bold text-white font-mono">
                      Ancho Axial X: {layout.canvasWidthMm} mm × Giro Circunferencia Y:{' '}
                      {layout.canvasHeightMm} mm ({config.arcDeg}°)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-300">
                    {layout.repeatCount} copia(s) · Ocupa {layout.designArcDeg}° de la vuelta
                  </span>
                </div>

                <div className="flex-1 bg-[#06090e] rounded-lg border border-slate-800 flex items-center justify-center p-3 overflow-hidden">
                  {preview ? (
                    <div className="relative flex flex-col items-center justify-center w-full h-full">
                      <div className="text-[10px] font-mono text-amber-300 mb-1 flex items-center gap-2">
                        <span>
                          ▼ BORDE SUPERIOR = COSTURA / ORIGEN PUNTERO LÁSER (Y = 0°) ▼
                        </span>
                      </div>
                      <div className="relative border-2 border-dashed border-emerald-500/70 bg-white rounded shadow-xl p-1 max-h-[230px] flex items-center justify-center">
                        <img
                          alt="Vista previa del objeto desenrollado"
                          src={preview}
                          className="max-h-[210px] w-auto object-contain"
                        />
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-1.5 flex items-center gap-4">
                        <span>◄ Izquierda: Extremo Mandril (X = 0 mm)</span>
                        <span>·</span>
                        <span>
                          Derecha: Extremo Libre (X = {layout.canvasWidthMm} mm) ►
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 text-center p-4">
                      Revisá las medidas del objeto a la derecha para previsualizar el desenrollado 1:1.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* BARRA INFERIOR DE RESUMEN TÉCNICO PARA CONFIGURAR LIGHTBURN ROTARY SETUP */}
          <div className="bg-[#0c111a] border-t border-slate-800 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded font-mono text-cyan-300 font-bold">
                LightBurn Rotary: {config.rotaryType === 'chuck' ? 'Chuck (Mandril)' : 'Roller (Rodillos)'}
              </span>
              <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded font-mono text-amber-300 font-bold">
                Object Diameter: Ø {layout.referenceDiameterMm} mm
              </span>
              <span className="bg-slate-900 border border-slate-800 px-2 py-1 rounded font-mono text-emerald-300 font-bold">
                Circunferencia: {layout.circumferenceMm} mm
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono">
              <span className="text-slate-300">
                C00:{' '}
                <strong className="text-white">
                  {layerParams.speedMmPerSec ?? '—'} mm/s ·{' '}
                  {layerParams.maxPowerPercent ?? '—'}% · Int.{' '}
                  {layerParams.lineIntervalMm} mm
                </strong>
              </span>
              <span className="text-slate-600">·</span>
              {physicalSetup.estimatedDurationSec > 0 ? (
                <button
                  type="button"
                  onClick={() => setSidebarTab('laser_c00')}
                  className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-600/50 text-emerald-300 font-bold hover:bg-emerald-900/70 transition"
                  title="Ver desglose de tiempo por pieza y por lote en 2. Velocidad y Potencia"
                >
                  ⏱️ Tiempo: ~{formatDurationSec(physicalSetup.estimatedDurationSec)}
                  {productionBatchQty > 1
                    ? ` · ${productionBatchQty}u: ~${formatDurationSec(batchTime.totalSec)}`
                    : ''}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSidebarTab('laser_c00')}
                  className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/50 text-amber-300 font-bold hover:bg-amber-900/60 transition"
                >
                  ⏱️ Tiempo: Definir Vel. →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* =====================================================================
            COLUMNA DERECHA: CONTROLES DEL ROTADOR EN 3 PESTAÑAS LIMPIAS Y ENFOCADAS
           ===================================================================== */}
        <aside className="w-[375px] lg:w-[420px] xl:w-[465px] bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-y-auto shrink-0">
          {/* BARRA DE PESTAÑAS SEGMENTADA (1 VISTA ENFOCADA A LA VEZ) */}
          <div className="sticky top-0 z-20 bg-[#111621]/95 backdrop-blur border-b border-slate-800 p-2">
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
              <button
                type="button"
                onClick={() => setSidebarTab('object')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarTab === 'object'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Objeto y Medidas
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('laser_c00')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarTab === 'laser_c00'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                2. Velocidad y Potencia
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('calibration')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarTab === 'calibration'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Calibrar Mandril
              </button>
            </div>
          </div>

          {statusBanner && (
            <div className="p-2.5 bg-emerald-950/70 border-b border-emerald-700/70 text-xs text-emerald-200 flex items-center justify-between">
              <span>{statusBanner}</span>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="text-emerald-300 hover:text-white ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 1: HARDWARE (MANDRIL SANOU / RODILLOS) Y MEDIDAS DEL OBJETO
             ===================================================================== */}
          {sidebarTab === 'object' && (
            <div className="p-4 space-y-3.5 text-xs">
              {/* 1.1 Selección de Perfil de Accesorio y Plantilla de Objeto en una sola tarjeta prolija */}
              <div className="bg-slate-900/75 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="grid grid-cols-1 gap-2.5">
                  <label className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">
                        Accesorio conectado al Eje Y:
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingProfile((v) => !v)}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
                      >
                        {isAddingProfile ? 'Cancelar' : '+ Nuevo perfil'}
                      </button>
                    </div>
                    <select
                      aria-label="Perfil de accesorio"
                      className={field}
                      value={selectedProfileId}
                      onChange={(e) => handleSelectProfile(e.target.value)}
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type === 'roller' ? 'Rodillos' : 'Mandril'})
                        </option>
                      ))}
                    </select>
                  </label>

                  {isAddingProfile && (
                    <div className="p-2.5 bg-slate-950 rounded-lg border border-cyan-500/40 flex gap-2">
                      <input
                        type="text"
                        placeholder="Nombre (ej: Mandril Sanou K11)"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 px-2.5 py-1 rounded text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={handleSaveProfile}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded"
                      >
                        Guardar
                      </button>
                    </div>
                  )}

                  <label className="space-y-1">
                    <span className="text-[11px] font-bold text-slate-300 block">
                      Plantilla rápida de objeto (Termos, Mates, Vasos):
                    </span>
                    <select
                      aria-label="Preset de objeto"
                      className={field}
                      value=""
                      onChange={(e) => {
                        const p = ROTARY_PRESETS.find(
                          (x) => x.id === e.target.value
                        );
                        if (p) {
                          setSelectedPresetId(p.id);
                          setVesselShape('auto');
                          setVesselSurface('auto');
                          if (
                            p.patch.rotaryType &&
                            p.patch.rotaryType !== config.rotaryType
                          ) {
                            handleToggleRotaryType(p.patch.rotaryType);
                          }
                          setConfig((c) => ({ ...c, ...p.patch }));
                        }
                      }}
                    >
                      <option value="">
                        Elegir termo, mate, vaso o botella de referencia…
                      </option>
                      {ROTARY_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          [{p.category}] {p.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Selector directo de Tipo de Producto y Material sincronizado en vivo con el Render 3D */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-cyan-300">
                        Tipo de Producto (Render 3D en vivo)
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {vesselShape === 'auto' ? 'Detección auto' : vesselShape.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {ROTARY_VESSEL_SHAPES.map((s) => {
                        const active = vesselShape === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setVesselShape(s.id);
                              if (s.id !== 'auto') setSelectedPresetId('');
                            }}
                            className={`py-1 px-1.5 rounded-lg text-[10px] font-bold border transition ${
                              active
                                ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/60'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 block">
                        Material / Acabado del producto:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {ROTARY_SURFACE_OPTIONS.map((opt) => {
                          const active = vesselSurface === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setVesselSurface(opt.id)}
                              className={`px-2 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 transition ${
                                active
                                  ? 'bg-slate-800 text-white border-cyan-500/60'
                                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
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
                  </div>
                </div>
              </div>

              {/* 1.2 Medidas principales del objeto con Sliders en tiempo real para generar el Render 3D */}
              <div className="bg-slate-900/75 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white text-xs">
                    Medidas del Producto (mm)
                  </span>
                  <div className="grid grid-cols-2 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsConicalMode(false);
                        setConfig((c) => ({ ...c, endDiameterMm: undefined }));
                      }}
                      className={`px-2 py-0.5 rounded font-bold transition ${
                        !isConicalMode
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Recto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsConicalMode(true);
                        const nextEnd =
                          config.endDiameterMm ??
                          lastEndDiameterRef.current ??
                          Math.max(15, roundMm((config.objectDiameterMm || 80) * 0.78, 1));
                        setEndDiameterStr(String(nextEnd));
                        setConfig((c) => ({
                          ...c,
                          endDiameterMm: nextEnd,
                        }));
                      }}
                      className={`px-2 py-0.5 rounded font-bold transition ${
                        isConicalMode
                          ? 'bg-amber-500/20 text-amber-200 border border-amber-500/50'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Cónico
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-emerald-300 font-semibold">
                        {isTapered(config)
                          ? 'Diámetro Base / Inicio X=0 (mm)'
                          : 'Diámetro del Producto (mm)'}
                      </span>
                      <input
                        aria-label="Diámetro inicial X=0 (mm)"
                        className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-white text-right focus:border-cyan-500 focus:outline-none"
                        type="number"
                        min={5}
                        max={300}
                        step="0.5"
                        value={val(config.objectDiameterMm)}
                        onChange={num('objectDiameterMm')}
                      />
                    </div>
                    <input
                      type="range"
                      aria-label="Slider diámetro inicial (mm)"
                      min={20}
                      max={160}
                      step={1}
                      value={Math.max(20, Math.min(160, config.objectDiameterMm || 75))}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          objectDiameterMm: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-emerald-400 cursor-pointer h-1.5"
                    />
                  </div>

                  {isConicalMode && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-amber-300 font-semibold">
                          Diámetro Boca / Fin X=largo (mm)
                        </span>
                        <input
                          aria-label="Diámetro final X=largo (mm)"
                          className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-white text-right focus:border-cyan-500 focus:outline-none"
                          type="number"
                          min={5}
                          max={300}
                          step="0.5"
                          value={endDiameterStr}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEndDiameterStr(raw);
                            const v = Number(raw.replace(',', '.'));
                            if (raw.trim() !== '' && Number.isFinite(v) && v >= 5) {
                              lastEndDiameterRef.current = v;
                              setConfig((c) => ({ ...c, endDiameterMm: v }));
                            }
                          }}
                          onBlur={() => {
                            if (endDiameterStr.trim() === '') {
                              const fallback =
                                lastEndDiameterRef.current ??
                                Math.max(15, roundMm((config.objectDiameterMm || 80) * 0.78, 1));
                              setEndDiameterStr(String(fallback));
                              setConfig((c) => ({ ...c, endDiameterMm: fallback }));
                            }
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        aria-label="Slider diámetro final (mm)"
                        min={20}
                        max={160}
                        step={1}
                        value={Math.max(20, Math.min(160, config.endDiameterMm || 65))}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          lastEndDiameterRef.current = v;
                          setEndDiameterStr(String(v));
                          setConfig((c) => ({
                            ...c,
                            endDiameterMm: v,
                          }));
                        }}
                        className="w-full accent-amber-400 cursor-pointer h-1.5"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-300 font-semibold">
                          Largo útil X (mm)
                        </span>
                        <input
                          aria-label="Largo útil axial X (mm)"
                          className="w-20 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs font-mono text-white text-right focus:border-cyan-500 focus:outline-none"
                          type="number"
                          min={10}
                          max={900}
                          step="1"
                          value={val(config.usefulLengthMm)}
                          onChange={num('usefulLengthMm')}
                        />
                      </div>
                      <input
                        type="range"
                        aria-label="Slider largo útil axial (mm)"
                        min={30}
                        max={260}
                        step={1}
                        value={Math.max(30, Math.min(260, config.usefulLengthMm || 100))}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            usefulLengthMm: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-cyan-400 cursor-pointer h-1.5"
                      />
                    </div>

                    <label className="space-y-1">
                      <span className="text-[10px] text-cyan-300 font-semibold block">
                        Copias (1..36)
                      </span>
                      <input
                        aria-label="Copias alrededor (1..36)"
                        className={field}
                        type="number"
                        min={1}
                        max={36}
                        step="1"
                        value={val(config.repeatCount, 1)}
                        onChange={num('repeatCount')}
                      />
                    </label>
                  </div>
                </div>

                {/* Orientación rápida del logo y lado agarrado por el mandril */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-300 font-semibold">
                      Orientación del logo sobre la pieza
                    </span>
                    <span className="font-mono text-[10px] text-cyan-300">
                      {layout.effectiveDesignWidthMm} × {layout.effectiveDesignHeightMm} mm
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { deg: 0, label: '0° Horiz.' },
                      { deg: 90, label: '90° Vert.' },
                      { deg: 180, label: '180° Inv.' },
                      { deg: 270, label: '270° Vert.' },
                    ] as const).map((opt) => {
                      const active = (config.designRotationDeg ?? 0) === opt.deg;
                      return (
                        <button
                          key={opt.deg}
                          type="button"
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              designRotationDeg: opt.deg,
                            }))
                          }
                          className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold border transition ${
                            active
                              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/60'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((c) => ({ ...c, chuckSide: 'left_base' }))
                      }
                      className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition ${
                        (config.chuckSide ?? 'left_base') === 'left_base'
                          ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/50'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      Mandril agarra Base (X=0)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((c) => ({ ...c, chuckSide: 'left_rim' }))
                      }
                      className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition ${
                        config.chuckSide === 'left_rim'
                          ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/50'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      Mandril agarra Boca (X=0)
                    </button>
                  </div>

                  {onDesignChange && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-300 font-semibold">
                          Tamaño del logo a grabar (mm)
                        </span>
                        <span className="font-mono text-[10px] text-emerald-300">
                          Proporcional
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-slate-400 block">
                            Ancho base (mm)
                          </span>
                          <input
                            className={field}
                            type="number"
                            min={2}
                            max={600}
                            step="0.5"
                            aria-label="Ancho del logo en rotativo (mm)"
                            value={rotaryLogoWStr}
                            onFocus={() => {
                              editingRotaryLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleRotaryLogoWidthInput(e.target.value)
                            }
                            onBlur={() => {
                              editingRotaryLogoSizeRef.current = false;
                              setRotaryLogoWStr(
                                String(roundMm(design.widthMm, 2))
                              );
                              setRotaryLogoHStr(
                                String(roundMm(design.heightMm, 2))
                              );
                            }}
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-slate-400 block">
                            Alto base (mm)
                          </span>
                          <input
                            className={field}
                            type="number"
                            min={2}
                            max={600}
                            step="0.5"
                            aria-label="Alto del logo en rotativo (mm)"
                            value={rotaryLogoHStr}
                            onFocus={() => {
                              editingRotaryLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleRotaryLogoHeightInput(e.target.value)
                            }
                            onBlur={() => {
                              editingRotaryLogoSizeRef.current = false;
                              setRotaryLogoWStr(
                                String(roundMm(design.widthMm, 2))
                              );
                              setRotaryLogoHStr(
                                String(roundMm(design.heightMm, 2))
                              );
                            }}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            applyRotaryLogoDimensions(
                              design.widthMm * 0.85,
                              design.heightMm * 0.85
                            )
                          }
                          className="py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-semibold text-slate-300"
                        >
                          −15%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            applyRotaryLogoDimensions(
                              design.widthMm * 1.15,
                              design.heightMm * 1.15
                            )
                          }
                          className="py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-semibold text-slate-300"
                        >
                          +15%
                        </button>
                        <button
                          type="button"
                          onClick={handleFitLogoToRotaryObject}
                          className="py-1 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/50 text-[10px] font-bold text-cyan-200"
                        >
                          Ajustar al vaso
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ajustes secundarios de posición y arco en un desplegable limpio */}
                <details className="group pt-1 border-t border-slate-800/80">
                  <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 font-medium select-none">
                    Más opciones de posición y sujeción ▾
                  </summary>
                  <div className="grid grid-cols-2 gap-2.5 pt-2.5">
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Tipo de sujeción
                      </span>
                      <select
                        className={field}
                        value={config.rotaryType}
                        onChange={(e) =>
                          handleToggleRotaryType(e.target.value as RotaryType)
                        }
                      >
                        <option value="chuck">Mandril 3 Mordazas (Chuck)</option>
                        <option value="roller">Rodillos (Roller)</option>
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Arco útil (°)
                      </span>
                      <input
                        className={field}
                        type="number"
                        min={1}
                        max={360}
                        step="1"
                        value={val(config.arcDeg)}
                        onChange={num('arcDeg')}
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Desplazamiento axial X (mm)
                      </span>
                      <input
                        className={field}
                        type="number"
                        step="0.5"
                        value={val(config.axisOffsetMm, 0)}
                        onChange={num('axisOffsetMm')}
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Giro del diseño Y (°)
                      </span>
                      <input
                        className={field}
                        type="number"
                        step="1"
                        value={val(config.angularOffsetDeg, 0)}
                        onChange={num('angularOffsetDeg')}
                      />
                    </label>
                  </div>
                </details>
              </div>

              {/* Alerta técnica y calculadora de nivelación física cuando es Objeto Cónico */}
              {layout.tapered && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs space-y-1.5 text-amber-200">
                  <div className="font-bold flex items-center justify-between text-amber-300">
                    <span>📐 Nivelación de Cono para Foco Z</span>
                    <span className="font-mono text-[10px] bg-amber-950 px-2 py-0.5 rounded border border-amber-600/60">
                      +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-200">
                    Levantá el extremo más angosto{' '}
                    <strong className="text-amber-300">
                      +{physicalSetup.tailstockLiftMm} mm
                    </strong>{' '}
                    para que la cara superior quede horizontal al cabezal láser. En LightBurn Rotary Setup ingresá{' '}
                    <strong className="text-cyan-300">
                      Object Diameter = Ø {layout.referenceDiameterMm} mm
                    </strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 2: VELOCIDAD, POTENCIA E INTERVALO DE GRABADO ROTATIVO (CAPA C00)
             ===================================================================== */}
          {sidebarTab === 'laser_c00' && (
            <div className="p-4 space-y-3.5 text-xs">
              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">
                    Parámetros de Grabado Rotativo (Capa C00)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[10px] text-cyan-300">
                    {Math.round(
                      25.4 / Math.max(0.02, layerParams.lineIntervalMm)
                    )}{' '}
                    DPI
                  </span>
                </div>

                {/* Selector desplegable limpio en vez de múltiples botones apilados */}
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">
                    Cargar referencia orientativa de taller:
                  </span>
                  <select
                    className={field}
                    value=""
                    onChange={(e) => {
                      const presets = [
                        {
                          id: 'vank_lb',
                          speed: 600,
                          maxP: 30,
                          minP: 30,
                          intMm: 0.073,
                          mode: 'image' as const,
                        },
                        {
                          id: 'powder_coat',
                          speed: 350,
                          maxP: 28,
                          minP: 22,
                          intMm: 0.073,
                          mode: 'fill' as const,
                        },
                        {
                          id: 'mate_wood',
                          speed: 250,
                          maxP: 22,
                          minP: 18,
                          intMm: 0.08,
                          mode: 'fill' as const,
                        },
                        {
                          id: 'glass',
                          speed: 200,
                          maxP: 18,
                          minP: 15,
                          intMm: 0.08,
                          mode: 'fill' as const,
                        },
                      ];
                      const match = presets.find((p) => p.id === e.target.value);
                      if (match) {
                        setLayerParams((prev) => ({
                          ...prev,
                          mode: match.mode,
                          speedMmPerSec: match.speed,
                          maxPowerPercent: match.maxP,
                          minPowerPercent: match.minP,
                          lineIntervalMm: match.intMm,
                        }));
                      }
                    }}
                  >
                    <option value="">Elegir referencia orientativa…</option>
                    <option value="vank_lb">
                      Preset LightBurn Vank 9060 (600 mm/s · 30% · 0.073 mm)
                    </option>
                    <option value="powder_coat">
                      Termo Pintado / Powder Coat (350 mm/s · 28% · 0.073 mm)
                    </option>
                    <option value="mate_wood">
                      Mate Madera / Cuero (250 mm/s · 22% · 0.080 mm)
                    </option>
                    <option value="glass">
                      Vaso de Vidrio / Cristal (200 mm/s · 18% · 0.080 mm)
                    </option>
                  </select>
                </label>

                {/* Los 4 parámetros principales en una grilla 2x2 súper clara */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-slate-300">
                      Modo LightBurn
                    </span>
                    <select
                      value={layerParams.mode}
                      onChange={(e) =>
                        setLayerParams((p) => ({
                          ...p,
                          mode: e.target.value as 'image' | 'fill' | 'line',
                        }))
                      }
                      className={field}
                    >
                      <option value="image">Imagen</option>
                      <option value="fill">Relleno (Fill)</option>
                      <option value="line">Línea</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-emerald-300">
                      Velocidad (mm/s)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      step={5}
                      placeholder="Ej: 350"
                      value={layerParams.speedMmPerSec ?? ''}
                      onChange={(e) =>
                        setLayerParams((p) => ({
                          ...p,
                          speedMmPerSec:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        }))
                      }
                      className={field}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-amber-300">
                      Potencia Máx (%)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={0.5}
                      placeholder="Ej: 30"
                      value={layerParams.maxPowerPercent ?? ''}
                      onChange={(e) => {
                        const v =
                          e.target.value === '' ? null : Number(e.target.value);
                        setLayerParams((p) => ({
                          ...p,
                          maxPowerPercent: v,
                          minPowerPercent:
                            p.minPowerPercent === null && v !== null
                              ? v
                              : p.minPowerPercent,
                        }));
                      }}
                      className={field}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold text-cyan-300">
                      Intervalo (mm)
                    </span>
                    <input
                      type="number"
                      min={0.02}
                      max={1.0}
                      step={0.001}
                      value={layerParams.lineIntervalMm}
                      onChange={(e) =>
                        setLayerParams((p) => ({
                          ...p,
                          lineIntervalMm: roundMm(
                            Math.max(0.02, Number(e.target.value) || 0.073),
                            3
                          ),
                        }))
                      }
                      className={field}
                    />
                  </label>
                </div>

                {/* Opciones secundarias de capa en un desplegable limpio */}
                <details className="group pt-2 border-t border-slate-800/80">
                  <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 font-medium select-none">
                    Opciones avanzadas (Potencia mín, Pasadas, Overscan) ▾
                  </summary>
                  <div className="space-y-3 pt-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400 block">
                          Pot. Mín (%)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          placeholder="25"
                          value={layerParams.minPowerPercent ?? ''}
                          onChange={(e) =>
                            setLayerParams((p) => ({
                              ...p,
                              minPowerPercent:
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                            }))
                          }
                          className={field}
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400 block">
                          Pasadas
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={layerParams.passes}
                          onChange={(e) =>
                            setLayerParams((p) => ({
                              ...p,
                              passes: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className={field}
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400 block">
                          Overscan (%)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={15}
                          step={0.5}
                          value={layerParams.overscanPercent}
                          onChange={(e) =>
                            setLayerParams((p) => ({
                              ...p,
                              overscanPercent: Math.max(
                                0,
                                Number(e.target.value) || 0
                              ),
                            }))
                          }
                          className={field}
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-slate-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={layerParams.bidirectional}
                          onChange={(e) =>
                            setLayerParams((p) => ({
                              ...p,
                              bidirectional: e.target.checked,
                            }))
                          }
                          className="accent-emerald-500"
                        />
                        <span>Bidireccional</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={layerParams.crossHatch}
                          onChange={(e) =>
                            setLayerParams((p) => ({
                              ...p,
                              crossHatch: e.target.checked,
                            }))
                          }
                          className="accent-cyan-500"
                        />
                        <span>Cruzado 90°</span>
                      </label>
                    </div>
                  </div>
                </details>
              </div>

              {/* Tarjeta dedicada de Tiempo de Producción (1 pieza y lote completo) */}
              <div className="bg-slate-900/85 p-3.5 rounded-xl border border-emerald-800/60 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-emerald-300 text-xs">
                    ⏱️ Tiempo Estimado de Producción
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    {physicalSetup.estimatedScanLines} {layerParams.mode === 'line' ? 'trazos' : 'líneas'} · {physicalSetup.timeBreakdown.effectiveDpi} DPI
                  </span>
                </div>

                {physicalSetup.estimatedDurationSec > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">
                          1 pieza ({layout.repeatCount} copia{layout.repeatCount > 1 ? 's' : ''})
                        </span>
                        <span className="font-mono text-sm font-extrabold text-emerald-400">
                          ~{formatDurationSec(physicalSetup.estimatedDurationSec)}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500 block">
                          Láser {Math.round(physicalSetup.timeBreakdown.scanOrCutSec)}s + Giros {Math.round(physicalSetup.timeBreakdown.turnaroundAndIndexSec)}s
                        </span>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">
                          Lote ({productionBatchQty} pieza{productionBatchQty > 1 ? 's' : ''})
                        </span>
                        <span className="font-mono text-sm font-extrabold text-cyan-300">
                          ~{formatDurationSec(batchTime.totalSec)}
                        </span>
                        <span className="text-[9px] font-mono text-slate-500 block">
                          {productionBatchQty > 1
                            ? `Incl. ~${Math.round(batchTime.handlingSec / 60)}m recambio`
                            : 'Cambiar cantidad abajo'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1.5 text-[10px]">
                      <span className="text-slate-400">Calcular lote de:</span>
                      <div className="flex items-center gap-1">
                        {[1, 10, 24, 50].map((qty) => (
                          <button
                            key={qty}
                            type="button"
                            onClick={() => setProductionBatchQty(qty)}
                            className={`px-2 py-0.5 rounded font-mono font-bold border transition ${
                              productionBatchQty === qty
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {qty}u
                          </button>
                        ))}
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          aria-label="Cantidad de piezas del lote rotativo"
                          value={productionBatchQty}
                          onChange={(e) =>
                            setProductionBatchQty(Math.max(1, Math.round(Number(e.target.value) || 1)))
                          }
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[10px] text-white text-center"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-amber-200 bg-amber-950/30 border border-amber-700/40 rounded-lg p-2">
                    Cargá arriba una <strong>Velocidad (mm/s)</strong> o elegí un preset de referencia para calcular el tiempo exacto por pieza y por lote.
                  </p>
                )}

                {physicalSetup.timeBreakdown.recommendedMaxRollerSpeedWarning && (
                  <p className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-700/50 rounded px-2 py-1">
                    ⚠ {physicalSetup.timeBreakdown.recommendedMaxRollerSpeedWarning}
                  </p>
                )}
              </div>

              {/* Recetas rotativas guardadas (Objeto + Parámetros C00) */}
              <div className="bg-slate-900/75 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                    <span>Recetas Rotativas Guardadas ({recipes.length})</span>
                  </span>
                </div>

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Nombre (ej: Termo 1L Negro mate)"
                    value={recipeNameInput}
                    onChange={(e) => setRecipeNameInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 px-2.5 py-1.5 rounded-lg text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveRecipe}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 font-bold text-xs rounded-lg whitespace-nowrap"
                  >
                    + Guardar
                  </button>
                </div>

                {recipes.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                    {recipes.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-2 bg-slate-950/90 border border-slate-800 px-2.5 py-1.5 rounded-lg"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-white truncate">
                            {r.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            Ø{r.objectDiameterMm}
                            {r.endDiameterMm ? `→${r.endDiameterMm}` : ''}mm ·{' '}
                            {r.speedMmPerSec ?? '—'}mm/s · {r.maxPowerPercent ?? '—'}%
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplyRecipe(r)}
                            className="px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold"
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecipe(r.id)}
                            title="Eliminar receta"
                            className="p-1 rounded hover:bg-red-950/70 text-slate-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Guardá combinaciones probadas en tu taller (medidas + velocidad + potencia C00) para reutilizarlas con 1 clic.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 3: CALIBRACIÓN DE PASOS POR VUELTA (MANDRIL SANOU / RODILLOS)
             ===================================================================== */}
          {sidebarTab === 'calibration' && (
            <div className="p-4 space-y-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-cyan-400" />
                  <span>Pasos por Vuelta (Mandril Sanou)</span>
                </span>
                <button
                  type="button"
                  disabled={!layout.valid || !hasVisibleEngraving}
                  onClick={handleSaveTestPattern}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[11px] font-semibold disabled:opacity-40"
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Descargar Patrón SVG</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {config.rotaryType === 'roller' && (
                  <label className="space-y-1">
                    <span className="text-slate-300">
                      Diámetro del rodillo motriz (mm):
                    </span>
                    <input
                      aria-label="Diámetro del rodillo motriz (mm)"
                      className={field}
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={val(config.rollerDiameterMm)}
                      placeholder="Medir con calibre"
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          rollerDiameterMm:
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="text-slate-300">
                    Pasos por vuelta (steps/rotation):
                  </span>
                  <input
                    aria-label="Pasos por vuelta"
                    className={field}
                    type="number"
                    min="0.001"
                    step="1"
                    value={val(config.stepsPerRotation)}
                    placeholder="3200 (ilustrativo)"
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        stepsPerRotation:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                      }))
                    }
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-slate-300">
                    Orientación de montaje (+Y):
                  </span>
                  <select
                    aria-label="Sentido de giro"
                    className={field}
                    value={config.rotationDirection || 'normal'}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        rotationDirection: e.target.value as RotaryDirection,
                      }))
                    }
                  >
                    <option value="normal">Normal (+Y avance horario)</option>
                    <option value="inverted">
                      Invertido (dirección invertida)
                    </option>
                  </select>
                </label>
              </div>

              {physicalSetup.stepResolutionUm !== null && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] font-mono">
                  <span className="text-slate-400">
                    Resolución superficial Eje Y (Ø {layout.referenceDiameterMm} mm):
                  </span>
                  <span className="text-cyan-300 font-bold">
                    {physicalSetup.stepResolutionUm} µm/paso
                  </span>
                </div>
              )}

              {/* Pestañas de método de calibración */}
              <div className="border-t border-slate-800 pt-2.5 space-y-2.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCalibMethod('angular')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border ${
                      calibMethod === 'angular'
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Método 1: Prueba de Giro 360°
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalibMethod('linear')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border ${
                      calibMethod === 'linear'
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Método 2: Medición Lineal (Calibre/Cinta)
                  </button>
                </div>

                {calibMethod === 'angular' ? (
                  <div className="space-y-2.5 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
                    <p className="text-[11px] text-slate-300">
                      Ejecutá el botón <em>Test</em> en LightBurn Rotary Setup. Si el mandril Sanou no regresó exacto a la marca de 360°, ingresá los grados reales observados:
                    </p>
                    <div className="flex items-end gap-2">
                      <label className="flex-1">
                        <span className="text-[11px] text-slate-300 block mb-1">
                          Giro real observado (°):
                        </span>
                        <input
                          aria-label="Giro medido en Test (grados)"
                          className={field}
                          type="number"
                          min="1"
                          max="720"
                          step="0.5"
                          value={
                            Number.isFinite(measuredDegrees)
                              ? measuredDegrees
                              : ''
                          }
                          onChange={(e) =>
                            setMeasuredDegrees(e.target.valueAsNumber)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={angularCorrection === null}
                        onClick={handleProposeAngularCalib}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-bold rounded-lg disabled:opacity-40 text-xs"
                      >
                        1. Guardar propuesta (
                        {angularCorrection ? `${angularCorrection} pasos` : '—'}
                        )
                      </button>
                    </div>

                    {activeProfile?.calibrationStatus ===
                      'calculated_pending' && (
                      <div className="p-2.5 bg-cyan-950/40 border border-cyan-500/40 rounded-lg flex items-center justify-between gap-2">
                        <div className="text-[11px] text-cyan-200">
                          Paso 2: Probá en la Vank 9060 con{' '}
                          <strong>
                            {activeProfile.proposedStepsPerRotation ||
                              angularCorrection}
                          </strong>{' '}
                          pasos. Si dio 360° exactos:
                        </div>
                        <button
                          type="button"
                          onClick={handleConfirmVerificationAngular}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold text-xs rounded-lg shrink-0"
                        >
                          Confirmar verificación física
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setLinearMode('caliper_chord')}
                        className={`p-2 rounded-lg text-left border ${
                          linearMode === 'caliper_chord'
                            ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-xs">
                          📐 Calibre digital (Pie de rey)
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Mide cuerda recta. Válido sólo en cilindros rectos.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinearMode('surface_arc')}
                        className={`p-2 rounded-lg text-left border ${
                          linearMode === 'surface_arc'
                            ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="font-bold text-xs">
                          📏 Cinta flexible / Papel
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Mide arco sobre la superficie (cilindros o conos).
                        </div>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="text-[11px] text-slate-300 block mb-0.5">
                          Cota nominal esperada (mm):
                        </span>
                        <input
                          className={field}
                          type="number"
                          min="5"
                          max="300"
                          step="0.5"
                          value={expectedLinearMm}
                          onChange={(e) =>
                            setExpectedLinearMm(Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        <span className="text-[11px] text-slate-300 block mb-0.5">
                          {linearMode === 'caliper_chord'
                            ? 'Medida con calibre (cuerda mm):'
                            : 'Medida con cinta (arco mm):'}
                        </span>
                        <input
                          className={field}
                          type="number"
                          min="0.1"
                          max="300"
                          step="0.05"
                          value={measuredLinearMm}
                          onChange={(e) =>
                            setMeasuredLinearMm(Number(e.target.value))
                          }
                        />
                      </label>
                    </div>

                    {detailedLinearResult.valid ? (
                      <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-[11px] space-y-1">
                        {linearMode === 'caliper_chord' && (
                          <p className="text-cyan-300">
                            Compensación de curvatura (Ø{' '}
                            {config.objectDiameterMm} mm): Cuerda{' '}
                            {measuredLinearMm} mm → Arco real:{' '}
                            <strong>
                              {detailedLinearResult.effectiveRealArcMm.toFixed(
                                2
                              )}{' '}
                              mm
                            </strong>
                          </p>
                        )}
                        {detailedLinearResult.warning && (
                          <p className="text-amber-300 bg-amber-500/10 p-1.5 rounded border border-amber-500/30">
                            ⚠️ {detailedLinearResult.warning}
                          </p>
                        )}
                        <div className="flex justify-between items-center text-slate-300 pt-0.5">
                          <span>
                            Relación:{' '}
                            <strong>
                              {detailedLinearResult.ratio.toFixed(4)}
                            </strong>
                          </span>
                          <span className="text-cyan-300 font-bold">
                            Pasos propuestos:{' '}
                            {detailedLinearResult.computedSteps}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 p-2 rounded">
                        {detailedLinearResult.error}
                      </p>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={!detailedLinearResult.valid}
                        onClick={handleProposeLinearCalib}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-bold rounded-lg disabled:opacity-40 text-xs"
                      >
                        1. Guardar propuesta (
                        {detailedLinearResult.valid
                          ? `${detailedLinearResult.computedSteps} pasos`
                          : '—'}
                        )
                      </button>
                      {activeProfile?.calibrationStatus ===
                        'calculated_pending' && (
                        <button
                          type="button"
                          onClick={handleConfirmVerificationLinear}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold rounded-lg text-xs"
                        >
                          2. Confirmar verificación física
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {calibHistory.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 text-[11px]">
                    <span className="text-slate-400 block mb-1 font-semibold">
                      Últimas calibraciones registradas:
                    </span>
                    <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-400">
                      {calibHistory.slice(0, 4).map((r) => (
                        <div
                          key={r.id}
                          className="flex justify-between bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80"
                        >
                          <span>
                            {r.method === 'angular_360'
                              ? 'Prueba 360°'
                              : 'Calibre lineal'}
                          </span>
                          <span className="truncate mx-2">
                            {r.operatorNotes}
                          </span>
                          <span className="text-cyan-400 font-bold shrink-0">
                            {r.computedSteps} pasos
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ERRORES Y ADVERTENCIAS GEOMÉTRICAS */}
          <div className="p-3.5 space-y-2 text-xs">
            {!hasVisibleEngraving && (
              <p
                role="alert"
                className="text-xs text-red-300 bg-red-950/50 border border-red-700 p-2.5 rounded-lg font-semibold"
              >
                El diseño no contiene elementos de grabado visibles para exportar. Agregá texto o un logo antes de generar los archivos.
              </p>
            )}
            {previewResult.error && (
              <p
                role="alert"
                className="text-xs text-red-300 bg-red-950/50 border border-red-700 p-2.5 rounded-lg"
              >
                {previewResult.error}
              </p>
            )}
            {layout.errors.map((m) => (
              <p
                key={m}
                role="alert"
                className="text-xs text-red-300 bg-red-950/50 border border-red-700 p-2.5 rounded-lg"
              >
                {m}
              </p>
            ))}
            {saveError && (
              <p
                role="alert"
                className="text-xs text-red-300 bg-red-950/50 border border-red-700 p-2.5 rounded-lg"
              >
                {saveError}
              </p>
            )}
            {layout.warnings.map((m) => (
              <p
                key={m}
                className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/60 p-2 rounded-lg"
              >
                • {m}
              </p>
            ))}
          </div>

          {/* DOCK FIJO INFERIOR DE EXPORTACIÓN Y CONEXIÓN DIRECTA CON VANK 9060 / LIGHTBURN */}
          <div className="sticky bottom-0 z-20 mt-auto bg-[#0f1520]/95 backdrop-blur border-t border-slate-700 p-3 space-y-2 text-xs shadow-2xl">
            {/* Conexión directa UDP con Ruida RDC8445S + Descarga USB .RD */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  Vank IP:
                </span>
                <input
                  type="text"
                  aria-label="IP Vank 9060"
                  value={ruidaIp}
                  onChange={(e) => setRuidaIp(e.target.value)}
                  className="flex-1 min-w-[116px] bg-slate-900 border border-slate-700 px-2 py-1 rounded text-[11px] font-mono text-cyan-200 focus:border-cyan-500 focus:outline-none"
                />
                <input
                  type="text"
                  maxLength={8}
                  aria-label="Nombre archivo en Vank"
                  value={rotaryJobName}
                  onChange={(e) => setRotaryJobName(e.target.value.toUpperCase())}
                  placeholder="ROTAT01"
                  className="w-16 bg-slate-900 border border-slate-700 px-1 py-1 rounded text-[10px] font-mono text-amber-200 uppercase text-center focus:border-cyan-500 focus:outline-none shrink-0"
                />
                <button
                  type="button"
                  onClick={() => void handleProbeRuidaConnection()}
                  disabled={!!ruidaStatus?.probing}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 shrink-0"
                >
                  <Wifi
                    className={`w-3 h-3 ${
                      ruidaStatus?.udpHandshakeOk
                        ? 'text-emerald-400'
                        : 'text-cyan-400'
                    }`}
                  />
                  <span>{ruidaStatus?.probing ? 'Probando…' : 'Probar Red'}</span>
                </button>
              </div>

              {ruidaStatus?.sending && ruidaStatus.progress && (
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div
                    className="bg-amber-400 h-full transition-all duration-150"
                    style={{ width: `${ruidaStatus.progress.percent}%` }}
                  />
                </div>
              )}

              {ruidaStatus?.message && (
                <p
                  className={`text-[10px] leading-snug px-2 py-1 rounded border ${
                    ruidaStatus.udpHandshakeOk || (ruidaStatus.reachable && !ruidaStatus.probing && ruidaStatus.message.startsWith('✓'))
                      ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                      : 'bg-amber-950/40 border-amber-700/60 text-amber-200'
                  }`}
                >
                  {ruidaStatus.message}
                </p>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={
                    !layout.valid ||
                    !hasVisibleEngraving ||
                    !!previewResult.error ||
                    !!ruidaStatus?.sending
                  }
                  onClick={() => void handleRotaryRdAction('send')}
                  className="py-2 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-extrabold text-[11px] flex items-center justify-center gap-1.5 shadow transition"
                >
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {ruidaStatus?.sending
                      ? 'Enviando…'
                      : 'Enviar a Vank (.RD)'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={
                    !layout.valid ||
                    !hasVisibleEngraving ||
                    !!previewResult.error
                  }
                  onClick={() => void handleRotaryRdAction('download')}
                  className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-200 border border-amber-500/40 font-bold text-[11px] flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Guardar .RD (USB)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 cursor-pointer text-cyan-200 font-semibold">
                <input
                  type="checkbox"
                  checked={withLbrn2}
                  onChange={(e) => setWithLbrn2(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span>Incluir Proyecto LightBurn (.lbrn2)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  disabled={rasterOnly}
                  checked={withDxf}
                  onChange={(e) => setWithDxf(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span>DXF RDWorks</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={withGuides}
                  onChange={(e) => setWithGuides(e.target.checked)}
                  className="accent-orange-500"
                />
                <span>Guías T1</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={
                  !layout.valid || !hasVisibleEngraving || !!previewResult.error
                }
                onClick={() => void handleOpenInLightBurn()}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-lg transition"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>
                  {isTauri()
                    ? 'Abrir en LightBurn (.lbrn2)'
                    : 'Descargar LightBurn (.lbrn2)'}
                </span>
              </button>

              <button
                type="button"
                disabled={
                  !layout.valid || !hasVisibleEngraving || !!previewResult.error
                }
                onClick={save}
                className="py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-lg transition"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>Guardar archivos de producción</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
