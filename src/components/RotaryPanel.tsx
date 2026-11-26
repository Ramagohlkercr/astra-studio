import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  FlaskConical,
  Layers,
  RotateCw,
  Ruler,
  Save,
  Sliders,
  Sparkles,
  Target,
  Undo2,
  X,
} from 'lucide-react';
import {
  computeRotaryLayout,
  computeRotaryPhysicalSetup,
  correctedRotarySteps,
  DEFAULT_ROTARY_LAYER_PARAMS,
  diameterAtX,
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
  LinearMeasurementMode,
  loadRotaryAccessoryProfiles,
  loadRotaryCalibrationHistory,
  recordProposedCalibration,
  revertCalibrationOnProfile,
  RotaryAccessoryProfile,
  RotaryCalibrationRecord,
  RotaryDirection,
  saveRotaryAccessoryProfile,
} from '../core/rotary/rotaryProfiles';
import {
  exportRotaryDxf,
  exportRotaryGuideSvg,
  exportRotarySvg,
  exportRotaryTestPatternSvg,
  exportRotaryToLbrn2,
} from '../core/exporters/rotaryExporter';
import { LogoOutputFile } from '../core/exporters/logoFolder';
import { roundMm } from '../core/geometry/geometryEngine';
import { LabelDesign } from '../core/types';

interface Props {
  design: LabelDesign;
  config: RotaryConfig;
  onConfigChange: (c: RotaryConfig) => void;
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
  onSave,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const setConfig = (update: (c: RotaryConfig) => RotaryConfig) =>
    onConfigChange(update(config));

  // Pestaña activa del panel lateral derecho
  const [sidebarTab, setSidebarTab] = useState<
    'all' | 'object' | 'laser_c00' | 'calibration'
  >('all');

  // Vista del visor izquierdo: 'split' (3D Mandril arriba + 2D Desenrollado abajo), '3d_chuck', '2d_unwrapped'
  const [canvasMode, setCanvasMode] = useState<
    'split' | '3d_chuck' | '2d_unwrapped'
  >('split');

  // Ángulo de rotación interactivo para girar el vaso/termo 360° en el simulador 3D
  const [previewRotationDeg, setPreviewRotationDeg] = useState<number>(0);

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

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

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
      const art = exportRotarySvg(design, config);
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
    <dialog
      ref={dialog}
      className="studio-orders-dialog fixed inset-0 z-50 w-full h-full max-w-none max-h-none m-0 p-0 bg-[#070a0e]/95 backdrop-blur-sm flex flex-col text-slate-100 select-none"
      aria-labelledby="rotary-title"
      onCancel={onClose}
    >
      {/* 1. CABECERA SUPERIOR DE LA ESTACIÓN ROTATIVA VANK 9060 */}
      <header className="min-h-14 py-2 bg-[#11161f] border-b border-slate-800 px-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <RotateCw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                id="rotary-title"
                className="text-sm font-bold text-white truncate"
              >
                Accesorio Rotativo — Vank 9060 CO₂ (Mandril Sanou & Rodillos)
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
                Ruida RDC8445S · Eje Y
              </span>
              {activeProfile?.calibrationStatus === 'verified_physical' ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                  ✓ Verificado físicamente ({activeProfile.stepsPerRotation} pasos/vuelta)
                </span>
              ) : activeProfile?.calibrationStatus === 'calculated_pending' ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
                  🟡 Corrección propuesta ({activeProfile.proposedStepsPerRotation || config.stepsPerRotation} pasos, pendiente de verificar en máquina)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  🔴 No calibrado ({config.stepsPerRotation ?? 3200} pasos ilustrativos no verificados)
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate hidden sm:block">
              Simulador físico 3D de Mandril Sanou, compensación cónica Pre-Warp, nivelación de foco Z y exportación directa a LightBurn (.lbrn2 / .SVG / .DXF)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!layout.valid || !hasVisibleEngraving}
            onClick={handleSaveTestPattern}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 text-xs font-bold disabled:opacity-40 whitespace-nowrap"
            title="Generar cuadrado patrón 1:1 mm para medir con calibre o cinta flexible sobre el cilindro"
          >
            <Ruler className="w-3.5 h-3.5 shrink-0" />
            <span>Generar Patrón SVG de Calibración</span>
          </button>

          <button
            type="button"
            disabled={!layout.valid || !hasVisibleEngraving || !!previewResult.error}
            onClick={() => void handleOpenInLightBurn()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-extrabold shadow whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isTauri()
                ? '🔥 Abrir en LightBurn (.lbrn2)'
                : '🔥 Descargar LightBurn (.lbrn2)'}
            </span>
          </button>

          <button
            type="button"
            disabled={!layout.valid || !hasVisibleEngraving || !!previewResult.error}
            onClick={save}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-slate-950 text-xs font-extrabold shadow whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
            <span>Guardar archivos de producción</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span>Cerrar</span>
          </button>
        </div>
      </header>

      {/* 2. CUERPO PRINCIPAL DE 2 COLUMNAS: VISOR 3D + 2D DESENROLLADO (IZQUIERDA) + CONTROLES (DERECHA) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* =====================================================================
            COLUMNA IZQUIERDA: SIMULADOR 3D DE MANDRIL SANOU + LIENZO 2D DESENROLLADO
           ===================================================================== */}
        <div className="flex-1 flex flex-col bg-[#080b10] min-w-0 overflow-hidden">
          {/* Sub-barra del visor */}
          <div className="py-1.5 px-3 bg-[#0e131b] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCanvasMode('split')}
                className={`px-2.5 py-1 rounded text-[11px] font-bold border transition ${
                  canvasMode === 'split'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                🔀 Vista Completa (Mandril 3D + Desenrollado 2D)
              </button>
              <button
                type="button"
                onClick={() => setCanvasMode('3d_chuck')}
                className={`px-2.5 py-1 rounded text-[11px] font-bold border transition ${
                  canvasMode === '3d_chuck'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                🧊 Montaje en Mandril Sanou
              </button>
              <button
                type="button"
                onClick={() => setCanvasMode('2d_unwrapped')}
                className={`px-2.5 py-1 rounded text-[11px] font-bold border transition ${
                  canvasMode === '2d_unwrapped'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                📐 Lienzo Desenrollado 1:1 mm
              </button>
            </div>

            {/* Control interactivo para girar el vaso/termo 360° */}
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
              <span className="text-[10px] text-slate-300 font-semibold">
                Girar Vaso 360°:
              </span>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={previewRotationDeg}
                onChange={(e) => setPreviewRotationDeg(Number(e.target.value))}
                className="w-24 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-[11px] text-cyan-300 font-bold w-10 text-right">
                {previewRotationDeg}°
              </span>
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

                  {layout.tapered && (
                    <span className="px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-600/60 font-mono text-[10px] font-bold">
                      📐 Nivelar Foco Z: Levantar extremo Ø{Math.min(sim3d.d0, sim3d.d1)}mm unos +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
                    </span>
                  )}
                </div>

                {/* Esquema SVG Técnico de Montaje Lateral en la Vank 9060 */}
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
                      GENERATRIZ SUPERIOR NIVELADA A FOCO LÁSER CONSTANTE (COSTURA Y = 0°)
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

                    {/* Mandril Sanou 3 Mordazas (Chuck) a la izquierda */}
                    {config.rotaryType === 'chuck' ? (
                      <g transform="translate(55, 38)">
                        {/* Cuerpo del motor / cabezal divisor */}
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
                        {/* Plato Sanou */}
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
                        {/* Mordazas escalonadas superior e inferior */}
                        <polygon
                          points="84,6 108,6 108,22 96,22 96,30 84,30"
                          fill="#cbd5e1"
                          stroke="#334155"
                          strokeWidth="1.2"
                        />
                        <polygon
                          points="84,122 108,122 108,100 96,100 96,92 84,92"
                          fill="#cbd5e1"
                          stroke="#334155"
                          strokeWidth="1.2"
                        />
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
                      /* Rodillos motrices abajo */
                      <g transform="translate(155, 138)">
                        <circle
                          cx="45"
                          cy="16"
                          r="16"
                          fill="#1e293b"
                          stroke="#38bdf8"
                          strokeWidth="2"
                        />
                        <circle
                          cx="255"
                          cy="16"
                          r="16"
                          fill="#1e293b"
                          stroke="#38bdf8"
                          strokeWidth="2"
                        />
                        <text
                          x="150"
                          y="20"
                          textAnchor="middle"
                          fill="#38bdf8"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          RODILLOS MOTRICES {config.rollerDiameterMm ? `(Ø ${config.rollerDiameterMm} mm)` : ''}
                        </text>
                      </g>
                    )}

                    {/* Cuerpo del Objeto Cilíndrico o Cónico (con la generatriz superior nivelada en y=44) */}
                    {(() => {
                      const maxD = Math.max(sim3d.d0, sim3d.d1, 40);
                      const h0 = Math.max(26, Math.min(106, (sim3d.d0 / maxD) * 96));
                      const h1 = Math.max(26, Math.min(106, (sim3d.d1 / maxD) * 96));
                      const xStart = 163;
                      const xEnd = 475;
                      const yTop = 44;
                      const yBot0 = yTop + h0;
                      const yBot1 = yTop + h1;

                      const designRatioW = Math.min(
                        1,
                        design.widthMm / Math.max(1, config.usefulLengthMm)
                      );
                      const designBoxW = (xEnd - xStart) * designRatioW;
                      const designBoxX =
                        xStart + ((xEnd - xStart - designBoxW) / 2);

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
                            cy={yTop + h0 / 2}
                            rx="7"
                            ry={h0 / 2}
                            fill="#334155"
                            stroke="#cbd5e1"
                            strokeWidth="1.2"
                          />
                          {/* Elipse extremo derecho X=L */}
                          <ellipse
                            cx={xEnd}
                            cy={yTop + h1 / 2}
                            rx="7"
                            ry={h1 / 2}
                            fill="#1e293b"
                            stroke="#cbd5e1"
                            strokeWidth="1.2"
                          />

                          {/* Área donde se graba el logo proyectado */}
                          <rect
                            x={designBoxX}
                            y={yTop + 6}
                            width={Math.max(16, designBoxW)}
                            height={Math.max(14, Math.min(h0, h1) * 0.55)}
                            rx="3"
                            fill="rgba(34, 211, 238, 0.16)"
                            stroke="#22d3ee"
                            strokeWidth="1.4"
                            strokeDasharray="4 2"
                          />
                          <text
                            x={designBoxX + Math.max(16, designBoxW) / 2}
                            y={yTop + 18 + Math.min(h0, h1) * 0.15}
                            textAnchor="middle"
                            fill="#ffffff"
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {design.name} ({design.widthMm}×{design.heightMm}mm)
                          </text>

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
                                x={xEnd + 42}
                                y={156}
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

            <div className="flex items-center gap-2 font-mono">
              <span className="text-slate-300">
                C00:{' '}
                <strong className="text-white">
                  {layerParams.speedMmPerSec ?? '—'} mm/s ·{' '}
                  {layerParams.maxPowerPercent ?? '—'}% · Int.{' '}
                  {layerParams.lineIntervalMm} mm
                </strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-bold">
                Tiempo: ~{formatDurationSec(physicalSetup.estimatedDurationSec)}
              </span>
            </div>
          </div>
        </div>

        {/* =====================================================================
            COLUMNA DERECHA: CONTROLES DEL ROTADOR ORGANIZADOS EN PESTAÑAS CLARAS
           ===================================================================== */}
        <aside className="w-[410px] lg:w-[460px] xl:w-[510px] bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-y-auto shrink-0 divide-y divide-slate-800">
          {/* BARRA DE NAVEGACIÓN FIJA (STICKY) */}
          <div className="sticky top-0 z-20 bg-[#111621]/95 backdrop-blur border-b border-slate-800 p-2 grid grid-cols-4 gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setSidebarTab('object')}
              className={`py-1.5 px-2 rounded-lg font-extrabold flex items-center justify-center gap-1 border transition ${
                sidebarTab === 'object'
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow'
                  : 'bg-slate-900 hover:bg-slate-800 text-cyan-300 border-slate-700'
              }`}
            >
              <span>🏺 1. Objeto</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('laser_c00')}
              className={`py-1.5 px-2 rounded-lg font-extrabold flex items-center justify-center gap-1 border transition ${
                sidebarTab === 'laser_c00'
                  ? 'bg-orange-500 text-slate-950 border-orange-300 shadow'
                  : 'bg-slate-900 hover:bg-slate-800 text-orange-300 border-orange-500/40'
              }`}
            >
              <span>⚡ 2. Vel/Pot C00</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('calibration')}
              className={`py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 border transition ${
                sidebarTab === 'calibration'
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow'
                  : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-slate-700'
              }`}
            >
              <span>🎯 3. Pasos Sanou</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('all')}
              className={`py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 border transition ${
                sidebarTab === 'all'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <span>Ver Todo</span>
            </button>
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
          {(sidebarTab === 'all' || sidebarTab === 'object') && (
            <div className="p-3.5 space-y-3 text-xs">
              {/* 1.1 Selección de Perfil de Accesorio Rotativo */}
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>1. Perfil de Accesorio Rotativo (Hardware)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAddingProfile((v) => !v)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold"
                  >
                    {isAddingProfile ? 'Cancelar nuevo' : '+ Guardar nuevo accesorio'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2">
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

                  <div className="flex items-center justify-between text-xs text-slate-300 px-2.5 py-1.5 bg-slate-950 rounded-lg border border-slate-800">
                    <span>
                      Sujeción:{' '}
                      <strong className="text-white">
                        {config.rotaryType === 'roller'
                          ? 'Rodillos'
                          : 'Mandril Sanou 3 Mordazas'}
                      </strong>
                    </span>
                    <span>
                      Giro:{' '}
                      <strong className="text-cyan-300">
                        {config.rotationDirection === 'inverted'
                          ? 'Invertido'
                          : 'Normal (+Y)'}
                      </strong>
                    </span>
                    {!activeProfile?.isBuiltIn && activeProfile && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(activeProfile.id)}
                        className="text-red-400 hover:text-red-300 font-bold"
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                </div>

                {activeProfile?.previousStepsPerRotation !== undefined && (
                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={handleRevertProfileCalibration}
                      className="text-[11px] text-amber-400 hover:text-amber-300 underline flex items-center gap-1"
                    >
                      <Undo2 className="w-3 h-3" />
                      <span>
                        Deshacer calibración (recuperar{' '}
                        {activeProfile.previousStepsPerRotation} pasos)
                      </span>
                    </button>
                  </div>
                )}

                {isAddingProfile && (
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-cyan-500/40 space-y-2">
                    <span className="text-[11px] font-semibold text-cyan-300 block">
                      Guardar configuración actual como nuevo accesorio:
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ej: Mandril Sanou K11 100mm"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 px-2.5 py-1 rounded text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={handleSaveProfile}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded"
                      >
                        Guardar Perfil
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 1.2 Plantillas de Objetos de Taller (Termos, Mates, Tumblers, Vasos, Botellas) */}
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-2.5">
                <label className="block font-bold text-white">
                  <span>Plantillas de Objetos de Taller (Termos, Mates, Vasos):</span>
                  <select
                    aria-label="Preset de objeto"
                    className={`${field} mt-1.5`}
                    value=""
                    onChange={(e) => {
                      const p = ROTARY_PRESETS.find(
                        (x) => x.id === e.target.value
                      );
                      if (p) {
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

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-300 font-semibold">
                      Tipo de sujeción:
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
                    <span className="text-[11px] text-slate-300 font-semibold">
                      Largo útil axial X (mm):
                    </span>
                    <input
                      className={field}
                      type="number"
                      min={1}
                      max={900}
                      step="0.5"
                      value={val(config.usefulLengthMm)}
                      onChange={num('usefulLengthMm')}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-emerald-300 font-bold">
                      Diámetro inicial X=0 (mm):
                    </span>
                    <input
                      className={field}
                      type="number"
                      min={5}
                      max={300}
                      step="0.1"
                      value={val(config.objectDiameterMm)}
                      onChange={num('objectDiameterMm')}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-amber-300 font-bold">
                      Diámetro final X=largo (mm):
                    </span>
                    <input
                      className={field}
                      type="number"
                      min={5}
                      max={300}
                      step="0.1"
                      placeholder="Igual al inicial = recto"
                      value={val(config.endDiameterMm)}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          endDiameterMm:
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value),
                        }))
                      }
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-300">
                      Arco a grabar (°):
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
                    <span className="text-[11px] text-cyan-300 font-bold">
                      Copias alrededor (1..36):
                    </span>
                    <input
                      className={field}
                      type="number"
                      min={1}
                      max={36}
                      step="1"
                      value={val(config.repeatCount, 1)}
                      onChange={num('repeatCount')}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">
                      Desplazamiento axial X (mm):
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
                      Giro del diseño Y (°):
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

                {/* Botones rápidos de distribución alrededor del cilindro */}
                <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-800">
                  <span className="text-[10px] text-slate-400 mr-1">
                    Distribución rápida:
                  </span>
                  {[
                    { n: 1, label: '1 Copia (Frente)' },
                    { n: 2, label: '2 Copias (Frente y Dorso 180°)' },
                    { n: 3, label: '3 Copias (120°)' },
                    { n: 4, label: '4 Copias (90°)' },
                  ].map((item) => (
                    <button
                      key={item.n}
                      type="button"
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          repeatCount: item.n,
                          axisOffsetMm: 0,
                          angularOffsetDeg: 0,
                        }))
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        (config.repeatCount ?? 1) === item.n
                          ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alerta técnica y calculadora de nivelación física cuando es Objeto Cónico */}
              {layout.tapered && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-xs space-y-2 text-amber-200">
                  <div className="font-extrabold flex items-center justify-between text-amber-300">
                    <span>⚠️ OBJETO CÓNICO + MANDRIL SANOU (PRE-WARP Y FOCO Z)</span>
                    <span className="font-mono text-[10px] bg-amber-950 px-2 py-0.5 rounded border border-amber-600">
                      Inclinación: {physicalSetup.wallTiltAngleDeg}°
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    <strong>1. Nivelación física del foco Z:</strong> Como el diámetro cambia de{' '}
                    <strong>Ø {config.objectDiameterMm} mm</strong> a{' '}
                    <strong>Ø {config.endDiameterMm} mm</strong>, suplementá/levantá el extremo más angosto unos{' '}
                    <strong className="text-white underline">
                      +{physicalSetup.tailstockLiftMm} mm ({physicalSetup.wallTiltAngleDeg}°)
                    </strong>{' '}
                    para que la pared superior quede horizontal y el láser no pierda foco.
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    <strong>2. En LightBurn Rotary Setup:</strong> Ingresá como{' '}
                    <em>Object Diameter</em> exactamente{' '}
                    <strong className="text-white">
                      Ø {layout.referenceDiameterMm} mm
                    </strong>{' '}
                    (promedio). <strong>No actives Taper Warp en LightBurn</strong> porque este archivo ya exporta las curvas pre-compensadas.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 2: VELOCIDAD, POTENCIA E INTERVALO DE GRABADO ROTATIVO (CAPA C00)
             ===================================================================== */}
          {(sidebarTab === 'all' || sidebarTab === 'laser_c00') && (
            <div className="p-3.5 space-y-2.5 text-xs bg-[#0b0f16]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-orange-400" />
                  <h4 className="font-extrabold text-white uppercase tracking-wide">
                    2. Calibrar Velocidad y Potencia Rotativa (Capa C00)
                  </h4>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[10px] text-cyan-300">
                  {Math.round(
                    25.4 / Math.max(0.02, layerParams.lineIntervalMm)
                  )}{' '}
                  DPI
                </span>
              </div>

              {/* Presets rápidos orientativos para objetos rotativos (Termos Powder Coat, Acero, Vidrio, Madera) */}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-slate-400">
                  Cargar referencia:
                </span>
                {[
                  {
                    label: '⚡ Captura LightBurn Vank (600/30 · 0.073mm)',
                    speed: 600,
                    maxP: 30,
                    minP: 30,
                    intMm: 0.073,
                    mode: 'image' as const,
                  },
                  {
                    label: 'Termo Pintado / Powder Coat (350/28 · 0.073mm)',
                    speed: 350,
                    maxP: 28,
                    minP: 22,
                    intMm: 0.073,
                    mode: 'fill' as const,
                  },
                  {
                    label: 'Mate Madera / Calabaza (250/22 · 0.080mm)',
                    speed: 250,
                    maxP: 22,
                    minP: 18,
                    intMm: 0.08,
                    mode: 'fill' as const,
                  },
                  {
                    label: 'Vaso Vidrio / Cristal (200/18 · 0.080mm)',
                    speed: 200,
                    maxP: 18,
                    minP: 15,
                    intMm: 0.08,
                    mode: 'fill' as const,
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setLayerParams((prev) => ({
                        ...prev,
                        mode: preset.mode,
                        speedMmPerSec: preset.speed,
                        maxPowerPercent: preset.maxP,
                        minPowerPercent: preset.minP,
                        lineIntervalMm: preset.intMm,
                      }))
                    }
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300 font-semibold"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Tarjeta C00 Grabado Rotativo estilo LightBurn Pro 2.2 */}
              <div className="p-3 rounded-xl bg-slate-900/95 border-2 border-slate-700 space-y-2.5">
                <div className="grid grid-cols-4 gap-2">
                  <label>
                    <span className="text-[10px] font-bold text-cyan-300 block mb-0.5">
                      Modo C00
                    </span>
                    <select
                      value={layerParams.mode}
                      onChange={(e) =>
                        setLayerParams((p) => ({
                          ...p,
                          mode: e.target.value as 'image' | 'fill' | 'line',
                        }))
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-bold"
                    >
                      <option value="image">Imagen</option>
                      <option value="fill">Relleno (Fill)</option>
                      <option value="line">Línea</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-[10px] font-bold text-emerald-300 block mb-0.5">
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
                      className="w-full bg-slate-950 border-2 border-emerald-500/60 rounded-lg px-2 py-1 text-sm font-mono font-extrabold text-white"
                    />
                  </label>

                  <label>
                    <span className="text-[10px] font-bold text-amber-300 block mb-0.5">
                      Pot. Máx (%)
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
                      className="w-full bg-slate-950 border-2 border-amber-500/60 rounded-lg px-2 py-1 text-sm font-mono font-extrabold text-white"
                    />
                  </label>

                  <label>
                    <span className="text-[10px] font-bold text-slate-300 block mb-0.5">
                      Pot. Mín (%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="Ej: 25"
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
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm font-mono font-bold text-white"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <label>
                    <span className="text-[10px] font-bold text-cyan-300 block">
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
                      className="w-full bg-slate-950 border border-cyan-500/60 rounded px-2 py-1 font-mono text-xs text-cyan-300 font-bold"
                    />
                  </label>

                  <label>
                    <span className="text-[10px] text-slate-300 block">
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
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                    />
                  </label>

                  <label>
                    <span className="text-[10px] text-slate-300 block">
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
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800 text-[11px]">
                  <div className="flex items-center gap-1">
                    {[0.073, 0.08, 0.1].map((mm) => (
                      <button
                        key={mm}
                        type="button"
                        onClick={() =>
                          setLayerParams((p) => ({ ...p, lineIntervalMm: mm }))
                        }
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                          Math.abs(layerParams.lineIntervalMm - mm) < 0.001
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {mm}mm ({Math.round(25.4 / mm)} DPI)
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <label className="flex items-center gap-1 cursor-pointer">
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
                    <label className="flex items-center gap-1 cursor-pointer">
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
                      <span>Cruzado 90° (Limpiar residuo)</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 3: CALIBRACIÓN DE PASOS POR VUELTA (MANDRIL SANOU / RODILLOS)
             ===================================================================== */}
          {(sidebarTab === 'all' || sidebarTab === 'calibration') && (
            <div className="p-3.5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-cyan-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-cyan-400" />
                  <span>3. Calibración de Pasos por Vuelta y Giro (+Y)</span>
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  Pasos activos: <strong>{config.stepsPerRotation ?? 3200}</strong>
                </span>
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

          {/* DOCK FIJO INFERIOR DE EXPORTACIÓN Y CONEXIÓN CON LIGHTBURN PRO 2.2 */}
          <div className="sticky bottom-0 z-20 mt-auto bg-[#0f1520]/95 backdrop-blur border-t border-slate-700 p-3 space-y-2 text-xs shadow-2xl">
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
    </dialog>
  );
}
