import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  FlaskConical,
  FolderOpen,
  Grid,
  Layers,
  Minimize2,
  Pause,
  Play,
  Plus,
  Power,
  RotateCw,
  Ruler,
  Save,
  Send,
  Sliders,
  Sparkles,
  Square,
  Target,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wind,
  X,
} from 'lucide-react';
import {
  compileLabelGeometry,
  rasterImageTransform,
  roundMm,
} from '../core/geometry/geometryEngine';
import { processImageDataUrlInBrowser } from '../core/image/browserImageLoader';
import {
  extractLogoFilesFromClipboardData,
  isEditableKeyboardTarget,
  readLogoFilesFromClipboard,
} from '../core/image/clipboardLogoReader';
import {
  DEFAULT_IMAGE_PROCESSING,
  parseSvgLogoString,
} from '../core/image/imageProcessor';
import {
  MATERIAL_SHEET_PRESETS,
  STANDARD_DIMENSION_PRESETS,
} from '../core/projects/projectManager';
import {
  HolePreset,
  LabelDesign,
  LabelShapeType,
  MaterialProfile,
  NestingResult,
  OrderProject,
  SvgLogoElement,
} from '../core/types';
import { LogoOutputFile } from '../core/exporters/logoFolder';
import { Workbench3DViewport } from './Workbench3DViewport';
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../core/workbench/lbrn2Exporter';
import {
  detectExternalLaserFormat,
  importExternalLaserFile,
  mergeComplementaryImportedJobs,
  mergeImportedLayerUpdates,
} from '../core/workbench/externalLaserFileImporter';
import {
  exportWorkbenchToAi,
  exportWorkbenchToDxf,
} from '../core/workbench/workbenchVectorExporters';
import {
  applyLibraryEntryToWorkbenchLayers,
  compileMaterialTestToRuidaRd,
  DEFAULT_CUT_TEST_CONFIG,
  DEFAULT_ENGRAVE_TEST_CONFIG,
  deleteMaterialLibraryEntry,
  exportMaterialTestToLbrn2,
  exportMaterialTestToSvg,
  generateMaterialTestCells,
  loadMaterialLibrary,
  saveMaterialLibraryEntry,
} from '../core/workbench/materialCalibrationEngine';
import {
  prepareWorkbenchRasterMasks,
  RasterScanlineMask,
} from '../core/workbench/rasterScanlines';
import {
  compileWorkbenchToRuidaRd,
  RuidaUploadProgress,
} from '../core/workbench/ruidaCompiler';
import {
  buildSmartRelayPowerCommand,
  listVankRuidaFiles,
  loadMachinePowerRelayConfig,
  MachinePowerRelayConfig,
  probeVankRuidaConnection,
  queryVankRuidaMachineStatus,
  queryVankRuidaMotionParams,
  RuidaControllerFile,
  saveMachinePowerRelayConfig,
  sendVankRuidaPanelAction,
  SmartRelayPreset,
  triggerSmartRelayPower,
  uploadRdBytesToVankRuida,
} from '../core/workbench/ruidaTransportClient';
import {
  learnEmpiricalDurationRatio,
  loadRememberedFileEstimates,
  loadStoredMotionCalibration,
  mergeControllerMotionParams,
  MotionPlannerCalibration,
  rememberRuidaFileEstimate,
  RememberedRuidaFileEstimate,
} from '../core/workbench/motionTiming';
import {
  armJobTimerWatch,
  computeLiveTimerSnapshot,
  createInitialJobTimerState,
  finishJobTimerExecution,
  formatDurationTimer,
  MachineJobTimerState,
  pauseJobTimerExecution,
  playWorkshopCompletionAlertChime,
  requestAndNotifyWorkshopCompletion,
  resumeJobTimerExecution,
  startJobTimerExecution,
} from '../core/workbench/jobTimerAlert';
import {
  applyExtremeMaterialSavingToWorkbench,
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  computeEcocueroRollMetrics,
  computePowerUpdateForLayer,
  createWorkbenchJobFromOrder,
  createWorkbenchJobFromUploadedLogo,
  fillLastRowFreeSlotsInWorkbench,
  reorderWorkbenchJob,
  simulateWorkbenchToolpath,
  sortWorkbenchJobsBySpatialOrder,
  syncLayersWithMaterialProfile,
  updateWorkbenchJobDesignAndQuantity,
  updateWorkbenchSheetDimensions,
  validateWorkbenchState,
} from '../core/workbench/workbenchEngine';
import {
  ECOCUERO_BED_PASS_HEIGHT_MM,
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
  isEcocueroMaterial,
  JobOriginAnchor,
  LIGHTBURN_PALETTE_COLORS,
  LightBurnCutMode,
  LightBurnImageDitherMode,
  MachineOriginCorner,
  MaterialTestCell,
  MaterialTestGridConfig,
  SavedMaterialLibraryEntry,
  StartFromMode,
  WorkbenchConfig,
  WorkbenchEngraveGrouping,
  WorkbenchExecutionSequenceMode,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
  WorkbenchTravelOrder,
} from '../core/workbench/workbenchTypes';

interface VankWorkbenchModalProps {
  design: LabelDesign;
  nesting: NestingResult;
  activeBatchIndex: number;
  material: MaterialProfile;
  projectName: string;
  clientName: string;
  activeOrderId: string;
  ordersCatalog: OrderProject[];
  workbenchConfig: WorkbenchConfig;
  workbenchJobs: WorkbenchJobItem[];
  initialSidebarView?: 'all' | 'layers' | 'jobs' | 'laser';
  onUpdateConfig: (next: WorkbenchConfig) => void;
  onUpdateJobs: (next: WorkbenchJobItem[]) => void;
  onSaveMaterialParameters: (updatedMaterial: MaterialProfile) => void;
  onRequestSaveFiles: (files: LogoOutputFile[]) => void;
  onNotify: (msg: string) => void;
  onClose: () => void;
}

const JOB_ORIGIN_ANCHORS: { id: JobOriginAnchor; label: string }[] = [
  { id: 'top_left', label: 'Superior Izquierda' },
  { id: 'top_center', label: 'Superior Centro' },
  { id: 'top_right', label: 'Superior Derecha' },
  { id: 'middle_left', label: 'Centro Izquierda' },
  { id: 'center', label: 'Centro' },
  { id: 'middle_right', label: 'Centro Derecha' },
  { id: 'bottom_left', label: 'Inferior Izquierda' },
  { id: 'bottom_center', label: 'Inferior Centro' },
  { id: 'bottom_right', label: 'Inferior Derecha' },
];

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0s';
  const totalSec = Math.ceil(sec);
  const mins = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (mins === 0) return `${remSec}s`;
  return `${mins}m ${remSec.toString().padStart(2, '0')}s`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`No se pudo leer el archivo ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export const VankWorkbenchModal: React.FC<VankWorkbenchModalProps> = ({
  design,
  nesting,
  activeBatchIndex,
  material,
  projectName,
  clientName,
  activeOrderId,
  ordersCatalog,
  workbenchConfig,
  workbenchJobs,
  initialSidebarView = 'layers',
  onUpdateConfig,
  onUpdateJobs,
  onSaveMaterialParameters,
  onRequestSaveFiles,
  onNotify,
  onClose,
}) => {
  const [sidebarView, setSidebarView] = useState<
    'layers' | 'jobs' | 'laser'
  >(initialSidebarView === 'all' ? 'layers' : initialSidebarView);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    () => workbenchJobs[0]?.id ?? null
  );
  const [cameraView, setCameraView] = useState<
    'tirada_roll' | 'occupied' | 'sheet' | 'machine' | '3d_machine'
  >('tirada_roll');
  const [canvasVisualMode, setCanvasVisualMode] = useState<
    'technical_lightburn' | 'realistic_material'
  >('technical_lightburn');
  const [canvasZoom, setCanvasZoom] = useState<number>(1.0);
  const [sheetWidthDraft, setSheetWidthDraft] = useState<string>(() =>
    String(workbenchConfig.sheetWidthMm)
  );
  const [sheetHeightDraft, setSheetHeightDraft] = useState<string>(() =>
    String(workbenchConfig.sheetHeightMm)
  );
  useEffect(() => {
    setSheetWidthDraft(String(workbenchConfig.sheetWidthMm));
    setSheetHeightDraft(String(workbenchConfig.sheetHeightMm));
  }, [workbenchConfig.sheetWidthMm, workbenchConfig.sheetHeightMm]);
  const [showSingleLabelLoupe, setShowSingleLabelLoupe] =
    useState<boolean>(true);
  const [isProbingRuida, setIsProbingRuida] = useState<boolean>(false);
  const [ruidaProbeResult, setRuidaProbeResult] = useState<{
    reachable: boolean;
    localPortFree: boolean;
    udpHandshakeOk?: boolean;
    transportMode?: string | null;
    pingOk?: boolean;
    latencyMs?: number | null;
    message: string;
  } | null>(null);
  const [ruidaUploadProgress, setRuidaUploadProgress] =
    useState<RuidaUploadProgress | null>(null);
  const [showSimulation, setShowSimulation] = useState<boolean>(false);
  const [isPlayingSim, setIsPlayingSim] = useState<boolean>(false);
  const [simProgress, setSimProgress] = useState<number>(100);
  const [safetyConfirmed, setSafetyConfirmed] = useState<boolean>(false);
  const [safetyHighlight, setSafetyHighlight] = useState<boolean>(false);
  const [isSendingToRuida, setIsSendingToRuida] = useState<boolean>(false);
  const [isUploadingLogos, setIsUploadingLogos] = useState<boolean>(false);
  const [ruidaStatusMsg, setRuidaStatusMsg] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [orderToAppendId, setOrderToAppendId] = useState<string>('');
  const [selectedLayerCutIndex, setSelectedLayerCutIndex] = useState<number>(0);
  const [showAdvancedLayerSettings, setShowAdvancedLayerSettings] =
    useState<boolean>(false);
  const [bottomDockTab, setBottomDockTab] = useState<'laser' | 'material_library'>(
    'laser'
  );
  const [showCalibrationMatrixModal, setShowCalibrationMatrixModal] =
    useState<boolean>(false);
  const [calibrationConfig, setCalibrationConfig] =
    useState<MaterialTestGridConfig>(() => ({
      ...DEFAULT_ENGRAVE_TEST_CONFIG,
    }));
  const [selectedCalibrationCell, setSelectedCalibrationCell] =
    useState<MaterialTestCell | null>(null);
  const [materialLibrary, setMaterialLibrary] = useState<SavedMaterialLibraryEntry[]>(
    () => loadMaterialLibrary()
  );
  const [libraryEntryName, setLibraryEntryName] = useState<string>(
    () => `${material.name} (${material.thicknessMm} mm)`
  );
  const [libraryNotes, setLibraryNotes] = useState<string>('');
  const [machineTimer, setMachineTimer] = useState<MachineJobTimerState>(() =>
    createInitialJobTimerState()
  );
  const [timerNowMs, setTimerNowMs] = useState<number>(() => Date.now());
  const [machineLiveStatus, setMachineLiveStatus] = useState<{
    reachable: boolean;
    latencyMs?: number | null;
  } | null>(null);
  const [motionCalibration, setMotionCalibration] = useState<MotionPlannerCalibration>(() =>
    loadStoredMotionCalibration()
  );
  const [ruidaControllerFiles, setRuidaControllerFiles] = useState<RuidaControllerFile[]>([]);
  const [rememberedFileEstimates, setRememberedFileEstimates] = useState<
    Record<string, RememberedRuidaFileEstimate>
  >(() => loadRememberedFileEstimates());
  const [activeVankFileName, setActiveVankFileName] = useState<string>('');
  const [powerRelayConfig, setPowerRelayConfig] = useState<MachinePowerRelayConfig>(() =>
    loadMachinePowerRelayConfig()
  );
  const [showPowerOffModal, setShowPowerOffModal] = useState<boolean>(false);
  const [isExecutingPowerAction, setIsExecutingPowerAction] = useState<boolean>(false);
  const [powerActionFeedback, setPowerActionFeedback] = useState<{
    type: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const [autoPowerOffRemainingSec, setAutoPowerOffRemainingSec] = useState<number | null>(
    null
  );
  const rasterMasksRef = useRef<Map<string, RasterScanlineMask>>(new Map());
  const [preparedRasterVersion, setPreparedRasterVersion] = useState<number>(0);

  const consecutiveIdlePollsRef = useRef<number>(0);
  const alertedCompletionRef = useRef<boolean>(false);
  const hardwareRunWasPausedRef = useRef<boolean>(false);
  const hardwareSyncedKeyRef = useRef<string>('');

  const multiLogoInputRef = useRef<HTMLInputElement | null>(null);
  const externalLaserInputRef = useRef<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingJobRef = useRef<{
    jobId: string;
    startMouseX: number;
    startMouseY: number;
    initialJobX: number;
    initialJobY: number;
  } | null>(null);

  const isEco = isEcocueroMaterial(material);

  const selectedJob = useMemo(
    () => workbenchJobs.find((j) => j.id === selectedJobId) ?? workbenchJobs[0] ?? null,
    [workbenchJobs, selectedJobId]
  );

  // Estado editable para dimensiones y distribución en mesa sin rebotes al borrar dígitos
  const [jobWidthStr, setJobWidthStr] = useState<string>('');
  const [jobHeightStr, setJobHeightStr] = useState<string>('');
  const [jobColsStr, setJobColsStr] = useState<string>('');
  const [jobRowsStr, setJobRowsStr] = useState<string>('');
  const [jobGapXStr, setJobGapXStr] = useState<string>('');
  const [jobGapYStr, setJobGapYStr] = useState<string>('');
  const editingJobSizeRef = useRef<boolean>(false);
  const editingJobGridFieldRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedJob) {
      setJobWidthStr('');
      setJobHeightStr('');
      setJobColsStr('');
      setJobRowsStr('');
      setJobGapXStr('');
      setJobGapYStr('');
      return;
    }
    if (!editingJobSizeRef.current) {
      setJobWidthStr(String(selectedJob.labelDesign.widthMm));
      setJobHeightStr(String(selectedJob.labelDesign.heightMm));
    }
    if (editingJobGridFieldRef.current !== 'cols') {
      setJobColsStr(String(selectedJob.columns));
    }
    if (editingJobGridFieldRef.current !== 'rows') {
      setJobRowsStr(String(selectedJob.rows));
    }
    if (editingJobGridFieldRef.current !== 'gapX') {
      setJobGapXStr(String(selectedJob.gapXMm));
    }
    if (editingJobGridFieldRef.current !== 'gapY') {
      setJobGapYStr(String(selectedJob.gapYMm));
    }
  }, [
    selectedJob?.id,
    selectedJob?.labelDesign.widthMm,
    selectedJob?.labelDesign.heightMm,
    selectedJob?.columns,
    selectedJob?.rows,
    selectedJob?.gapXMm,
    selectedJob?.gapYMm,
  ]);

  const handleScaleSelectedJobArtwork = (factor: number) => {
    if (!selectedJob) return;
    const nextEls = selectedJob.labelDesign.elements.map((el) => {
      const nw = roundMm(Math.max(1, el.widthMm * factor), 2);
      const nh = roundMm(Math.max(1, el.heightMm * factor), 2);
      return el.type === 'vector_text'
        ? {
            ...el,
            widthMm: nw,
            heightMm: nh,
            fontSizeMm: roundMm(Math.max(1, el.fontSizeMm * factor), 2),
          }
        : { ...el, widthMm: nw, heightMm: nh };
    });
    const nextJob = {
      ...selectedJob,
      labelDesign: { ...selectedJob.labelDesign, elements: nextEls },
    };
    onUpdateJobs(workbenchJobs.map((j) => (j.id === selectedJob.id ? nextJob : j)));
  };

  const validation = useMemo(
    () => validateWorkbenchState(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

  // Preparación automática de máscaras ráster en segundo plano para calcular anchos reales de escaneo
  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void prepareWorkbenchRasterMasks(workbenchJobs, workbenchConfig)
        .then((masks) => {
          if (cancelled) return;
          rasterMasksRef.current = masks;
          setPreparedRasterVersion((v) => v + 1);
        })
        .catch(() => {
          // Mantener simulación geométrica de respaldo si una imagen está en tránsito
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [workbenchJobs, workbenchConfig]);

  const simulation = useMemo(
    () =>
      simulateWorkbenchToolpath(
        workbenchJobs,
        workbenchConfig,
        motionCalibration,
        rasterMasksRef.current
      ),
    [workbenchJobs, workbenchConfig, motionCalibration, preparedRasterVersion]
  );

  const rollMetrics = useMemo(
    () => computeEcocueroRollMetrics(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

  const validationRef = useRef(validation);
  validationRef.current = validation;
  const simulationRef = useRef(simulation);
  simulationRef.current = simulation;
  const activeVankFileNameRef = useRef(activeVankFileName);
  activeVankFileNameRef.current = activeVankFileName;
  const rememberedEstimatesRef = useRef(rememberedFileEstimates);
  rememberedEstimatesRef.current = rememberedFileEstimates;
  const ruidaControllerFilesRef = useRef(ruidaControllerFiles);
  ruidaControllerFilesRef.current = ruidaControllerFiles;
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;
  const ruidaJobNameRef = useRef(workbenchConfig.ruidaJobName);
  ruidaJobNameRef.current = workbenchConfig.ruidaJobName;

  const syncHardwareCalibrationAndFiles = async (ip: string, port: number) => {
    if (!isTauri() || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) return;
    try {
      const [motionHw, filesRes] = await Promise.all([
        queryVankRuidaMotionParams({ ip, port }),
        listVankRuidaFiles({ ip, port }),
      ]);
      if (motionHw.calibrated) {
        setMotionCalibration((prev) => mergeControllerMotionParams(prev, motionHw));
      }
      if (filesRes.reachable && filesRes.files.length > 0) {
        setRuidaControllerFiles(filesRes.files);
        setActiveVankFileName((prev) => {
          if (prev && filesRes.files.some((f) => f.name === prev)) return prev;
          return prev || filesRes.files[filesRes.files.length - 1].name;
        });
      }
    } catch {
      // Silenciar si la controladora está ocupada
    }
  };

  // Reproductor de animación de trayectoria láser
  useEffect(() => {
    if (!isPlayingSim) return;
    const interval = window.setInterval(() => {
      setSimProgress((prev) => {
        if (prev >= 100) {
          setIsPlayingSim(false);
          return 100;
        }
        return Math.min(100, prev + 1.5);
      });
    }, 45);
    return () => window.clearInterval(interval);
  }, [isPlayingSim]);

  // Cronómetro en vivo (tick cada 1s) cuando la máquina está grabando/cortando o en pausa
  useEffect(() => {
    if (machineTimer.phase !== 'running' && machineTimer.phase !== 'paused') {
      return;
    }
    setTimerNowMs(Date.now());
    const id = window.setInterval(() => {
      const now = Date.now();
      setTimerNowMs(now);
      setMachineTimer((prev) => {
        if (
          prev.phase === 'running' &&
          prev.source === 'manual' &&
          prev.autoAlertOnManualZero
        ) {
          const snap = computeLiveTimerSnapshot(prev, now);
          if (snap.remainingSec <= 0) {
            return finishJobTimerExecution(prev, now);
          }
        }
        return prev;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [machineTimer.phase]);

  // Disparo único de alerta sonora, notificación macOS y auto-aprendizaje empírico de tiempo
  useEffect(() => {
    if (machineTimer.phase !== 'finished') {
      alertedCompletionRef.current = false;
      return;
    }
    if (alertedCompletionRef.current) return;
    alertedCompletionRef.current = true;

    const snap = computeLiveTimerSnapshot(
      machineTimer,
      machineTimer.finishedAtMs ?? Date.now()
    );

    if (
      machineTimer.source === 'hardware' &&
      !hardwareRunWasPausedRef.current &&
      snap.elapsedSec >= 8 &&
      machineTimer.estimatedTotalSec >= 8
    ) {
      setMotionCalibration((prev) =>
        learnEmpiricalDurationRatio(prev, snap.elapsedSec, machineTimer.estimatedTotalSec)
      );
      if (machineTimer.jobName) {
        const key = machineTimer.jobName.trim().toUpperCase();
        rememberRuidaFileEstimate({
          fileName: key,
          totalPieces: machineTimer.totalPieces || validationRef.current.totalPieces,
          estimatedTotalSec: Math.round(snap.elapsedSec),
          updatedAtMs: Date.now(),
        });
        setRememberedFileEstimates(loadRememberedFileEstimates());
      }
    }

    const elapsedText = formatDurationTimer(snap.elapsedSec);
    if (machineTimer.soundEnabled) {
      playWorkshopCompletionAlertChime();
    }
    requestAndNotifyWorkshopCompletion(
      machineTimer.jobName,
      elapsedText,
      machineTimer.totalPieces
    );
    onNotify(
      `✅ Vank 9060 terminó "${machineTimer.jobName}" (${machineTimer.totalPieces} u.) en ${elapsedText}.`
    );

    if (
      powerRelayConfig.autoPowerOffOnFinish &&
      buildSmartRelayPowerCommand(powerRelayConfig, 'off')
    ) {
      setAutoPowerOffRemainingSec(powerRelayConfig.cooldownSeconds);
    }
  }, [machineTimer, onNotify, powerRelayConfig]);

  // Cuenta regresiva segura de enfriamiento del chiller antes de cortar 220V automáticamente al finalizar
  useEffect(() => {
    if (autoPowerOffRemainingSec === null) return;
    if (machineTimer.phase === 'running') {
      setAutoPowerOffRemainingSec(null);
      return;
    }
    if (autoPowerOffRemainingSec <= 0) {
      setAutoPowerOffRemainingSec(null);
      void (async () => {
        const st = await queryVankRuidaMachineStatus({
          ip: workbenchConfig.ruidaIpAddress,
          port: workbenchConfig.ruidaPort,
        });
        if (st.is_running && !st.is_paused) {
          onNotify('⚠ Auto-apagado cancelado: la Vank 9060 volvió a estar en ejecución.');
          return;
        }
        const relayRes = await triggerSmartRelayPower(powerRelayConfig, 'off');
        onNotify(
          relayRes.ok
            ? `⏻ Vank 9060 apagada automáticamente tras enfriamiento (${relayRes.message}).`
            : `⚠ Auto-apagado pendiente: ${relayRes.message}`
        );
      })();
      return;
    }
    const id = window.setTimeout(() => {
      setAutoPowerOffRemainingSec((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [
    autoPowerOffRemainingSec,
    machineTimer.phase,
    workbenchConfig.ruidaIpAddress,
    workbenchConfig.ruidaPort,
    powerRelayConfig,
    onNotify,
  ]);

  const handleUpdatePowerRelayConfig = (patch: Partial<MachinePowerRelayConfig>) => {
    setPowerRelayConfig((prev) => {
      const next = { ...prev, ...patch };
      saveMachinePowerRelayConfig(next);
      return next;
    });
  };

  const handleRuidaRemoteCommand = async (action: 'stop' | 'pause' | 'reset') => {
    setIsExecutingPowerAction(true);
    setPowerActionFeedback(null);
    try {
      const res = await sendVankRuidaPanelAction({
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
        action,
      });
      setPowerActionFeedback({
        type: res.ok ? 'success' : 'info',
        text: res.message,
      });
      onNotify(res.message);
    } finally {
      setIsExecutingPowerAction(false);
    }
  };

  const handleExecuteFullMachineShutdown = async () => {
    setIsExecutingPowerAction(true);
    setPowerActionFeedback(null);
    try {
      const steps: string[] = [];
      // 1. Verificar estado y enviar STOP + RESET seguro a la Ruida para frenar tubo láser, aire y motores
      const st = await queryVankRuidaMachineStatus({
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
      });
      if (st.reachable) {
        if (st.is_running || st.is_paused || st.is_framing) {
          const stopRes = await sendVankRuidaPanelAction({
            ip: workbenchConfig.ruidaIpAddress,
            port: workbenchConfig.ruidaPort,
            action: 'stop',
          });
          steps.push(stopRes.message);
          await new Promise((r) => setTimeout(r, 900));
        }
        const resetRes = await sendVankRuidaPanelAction({
          ip: workbenchConfig.ruidaIpAddress,
          port: workbenchConfig.ruidaPort,
          action: 'reset',
        });
        if (resetRes.ok) {
          steps.push('Controladora Ruida detenida y en reposo seguro.');
        }
      } else {
        steps.push(`Ruida (${workbenchConfig.ruidaIpAddress}) sin respuesta previa al corte.`);
      }

      // 2. Cortar 220V mediante relé inteligente local (Shelly / Tasmota / Webhook)
      const relayCmd = buildSmartRelayPowerCommand(powerRelayConfig, 'off');
      if (relayCmd) {
        const relayRes = await triggerSmartRelayPower(powerRelayConfig, 'off');
        steps.push(relayRes.message);
        setPowerActionFeedback({
          type: relayRes.ok ? 'success' : 'error',
          text: steps.join(' · '),
        });
        if (relayRes.ok) {
          setMachineTimer(createInitialJobTimerState());
          setAutoPowerOffRemainingSec(null);
        }
        onNotify(steps.join(' · '));
      } else {
        const infoTxt = `${steps.join(' · ')} ⚠️ Para cortar electricidad 220 V (pantalla, chiller y extractor) conectá un relé Wi-Fi con contactor ≥25A (ej. Shelly Plus 1) e ingresá su IP abajo.`;
        setPowerActionFeedback({ type: 'info', text: infoTxt });
        onNotify(infoTxt);
      }
    } finally {
      setIsExecutingPowerAction(false);
    }
  };

  // Monitor SIEMPRE ACTIVO de la controladora Ruida RDC8445S:
  // Detecta cualquier START físico (incluso tras Stop, desde LightBurn o USB, enviado o no desde Astra)
  // abre automáticamente el pop-up de cronómetro, sincroniza aceleraciones reales y detecta cuando termina.
  useEffect(() => {
    const ip = workbenchConfig.ruidaIpAddress.trim();
    const port = workbenchConfig.ruidaPort;
    if (!isTauri() || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const st = await queryVankRuidaMachineStatus({ ip, port });
      if (cancelled) return;
      setMachineLiveStatus({
        reachable: st.reachable,
        latencyMs: st.latency_ms,
      });
      if (!st.reachable) return;

      const syncKey = `${ip}:${port}`;
      if (hardwareSyncedKeyRef.current !== syncKey) {
        hardwareSyncedKeyRef.current = syncKey;
        void syncHardwareCalibrationAndFiles(ip, port);
      }

      const now = Date.now();

      // Ignorar pulsaciones de FRAME/Encuadre: solo iniciar cronómetro en corte/grabado real
      const isExecutingLaserJob = st.is_running && !st.is_framing && !st.is_paused;

      if (isExecutingLaserJob) {
        // Si venimos de idle/armed/finished, refrescar archivos en memoria de la controladora sin bloquear el pop-up
        const currentFiles = ruidaControllerFilesRef.current;
        const candidateName = (
          activeVankFileNameRef.current ||
          (currentFiles.length > 0 ? currentFiles[currentFiles.length - 1].name : '') ||
          ruidaJobNameRef.current ||
          projectNameRef.current ||
          'Vank 9060'
        )
          .trim()
          .toUpperCase();

        setMachineTimer((prev) => {
          if (prev.phase === 'idle' || prev.phase === 'armed' || prev.phase === 'finished') {
            consecutiveIdlePollsRef.current = 0;
            hardwareRunWasPausedRef.current = false;

            const remembered = candidateName
              ? rememberedEstimatesRef.current[candidateName]
              : undefined;
            const simTotal = Math.max(
              10,
              Math.round(simulationRef.current.totalDurationSec)
            );
            const resolvedName =
              prev.phase === 'armed'
                ? prev.jobName
                : remembered?.fileName || candidateName || prev.jobName;
            const resolvedPieces =
              prev.phase === 'armed' && prev.totalPieces > 0
                ? prev.totalPieces
                : remembered?.totalPieces || validationRef.current.totalPieces;
            const resolvedEstSec =
              prev.phase === 'armed' && prev.estimatedTotalSec > 0
                ? prev.estimatedTotalSec
                : remembered?.estimatedTotalSec || simTotal;

            // Consultar archivos recientes en segundo plano por si otro archivo fue elegido en panel/USB
            void listVankRuidaFiles({ ip, port }).then((filesRes) => {
              if (cancelled || !filesRes.reachable || filesRes.files.length === 0) return;
              setRuidaControllerFiles(filesRes.files);
              const latestName =
                filesRes.files[filesRes.files.length - 1].name.trim().toUpperCase();
              if (!activeVankFileNameRef.current && latestName) {
                setActiveVankFileName(latestName);
              }
            });

            return startJobTimerExecution(
              prev,
              {
                source: 'hardware',
                jobName: resolvedName,
                totalPieces: resolvedPieces,
                estimatedTotalSec: resolvedEstSec,
              },
              now
            );
          }
          if (prev.phase === 'paused') {
            consecutiveIdlePollsRef.current = 0;
            return resumeJobTimerExecution(prev, now);
          }
          if (prev.phase === 'running') {
            consecutiveIdlePollsRef.current = 0;
          }
          return prev;
        });
        return;
      }

      if (st.is_paused) {
        setMachineTimer((prev) => {
          if (prev.phase === 'running') {
            consecutiveIdlePollsRef.current = 0;
            hardwareRunWasPausedRef.current = true;
            return pauseJobTimerExecution(prev, now);
          }
          return prev;
        });
        return;
      }

      // Máquina inactiva (terminó o se presionó STOP)
      if (!st.is_running && !st.is_framing) {
        setMachineTimer((prev) => {
          if (
            prev.source === 'hardware' &&
            (prev.phase === 'running' || prev.phase === 'paused')
          ) {
            const elapsedMs = prev.startedAtMs ? now - prev.startedAtMs : 0;
            if (elapsedMs >= 2500) {
              consecutiveIdlePollsRef.current += 1;
              if (consecutiveIdlePollsRef.current >= 2) {
                return finishJobTimerExecution(prev, now);
              }
            }
          }
          return prev;
        });
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workbenchConfig.ruidaIpAddress, workbenchConfig.ruidaPort]);

  const liveTimerSnapshot = useMemo(
    () => computeLiveTimerSnapshot(machineTimer, timerNowMs),
    [machineTimer, timerNowMs]
  );

  // Segmento activo y posición instantánea del cabezal láser durante la simulación
  const activeSimulatedSegment = useMemo(() => {
    if (simulation.segments.length === 0) return null;
    const targetTime = (simProgress / 100) * simulation.totalDurationSec;
    return (
      simulation.segments.find(
        (s) => targetTime >= s.startTimeSec && targetTime <= s.endTimeSec
      ) ?? simulation.segments[simulation.segments.length - 1]
    );
  }, [simulation, simProgress]);

  const simulatedLaserHead = useMemo(() => {
    const activeSeg = activeSimulatedSegment;
    if (!activeSeg || activeSeg.points.length === 0) {
      return validation.jobOriginPointMm;
    }
    const targetTime = (simProgress / 100) * simulation.totalDurationSec;
    const ratio =
      activeSeg.durationSec > 0
        ? Math.max(0, Math.min(1, (targetTime - activeSeg.startTimeSec) / activeSeg.durationSec))
        : 1;
    const ptIdx = Math.min(
      activeSeg.points.length - 1,
      Math.floor(ratio * activeSeg.points.length)
    );
    return activeSeg.points[ptIdx];
  }, [activeSimulatedSegment, simulation.totalDurationSec, simProgress, validation.jobOriginPointMm]);

  // Aplicar medidas personalizadas de plancha o retazo (y reacomodar trabajos al nuevo ancho)
  const handleUpdateSheetDimensions = (
    nextWidthMm: number,
    nextHeightMm: number,
    options?: { isRollMaterial?: boolean; notifyText?: string }
  ) => {
    const { config: nextCfg, jobs: arrangedJobs } = updateWorkbenchSheetDimensions(
      workbenchJobs,
      workbenchConfig,
      nextWidthMm,
      nextHeightMm,
      { isRollMaterial: options?.isRollMaterial }
    );
    onUpdateConfig(nextCfg);
    if (workbenchJobs.length > 0) {
      onUpdateJobs(arrangedJobs);
    }
    if (options?.notifyText) {
      onNotify(options.notifyText);
    }
  };

  // Activar medida real del Rollo Ecocuero 73 cm x 5 m y optimizar tirada
  const handleApplyEcocueroRoll73cm = () => {
    handleUpdateSheetDimensions(
      ECOCUERO_ROLL_WIDTH_MM,
      ECOCUERO_BED_PASS_HEIGHT_MM,
      {
        isRollMaterial: true,
        notifyText:
          'Rollo de Ecocuero 73 cm × 5 m (730 × 600 mm en mesa) aplicado y trabajos optimizados a todo el ancho.',
      }
    );
  };

  // Importar archivos externos de grabado y corte (DXF, SVG, LBRN2, AI, RD) con medidas reales 1:1 en mm
  const importExternalFilesToWorkbench = async (fileArray: File[]) => {
    setIsUploadingLogos(true);
    try {
      const incomingJobs: WorkbenchJobItem[] = [];
      let nextCfg = workbenchConfig;
      const summaries: string[] = [];

      for (const file of fileArray) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await importExternalLaserFile({
          fileName: file.name,
          bytes,
          config: nextCfg,
        });
        if (res.summary.hasAppliedLayerParams) {
          nextCfg = mergeImportedLayerUpdates(nextCfg, res.layerUpdates);
        }
        incomingJobs.push(...res.jobs);
        const engTotal = res.summary.engravePathCount + res.summary.rasterCount;
        summaries.push(
          `${file.name} (${res.summary.widthMm}×${res.summary.heightMm} mm · ${engTotal}G/${res.summary.holeContourCount}A/${res.summary.cutContourCount}C)`
        );
      }

      const merged = mergeComplementaryImportedJobs(workbenchJobs, incomingJobs);
      const lastCreatedId =
        merged.jobs[merged.jobs.length - 1]?.id ?? incomingJobs[incomingJobs.length - 1]?.id ?? null;

      if (nextCfg !== workbenchConfig) {
        onUpdateConfig(nextCfg);
      }
      const useZeroWaste =
        nextCfg.packingMode === 'continuous_zero_waste' ||
        nextCfg.isRollMaterial ||
        isEco;
      const arranged = autoArrangeWorkbenchJobs(
        merged.jobs,
        nextCfg,
        nextCfg.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
        useZeroWaste
      );
      onUpdateJobs(arranged);
      if (lastCreatedId) setSelectedJobId(lastCreatedId);
      const pairNote =
        merged.mergedCount > 0 ? ' · ✨ Grabado + Corte emparejados 1:1 mm' : '';
      const msg = `📂 ${fileArray.length} archivo(s) externo(s) abierto(s): ${summaries.join(' | ')}${pairNote}`;
      setRuidaStatusMsg({ type: 'success', text: msg });
      onNotify(msg);
    } catch (err) {
      const msg = `Error al abrir archivo externo: ${
        err instanceof Error ? err.message : String(err)
      }`;
      setRuidaStatusMsg({ type: 'error', text: msg });
      onNotify(msg);
    } finally {
      setIsUploadingLogos(false);
    }
  };

  const handleExternalLaserFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    e.target.value = '';
    await importExternalFilesToWorkbench(fileArray);
  };

  // Subir o pegar múltiples archivos de logo (PNG, JPG, SVG o portapapeles) a la tirada
  const processLogoFilesIntoWorkbench = async (
    fileArray: File[],
    originLabel: 'upload' | 'clipboard' = 'upload'
  ) => {
    setIsUploadingLogos(true);
    try {
      let currentList = [...workbenchJobs];
      let nextCfg = workbenchConfig;
      let lastCreatedId: string | null = null;
      let addedCount = 0;

      for (const file of fileArray) {
        const cleanName = file.name.replace(/\.[^.]+$/, '');
        const extFmt = detectExternalLaserFormat(file.name);
        if (extFmt && extFmt !== 'svg' && !(originLabel === 'clipboard' && extFmt === 'raster')) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const imported = await importExternalLaserFile({
            fileName: file.name,
            bytes,
            config: nextCfg,
          });
          if (imported.summary.hasAppliedLayerParams) {
            nextCfg = mergeImportedLayerUpdates(nextCfg, imported.layerUpdates);
          }
          for (const j of imported.jobs) {
            currentList.push(j);
            lastCreatedId = j.id;
            addedCount++;
          }
          continue;
        }

        const isSvg =
          file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

        if (isSvg) {
          const svgText = await file.text();
          let usedExternalSvgFallback = false;
          try {
            const parsed = parseSvgLogoString(svgText);
            const svgEl: SvgLogoElement = {
              id: `wb-logo-svg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: cleanName,
              type: 'logo_svg',
              xMm: roundMm(design.widthMm / 2, 2),
              yMm: roundMm(design.heightMm / 2, 2),
              widthMm: roundMm(design.widthMm * 0.7, 2),
              heightMm: roundMm((design.widthMm * 0.7) / Math.max(0.1, parsed.aspectRatio), 2),
              aspectRatio: parsed.aspectRatio,
              lockAspectRatio: true,
              rotationDeg: 0,
              locked: false,
              visible: true,
              rawSvgContent: svgText,
              normalizedPaths: parsed.normalizedPaths,
              originalViewBox: parsed.originalViewBox,
              contentBoundsNormalized: parsed.contentBoundsNormalized,
            };

            const newJob = createWorkbenchJobFromUploadedLogo({
              logoName: cleanName,
              clientName: cleanName,
              element: svgEl,
              widthMm: design.widthMm,
              heightMm: design.heightMm,
              shape: design.shape,
              holePreset: design.holes.preset,
              quantity: Math.min(200, Math.max(10, nesting.config.requestedQuantity || 50)),
              gapXMm: nesting.config.gapXMm,
              gapYMm: nesting.config.gapYMm,
              existingJobs: currentList,
              config: nextCfg,
            });
            currentList.push(newJob);
            lastCreatedId = newJob.id;
            addedCount++;
          } catch {
            usedExternalSvgFallback = true;
          }

          if (usedExternalSvgFallback) {
            const imported = await importExternalLaserFile({
              fileName: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
              config: nextCfg,
            });
            for (const j of imported.jobs) {
              currentList.push(j);
              lastCreatedId = j.id;
              addedCount++;
            }
          }
        } else {
          const dataUrl = await readFileAsDataUrl(file);
          const rasterEl = await processImageDataUrlInBrowser({
            dataUrl,
            name: cleanName,
            targetWidthMm: roundMm(design.widthMm * 0.7, 2),
            centerXMm: roundMm(design.widthMm / 2, 2),
            centerYMm: roundMm(design.heightMm / 2, 2),
            options: DEFAULT_IMAGE_PROCESSING,
          });

          const newJob = createWorkbenchJobFromUploadedLogo({
            logoName: cleanName,
            clientName: cleanName,
            element: rasterEl,
            widthMm: design.widthMm,
            heightMm: design.heightMm,
            shape: design.shape,
            holePreset: design.holes.preset,
            quantity: Math.min(200, Math.max(10, nesting.config.requestedQuantity || 50)),
            gapXMm: nesting.config.gapXMm,
            gapYMm: nesting.config.gapYMm,
            existingJobs: currentList,
            config: nextCfg,
          });
          currentList.push(newJob);
          lastCreatedId = newJob.id;
          addedCount++;
        }
      }

      if (nextCfg !== workbenchConfig) {
        onUpdateConfig(nextCfg);
      }
      // Acomodar todos los trabajos automáticamente aprovechando al máximo el ancho útil
      const useZeroWaste =
        nextCfg.packingMode === 'continuous_zero_waste' ||
        nextCfg.isRollMaterial ||
        isEco;
      const arranged = autoArrangeWorkbenchJobs(
        currentList,
        nextCfg,
        nextCfg.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
        useZeroWaste
      );
      onUpdateJobs(arranged);
      if (lastCreatedId) setSelectedJobId(lastCreatedId);
      const msg =
        originLabel === 'clipboard'
          ? `📋 ${addedCount} logo(s) pegado(s) del portapapeles y acomodado(s) en la tirada.`
          : `${addedCount} trabajo(s) con logos distintos cargados y acomodados aprovechando la plancha.`;
      setRuidaStatusMsg({ type: 'success', text: msg });
      onNotify(msg);
    } catch (err) {
      const msg = `Error al procesar logos para la tirada: ${
        err instanceof Error ? err.message : String(err)
      }`;
      setRuidaStatusMsg({ type: 'error', text: msg });
      onNotify(msg);
    } finally {
      setIsUploadingLogos(false);
    }
  };

  const handleMultiLogoFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    e.target.value = '';
    await processLogoFilesIntoWorkbench(fileArray, 'upload');
  };

  const handlePasteLogoToWorkbenchButton = async () => {
    const files = await readLogoFilesFromClipboard();
    if (files.length === 0) {
      const warn =
        'No se detectó ningún logo o imagen copiado en el portapapeles. Copiá una imagen (⌘C / Copiar imagen) y tocá "Pegar Logo" o presioná ⌘V.';
      setRuidaStatusMsg({ type: 'info', text: warn });
      onNotify(warn);
      return;
    }
    await processLogoFilesIntoWorkbench(files, 'clipboard');
  };

  const processLogoFilesIntoWorkbenchRef = useRef(processLogoFilesIntoWorkbench);
  processLogoFilesIntoWorkbenchRef.current = processLogoFilesIntoWorkbench;

  useEffect(() => {
    const onWorkbenchPaste = (e: ClipboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) return;
      const clipFiles = extractLogoFilesFromClipboardData(e.clipboardData);
      if (clipFiles.length > 0) {
        e.preventDefault();
        void processLogoFilesIntoWorkbenchRef.current(clipFiles, 'clipboard');
        return;
      }
      if (isTauri()) {
        void readLogoFilesFromClipboard().then((nativeFiles) => {
          if (nativeFiles.length > 0) {
            void processLogoFilesIntoWorkbenchRef.current(nativeFiles, 'clipboard');
          }
        });
      }
    };
    window.addEventListener('paste', onWorkbenchPaste);
    return () => window.removeEventListener('paste', onWorkbenchPaste);
  }, []);

  // Acciones de agregar trabajos a la plancha
  const handleAddActiveBatch = () => {
    const useZeroWaste =
      workbenchConfig.packingMode === 'continuous_zero_waste' ||
      workbenchConfig.isRollMaterial ||
      isEco;
    const newJob = createWorkbenchJobFromOrder({
      design,
      nesting,
      batchIndex: activeBatchIndex,
      mode: useZeroWaste ? 'roll_strip' : 'active_batch',
      projectName,
      clientName,
      orderId: activeOrderId,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = autoArrangeWorkbenchJobs(
      [...workbenchJobs, newJob],
      workbenchConfig,
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
      useZeroWaste
    );
    onUpdateJobs(next);
    setSelectedJobId(newJob.id);
    onNotify(`Trabajo "${newJob.name}" agregado a la tirada en plancha.`);
  };

  const handleAddSinglePiece = () => {
    const newJob = createWorkbenchJobFromOrder({
      design,
      nesting,
      batchIndex: activeBatchIndex,
      mode: 'single_piece',
      projectName,
      clientName,
      orderId: activeOrderId,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = [...workbenchJobs, newJob];
    onUpdateJobs(next);
    setSelectedJobId(newJob.id);
    onNotify(`Etiqueta individual "${newJob.name}" agregada a la plancha.`);
  };

  const handleAddFromCatalogOrder = (ordId: string) => {
    const targetOrder = ordersCatalog.find((o) => o.id === ordId);
    if (!targetOrder) return;
    const useZeroWaste =
      workbenchConfig.packingMode === 'continuous_zero_waste' ||
      workbenchConfig.isRollMaterial ||
      isEco;
    const newJob = createWorkbenchJobFromOrder({
      design: targetOrder.labelDesign,
      nesting,
      mode: 'roll_strip',
      customQuantity: targetOrder.nestingConfig.requestedQuantity,
      projectName: targetOrder.projectName,
      clientName: targetOrder.clientName,
      orderId: targetOrder.id,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = autoArrangeWorkbenchJobs(
      [...workbenchJobs, newJob],
      workbenchConfig,
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
      useZeroWaste
    );
    onUpdateJobs(next);
    setSelectedJobId(newJob.id);
    setOrderToAppendId('');
    onNotify(
      `Pedido "${targetOrder.projectName}" (${newJob.pieceCount} u.) combinado en la misma tirada.`
    );
  };

  const handleAutoArrangeAll = (optimizeForRollWidth = true) => {
    const arranged = autoArrangeWorkbenchJobs(
      workbenchJobs,
      workbenchConfig,
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
      optimizeForRollWidth
    );
    onUpdateJobs(arranged);
    onNotify(
      optimizeForRollWidth
        ? `Tirada optimizada en flujo continuo (${workbenchConfig.sheetWidthMm} mm) sin huecos entre logos.`
        : 'Trabajos acomodados automáticamente dentro de la plancha.'
    );
  };

  const handleApplyExtremeSaving = () => {
    const { config: nextConfig, jobs: nextJobs } =
      applyExtremeMaterialSavingToWorkbench(workbenchJobs, workbenchConfig);
    onUpdateConfig(nextConfig);
    onUpdateJobs(nextJobs);
    const nextMetrics = computeEcocueroRollMetrics(nextJobs, nextConfig);
    onNotify(
      `✨ Aprovechamiento optimizado: ${nextMetrics.stripAreaEfficiencyPercent}% eficiencia (${nextMetrics.usedLengthCm} cm de avance · ${nextMetrics.savedRollLengthCm} cm ahorrados).`
    );
  };

  const handleFillLastRowFreeSlots = () => {
    const { jobs: nextJobs, addedPieces } = fillLastRowFreeSlotsInWorkbench(
      workbenchJobs,
      workbenchConfig
    );
    if (addedPieces > 0) {
      onUpdateJobs(nextJobs);
      onNotify(
        `+${addedPieces} etiquetas agregadas en el hueco libre de la última fila (0.0 cm de rollo adicional consumido).`
      );
    }
  };

  const handleDuplicateSelectedJob = () => {
    if (!selectedJob) return;
    const useZeroWaste =
      workbenchConfig.packingMode === 'continuous_zero_waste' ||
      workbenchConfig.isRollMaterial ||
      isEco;
    const copy: WorkbenchJobItem = {
      ...structuredClone(selectedJob),
      id: `wb-job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${selectedJob.name.replace(/\s*\(\d+\s*u\.\)$/, '')} Copia (${selectedJob.pieceCount} u.)`,
    };
    const next = autoArrangeWorkbenchJobs(
      [...workbenchJobs, copy],
      workbenchConfig,
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
      useZeroWaste
    );
    onUpdateJobs(next);
    setSelectedJobId(copy.id);
    onNotify(`Trabajo "${selectedJob.name}" duplicado en la tirada.`);
  };

  const handleDeleteJob = (id: string) => {
    const next = workbenchJobs.filter((j) => j.id !== id);
    onUpdateJobs(next);
    if (selectedJobId === id) {
      setSelectedJobId(next[0]?.id ?? null);
    }
  };

  const handleMoveJob = (id: string, direction: 'up' | 'down') => {
    const reordered = reorderWorkbenchJob(workbenchJobs, id, direction);
    const useZeroWaste =
      workbenchConfig.packingMode === 'continuous_zero_waste' ||
      workbenchConfig.isRollMaterial ||
      isEco;
    const arranged = autoArrangeWorkbenchJobs(
      reordered,
      workbenchConfig,
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
      useZeroWaste
    );
    onUpdateJobs(arranged);
  };

  const handleSortJobsBySpatialOrder = () => {
    const sorted = sortWorkbenchJobsBySpatialOrder(workbenchJobs);
    onUpdateJobs(sorted);
    onNotify('Cola de corte ordenada de arriba hacia abajo e izquierda a derecha.');
  };

  const handleUpdateSelectedJob = (patch: Partial<WorkbenchJobItem>) => {
    if (!selectedJob) return;
    const next = workbenchJobs.map((j) =>
      j.id === selectedJob.id ? { ...j, ...patch } : j
    );
    onUpdateJobs(next);
  };

  const handleUpdateSelectedJobDesignOrQty = (updates: {
    baseName?: string;
    clientName?: string;
    widthMm?: number;
    heightMm?: number;
    shape?: LabelShapeType;
    holePreset?: HolePreset;
    pieceCount?: number;
    columns?: number;
    rows?: number;
    gapXMm?: number;
    gapYMm?: number;
    blockRotationDeg?: 0 | 90;
    autoFitColumnsToRoll?: boolean;
    preservePieceCount?: boolean;
  }) => {
    if (!selectedJob) return;
    const rebuilt = updateWorkbenchJobDesignAndQuantity(
      selectedJob,
      updates,
      workbenchConfig
    );
    const updatedList = workbenchJobs.map((j) =>
      j.id === selectedJob.id ? rebuilt : j
    );
    // Mantener el flujo continuo cuando cambian medidas/cantidad, o preservar columnas/filas manuales evitando solapamientos
    if (
      updates.pieceCount !== undefined ||
      updates.widthMm !== undefined ||
      updates.heightMm !== undefined ||
      updates.autoFitColumnsToRoll
    ) {
      const useZeroWaste =
        workbenchConfig.packingMode === 'continuous_zero_waste' ||
        workbenchConfig.isRollMaterial ||
        isEco;
      onUpdateJobs(
        autoArrangeWorkbenchJobs(
          updatedList,
          workbenchConfig,
          workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
          useZeroWaste
        )
      );
    } else if (updatedList.length > 1) {
      onUpdateJobs(
        autoArrangeWorkbenchJobs(updatedList, workbenchConfig, 2, false)
      );
    } else {
      onUpdateJobs(updatedList);
    }
  };

  // Gestión de Capas C00..C02
  const handleUpdateLayer = (
    cutIndex: number,
    patch: Partial<WorkbenchLayerConfig>
  ) => {
    const nextLayers = workbenchConfig.layers.map((l) =>
      l.cutIndex === cutIndex ? { ...l, ...patch } : l
    );
    onUpdateConfig({ ...workbenchConfig, layers: nextLayers });
  };

  const handleMoveLayerPriority = (cutIndex: number, direction: 'up' | 'down') => {
    const sorted = [...workbenchConfig.layers].sort((a, b) => a.priority - b.priority);
    const idx = sorted.findIndex((l) => l.cutIndex === cutIndex);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const tempPrio = sorted[idx].priority;
    sorted[idx] = { ...sorted[idx], priority: sorted[swapIdx].priority };
    sorted[swapIdx] = { ...sorted[swapIdx], priority: tempPrio };

    onUpdateConfig({
      ...workbenchConfig,
      layers: sorted.sort((a, b) => a.priority - b.priority),
    });
  };

  const handleSyncFromMaterial = () => {
    const synced = syncLayersWithMaterialProfile(workbenchConfig.layers, material);
    onUpdateConfig({ ...workbenchConfig, layers: synced });
    onNotify(`Parámetros de capas sincronizados desde "${material.name}".`);
  };

  const handleSaveLayersToMaterial = () => {
    const updatedMat = applyWorkbenchLayersToMaterialProfile(
      workbenchConfig.layers,
      material
    );
    onSaveMaterialParameters(updatedMat);
    onNotify(`Velocidades y potencias guardadas en el perfil de "${material.name}".`);
  };

  const selectedLayer = useMemo(
    () =>
      workbenchConfig.layers.find((l) => l.cutIndex === selectedLayerCutIndex) ??
      workbenchConfig.layers[0],
    [workbenchConfig.layers, selectedLayerCutIndex]
  );

  const calibrationGrid = useMemo(
    () => generateMaterialTestCells(calibrationConfig),
    [calibrationConfig]
  );

  // Aplicar celda ganadora de la matriz de calibración a la capa correspondiente
  const handleApplyWinningCalibrationCell = (
    cell: MaterialTestCell,
    alsoSaveToLibrary: boolean
  ) => {
    const targetCutIndex =
      calibrationConfig.targetRole === 'ENGRAVE'
        ? 0
        : calibrationConfig.targetRole === 'HOLES'
          ? 1
          : 2;

    const nextLayers = workbenchConfig.layers.map((l) => {
      if (l.cutIndex !== targetCutIndex) return l;
      return {
        ...l,
        speedMmPerSec: cell.speedMmPerSec,
        maxPowerPercent: cell.maxPowerPercent,
        minPowerPercent: cell.minPowerPercent,
        lineIntervalMm:
          calibrationConfig.testType === 'engrave_grid'
            ? cell.lineIntervalMm
            : l.lineIntervalMm,
        passes: calibrationConfig.passes,
        airAssist: calibrationConfig.airAssist,
        operatorValidated: true,
      };
    });

    onUpdateConfig({
      ...workbenchConfig,
      layers: nextLayers,
    });
    setSelectedLayerCutIndex(targetCutIndex);

    if (alsoSaveToLibrary) {
      const eng = nextLayers.find((l) => l.role === 'ENGRAVE') ?? nextLayers[0];
      const hol = nextLayers.find((l) => l.role === 'HOLES') ?? nextLayers[1];
      const cut = nextLayers.find((l) => l.role === 'CUT') ?? nextLayers[2];
      const entry: SavedMaterialLibraryEntry = {
        id: `matlib-${Date.now()}`,
        materialName:
          libraryEntryName.trim() ||
          `${material.name} (${cell.speedMmPerSec}mm/s · ${cell.maxPowerPercent}%)`,
        thicknessMm: material.thicknessMm,
        description: `Calibrado con Matriz (${cell.layerCode}: ${cell.speedMmPerSec} mm/s · ${cell.maxPowerPercent}% · Int. ${cell.lineIntervalMm} mm)`,
        updatedAt: new Date().toISOString(),
        engrave: {
          mode: eng.mode === 'image' ? 'image' : 'fill',
          speedMmPerSec: eng.speedMmPerSec ?? 300,
          maxPowerPercent: eng.maxPowerPercent ?? 25,
          minPowerPercent: eng.minPowerPercent ?? eng.maxPowerPercent ?? 25,
          lineIntervalMm: eng.lineIntervalMm,
          passes: eng.passes,
          airAssist: eng.airAssist,
          imageDitherMode: eng.imageDitherMode ?? 'jarvis',
        },
        holes: {
          speedMmPerSec: hol.speedMmPerSec ?? 20,
          maxPowerPercent: hol.maxPowerPercent ?? 55,
          minPowerPercent: hol.minPowerPercent ?? 45,
          passes: hol.passes,
          airAssist: hol.airAssist,
        },
        cut: {
          speedMmPerSec: cut.speedMmPerSec ?? 20,
          maxPowerPercent: cut.maxPowerPercent ?? 60,
          minPowerPercent: cut.minPowerPercent ?? 50,
          passes: cut.passes,
          airAssist: cut.airAssist,
          kerfOffsetMm: cut.kerfOffsetMm ?? 0,
        },
      };
      const updatedLib = saveMaterialLibraryEntry(entry);
      setMaterialLibrary(updatedLib);
    }

    onNotify(
      `✓ Calibración aplicada a C0${targetCutIndex}: ${cell.speedMmPerSec} mm/s · Potencia ${cell.maxPowerPercent}%${
        calibrationConfig.testType === 'engrave_grid'
          ? ` · Intervalo ${cell.lineIntervalMm} mm (${Math.round(
              25.4 / cell.lineIntervalMm
            )} DPI)`
          : ''
      }`
    );
  };

  // Guardar las 3 capas actuales en la Biblioteca de Materiales LightBurn
  const handleSaveCurrentLayersToLibrary = () => {
    const eng =
      workbenchConfig.layers.find((l) => l.role === 'ENGRAVE') ??
      workbenchConfig.layers[0];
    const hol =
      workbenchConfig.layers.find((l) => l.role === 'HOLES') ??
      workbenchConfig.layers[1];
    const cut =
      workbenchConfig.layers.find((l) => l.role === 'CUT') ??
      workbenchConfig.layers[2];

    if (
      (eng.speedMmPerSec === null || eng.maxPowerPercent === null) &&
      (cut.speedMmPerSec === null || cut.maxPowerPercent === null)
    ) {
      onNotify(
        'Ingresá velocidades y potencias en al menos una capa antes de guardar en la Biblioteca de Materiales.'
      );
      return;
    }

    const entry: SavedMaterialLibraryEntry = {
      id: `matlib-${Date.now()}`,
      materialName:
        libraryEntryName.trim() || `${material.name} (${material.thicknessMm} mm)`,
      thicknessMm: material.thicknessMm,
      description:
        libraryNotes.trim() ||
        `C00 ${eng.speedMmPerSec ?? '—'}/${eng.maxPowerPercent ?? '—'} (Int ${eng.lineIntervalMm}mm) · C02 ${cut.speedMmPerSec ?? '—'}/${cut.maxPowerPercent ?? '—'}`,
      updatedAt: new Date().toISOString(),
      engrave: {
        mode: eng.mode === 'image' ? 'image' : 'fill',
        speedMmPerSec: eng.speedMmPerSec ?? 600,
        maxPowerPercent: eng.maxPowerPercent ?? 30,
        minPowerPercent: eng.minPowerPercent ?? eng.maxPowerPercent ?? 30,
        lineIntervalMm: eng.lineIntervalMm,
        passes: eng.passes,
        airAssist: eng.airAssist,
        imageDitherMode: eng.imageDitherMode ?? 'jarvis',
      },
      holes: {
        speedMmPerSec: hol.speedMmPerSec ?? cut.speedMmPerSec ?? 100,
        maxPowerPercent: hol.maxPowerPercent ?? cut.maxPowerPercent ?? 100,
        minPowerPercent: hol.minPowerPercent ?? hol.maxPowerPercent ?? 100,
        passes: hol.passes,
        airAssist: hol.airAssist,
      },
      cut: {
        speedMmPerSec: cut.speedMmPerSec ?? 100,
        maxPowerPercent: cut.maxPowerPercent ?? 100,
        minPowerPercent: cut.minPowerPercent ?? cut.maxPowerPercent ?? 100,
        passes: cut.passes,
        airAssist: cut.airAssist,
        kerfOffsetMm: cut.kerfOffsetMm ?? 0,
      },
    };

    const nextLib = saveMaterialLibraryEntry(entry);
    setMaterialLibrary(nextLib);
    setLibraryNotes('');
    onNotify(
      `Preset "${entry.materialName}" guardado en la Biblioteca de Materiales.`
    );
  };

  const handleApplyLibraryEntry = (entry: SavedMaterialLibraryEntry) => {
    const nextLayers = applyLibraryEntryToWorkbenchLayers(
      entry,
      workbenchConfig.layers
    );
    onUpdateConfig({
      ...workbenchConfig,
      layers: nextLayers,
    });
    onNotify(
      `Preset "${entry.materialName}" aplicado a las capas C00, C01 y C02.`
    );
  };

  const handleDeleteLibraryEntry = (id: string) => {
    const nextLib = deleteMaterialLibraryEntry(id);
    setMaterialLibrary(nextLib);
  };

  // Exportar o enviar la Matriz de Calibración a LightBurn (.lbrn2), .RD, .SVG o UDP directo a 192.168.0.195
  const handleExportCalibrationLbrn2 = async (openInLightBurn: boolean) => {
    try {
      const artifact = exportMaterialTestToLbrn2(calibrationConfig, material.name);
      if (openInLightBurn && isTauri()) {
        const res = await invoke<{
          saved_path: string;
          launched_lightburn: boolean;
          message: string;
        }>('open_lbrn2_in_lightburn', {
          folderName: 'Matrices_Calibracion_Vank9060',
          filename: artifact.filenameSuggested,
          lbrn2Content: artifact.lbrn2Content,
        });
        onNotify(res.message);
        return;
      }
      onRequestSaveFiles([
        {
          name: artifact.filenameSuggested,
          content: artifact.lbrn2Content,
        },
      ]);
      onNotify(`Matriz LightBurn "${artifact.filenameSuggested}" generada.`);
    } catch (err) {
      onNotify(
        `Error al exportar matriz .lbrn2: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  const handleDownloadCalibrationRd = () => {
    try {
      const compiled = compileMaterialTestToRuidaRd(calibrationConfig, 'CALTEST');
      const blob = new Blob([compiled.rdBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = compiled.filenameSuggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotify(
        `Matriz Ruida "${compiled.filenameSuggested}" (${compiled.totalPieces} celdas) descargada.`
      );
    } catch (err) {
      onNotify(
        `Error al compilar matriz .RD: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  const handleSendCalibrationMatrixToVank = async () => {
    try {
      const compiled = compileMaterialTestToRuidaRd(calibrationConfig, 'CALTEST');
      if (!isTauri()) {
        handleDownloadCalibrationRd();
        return;
      }
      setIsSendingToRuida(true);
      setRuidaUploadProgress(null);
      const response = await uploadRdBytesToVankRuida({
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
        rdBytes: compiled.rdBytes,
        jobName: compiled.ruidaJobName,
        onProgress: setRuidaUploadProgress,
      });
      onNotify(response.message);
    } catch (err) {
      onNotify(
        `Error al enviar matriz a ${workbenchConfig.ruidaIpAddress}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setIsSendingToRuida(false);
      setRuidaUploadProgress(null);
    }
  };

  const handleExportCalibrationSvg = () => {
    const svgArt = exportMaterialTestToSvg(calibrationConfig, material.name);
    onRequestSaveFiles([
      {
        name: svgArt.filenameSuggested,
        content: svgArt.svgContent,
      },
    ]);
    onNotify(`Matriz SVG "${svgArt.filenameSuggested}" lista para guardar.`);
  };

  // Arrastre de bloques en el lienzo SVG
  const clientToMillimeters = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const handleJobPointerDown = (
    e: React.PointerEvent<SVGGElement>,
    job: WorkbenchJobItem
  ) => {
    e.stopPropagation();
    setSelectedJobId(job.id);
    if (job.locked) return;
    const mm = clientToMillimeters(e.clientX, e.clientY);
    draggingJobRef.current = {
      jobId: job.id,
      startMouseX: mm.x,
      startMouseY: mm.y,
      initialJobX: job.xMm,
      initialJobY: job.yMm,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = draggingJobRef.current;
    if (!drag) return;
    const mm = clientToMillimeters(e.clientX, e.clientY);
    const dx = mm.x - drag.startMouseX;
    const dy = mm.y - drag.startMouseY;
    const nextX = roundMm(
      Math.max(
        0,
        Math.min(workbenchConfig.machineBedWidthMm - 5, drag.initialJobX + dx)
      ),
      1
    );
    const nextY = roundMm(
      Math.max(
        0,
        Math.min(workbenchConfig.machineBedHeightMm - 5, drag.initialJobY + dy)
      ),
      1
    );

    onUpdateJobs(
      workbenchJobs.map((j) =>
        j.id === drag.jobId ? { ...j, xMm: nextX, yMm: nextY } : j
      )
    );
  };

  const handleSvgPointerUp = () => {
    draggingJobRef.current = null;
  };

  // =====================================================
  // ACCIONES DE CARGA A VANK 9060 Y EXPORTACIÓN (.LBRN2 / .RD / .SVG)
  // =====================================================

  const handleSendToVankRuida = async () => {
    setRuidaStatusMsg(null);
    if (!safetyConfirmed) {
      const warnMsg =
        'Marcá primero el check "Confirmo foco Z, extracción/chiller encendidos y parámetros validados" para enviar el trabajo a la Vank 9060.';
      setSafetyHighlight(true);
      setRuidaStatusMsg({
        type: 'error',
        text: warnMsg,
      });
      onNotify(warnMsg);
      return;
    }
    setSafetyHighlight(false);

    try {
      setIsSendingToRuida(true);
      setRuidaStatusMsg({
        type: 'info',
        text: 'Procesando píxeles reales del logo para el grabado láser…',
      });
      const rasterMasks = await prepareWorkbenchRasterMasks(
        workbenchJobs,
        workbenchConfig
      );
      rasterMasksRef.current = rasterMasks;
      setPreparedRasterVersion((v) => v + 1);
      const exactSim = simulateWorkbenchToolpath(
        workbenchJobs,
        workbenchConfig,
        motionCalibration,
        rasterMasks
      );
      const exactEstSec = Math.max(10, Math.round(exactSim.totalDurationSec));
      const compiled = compileWorkbenchToRuidaRd(
        workbenchJobs,
        workbenchConfig,
        rasterMasks
      );
      const jobKey = (compiled.ruidaJobName || projectName || 'ASTRA01')
        .trim()
        .toUpperCase();
      setActiveVankFileName(jobKey);
      rememberRuidaFileEstimate({
        fileName: jobKey,
        totalPieces: compiled.totalPieces,
        estimatedTotalSec: exactEstSec,
        updatedAtMs: Date.now(),
      });
      setRememberedFileEstimates(loadRememberedFileEstimates());

      if (!isTauri()) {
        setIsSendingToRuida(false);
        const blob = new Blob([compiled.rdBytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = compiled.filenameSuggested;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMachineTimer((prev) =>
          armJobTimerWatch(prev, {
            jobName: jobKey,
            totalPieces: compiled.totalPieces,
            estimatedTotalSec: exactEstSec,
          })
        );
        setRuidaStatusMsg({
          type: 'info',
          text: `Archivo binario Ruida "${compiled.filenameSuggested}" (${compiled.rdBytes.length} bytes) descargado. El envío TCP/UDP directo sin cables se realiza desde la app nativa Astra Studio (.app).`,
        });
        return;
      }

      setRuidaUploadProgress(null);
      const response = await uploadRdBytesToVankRuida({
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
        rdBytes: compiled.rdBytes,
        jobName: compiled.ruidaJobName,
        onProgress: setRuidaUploadProgress,
      });

      void syncHardwareCalibrationAndFiles(
        workbenchConfig.ruidaIpAddress,
        workbenchConfig.ruidaPort
      );

      setMachineTimer((prev) =>
        armJobTimerWatch(prev, {
          jobName: jobKey,
          totalPieces: compiled.totalPieces,
          estimatedTotalSec: exactEstSec,
        })
      );
      setRuidaStatusMsg({
        type: 'success',
        text: response.message,
      });
      onNotify(response.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRuidaStatusMsg({
        type: 'error',
        text: msg,
      });
    } finally {
      setIsSendingToRuida(false);
      setRuidaUploadProgress(null);
    }
  };

  const handleDownloadRdFile = async () => {
    setRuidaStatusMsg(null);
    try {
      const rasterMasks = await prepareWorkbenchRasterMasks(
        workbenchJobs,
        workbenchConfig
      );
      rasterMasksRef.current = rasterMasks;
      setPreparedRasterVersion((v) => v + 1);
      const exactSim = simulateWorkbenchToolpath(
        workbenchJobs,
        workbenchConfig,
        motionCalibration,
        rasterMasks
      );
      const compiled = compileWorkbenchToRuidaRd(
        workbenchJobs,
        workbenchConfig,
        rasterMasks
      );
      const jobKey = (compiled.ruidaJobName || projectName || 'ASTRA01')
        .trim()
        .toUpperCase();
      setActiveVankFileName(jobKey);
      rememberRuidaFileEstimate({
        fileName: jobKey,
        totalPieces: compiled.totalPieces,
        estimatedTotalSec: Math.max(10, Math.round(exactSim.totalDurationSec)),
        updatedAtMs: Date.now(),
      });
      setRememberedFileEstimates(loadRememberedFileEstimates());
      const blob = new Blob([compiled.rdBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = compiled.filenameSuggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRuidaStatusMsg({
        type: 'success',
        text: `Archivo Ruida "${compiled.filenameSuggested}" (${compiled.totalPieces} piezas, ${compiled.commandCount} comandos láser) descargado para Pendrive USB (U-Disk Ruida).`,
      });
      onNotify(`Archivo ${compiled.filenameSuggested} descargado.`);
    } catch (err) {
      setRuidaStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleOpenOrSaveLbrn2 = async (openDirectlyInLightBurn: boolean) => {
    setRuidaStatusMsg(null);
    try {
      const artifact = exportWorkbenchToLbrn2(
        workbenchJobs,
        workbenchConfig,
        projectName
      );

      if (openDirectlyInLightBurn && isTauri()) {
        const res = await invoke<{
          saved_path: string;
          launched_lightburn: boolean;
          message: string;
        }>('open_lbrn2_in_lightburn', {
          folderName: projectName.trim() || 'Mesa_Vank_9060',
          filename: artifact.filenameSuggested,
          lbrn2Content: artifact.lbrn2Content,
        });
        setRuidaStatusMsg({
          type: 'success',
          text: res.message,
        });
        onNotify(res.message);
        return;
      }

      onRequestSaveFiles([
        {
          name: artifact.filenameSuggested,
          content: artifact.lbrn2Content,
        },
      ]);
    } catch (err) {
      setRuidaStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleExportWorkbenchSvg = () => {
    setRuidaStatusMsg(null);
    try {
      const svgArt = exportWorkbenchToSvg(workbenchJobs, workbenchConfig, projectName);
      onRequestSaveFiles([
        {
          name: svgArt.filenameSuggested,
          content: svgArt.svgContent,
        },
      ]);
    } catch (err) {
      setRuidaStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleExportWorkbenchVector = async (format: 'dxf' | 'ai') => {
    setRuidaStatusMsg(null);
    try {
      const rasterMasks = await prepareWorkbenchRasterMasks(
        workbenchJobs,
        workbenchConfig
      );
      if (format === 'dxf') {
        const dxfArt = exportWorkbenchToDxf(
          workbenchJobs,
          workbenchConfig,
          rasterMasks,
          projectName
        );
        onRequestSaveFiles([
          {
            name: dxfArt.filenameSuggested,
            content: dxfArt.dxfContent,
          },
        ]);
        setRuidaStatusMsg({
          type: 'success',
          text: `DXF 1:1 mm exportado: "${dxfArt.filenameSuggested}" (${dxfArt.engravePolylineCount} grabados, ${dxfArt.holeContourCount} orificios, ${dxfArt.cutContourCount} cortes).`,
        });
      } else {
        const aiArt = exportWorkbenchToAi(
          workbenchJobs,
          workbenchConfig,
          rasterMasks,
          projectName
        );
        onRequestSaveFiles([
          {
            name: aiArt.filenameSuggested,
            content: aiArt.aiContent,
          },
        ]);
        setRuidaStatusMsg({
          type: 'success',
          text: `Archivo Adobe Illustrator (.AI) 1:1 mm exportado: "${aiArt.filenameSuggested}" (${aiArt.engraveContourCount} grabados, ${aiArt.holeContourCount} orificios, ${aiArt.cutContourCount} cortes).`,
        });
      }
    } catch (err) {
      setRuidaStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Probar alcance de red y handshake Ruida hacia la Vank 9060 (192.168.0.195:50200) sin mover el láser
  const handleProbeRuidaConnection = async () => {
    setIsProbingRuida(true);
    setRuidaStatusMsg(null);
    try {
      const val = validateWorkbenchState(workbenchJobs, workbenchConfig);
      const res = await probeVankRuidaConnection({
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
        preparedSummary: `Tirada actual: ${val.totalPieces} u. (${rollMetrics.usedLengthCm} cm).`,
      });

      setRuidaProbeResult({
        reachable: res.reachable,
        localPortFree: res.local_port_40200_free,
        udpHandshakeOk: res.udp_handshake_ok,
        transportMode: res.transport_mode ?? null,
        pingOk: res.ping_ok,
        latencyMs: res.latency_ms,
        message: res.message,
      });
      if (res.reachable) {
        void syncHardwareCalibrationAndFiles(
          workbenchConfig.ruidaIpAddress,
          workbenchConfig.ruidaPort
        );
      }
      setRuidaStatusMsg({
        type: res.udp_handshake_ok
          ? 'success'
          : res.reachable || (!isTauri() && res.ip)
            ? 'info'
            : 'error',
        text: res.message,
      });
      onNotify(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRuidaProbeResult({
        reachable: false,
        localPortFree: false,
        message: msg,
      });
      setRuidaStatusMsg({ type: 'error', text: msg });
    } finally {
      setIsProbingRuida(false);
    }
  };

  // Calcular ViewBox del SVG según la vista de cámara + zoom interactivo
  let baseMinX = -28;
  let baseMinY = -28;
  let baseWidth = workbenchConfig.machineBedWidthMm + 48;
  let baseHeight = workbenchConfig.machineBedHeightMm + 48;

  if (cameraView === 'tirada_roll') {
    // Vista inteligente de tirada activa sobre el ancho del rollo de 73 cm:
    // Muestra de punta a punta el ancho del rollo (730 mm) pero recorta el espacio muerto inferior
    // para que las etiquetas se vean más de 3 veces más grandes y nítidas.
    const padX = 18;
    const padTop = 16;
    const activeUsedH = Math.max(45, rollMetrics.usedLengthMm || 60);
    const visibleSheetH = Math.min(
      workbenchConfig.sheetHeightMm,
      Math.max(120, activeUsedH + 35)
    );
    baseMinX = workbenchConfig.sheetOffsetXMm - padX;
    baseMinY = workbenchConfig.sheetOffsetYMm - padTop;
    baseWidth = workbenchConfig.sheetWidthMm + padX * 2;
    baseHeight = visibleSheetH + padTop + 16;
  } else if (cameraView === 'sheet') {
    const pad = Math.max(
      22,
      Math.max(workbenchConfig.sheetWidthMm, workbenchConfig.sheetHeightMm) * 0.06
    );
    baseMinX = workbenchConfig.sheetOffsetXMm - pad;
    baseMinY = workbenchConfig.sheetOffsetYMm - pad;
    baseWidth = workbenchConfig.sheetWidthMm + pad * 2;
    baseHeight = workbenchConfig.sheetHeightMm + pad * 2;
  } else if (cameraView === 'occupied' && validation.occupiedBoundsMm) {
    const ob = validation.occupiedBoundsMm;
    const padX = Math.max(12, ob.width * 0.04);
    const padY = Math.max(12, ob.height * 0.18);
    baseMinX = ob.minX - padX;
    baseMinY = ob.minY - padY;
    baseWidth = ob.width + padX * 2;
    baseHeight = ob.height + padY * 2;
  }

  const safeZoom = Math.max(0.75, Math.min(8, canvasZoom));
  const vbWidth = roundMm(baseWidth / safeZoom, 2);
  const vbHeight = roundMm(baseHeight / safeZoom, 2);
  // Al hacer zoom, enfocamos hacia el centro superior de la tirada activa
  const focusCenterX = validation.occupiedBoundsMm
    ? (validation.occupiedBoundsMm.minX + validation.occupiedBoundsMm.maxX) / 2
    : baseMinX + baseWidth / 2;
  const focusCenterY = validation.occupiedBoundsMm
    ? (validation.occupiedBoundsMm.minY + validation.occupiedBoundsMm.maxY) / 2
    : baseMinY + baseHeight / 3;
  const vbMinX = roundMm(
    safeZoom === 1 ? baseMinX : focusCenterX - vbWidth / 2,
    2
  );
  const vbMinY = roundMm(
    safeZoom === 1 ? baseMinY : focusCenterY - vbHeight / 2,
    2
  );

  const machineHomeCoords = useMemo(() => {
    const w = workbenchConfig.machineBedWidthMm;
    const h = workbenchConfig.machineBedHeightMm;
    switch (workbenchConfig.machineOriginCorner) {
      case 'top_left':
        return { x: 0, y: 0 };
      case 'top_right':
        return { x: w, y: 0 };
      case 'bottom_left':
        return { x: 0, y: h };
      case 'bottom_right':
        return { x: w, y: h };
    }
  }, [
    workbenchConfig.machineOriginCorner,
    workbenchConfig.machineBedWidthMm,
    workbenchConfig.machineBedHeightMm,
  ]);

  const sortedLayers = useMemo(
    () => [...workbenchConfig.layers].sort((a, b) => a.priority - b.priority),
    [workbenchConfig.layers]
  );

  const engraveLayerCfg = workbenchConfig.layers.find((l) => l.role === 'ENGRAVE');
  const holesLayerCfg = workbenchConfig.layers.find((l) => l.role === 'HOLES');
  const cutLayerCfg = workbenchConfig.layers.find((l) => l.role === 'CUT');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mesa de Trabajo Vank 9060 estilo LightBurn"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files);
          const laserFiles = dropped.filter((f) => detectExternalLaserFormat(f.name) !== null);
          if (laserFiles.length > 0) {
            void importExternalFilesToWorkbench(laserFiles);
          }
        }
      }}
      className="fixed inset-0 z-50 bg-[#070a0e]/95 backdrop-blur-sm flex flex-col text-slate-100 select-none"
    >
      {/* Input oculto para abrir archivos externos completos de grabado y corte (DXF, SVG, LBRN2, AI, RD, PNG, JPG) */}
      <input
        ref={externalLaserInputRef}
        type="file"
        multiple
        accept=".dxf,.svg,.lbrn2,.lbrn,.ai,.rd,.png,.jpg,.jpeg,.webp,.bmp"
        aria-label="Abrir archivo externo de grabado y corte"
        onChange={handleExternalLaserFilesSelected}
        className="hidden"
      />
      {/* Input oculto para subir múltiples logos o trazados a la vez */}
      <input
        ref={multiLogoInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.svg,.dxf,.lbrn2,.lbrn,.ai,.rd"
        aria-label="Subir varios logos a la tirada"
        onChange={handleMultiLogoFilesSelected}
        className="hidden"
      />

      {/* 1. CABECERA SUPERIOR LIMPIA Y PROLIJA */}
      <header className="h-13 bg-[#11161f] border-b border-slate-800/90 px-4 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-white truncate">
            Mesa de Trabajo — Vank 9060 CO₂
          </h2>
          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md bg-slate-800/90 text-amber-300 border border-slate-700 shrink-0">
            {workbenchConfig.sheetWidthMm === 730 &&
            workbenchConfig.sheetHeightMm === 600
              ? 'Rollo Ecocuero 73 cm × 5 m'
              : `${isEcocueroMaterial(material) ? 'Retazo Ecocuero' : 'Plancha'} ${workbenchConfig.sheetWidthMm}×${workbenchConfig.sheetHeightMm} mm`}
          </span>
        </div>

        {/* Acciones principales despejadas */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isUploadingLogos}
            onClick={() => externalLaserInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 text-white text-xs font-bold transition-colors whitespace-nowrap"
            title="Abrir archivo externo de grabado y corte (DXF, SVG, LightBurn .lbrn2, Illustrator .ai, Ruida .rd o PNG/JPG) en medidas 1:1 mm"
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span>Abrir Archivo</span>
          </button>

          <button
            type="button"
            disabled={isUploadingLogos}
            onClick={() => multiLogoInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold transition-colors whitespace-nowrap"
            title="Subir varios archivos de logos (PNG, JPG o SVG) a la misma tirada"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isUploadingLogos ? 'Cargando...' : '+ Subir Logos'}
            </span>
          </button>

          <button
            type="button"
            disabled={isUploadingLogos}
            onClick={() => void handlePasteLogoToWorkbenchButton()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/90 hover:bg-teal-500 text-white text-xs font-bold transition-colors whitespace-nowrap"
            title="Pegar logo copiado en el portapapeles (o presioná ⌘V / Ctrl+V) sin descargar archivos"
          >
            <ClipboardPaste className="w-3.5 h-3.5 shrink-0" />
            <span>Pegar Logo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const targetKey = (
                activeVankFileName ||
                workbenchConfig.ruidaJobName ||
                projectName ||
                'ASTRA01'
              )
                .trim()
                .toUpperCase();
              const estSec = Math.max(10, Math.round(simulation.totalDurationSec));
              rememberRuidaFileEstimate({
                fileName: targetKey,
                totalPieces: validation.totalPieces,
                estimatedTotalSec: estSec,
                updatedAtMs: Date.now(),
              });
              setRememberedFileEstimates(loadRememberedFileEstimates());
              if (machineTimer.phase === 'idle') {
                setMachineTimer((prev) =>
                  armJobTimerWatch(prev, {
                    jobName: targetKey,
                    totalPieces: validation.totalPieces,
                    estimatedTotalSec: estSec,
                  })
                );
              } else {
                setMachineTimer((prev) => ({
                  ...prev,
                  popupMinimized: false,
                }));
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap ${
              machineTimer.phase === 'running'
                ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200 animate-pulse'
                : machineTimer.phase === 'paused'
                  ? 'bg-amber-600/25 border-amber-400 text-amber-200'
                  : machineTimer.phase === 'armed'
                    ? 'bg-cyan-600/20 border-cyan-400/70 text-cyan-200'
                    : machineTimer.phase === 'finished'
                      ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-500/30'
                      : 'bg-slate-800/90 hover:bg-slate-700 border-slate-700 text-cyan-300'
            }`}
            title="Monitor de estado en vivo, cronómetro del pedido y alerta sonora al finalizar"
          >
            {machineTimer.phase === 'finished' ? (
              <Bell className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Clock className="w-3.5 h-3.5 shrink-0" />
            )}
            {machineLiveStatus?.reachable && machineTimer.phase === 'idle' && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                title="Monitor automático conectado a Vank 9060"
              />
            )}
            <span>
              {machineTimer.phase === 'idle'
                ? 'Cronómetro Vank'
                : machineTimer.phase === 'armed'
                  ? 'Esperando START...'
                  : machineTimer.phase === 'running'
                    ? `${formatDurationTimer(liveTimerSnapshot.remainingSec)} · ${liveTimerSnapshot.progressPercent}%`
                    : machineTimer.phase === 'paused'
                      ? `Pausada (${formatDurationTimer(liveTimerSnapshot.remainingSec)})`
                      : '¡Pedido Terminado!'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowCalibrationMatrixModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-amber-300 text-xs font-semibold transition-colors whitespace-nowrap"
            title="Abrir Generador de Matriz de Prueba de Potencia × Velocidad"
          >
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            <span>Matriz de Prueba</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPowerActionFeedback(null);
              setShowPowerOffModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/90 hover:bg-rose-900 border border-rose-700/80 text-rose-200 text-xs font-bold transition-colors whitespace-nowrap"
            title="Detener trabajo y apagar completamente la Vank 9060 (STOP Ruida + corte 220V)"
          >
            <Power className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span>Apagar Máquina</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span>Volver</span>
          </button>
        </div>
      </header>

      {/* 2. CUERPO PRINCIPAL: LIENZO 900x600 MM + DOCKS LATERALES ESTILO LIGHTBURN */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ÁREA IZQUIERDA/CENTRAL: MESA DE TRABAJO DESPEJADA + PANEL INFERIOR DE LUPA 1:1 Y ENCUADRE */}
        <div className="flex-1 flex flex-col bg-[#080b10] relative min-w-0 overflow-hidden">
          {/* Sub-barra compacta de vista de cámara, zoom interactivo, modo visual y simulador */}
          <div className="py-1 bg-[#0e131b] border-b border-slate-800/90 px-2.5 flex flex-wrap items-center justify-between gap-1.5 text-[11px] shrink-0">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setCameraView('tirada_roll');
                  setCanvasZoom(1.0);
                }}
                className={`px-2 py-0.5 rounded font-bold transition whitespace-nowrap ${
                  cameraView === 'tirada_roll'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                🔍{' '}
                {workbenchConfig.sheetWidthMm === 730 &&
                workbenchConfig.sheetHeightMm === 600
                  ? 'Rollo 73 cm'
                  : `Retazo ${roundMm(workbenchConfig.sheetWidthMm / 10, 1)} cm`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraView('occupied');
                  setCanvasZoom(1.0);
                }}
                className={`px-2 py-0.5 rounded font-medium transition whitespace-nowrap ${
                  cameraView === 'occupied'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Enfocar Tirada
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraView('sheet');
                  setCanvasZoom(1.0);
                }}
                className={`px-2 py-0.5 rounded font-medium transition whitespace-nowrap ${
                  cameraView === 'sheet'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Plancha {workbenchConfig.sheetWidthMm}×{workbenchConfig.sheetHeightMm}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraView('machine');
                  setCanvasZoom(1.0);
                }}
                className={`px-2 py-0.5 rounded font-medium transition whitespace-nowrap ${
                  cameraView === 'machine'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Mesa 900×600
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraView('3d_machine');
                }}
                className={`px-2 py-0.5 rounded font-bold transition whitespace-nowrap ${
                  cameraView === '3d_machine'
                    ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/60'
                    : 'bg-slate-900 text-indigo-300 hover:text-white border border-slate-800'
                }`}
                title="Vista 3D WebGL interactiva de la mesa Vank 9060 con cabezal láser y piezas"
              >
                🧊 3D Vank
              </button>

              {/* Controles de Zoom Interactivo */}
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded px-1 py-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setCanvasZoom((z) => roundMm(Math.max(0.75, z / 1.35), 2))
                  }
                  className="px-1.5 rounded hover:bg-slate-800 text-slate-300 font-mono font-bold"
                  title="Alejar vista"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasZoom(1.0)}
                  className="px-1 rounded hover:bg-slate-800 text-cyan-300 font-mono text-[10px] font-bold"
                  title="Restablecer zoom 100%"
                >
                  {Math.round(canvasZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCanvasZoom((z) => roundMm(Math.min(8, z * 1.35), 2))
                  }
                  className="px-1.5 rounded hover:bg-slate-800 text-slate-300 font-mono font-bold"
                  title="Acercar vista para ver etiquetas en grande"
                >
                  +
                </button>
              </div>
            </div>

            {/* Selector de Estilo Visual + Lupa 1:1 + Simulador */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setCanvasVisualMode(
                    canvasVisualMode === 'technical_lightburn'
                      ? 'realistic_material'
                      : 'technical_lightburn'
                  )
                }
                className={`px-2 py-0.5 rounded font-bold border transition whitespace-nowrap ${
                  canvasVisualMode === 'technical_lightburn'
                    ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                    : 'bg-amber-950/60 border-amber-700/60 text-amber-200'
                }`}
                title="Alternar entre Vista Técnica LightBurn (Alto Contraste C00/C01/C02) y Textura Realista de Material"
              >
                {canvasVisualMode === 'technical_lightburn'
                  ? '🎨 Alto Contraste'
                  : '🪵 Textura Material'}
              </button>

              <button
                type="button"
                onClick={() => setShowSingleLabelLoupe(!showSingleLabelLoupe)}
                className={`px-2 py-0.5 rounded font-bold border transition whitespace-nowrap ${
                  showSingleLabelLoupe
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                🔬 Lupa 1:1
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !showSimulation;
                  setShowSimulation(next);
                  if (!next) setIsPlayingSim(false);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-semibold border transition whitespace-nowrap ${
                  showSimulation
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Simulador</span>
              </button>

              {showSimulation && (
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                  <button
                    type="button"
                    onClick={() => {
                      if (simProgress >= 100) setSimProgress(0);
                      setIsPlayingSim(!isPlayingSim);
                    }}
                    className="p-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white"
                  >
                    {isPlayingSim ? (
                      <Pause className="w-2.5 h-2.5" />
                    ) : (
                      <Play className="w-2.5 h-2.5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={simProgress}
                    onChange={(e) => {
                      setIsPlayingSim(false);
                      setSimProgress(Number(e.target.value));
                    }}
                    aria-label="Progreso de simulación láser"
                    className="w-14 accent-cyan-400 cursor-pointer"
                  />
                  {activeSimulatedSegment?.jobIndex !== undefined && (
                    <span className="text-[10px] font-mono text-amber-300 px-1 truncate max-w-[120px]">
                      #{activeSimulatedSegment.jobIndex + 1} · {activeSimulatedSegment.layerCode}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1 font-mono text-[10px] bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded whitespace-nowrap">
                <span className="text-cyan-300 font-bold">
                  {validation.totalPieces} u.
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-400 font-bold">
                  {formatDuration(simulation.totalDurationSec)}
                </span>
              </div>
            </div>
          </div>

          {/* LIENZO INTERACTIVO 2D SVG O 3D WEBGL DE LA MESA VANK 9060 */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center p-2">
            {cameraView === '3d_machine' ? (
              <Workbench3DViewport
                config={workbenchConfig}
                jobs={workbenchJobs}
                selectedJobId={selectedJob?.id ?? null}
                material={material}
                simulation={simulation}
                simProgress={simProgress}
                showSimulation={showSimulation}
              />
            ) : (
            <svg
              ref={svgRef}
              viewBox={`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}
              onWheel={(e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
                setCanvasZoom((z) =>
                  roundMm(Math.max(0.75, Math.min(8, z * factor)), 2)
                );
              }}
              className="w-full h-full max-h-full select-none"
              style={{
                background:
                  canvasVisualMode === 'technical_lightburn'
                    ? '#090d14'
                    : '#06080c',
              }}
            >
              <defs>
                <pattern
                  id="wb-grid-10mm"
                  width="10"
                  height="10"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 10 0 L 0 0 0 10"
                    fill="none"
                    stroke={
                      canvasVisualMode === 'technical_lightburn'
                        ? '#1e293b'
                        : '#162032'
                    }
                    strokeWidth="0.25"
                  />
                </pattern>
                <pattern
                  id="wb-grid-50mm"
                  width="50"
                  height="50"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="50" height="50" fill="url(#wb-grid-10mm)" />
                  <path
                    d="M 50 0 L 0 0 0 50"
                    fill="none"
                    stroke={
                      canvasVisualMode === 'technical_lightburn'
                        ? '#334155'
                        : '#283548'
                    }
                    strokeWidth="0.45"
                  />
                </pattern>
                {/* Símbolos maestros en (0,0) por trabajo para renderizado instantáneo (<use>) */}
                {workbenchJobs
                  .filter((j) => j.visible)
                  .map((job, jobIndex) => {
                    const isSelected = selectedJob?.id === job.id;
                    const jobColors = [
                      '#22d3ee',
                      '#34d399',
                      '#fbbf24',
                      '#a78bfa',
                      '#f472b6',
                    ];
                    const jobAccentColor = jobColors[jobIndex % jobColors.length];
                    const isTech = canvasVisualMode === 'technical_lightburn';

                    if (job.preserveImportedGeometry) {
                      return (
                        <g key={`def-${job.id}`} id={`wb-master-${job.id}`}>
                          <rect
                            x={0}
                            y={0}
                            width={job.widthMm}
                            height={job.heightMm}
                            fill={isTech ? '#f1f5f9' : material.visual.surfaceColor}
                            fillOpacity={isTech ? 0.92 : 0.78}
                            stroke={isSelected ? jobAccentColor : undefined}
                            strokeWidth={isSelected ? '0.4' : undefined}
                          />
                          {job.instances.map((inst) => (
                            <g key={`${job.id}-imp-${inst.instanceIndex}`}>
                              {(!engraveLayerCfg || engraveLayerCfg.visible) &&
                                inst.engraveItems.map((eng) => {
                                  if (eng.kind === 'vector_path' && eng.svgPathD) {
                                    return (
                                      <path
                                        key={eng.id}
                                        d={eng.svgPathD}
                                        fill={eng.filled ? '#090d14' : 'none'}
                                        fillRule={eng.fillRule || 'evenodd'}
                                        stroke="#090d14"
                                        strokeWidth={
                                          eng.filled ? 0.05 : eng.strokeWidthMm || 0.25
                                        }
                                      />
                                    );
                                  }
                                  if (eng.kind === 'raster_image' && eng.dataUrl) {
                                    return (
                                      <image
                                        key={eng.id}
                                        x={eng.xMm}
                                        y={eng.yMm}
                                        width={eng.widthMm}
                                        height={eng.heightMm}
                                        preserveAspectRatio="none"
                                        href={eng.dataUrl}
                                        transform={rasterImageTransform(eng)}
                                        style={{ mixBlendMode: 'multiply' }}
                                      />
                                    );
                                  }
                                  return null;
                                })}
                              {(!holesLayerCfg || holesLayerCfg.visible) &&
                                inst.holeContours.map((hole) => (
                                  <path
                                    key={hole.id}
                                    d={hole.svgPathD}
                                    fill={isTech ? '#dbeafe' : '#090c10'}
                                    stroke="#2563eb"
                                    strokeWidth="0.4"
                                  />
                                ))}
                              {(!cutLayerCfg || cutLayerCfg.visible) &&
                                inst.cutContour &&
                                inst.cutContour.points.length >= 2 &&
                                inst.cutContour.svgPathD && (
                                  <path
                                    d={inst.cutContour.svgPathD}
                                    fill="none"
                                    stroke="#ef4444"
                                    strokeWidth="0.45"
                                  />
                                )}
                            </g>
                          ))}
                        </g>
                      );
                    }

                    const master = compileLabelGeometry(job.labelDesign, {
                      offsetXMm: 0,
                      offsetYMm: 0,
                      rotated90: job.blockRotationDeg === 90,
                      instanceIdPrefix: `master_${job.id}`,
                    });
                    return (
                      <g key={`def-${job.id}`} id={`wb-master-${job.id}`}>
                        <rect
                          x={0}
                          y={0}
                          width={master.effectiveCutWidthMm}
                          height={master.effectiveCutHeightMm}
                          fill={
                            isTech
                              ? '#f1f5f9'
                              : material.visual.surfaceColor
                          }
                          fillOpacity={isTech ? 0.92 : 0.72}
                          stroke={isSelected ? jobAccentColor : undefined}
                          strokeWidth={isSelected ? '0.35' : undefined}
                        />
                        {(!engraveLayerCfg || engraveLayerCfg.visible) &&
                          master.engravingItems.map((eng) => {
                            if (eng.kind === 'vector_path' && eng.svgPathD) {
                              return (
                                <path
                                  key={eng.id}
                                  d={eng.svgPathD}
                                  fill={eng.filled ? '#090d14' : 'none'}
                                  fillRule={eng.fillRule || 'evenodd'}
                                  stroke="#090d14"
                                  strokeWidth={
                                    eng.filled ? 0.05 : eng.strokeWidthMm || 0.25
                                  }
                                />
                              );
                            }
                            if (eng.kind === 'raster_image' && eng.dataUrl) {
                              return (
                                <image
                                  key={eng.id}
                                  x={eng.xMm}
                                  y={eng.yMm}
                                  width={eng.widthMm}
                                  height={eng.heightMm}
                                  preserveAspectRatio="none"
                                  href={eng.dataUrl}
                                  transform={rasterImageTransform(eng)}
                                />
                              );
                            }
                            return null;
                          })}
                        {(!holesLayerCfg || holesLayerCfg.visible) &&
                          master.holeContours.map((hole) => (
                            <path
                              key={hole.id}
                              d={hole.svgPathD}
                              fill={isTech ? '#dbeafe' : '#090c10'}
                              stroke="#2563eb"
                              strokeWidth="0.45"
                            />
                          ))}
                        {(!cutLayerCfg || cutLayerCfg.visible) &&
                          master.outerCutContour && (
                            <path
                              d={master.outerCutContour.svgPathD}
                              fill="none"
                              stroke="#ef4444"
                              strokeWidth="0.55"
                            />
                          )}
                      </g>
                    );
                  })}
              </defs>

              {/* 1. MESA FÍSICA VANK 9060 (900 x 600 mm) */}
              <rect
                x={0}
                y={0}
                width={workbenchConfig.machineBedWidthMm}
                height={workbenchConfig.machineBedHeightMm}
                fill="url(#wb-grid-50mm)"
                stroke="#475569"
                strokeWidth="1.2"
              />

              {/* Reglas milimétricas superiores e izquierdas */}
              {Array.from({
                length: Math.floor(workbenchConfig.machineBedWidthMm / 50) + 1,
              }).map((_, i) => {
                const x = i * 50;
                return (
                  <g key={`ruler-x-${x}`}>
                    <line
                      x1={x}
                      y1={-4}
                      x2={x}
                      y2={0}
                      stroke="#64748b"
                      strokeWidth="0.6"
                    />
                    <text
                      x={x}
                      y={-6}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="5"
                      fontFamily="monospace"
                    >
                      {x}
                    </text>
                  </g>
                );
              })}
              {Array.from({
                length: Math.floor(workbenchConfig.machineBedHeightMm / 50) + 1,
              }).map((_, i) => {
                const y = i * 50;
                return (
                  <g key={`ruler-y-${y}`}>
                    <line
                      x1={-4}
                      y1={y}
                      x2={0}
                      y2={y}
                      stroke="#64748b"
                      strokeWidth="0.6"
                    />
                    <text
                      x={-6}
                      y={y + 1.5}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="5"
                      fontFamily="monospace"
                    >
                      {y}
                    </text>
                  </g>
                );
              })}

              {/* 2. PLANCHA / ROLLO DE MATERIAL COLOCADO SOBRE LA MESA */}
              <g id="workbench-material-sheet">
                <rect
                  x={workbenchConfig.sheetOffsetXMm}
                  y={workbenchConfig.sheetOffsetYMm}
                  width={workbenchConfig.sheetWidthMm}
                  height={workbenchConfig.sheetHeightMm}
                  fill={material.visual.surfaceColor}
                  fillOpacity={
                    canvasVisualMode === 'technical_lightburn' ? 0.14 : 0.28
                  }
                  stroke="#38bdf8"
                  strokeWidth="0.9"
                />
                {workbenchConfig.sheetSafetyMarginMm > 0 && (
                  <rect
                    x={
                      workbenchConfig.sheetOffsetXMm +
                      workbenchConfig.sheetSafetyMarginMm
                    }
                    y={
                      workbenchConfig.sheetOffsetYMm +
                      workbenchConfig.sheetSafetyMarginMm
                    }
                    width={Math.max(
                      0,
                      workbenchConfig.sheetWidthMm -
                        workbenchConfig.sheetSafetyMarginMm * 2
                    )}
                    height={Math.max(
                      0,
                      workbenchConfig.sheetHeightMm -
                        workbenchConfig.sheetSafetyMarginMm * 2
                    )}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="0.4"
                    strokeDasharray="3 2"
                    strokeOpacity={0.65}
                  />
                )}

                {/* Línea horizontal de corte/avance del rollo consumido en esta tirada */}
                {rollMetrics.usedLengthMm > 0 &&
                  rollMetrics.usedLengthMm <= workbenchConfig.sheetHeightMm && (
                    <g pointerEvents="none">
                      <line
                        x1={workbenchConfig.sheetOffsetXMm}
                        y1={
                          workbenchConfig.sheetOffsetYMm + rollMetrics.usedLengthMm
                        }
                        x2={
                          workbenchConfig.sheetOffsetXMm +
                          workbenchConfig.sheetWidthMm
                        }
                        y2={
                          workbenchConfig.sheetOffsetYMm + rollMetrics.usedLengthMm
                        }
                        stroke="#10b981"
                        strokeWidth="0.9"
                        strokeDasharray="4 2"
                      />
                      <rect
                        x={workbenchConfig.sheetOffsetXMm + 4}
                        y={
                          workbenchConfig.sheetOffsetYMm +
                          rollMetrics.usedLengthMm +
                          2
                        }
                        width={295}
                        height={8}
                        rx={1.5}
                        fill="#064e3b"
                        fillOpacity={0.92}
                        stroke="#10b981"
                        strokeWidth="0.35"
                      />
                      <text
                        x={workbenchConfig.sheetOffsetXMm + 8}
                        y={
                          workbenchConfig.sheetOffsetYMm +
                          rollMetrics.usedLengthMm +
                          7.4
                        }
                        fill="#6ee7b7"
                        fontSize="4.2"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        ✂ CORTE DE TIRADA: {rollMetrics.usedLengthCm} cm ({rollMetrics.usedLengthMm} mm) · Restan {rollMetrics.remainingRollLengthCm} cm de 5 m
                      </text>
                    </g>
                  )}
              </g>

              {/* 3. TRABAJOS POSICIONADOS EN LA PLANCHA / ROLLO */}
              {workbenchJobs
                .filter((j) => j.visible)
                .map((job, jobIndex) => {
                  const isSelected = selectedJob?.id === job.id;
                  const jobColors = [
                    '#22d3ee',
                    '#34d399',
                    '#fbbf24',
                    '#a78bfa',
                    '#f472b6',
                  ];
                  const jobAccentColor = jobColors[jobIndex % jobColors.length];
                  const isContinuousFlow = (job.firstRowIndentMm ?? 0) > 0;
                  const firstInst = job.instances[0];
                  const badgeX = firstInst ? firstInst.localXMm : 0;
                  const badgeY = firstInst ? firstInst.localYMm - 1.5 : -2.2;

                  const isOutSheet =
                    job.xMm < workbenchConfig.sheetOffsetXMm - 0.01 ||
                    job.yMm < workbenchConfig.sheetOffsetYMm - 0.01 ||
                    job.xMm + job.widthMm >
                      workbenchConfig.sheetOffsetXMm +
                        workbenchConfig.sheetWidthMm +
                        0.01 ||
                    job.yMm + job.heightMm >
                      workbenchConfig.sheetOffsetYMm +
                        workbenchConfig.sheetHeightMm +
                        0.01;

                  return (
                    <g
                      key={job.id}
                      transform={`translate(${job.xMm}, ${job.yMm})`}
                      onPointerDown={(e) => handleJobPointerDown(e, job)}
                      className={job.locked ? 'cursor-not-allowed' : 'cursor-move'}
                    >
                      {!isContinuousFlow && (
                        <rect
                          x={-0.8}
                          y={-0.8}
                          width={job.widthMm + 1.6}
                          height={job.heightMm + 1.6}
                          fill={
                            isOutSheet
                              ? 'rgba(239, 68, 68, 0.14)'
                              : isSelected
                                ? 'rgba(6, 182, 212, 0.08)'
                                : 'rgba(15, 23, 42, 0.04)'
                          }
                          stroke={
                            isOutSheet
                              ? '#ef4444'
                              : isSelected
                                ? jobAccentColor
                                : '#64748b'
                          }
                          strokeWidth={isSelected ? '0.7' : '0.35'}
                          strokeDasharray={isSelected ? undefined : '2 1.5'}
                        />
                      )}

                      <text
                        x={badgeX}
                        y={badgeY}
                        fill={isOutSheet ? '#fca5a5' : jobAccentColor}
                        fontSize="3.8"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        #{jobIndex + 1} {job.name} · {job.labelDesign.widthMm}×{job.labelDesign.heightMm}mm
                      </text>

                      {job.preserveImportedGeometry ? (
                        <use
                          key={`${job.id}-imp-sheet`}
                          href={`#wb-master-${job.id}`}
                          x={0}
                          y={0}
                        />
                      ) : (
                        job.instances.map((inst) => (
                          <use
                            key={`${job.id}-inst-${inst.instanceIndex}`}
                            href={`#wb-master-${job.id}`}
                            x={inst.localXMm}
                            y={inst.localYMm}
                          />
                        ))
                      )}
                    </g>
                  );
                })}

              {/* 4. MARCO DE ENCUADRE LÁSER (FRAME / BOUNDING BOX) Y COTAS AUTOMÁTICAS */}
              {validation.occupiedBoundsMm && (
                <g pointerEvents="none">
                  <rect
                    x={validation.occupiedBoundsMm.minX - 1.2}
                    y={validation.occupiedBoundsMm.minY - 1.2}
                    width={validation.occupiedBoundsMm.width + 2.4}
                    height={validation.occupiedBoundsMm.height + 2.4}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="0.65"
                    strokeDasharray="3 1.5"
                  />
                  <rect
                    x={validation.occupiedBoundsMm.minX}
                    y={Math.max(-13, validation.occupiedBoundsMm.minY - 8.5)}
                    width={245}
                    height={6.5}
                    rx={1.2}
                    fill="#052e16"
                    fillOpacity={0.92}
                    stroke="#22c55e"
                    strokeWidth="0.35"
                  />
                  <text
                    x={validation.occupiedBoundsMm.minX + 3}
                    y={Math.max(-8.5, validation.occupiedBoundsMm.minY - 4)}
                    fill="#86efac"
                    fontSize="3.8"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    📐 ENCUADRE LÁSER (FRAME): {validation.occupiedBoundsMm.width} × {validation.occupiedBoundsMm.height} mm ({roundMm(validation.occupiedBoundsMm.width / 10, 1)} × {roundMm(validation.occupiedBoundsMm.height / 10, 1)} cm)
                  </text>

                  {/* Zonas libres aprovechables detectadas en tiempo real */}
                  {rollMetrics.freeSlotsInLastRow > 0 &&
                    (() => {
                      const visJobs = workbenchJobs.filter(
                        (j) => j.visible && j.instances.length > 0
                      );
                      const lastJ = visJobs[visJobs.length - 1];
                      const lastI = lastJ?.instances[lastJ.instances.length - 1];
                      if (!lastJ || !lastI) return null;
                      const freeStartX = roundMm(
                        lastJ.xMm +
                          (lastJ.lastRowEndXMm ??
                            lastI.localXMm + lastI.widthMm) +
                          Math.max(0.5, lastJ.gapXMm)
                      );
                      const freeY = roundMm(
                        lastJ.yMm + (lastJ.lastRowLocalYMm ?? lastI.localYMm)
                      );
                      const freeMaxX = roundMm(
                        workbenchConfig.sheetOffsetXMm +
                          workbenchConfig.sheetWidthMm -
                          workbenchConfig.sheetSafetyMarginMm
                      );
                      const freeW = roundMm(freeMaxX - freeStartX);
                      if (freeW < 10) return null;
                      return (
                        <g>
                          <rect
                            x={freeStartX}
                            y={freeY}
                            width={freeW}
                            height={lastI.heightMm}
                            fill="rgba(16, 185, 129, 0.12)"
                            stroke="#10b981"
                            strokeWidth="0.45"
                            strokeDasharray="2.2 1.4"
                          />
                          <text
                            x={freeStartX + freeW / 2}
                            y={freeY + lastI.heightMm / 2 + 1.4}
                            textAnchor="middle"
                            fill="#6ee7b7"
                            fontSize={Math.min(4.2, Math.max(2.6, lastI.heightMm * 0.35))}
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            +{rollMetrics.freeSlotsInLastRow} u. entran gratis aquí ({roundMm(freeW / 10, 1)} cm)
                          </text>
                        </g>
                      );
                    })()}
                </g>
              )}

              {/* 5. SUPERPOSICIÓN DEL SIMULADOR DE RECORRIDO LÁSER */}
              {showSimulation && simulation.segments.length > 0 && (
                <g id="workbench-toolpath-simulation" pointerEvents="none">
                  {simulation.segments.map((seg) => {
                    const targetTime =
                      (simProgress / 100) * simulation.totalDurationSec;
                    if (seg.startTimeSec > targetTime) return null;

                    const d = seg.points
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                      .join(' ');

                    if (seg.kind === 'rapid_move') {
                      return (
                        <path
                          key={seg.id}
                          d={d}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="0.3"
                          strokeDasharray="1.5 1.5"
                          strokeOpacity={0.75}
                        />
                      );
                    }

                    return (
                      <path
                        key={seg.id}
                        d={d}
                        fill="none"
                        stroke={
                          seg.kind === 'engrave_scan'
                            ? '#f59e0b'
                            : seg.kind === 'hole_cut'
                              ? '#60a5fa'
                              : '#f87171'
                        }
                        strokeWidth="0.45"
                        strokeOpacity={0.9}
                      />
                    );
                  })}

                  <g
                    transform={`translate(${simulatedLaserHead.x}, ${simulatedLaserHead.y})`}
                  >
                    <circle
                      r="4.5"
                      fill="rgba(239, 68, 68, 0.25)"
                      stroke="#f87171"
                      strokeWidth="0.6"
                    />
                    <circle r="1.4" fill="#fef08a" />
                    <line
                      x1={-6}
                      y1={0}
                      x2={6}
                      y2={0}
                      stroke="#f87171"
                      strokeWidth="0.5"
                    />
                    <line
                      x1={0}
                      y1={-6}
                      x2={0}
                      y2={6}
                      stroke="#f87171"
                      strokeWidth="0.5"
                    />
                  </g>
                </g>
              )}

              {/* 6. INDICADOR DE HOME DE MÁQUINA RUIDA (Círculo Rojo) */}
              <g
                transform={`translate(${machineHomeCoords.x}, ${machineHomeCoords.y})`}
                pointerEvents="none"
              >
                <circle
                  r="4"
                  fill="rgba(239, 68, 68, 0.25)"
                  stroke="#ef4444"
                  strokeWidth="0.8"
                />
                <circle r="1.3" fill="#ef4444" />
              </g>

              {/* 7. INDICADOR DE ORIGEN DEL TRABAJO (Cuadrado Verde Brillante estilo LightBurn) */}
              <g
                transform={`translate(${validation.jobOriginPointMm.x}, ${validation.jobOriginPointMm.y})`}
                pointerEvents="none"
              >
                <circle
                  r="6"
                  fill="rgba(34, 197, 94, 0.22)"
                  stroke="#22c55e"
                  strokeWidth="0.5"
                />
                <rect
                  x={-2.8}
                  y={-2.8}
                  width={5.6}
                  height={5.6}
                  fill="#22c55e"
                  fillOpacity={0.95}
                  stroke="#ffffff"
                  strokeWidth="0.6"
                />
              </g>
            </svg>
            )}
          </div>

          {/* PANEL INFERIOR DEDICADO (FUERA DEL LIENZO PARA NO TAPAR EL ROLLO): LUPA 1:1 DE ETIQUETA + DATOS DE ENCUADRE VANK 9060 */}
          <div className="bg-[#0c111a] border-t border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Izquierda: Lupa 1:1 de 1 etiqueta en grande + Resumen de las 3 capas */}
            {showSingleLabelLoupe && selectedJob && (
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-28 h-16 bg-[#06090e] rounded-lg border border-cyan-500/40 flex items-center justify-center p-1 shrink-0 shadow-inner">
                  <svg
                    viewBox={`-2 -2 ${
                      (selectedJob.preserveImportedGeometry
                        ? selectedJob.widthMm
                        : selectedJob.blockRotationDeg === 90
                          ? selectedJob.labelDesign.heightMm
                          : selectedJob.labelDesign.widthMm) + 4
                    } ${
                      (selectedJob.preserveImportedGeometry
                        ? selectedJob.heightMm
                        : selectedJob.blockRotationDeg === 90
                          ? selectedJob.labelDesign.widthMm
                          : selectedJob.labelDesign.heightMm) + 4
                    }`}
                    className="w-full h-full"
                  >
                    <use href={`#wb-master-${selectedJob.id}`} x={0} y={0} />
                  </svg>
                </div>

                <div className="space-y-1 text-[10px] font-mono min-w-0">
                  <div className="font-bold text-cyan-300 truncate">
                    🔬 Muestra 1:1 — {selectedJob.name} (
                    {selectedJob.preserveImportedGeometry
                      ? `${selectedJob.widthMm}×${selectedJob.heightMm}`
                      : `${selectedJob.labelDesign.widthMm}×${selectedJob.labelDesign.heightMm}`}{' '}
                    mm)
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sortedLayers.map((l) => (
                      <span
                        key={`loupe-layer-${l.cutIndex}`}
                        className="inline-flex items-center gap-1 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 text-slate-200"
                      >
                        <span
                          className="w-2 h-2 rounded-sm inline-block border border-white/40"
                          style={{ backgroundColor: l.hexColor }}
                        />
                        <span className="font-bold">{l.code}:</span>
                        <span
                          className={
                            l.speedMmPerSec && l.maxPowerPercent
                              ? 'text-emerald-300 font-bold'
                              : 'text-amber-400'
                          }
                        >
                          {l.speedMmPerSec && l.maxPowerPercent
                            ? `${l.speedMmPerSec}/${l.maxPowerPercent}%${
                                l.mode !== 'line' ? ` (${l.lineIntervalMm}mm)` : ''
                              }`
                            : 'Sin calibrar'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Derecha: Guía de Puntero Láser (Origin) y Encuadre (Frame) en la Vank 9060 */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-200 ml-auto">
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block border border-white" />
                <span>
                  <strong>Puntero Láser:</strong>{' '}
                  {JOB_ORIGIN_ANCHORS.find(
                    (a) => a.id === workbenchConfig.jobOriginAnchor
                  )?.label ?? workbenchConfig.jobOriginAnchor}
                </span>
              </div>
              {validation.occupiedBoundsMm && (
                <div className="bg-slate-900/90 border border-slate-800 px-2 py-1 rounded text-cyan-300 font-mono font-bold">
                  Frame: {roundMm(validation.occupiedBoundsMm.width / 10, 1)} ×{' '}
                  {roundMm(validation.occupiedBoundsMm.height / 10, 1)} cm
                </div>
              )}
              <div className="bg-emerald-950/50 border border-emerald-700/60 px-2 py-1 rounded text-emerald-300 font-mono font-bold">
                {workbenchConfig.sheetWidthMm === 730 &&
                workbenchConfig.sheetHeightMm === 600
                  ? `Rollo: ${rollMetrics.usedLengthCm} cm de ${rollMetrics.totalRollLengthCm} cm`
                  : `Retazo: ${rollMetrics.usedLengthCm} cm de ${roundMm(workbenchConfig.sheetHeightMm / 10, 1)} cm`}
              </div>
            </div>
          </div>
        </div>

        {/* PANEL LATERAL DERECHO: 3 PESTAÑAS LIMPIAS + DOCK FIJO SIEMPRE VISIBLE */}
        <aside className="w-[380px] lg:w-[425px] xl:w-[475px] bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-hidden shrink-0">
          {/* BARRA DE PESTAÑAS SEGMENTADA */}
          <div className="shrink-0 z-20 bg-[#111621]/95 backdrop-blur border-b border-slate-800 p-2">
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
              <button
                type="button"
                onClick={() => setSidebarView('layers')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarView === 'layers'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1. Velocidad y Potencia
              </button>
              <button
                type="button"
                onClick={() => setSidebarView('jobs')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarView === 'jobs'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {workbenchConfig.sheetWidthMm === 730 &&
                workbenchConfig.sheetHeightMm === 600
                  ? '2. Rollo 73 cm y Logos'
                  : `2. Retazo ${roundMm(workbenchConfig.sheetWidthMm / 10, 1)}×${roundMm(workbenchConfig.sheetHeightMm / 10, 1)} cm`}
              </button>
              <button
                type="button"
                onClick={() => setSidebarView('laser')}
                className={`py-1.5 px-2 rounded-lg font-bold transition ${
                  sidebarView === 'laser'
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3. Origen y Conexión
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* =====================================================================
              SECCIÓN 1: CALIBRACIÓN LIMPIA DE VELOCIDAD Y POTENCIA DE LAS 3 CAPAS
              (C00 GRABADO · C01 ORIFICIOS · C02 CORTE EXTERIOR)
             ===================================================================== */}
          {sidebarView === 'layers' && (
            <div className="p-3.5 space-y-3">
              {/* Barra superior limpia con Preset Vank 9060 y Guardar en Material */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">
                  Capas Láser (C00 · C01 · C02)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextLayers = workbenchConfig.layers.map((l) => {
                        if (l.cutIndex === 0) {
                          return {
                            ...l,
                            mode: 'image' as LightBurnCutMode,
                            speedMmPerSec: 600,
                            maxPowerPercent: 30,
                            minPowerPercent: 30,
                            lineIntervalMm: 0.073,
                            passes: 1,
                            airAssist: true,
                            operatorValidated: true,
                          };
                        }
                        return {
                          ...l,
                          mode: 'line' as LightBurnCutMode,
                          speedMmPerSec: 100,
                          maxPowerPercent: 100,
                          minPowerPercent: 100,
                          passes: 1,
                          airAssist: true,
                          operatorValidated: true,
                        };
                      });
                      onUpdateConfig({ ...workbenchConfig, layers: nextLayers });
                      onNotify(
                        '✓ Calibración LightBurn Vank 9060 aplicada: C00 Grabado 600 mm/s · 30% · Int. 0.073 mm | C01 y C02 Corte 100 mm/s · 100%.'
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold transition"
                  >
                    ⚡ Preset Vank 9060 (600/30 · 100/100)
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLayersToMaterial}
                    title={`Guardar estas velocidades y potencias en ${material.name}`}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium transition"
                  >
                    Guardar
                  </button>
                </div>
              </div>

              {/* LAS 3 TARJETAS DE CAPAS ABIERTAS Y LIMPIAS */}
              <div className="space-y-2.5">
                {sortedLayers.map((layer, idx) => {
                  const isEngraveLayer = layer.role === 'ENGRAVE';
                  const isHolesLayer = layer.role === 'HOLES';
                  const isMissingParams =
                    layer.outputEnabled &&
                    (layer.speedMmPerSec === null ||
                      layer.speedMmPerSec <= 0 ||
                      layer.maxPowerPercent === null ||
                      layer.maxPowerPercent <= 0);

                  const roleTitle = isEngraveLayer
                    ? 'C00 · Grabado del Logo'
                    : isHolesLayer
                      ? 'C01 · Corte de Orificios'
                      : 'C02 · Corte Exterior';

                  const roleBorderColor = isEngraveLayer
                    ? 'border-slate-700/90 bg-slate-900/80'
                    : isHolesLayer
                      ? 'border-blue-500/40 bg-slate-900/80'
                      : 'border-red-500/40 bg-slate-900/80';

                  return (
                    <div
                      key={layer.cutIndex}
                      onClick={() => setSelectedLayerCutIndex(layer.cutIndex)}
                      className={`p-3 rounded-xl border space-y-2.5 text-xs transition ${roleBorderColor} ${
                        isMissingParams ? 'ring-1 ring-amber-500/50' : ''
                      }`}
                    >
                      {/* FILA 1: NOMBRE DE LA CAPA + RESUMEN + SWITCH SALIDA */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-5 h-5 rounded font-mono text-[11px] font-bold flex items-center justify-center border border-white/30 shrink-0"
                            style={{
                              backgroundColor: layer.hexColor,
                              color: '#ffffff',
                            }}
                          >
                            {layer.cutIndex.toString().padStart(2, '0')}
                          </span>
                          <span className="font-bold text-white text-xs truncate">
                            {roleTitle}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!isEngraveLayer &&
                            (layer.maxPowerPercent !== 100 ||
                              layer.minPowerPercent !== 100) && (
                              <button
                                type="button"
                                title="Restablecer potencia Máx y Mín de corte a 100% / 100%"
                                onClick={() => {
                                  handleUpdateLayer(layer.cutIndex, {
                                    maxPowerPercent: 100,
                                    minPowerPercent: 100,
                                  });
                                  onNotify(
                                    `${layer.code} fijado en 100% Máx / 100% Mín para corte limpio.`
                                  );
                                }}
                                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/50 text-amber-200 text-[10px] font-semibold"
                              >
                                ⚡ Fijar 100%
                              </button>
                            )}
                          {isHolesLayer &&
                            cutLayerCfg &&
                            (cutLayerCfg.speedMmPerSec !== null ||
                              cutLayerCfg.maxPowerPercent !== null) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextMax =
                                    cutLayerCfg.maxPowerPercent ?? 100;
                                  const nextMin =
                                    cutLayerCfg.minPowerPercent !== null &&
                                    cutLayerCfg.minPowerPercent > 10
                                      ? cutLayerCfg.minPowerPercent
                                      : nextMax;
                                  handleUpdateLayer(layer.cutIndex, {
                                    speedMmPerSec: cutLayerCfg.speedMmPerSec,
                                    maxPowerPercent: nextMax,
                                    minPowerPercent: nextMin,
                                    passes: cutLayerCfg.passes,
                                    airAssist: cutLayerCfg.airAssist,
                                  });
                                  onNotify(
                                    'Velocidad y potencia de C02 copiadas a C01.'
                                  );
                                }}
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[10px] font-medium"
                              >
                                Igualar a C02
                              </button>
                            )}

                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={layer.outputEnabled}
                              aria-label={`Salida ${layer.code}`}
                              onClick={() =>
                                handleUpdateLayer(layer.cutIndex, {
                                  outputEnabled: !layer.outputEnabled,
                                })
                              }
                              className={`w-7 h-4 rounded-full inline-flex items-center px-0.5 transition-colors border ${
                                layer.outputEnabled
                                  ? 'bg-emerald-500 border-emerald-400 justify-end'
                                  : 'bg-slate-800 border-slate-700 justify-start'
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full bg-white shadow" />
                            </button>
                            <span>Activa</span>
                          </label>
                        </div>
                      </div>

                      {/* FILA 2: LOS 4 CAMPOS PRINCIPALES EN UNA SOLA FILA LIMPIA */}
                      <div className="grid grid-cols-4 gap-2">
                        {layer.mode !== 'line' && (
                          <label className="block">
                            <span className="text-[10px] text-slate-400 block mb-0.5">
                              Modo
                            </span>
                            <select
                              aria-label={`Modo de capa ${layer.code}`}
                              value={layer.mode}
                              onChange={(e) =>
                                handleUpdateLayer(layer.cutIndex, {
                                  mode: e.target.value as LightBurnCutMode,
                                })
                              }
                              className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-2 py-1.5 text-xs text-white font-semibold"
                            >
                              <option value="image">Imagen</option>
                              <option value="fill">Relleno</option>
                              <option value="line">Línea</option>
                              <option value="offset_fill">Offset</option>
                            </select>
                          </label>
                        )}

                        <label className="block">
                          <span className="text-[10px] text-emerald-300 font-semibold block mb-0.5">
                            Velocidad (mm/s)
                          </span>
                          <input
                            type="number"
                            min={0.1}
                            max={1000}
                            step={1}
                            aria-label={`Velocidad ${layer.code}`}
                            placeholder={isEngraveLayer ? '600' : '100'}
                            value={layer.speedMmPerSec ?? ''}
                            onChange={(e) => {
                              const val =
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value);
                              handleUpdateLayer(layer.cutIndex, {
                                speedMmPerSec: val,
                              });
                            }}
                            className="w-full bg-slate-950 border border-slate-700/90 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white"
                          />
                        </label>

                        <label className="block">
                          <span className="text-[10px] text-amber-300 font-semibold block mb-0.5">
                            {layer.mode === 'line'
                              ? 'Pot. Máx (%)'
                              : 'Potencia (%)'}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            aria-label={`Potencia máxima ${layer.code}`}
                            placeholder={isEngraveLayer ? '30' : '100'}
                            value={layer.maxPowerPercent ?? ''}
                            onChange={(e) => {
                              const val =
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value);
                              handleUpdateLayer(
                                layer.cutIndex,
                                computePowerUpdateForLayer(layer, val)
                              );
                            }}
                            className="w-full bg-slate-950 border border-slate-700/90 focus:border-amber-500 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white"
                          />
                        </label>

                        {layer.mode !== 'line' ? (
                          <label className="block">
                            <span className="text-[10px] text-cyan-300 font-semibold block mb-0.5">
                              Intervalo (mm)
                            </span>
                            <input
                              type="number"
                              min={0.02}
                              max={1.0}
                              step={0.001}
                              aria-label={`Intervalo ${layer.code}`}
                              value={layer.lineIntervalMm}
                              onChange={(e) => {
                                const val = Math.max(
                                  0.02,
                                  Math.min(1.0, Number(e.target.value) || 0.073)
                                );
                                handleUpdateLayer(layer.cutIndex, {
                                  lineIntervalMm: roundMm(val, 3),
                                });
                              }}
                              className="w-full bg-slate-950 border border-slate-700/90 focus:border-cyan-500 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-cyan-300"
                            />
                          </label>
                        ) : (
                          <>
                            <label className="block">
                              <span className="text-[10px] text-amber-300 font-semibold block mb-0.5">
                                Pot. Mín (%)
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                aria-label={`Potencia mínima ${layer.code}`}
                                placeholder="100"
                                value={layer.minPowerPercent ?? ''}
                                onChange={(e) => {
                                  const val =
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value);
                                  handleUpdateLayer(layer.cutIndex, {
                                    minPowerPercent: val,
                                  });
                                }}
                                className={`w-full bg-slate-950 border rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white ${
                                  layer.minPowerPercent !== null &&
                                  layer.minPowerPercent <= 10
                                    ? 'border-red-500 ring-1 ring-red-500/40'
                                    : 'border-slate-700/90 focus:border-amber-500'
                                }`}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-slate-300 font-semibold block mb-0.5">
                                Pasadas
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                step={1}
                                aria-label={`Pasadas ${layer.code}`}
                                value={layer.passes}
                                onChange={(e) =>
                                  handleUpdateLayer(layer.cutIndex, {
                                    passes: Math.max(
                                      1,
                                      Number(e.target.value) || 1
                                    ),
                                  })
                                }
                                className="w-full bg-slate-950 border border-slate-700/90 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white"
                              />
                            </label>
                          </>
                        )}
                      </div>

                      {/* FILA 3: DESPLEGABLE LIMPIO DE AJUSTES AVANZADOS DE CAPA */}
                      <details className="group pt-1 border-t border-slate-800/80">
                        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between select-none">
                          <span>
                            Más ajustes ({layer.mode !== 'line' ? `${Math.round(25.4 / Math.max(0.02, layer.lineIntervalMm))} DPI · Tramado · Pot. mín` : 'Modo · Kerf · Overcut · Aire'}) ▾
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            Orden #{idx + 1}
                          </span>
                        </summary>

                        <div className="pt-2.5 space-y-2.5">
                          {layer.mode !== 'line' ? (
                            <div className="grid grid-cols-4 gap-2">
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Pot. Mín (%)
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  aria-label={`Potencia mínima ${layer.code}`}
                                  placeholder="30"
                                  value={layer.minPowerPercent ?? ''}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      minPowerPercent:
                                        e.target.value === ''
                                          ? null
                                          : Number(e.target.value),
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Pasadas
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  aria-label={`Pasadas ${layer.code}`}
                                  value={layer.passes}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      passes: Math.max(
                                        1,
                                        Number(e.target.value) || 1
                                      ),
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Tramado
                                </span>
                                <select
                                  value={layer.imageDitherMode ?? 'jarvis'}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      imageDitherMode:
                                        e.target.value as LightBurnImageDitherMode,
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white"
                                >
                                  <option value="threshold">Umbral</option>
                                  <option value="jarvis">Jarvis</option>
                                  <option value="stucki">Stucki</option>
                                  <option value="halftone">Semitono</option>
                                  <option value="grayscale">Escala grises</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Overscan (%)
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={20}
                                  step={0.5}
                                  value={layer.overscanPercent ?? 2.5}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      overscanPercent: Math.max(
                                        0,
                                        Number(e.target.value) || 0
                                      ),
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                                />
                              </label>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-2">
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Modo
                                </span>
                                <select
                                  aria-label={`Modo de capa ${layer.code}`}
                                  value={layer.mode}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      mode: e.target.value as LightBurnCutMode,
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-white"
                                >
                                  <option value="line">Línea</option>
                                  <option value="fill">Relleno</option>
                                  <option value="image">Imagen</option>
                                  <option value="offset_fill">Offset</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Kerf Offset (mm)
                                </span>
                                <input
                                  type="number"
                                  min={-1}
                                  max={1}
                                  step={0.02}
                                  aria-label={`Kerf ${layer.code}`}
                                  value={layer.kerfOffsetMm ?? 0}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      kerfOffsetMm: roundMm(
                                        Number(e.target.value) || 0,
                                        3
                                      ),
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 block">
                                  Overcut (mm)
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={5}
                                  step={0.1}
                                  value={layer.overcutMm ?? 0}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      overcutMm: Math.max(
                                        0,
                                        Number(e.target.value) || 0
                                      ),
                                    })
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-white"
                                />
                              </label>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={layer.visible}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      visible: e.target.checked,
                                    })
                                  }
                                  className="accent-emerald-500"
                                />
                                <span>Mostrar</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={layer.airAssist}
                                  onChange={(e) =>
                                    handleUpdateLayer(layer.cutIndex, {
                                      airAssist: e.target.checked,
                                    })
                                  }
                                  className="accent-emerald-500"
                                />
                                <span>Aire</span>
                              </label>
                              {layer.mode !== 'line' && (
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={layer.crossHatch ?? false}
                                    onChange={(e) =>
                                      handleUpdateLayer(layer.cutIndex, {
                                        crossHatch: e.target.checked,
                                      })
                                    }
                                    className="accent-cyan-500"
                                  />
                                  <span>Cruzado 90°</span>
                                </label>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() =>
                                  handleMoveLayerPriority(layer.cutIndex, 'up')
                                }
                                title="Ejecutar antes"
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === sortedLayers.length - 1}
                                onClick={() =>
                                  handleMoveLayerPriority(
                                    layer.cutIndex,
                                    'down'
                                  )
                                }
                                title="Ejecutar después"
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* =====================================================================
              SECCIÓN 2: MEDIDA DE PLANCHA/RETAZO + TIRADA MULTI-TRABAJO
             ===================================================================== */}
          {sidebarView === 'jobs' && (
          <div className="p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Ruler className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {workbenchConfig.sheetWidthMm === 730 &&
                  workbenchConfig.sheetHeightMm === 600
                    ? `Rollo Ecocuero 73 cm × 5 m · Trabajos (${workbenchJobs.length})`
                    : `Retazo ${workbenchConfig.sheetWidthMm}×${workbenchConfig.sheetHeightMm} mm · Trabajos (${workbenchJobs.length})`}
                </span>
              </h3>
              <button
                type="button"
                onClick={handleAddActiveBatch}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[11px] font-semibold"
              >
                + Sumar Diseño Actual
              </button>
            </div>

            {/* Selector rápido de tamaño de plancha / retazo de Ecocuero */}
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-amber-300">
                  Tamaño de Plancha / Retazo
                </span>
                <div className="flex items-center gap-1.5">
                  {(workbenchConfig.sheetWidthMm !== 730 ||
                    workbenchConfig.sheetHeightMm !== 600) && (
                    <button
                      type="button"
                      onClick={handleApplyEcocueroRoll73cm}
                      className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 text-[10px] font-semibold whitespace-nowrap"
                    >
                      ↻ Rollo 73 cm
                    </button>
                  )}
                  <select
                    aria-label="Presets de retazo en tirada"
                    value=""
                    onChange={(e) => {
                      const preset = MATERIAL_SHEET_PRESETS.find(
                        (p) => p.label === e.target.value
                      );
                      if (preset) {
                        handleUpdateSheetDimensions(preset.widthMm, preset.heightMm, {
                          isRollMaterial: preset.widthMm === 730 && preset.heightMm >= 600,
                          notifyText: `Retazo/plancha cambiado a ${preset.widthMm} × ${preset.heightMm} mm y piezas reacomodadas.`,
                        });
                      }
                    }}
                    className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-cyan-300"
                  >
                    <option value="">Elegir formato...</option>
                    {MATERIAL_SHEET_PRESETS.map((p) => (
                      <option key={p.label} value={p.label}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-slate-400 block mb-0.5">
                    Ancho útil ({roundMm(workbenchConfig.sheetWidthMm / 10, 1)} cm)
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={workbenchConfig.machineBedWidthMm}
                    step={5}
                    aria-label="Ancho de plancha en tirada (mm)"
                    value={sheetWidthDraft}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSheetWidthDraft(raw);
                      const num = Number(raw);
                      if (raw !== '' && Number.isFinite(num) && num >= 10) {
                        handleUpdateSheetDimensions(num, workbenchConfig.sheetHeightMm);
                      }
                    }}
                    onBlur={() =>
                      setSheetWidthDraft(String(workbenchConfig.sheetWidthMm))
                    }
                    className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded px-2 py-1 font-mono text-xs text-white font-bold"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400 block mb-0.5">
                    Alto / Largo retazo ({roundMm(workbenchConfig.sheetHeightMm / 10, 1)} cm)
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={workbenchConfig.machineBedHeightMm}
                    step={5}
                    aria-label="Alto de plancha en tirada (mm)"
                    value={sheetHeightDraft}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSheetHeightDraft(raw);
                      const num = Number(raw);
                      if (raw !== '' && Number.isFinite(num) && num >= 10) {
                        handleUpdateSheetDimensions(workbenchConfig.sheetWidthMm, num);
                      }
                    }}
                    onBlur={() =>
                      setSheetHeightDraft(String(workbenchConfig.sheetHeightMm))
                    }
                    className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded px-2 py-1 font-mono text-xs text-white font-bold"
                  />
                </label>
              </div>
            </div>

            {/* Tarjeta de Aprovechamiento Real de la Plancha / Rollo (Cero Desperdicio) */}
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">
                  Aprovechamiento: {rollMetrics.stripAreaEfficiencyPercent}%
                </span>
                <div className="flex items-center gap-1.5">
                  {rollMetrics.savedRollLengthCm > 0 && (
                    <span className="text-[10px] font-mono bg-emerald-500/15 px-2 py-0.5 rounded-md text-emerald-300 border border-emerald-500/30 font-semibold">
                      Ahorro: {rollMetrics.savedRollLengthCm} cm
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-slate-400">
                    Desperdicio: {rollMetrics.wastePercent ?? roundMm(100 - rollMetrics.stripAreaEfficiencyPercent, 1)}%
                  </span>
                </div>
              </div>

              {/* Barra visual de material aprovechado vs desperdiciado */}
              <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    rollMetrics.stripAreaEfficiencyPercent >= 85
                      ? 'bg-emerald-500'
                      : rollMetrics.stripAreaEfficiencyPercent >= 65
                        ? 'bg-cyan-500'
                        : 'bg-amber-500'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(4, rollMetrics.stripAreaEfficiencyPercent))}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/75 p-2 rounded-lg border border-slate-800/80">
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Consumo
                  </span>
                  <span className="font-mono font-bold text-emerald-400 text-xs">
                    {rollMetrics.usedLengthCm} cm
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    de{' '}
                    {workbenchConfig.sheetWidthMm === 730 &&
                    workbenchConfig.sheetHeightMm === 600
                      ? `${rollMetrics.totalRollLengthCm} cm`
                      : `${roundMm(workbenchConfig.sheetHeightMm / 10, 1)} cm`}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Área Libre
                  </span>
                  <span className="font-mono font-bold text-amber-300 text-xs">
                    {rollMetrics.wasteAreaCm2 ?? 0} cm²
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    sin ocupar
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    {workbenchConfig.sheetWidthMm === 730 &&
                    workbenchConfig.sheetHeightMm === 600
                      ? 'Rinde Rollo 5m'
                      : 'Calce en Retazo'}
                  </span>
                  <span
                    className={`font-mono font-bold text-xs ${
                      workbenchConfig.sheetWidthMm === 730 &&
                      workbenchConfig.sheetHeightMm === 600
                        ? 'text-cyan-300'
                        : rollMetrics.usedLengthMm <= workbenchConfig.sheetHeightMm
                          ? 'text-emerald-300'
                          : 'text-red-400'
                    }`}
                  >
                    {workbenchConfig.sheetWidthMm === 730 &&
                    workbenchConfig.sheetHeightMm === 600
                      ? rollMetrics.estimatedRunsPerRoll > 0
                        ? `~${rollMetrics.estimatedRunsPerRoll} tiradas`
                        : '—'
                      : rollMetrics.usedLengthMm <= workbenchConfig.sheetHeightMm
                        ? 'Entra OK'
                        : 'Excede alto'}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    ({rollMetrics.widthUtilizationPercent}% ancho)
                  </span>
                </div>
              </div>

              {/* Aviso contextual de hueco recuperable en última fila */}
              {rollMetrics.freeSlotsInLastRow > 0 && (
                <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-emerald-200 leading-tight">
                    <span className="font-bold text-emerald-300 block">
                      Entran +{rollMetrics.freeSlotsInLastRow} etiquetas gratis aquí
                    </span>
                    <span className="text-[10px] text-slate-300">
                      Quedan {rollMetrics.freeWidthInLastRowCm} cm libres en la última fila
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFillLastRowFreeSlots}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] shrink-0"
                  >
                    + Completar
                  </button>
                </div>
              )}

              {/* Selector de estrategia + Botón principal único de optimización */}
              <div className="flex items-center gap-2 pt-0.5">
                <select
                  aria-label="Modo de aprovechamiento de plancha"
                  value={workbenchConfig.packingMode}
                  onChange={(e) => {
                    const nextMode = e.target.value as
                      | 'continuous_zero_waste'
                      | 'rectangular_blocks';
                    const nextCfg: WorkbenchConfig = {
                      ...workbenchConfig,
                      packingMode: nextMode,
                    };
                    onUpdateConfig(nextCfg);
                    onUpdateJobs(
                      autoArrangeWorkbenchJobs(
                        workbenchJobs,
                        nextCfg,
                        nextCfg.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
                        nextMode === 'continuous_zero_waste'
                      )
                    );
                  }}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                >
                  <option value="continuous_zero_waste">
                    Flujo 2D Continuo (Sin huecos)
                  </option>
                  <option value="rectangular_blocks">
                    Bloques Rectangulares Cerrados
                  </option>
                </select>

                <button
                  type="button"
                  onClick={handleApplyExtremeSaving}
                  disabled={workbenchJobs.length === 0}
                  className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Optimizar {Math.round(workbenchConfig.sheetWidthMm / 10)} cm</span>
                </button>
              </div>

              {/* Secuencia multi-archivo y sentido ordenado de corte */}
              <div className="p-2 rounded-lg bg-slate-950/75 border border-slate-800/80 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block">
                    <span className="text-[10px] text-cyan-300 font-semibold block mb-0.5">
                      Secuencia de archivos
                    </span>
                    <select
                      aria-label="Secuencia de corte con varios archivos"
                      value={workbenchConfig.executionSequenceMode ?? 'sequential_per_job'}
                      onChange={(e) =>
                        onUpdateConfig({
                          ...workbenchConfig,
                          executionSequenceMode: e.target.value as WorkbenchExecutionSequenceMode,
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white"
                    >
                      <option value="sequential_per_job">
                        Trabajo #1 completo → #2 → #3
                      </option>
                      <option value="global_by_layer">
                        Global por capa (C00 → C01 → C02)
                      </option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] text-amber-300 font-semibold block mb-0.5">
                      Sentido de recorrido
                    </span>
                    <select
                      aria-label="Sentido ordenado del cabezal láser"
                      value={workbenchConfig.travelOrder ?? 'zigzag_rows'}
                      onChange={(e) =>
                        onUpdateConfig({
                          ...workbenchConfig,
                          travelOrder: e.target.value as WorkbenchTravelOrder,
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white"
                    >
                      <option value="zigzag_rows">
                        Serpenteo ordenado (ZigZag)
                      </option>
                      <option value="left_to_right">
                        Filas estrictas Izq → Der
                      </option>
                      <option value="top_to_bottom">
                        Columnas Arriba ↔ Abajo
                      </option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-[10px] text-emerald-300 font-semibold block mb-0.5">
                    Modo de grabado en plancha (C00)
                  </span>
                  <select
                    aria-label="Modo de barrido de grabado en plancha"
                    value={workbenchConfig.engraveGrouping ?? 'all_at_once'}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        engraveGrouping: e.target.value as WorkbenchEngraveGrouping,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white"
                  >
                    <option value="all_at_once">
                      Todas a la vez — barrido completo por fila (estilo LightBurn)
                    </option>
                    <option value="per_piece">
                      Etiqueta por etiqueta (una pieza completa por vez)
                    </option>
                  </select>
                </label>

                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={workbenchConfig.preserveJobSequenceInNesting ?? false}
                      onChange={(e) =>
                        onUpdateConfig({
                          ...workbenchConfig,
                          preserveJobSequenceInNesting: e.target.checked,
                        })
                      }
                      className="accent-cyan-400"
                    />
                    <span>Bloquear orden #1 → #2 → #3 al optimizar</span>
                  </label>

                  {rollMetrics.sheetPassCount !== undefined && rollMetrics.usedLengthMm > 0 && (
                    <span
                      className={`font-mono px-1.5 py-0.5 rounded border ${
                        rollMetrics.exceedsSingleBedPass
                          ? 'bg-amber-950/60 border-amber-600/60 text-amber-300'
                          : 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                      }`}
                    >
                      {rollMetrics.sheetPassCount} tirada{rollMetrics.sheetPassCount > 1 ? 's' : ''} ·{' '}
                      {rollMetrics.exceedsSingleBedPass
                        ? `supera 60 cm`
                        : `${rollMetrics.remainingInCurrentPassCm ?? 0} cm libres en mesa`}
                    </span>
                  )}
                </div>
              </div>

              {/* Combinar también desde biblioteca de pedidos guardados */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Combinar otro pedido en la plancha"
                  value={orderToAppendId}
                  onChange={(e) => handleAddFromCatalogOrder(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-cyan-300"
                >
                  <option value="">
                    + Sumar otro pedido de la biblioteca para llenar huecos…
                  </option>
                  {ordersCatalog.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.projectName} ({ord.labelDesign.widthMm}×
                      {ord.labelDesign.heightMm} mm · {ord.nestingConfig.requestedQuantity}{' '}
                      u.)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Lista de trabajos / logos en la tirada actual + Orden de corte + Editor individual */}
            {workbenchJobs.length > 0 && (
              <div className="space-y-2">
                {workbenchJobs.length > 1 && (
                  <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                    <span>
                      Orden de ejecución ({workbenchJobs.length} archivos en tirada):
                    </span>
                    <button
                      type="button"
                      onClick={handleSortJobsBySpatialOrder}
                      className="text-cyan-300 hover:text-cyan-200 font-semibold"
                    >
                      Ordenar por posición ⇅
                    </button>
                  </div>
                )}
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {workbenchJobs.map((job, idx) => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`px-2.5 py-1.5 rounded border text-xs flex items-center justify-between cursor-pointer transition ${
                        selectedJob?.id === job.id
                          ? 'bg-cyan-950/60 border-cyan-500/70 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="truncate pr-2">
                        <span className="font-mono text-[10px] text-amber-400 mr-1.5 font-bold">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold">{job.name}</span>
                        <span className="text-[10px] text-cyan-300 font-mono ml-2">
                          {job.labelDesign.widthMm}×{job.labelDesign.heightMm}mm
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono ml-1.5">
                          ({job.pieceCount}u · {job.blockRotationDeg}°)
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {workbenchJobs.length > 1 && (
                          <>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveJob(job.id, 'up');
                              }}
                              className="p-1 text-slate-400 hover:text-cyan-300 disabled:opacity-25"
                              title="Subir en orden de corte"
                              aria-label={`Subir trabajo ${job.name}`}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === workbenchJobs.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveJob(job.id, 'down');
                              }}
                              className="p-1 text-slate-400 hover:text-cyan-300 disabled:opacity-25"
                              title="Bajar en orden de corte"
                              aria-label={`Bajar trabajo ${job.name}`}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteJob(job.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-400"
                          title="Quitar trabajo de la tirada"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Inspector del trabajo seleccionado: Cambiar cantidad, ancho x alto, forma, agujeros */}
                {selectedJob && (
                  <div className="p-2.5 rounded-lg bg-slate-900/95 border border-cyan-900/60 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-300 truncate">
                        Editar Trabajo: {selectedJob.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              blockRotationDeg:
                                selectedJob.blockRotationDeg === 90 ? 0 : 90,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <RotateCw className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>Rotar 90°</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDuplicateSelectedJob}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3 text-cyan-400" />
                          <span>Duplicar</span>
                        </button>
                      </div>
                    </div>

                    {/* Cantidad y Medidas de la etiqueta de este logo */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <label>
                        <span className="text-[10px] text-emerald-300 font-semibold block">
                          Cantidad (u.)
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={5000}
                          step={10}
                          aria-label="Cantidad de etiquetas del trabajo seleccionado"
                          value={selectedJob.pieceCount}
                          onChange={(e) =>
                            handleUpdateSelectedJobDesignOrQty({
                              pieceCount: Math.max(1, Number(e.target.value) || 1),
                              autoFitColumnsToRoll: true,
                            })
                          }
                          className="w-full bg-slate-950 border border-emerald-600/60 rounded px-2 py-1 font-mono text-emerald-300 font-bold"
                        />
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-300 block">
                          Ancho Etiq. (mm)
                        </span>
                        <input
                          type="number"
                          min={5}
                          max={400}
                          step={1}
                          aria-label="Ancho de etiqueta del trabajo seleccionado"
                          value={jobWidthStr}
                          onFocus={() => {
                            editingJobSizeRef.current = true;
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setJobWidthStr(raw);
                            const v = Number(raw.replace(',', '.'));
                            if (Number.isFinite(v) && v >= 5 && raw.trim() !== '') {
                              handleUpdateSelectedJobDesignOrQty({
                                widthMm: v,
                                autoFitColumnsToRoll: true,
                              });
                            }
                          }}
                          onBlur={() => {
                            editingJobSizeRef.current = false;
                            if (selectedJob) {
                              setJobWidthStr(String(selectedJob.labelDesign.widthMm));
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                        />
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-300 block">
                          Alto Etiq. (mm)
                        </span>
                        <input
                          type="number"
                          min={5}
                          max={400}
                          step={1}
                          aria-label="Alto de etiqueta del trabajo seleccionado"
                          value={jobHeightStr}
                          onFocus={() => {
                            editingJobSizeRef.current = true;
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setJobHeightStr(raw);
                            const v = Number(raw.replace(',', '.'));
                            if (Number.isFinite(v) && v >= 5 && raw.trim() !== '') {
                              handleUpdateSelectedJobDesignOrQty({
                                heightMm: v,
                                autoFitColumnsToRoll: true,
                              });
                            }
                          }}
                          onBlur={() => {
                            editingJobSizeRef.current = false;
                            if (selectedJob) {
                              setJobHeightStr(String(selectedJob.labelDesign.heightMm));
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                        />
                      </label>
                    </div>

                    {/* Botones rápidos de medidas y cantidades para este logo */}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-slate-400 mr-1">Medidas:</span>
                      {STANDARD_DIMENSION_PRESETS.slice(3, 8).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              widthMm: p.widthMm,
                              heightMm: p.heightMm,
                              autoFitColumnsToRoll: true,
                            })
                          }
                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                            selectedJob.labelDesign.widthMm === p.widthMm &&
                            selectedJob.labelDesign.heightMm === p.heightMm
                              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {p.widthMm}×{p.heightMm}
                        </button>
                      ))}
                    </div>

                    {/* Escala directa del logo grabado dentro de esta etiqueta */}
                    <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/70">
                      <span className="text-[10px] text-slate-400">
                        Logo interno:
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedJobArtwork(0.85)}
                          className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-200 font-semibold"
                        >
                          −15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedJobArtwork(1.15)}
                          className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-200 font-semibold"
                        >
                          +15%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              widthMm: selectedJob.labelDesign.widthMm,
                              heightMm: selectedJob.labelDesign.heightMm,
                            })
                          }
                          title="Recentrar y ajustar logo al 85% de la etiqueta"
                          className="px-2 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/50 text-[10px] text-cyan-200 font-bold"
                        >
                          Ajustar
                        </button>
                      </div>
                    </div>

                    {/* Distribución editable en mesa: Columnas, Filas y Separación X/Y */}
                    <div className="p-2 rounded-lg bg-slate-950/75 border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                          <Grid className="w-3 h-3" />
                          <span>Distribución en Mesa</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {selectedJob.columns} col × {selectedJob.rows} fil ·{' '}
                          {roundMm(selectedJob.widthMm / 10, 1)}×
                          {roundMm(selectedJob.heightMm / 10, 1)} cm
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        <label>
                          <span className="text-[10px] text-cyan-300 block mb-0.5">
                            Columnas
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={300}
                            step={1}
                            aria-label="Columnas en mesa del trabajo seleccionado"
                            value={jobColsStr}
                            onFocus={() => {
                              editingJobGridFieldRef.current = 'cols';
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setJobColsStr(raw);
                              const v = Math.round(Number(raw));
                              if (Number.isFinite(v) && v >= 1 && v <= 300 && raw.trim() !== '') {
                                handleUpdateSelectedJobDesignOrQty({
                                  columns: v,
                                  preservePieceCount: true,
                                });
                              }
                            }}
                            onBlur={() => {
                              editingJobGridFieldRef.current = null;
                              if (selectedJob) {
                                setJobColsStr(String(selectedJob.columns));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                          />
                        </label>
                        <label>
                          <span className="text-[10px] text-cyan-300 block mb-0.5">
                            Filas
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={300}
                            step={1}
                            aria-label="Filas en mesa del trabajo seleccionado"
                            value={jobRowsStr}
                            onFocus={() => {
                              editingJobGridFieldRef.current = 'rows';
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setJobRowsStr(raw);
                              const v = Math.round(Number(raw));
                              if (Number.isFinite(v) && v >= 1 && v <= 300 && raw.trim() !== '') {
                                handleUpdateSelectedJobDesignOrQty({
                                  rows: v,
                                  preservePieceCount: true,
                                });
                              }
                            }}
                            onBlur={() => {
                              editingJobGridFieldRef.current = null;
                              if (selectedJob) {
                                setJobRowsStr(String(selectedJob.rows));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                          />
                        </label>
                        <label>
                          <span className="text-[10px] text-slate-300 block mb-0.5">
                            Gap X (mm)
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            aria-label="Separación horizontal entre etiquetas en mm"
                            value={jobGapXStr}
                            onFocus={() => {
                              editingJobGridFieldRef.current = 'gapX';
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setJobGapXStr(raw);
                              const v = Number(raw.replace(',', '.'));
                              if (Number.isFinite(v) && v >= 0 && v <= 50 && raw.trim() !== '') {
                                handleUpdateSelectedJobDesignOrQty({
                                  gapXMm: roundMm(v, 2),
                                  preservePieceCount: true,
                                });
                              }
                            }}
                            onBlur={() => {
                              editingJobGridFieldRef.current = null;
                              if (selectedJob) {
                                setJobGapXStr(String(selectedJob.gapXMm));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                          />
                        </label>
                        <label>
                          <span className="text-[10px] text-slate-300 block mb-0.5">
                            Gap Y (mm)
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            aria-label="Separación vertical entre etiquetas en mm"
                            value={jobGapYStr}
                            onFocus={() => {
                              editingJobGridFieldRef.current = 'gapY';
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setJobGapYStr(raw);
                              const v = Number(raw.replace(',', '.'));
                              if (Number.isFinite(v) && v >= 0 && v <= 50 && raw.trim() !== '') {
                                handleUpdateSelectedJobDesignOrQty({
                                  gapYMm: roundMm(v, 2),
                                  preservePieceCount: true,
                                });
                              }
                            }}
                            onBlur={() => {
                              editingJobGridFieldRef.current = null;
                              if (selectedJob) {
                                setJobGapYStr(String(selectedJob.gapYMm));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              autoFitColumnsToRoll: true,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[10px] text-amber-200 font-semibold"
                        >
                          Max. Columnas
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              columns: 1,
                              preservePieceCount: true,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200 font-semibold"
                        >
                          1 Columna
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobDesignOrQty({
                              rows: 1,
                              preservePieceCount: true,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200 font-semibold"
                        >
                          1 Fila
                        </button>
                        {selectedJob.pieceCount !==
                          selectedJob.columns * selectedJob.rows && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateSelectedJobDesignOrQty({
                                pieceCount:
                                  selectedJob.columns * selectedJob.rows,
                              })
                            }
                            className="px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-600/50 text-[10px] text-emerald-300 font-semibold"
                          >
                            Llenar ({selectedJob.columns * selectedJob.rows} u.)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const margin = Math.max(
                              0,
                              workbenchConfig.sheetSafetyMarginMm
                            );
                            if (workbenchJobs.length > 1) {
                              onUpdateJobs(
                                autoArrangeWorkbenchJobs(
                                  workbenchJobs,
                                  workbenchConfig,
                                  2,
                                  false
                                )
                              );
                            } else {
                              handleUpdateSelectedJob({
                                xMm: roundMm(workbenchConfig.sheetOffsetXMm + margin),
                                yMm: roundMm(workbenchConfig.sheetOffsetYMm + margin),
                              });
                            }
                          }}
                          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-cyan-300 font-semibold"
                        >
                          Alinear en mesa
                        </button>
                      </div>
                    </div>

                    {/* Forma, Orificios y Posición X/Y del bloque */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <label className="col-span-2">
                        <span className="text-[10px] text-slate-400 block">
                          Orificios
                        </span>
                        <select
                          aria-label="Orificios del trabajo seleccionado"
                          value={selectedJob.labelDesign.holes.preset}
                          onChange={(e) =>
                            handleUpdateSelectedJobDesignOrQty({
                              holePreset: e.target.value as HolePreset,
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200"
                        >
                          <option value="none">Sin orificios</option>
                          <option value="single_left">1 lateral</option>
                          <option value="two_horizontal">2 laterales (costura)</option>
                          <option value="single_top">1 superior (colgante)</option>
                          <option value="four_corners">4 esquinas</option>
                        </select>
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-400 block">
                          Pos X (mm)
                        </span>
                        <input
                          type="number"
                          step={1}
                          value={selectedJob.xMm}
                          onChange={(e) =>
                            handleUpdateSelectedJob({
                              xMm: roundMm(Number(e.target.value) || 0),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-400 block">
                          Pos Y (mm)
                        </span>
                        <input
                          type="number"
                          step={1}
                          value={selectedJob.yMm}
                          onChange={(e) =>
                            handleUpdateSelectedJob({
                              yMm: roundMm(Number(e.target.value) || 0),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dimensiones de la Plancha o Retazo en Mesa */}
            <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">
                  Formato de Material en Mesa
                </span>
                <select
                  aria-label="Presets de plancha"
                  value=""
                  onChange={(e) => {
                    const preset = MATERIAL_SHEET_PRESETS.find(
                      (p) => p.label === e.target.value
                    );
                    if (preset) {
                      handleUpdateSheetDimensions(preset.widthMm, preset.heightMm, {
                        isRollMaterial: preset.widthMm === 730 && preset.heightMm >= 600,
                        notifyText: `Formato cambiado a ${preset.widthMm} × ${preset.heightMm} mm.`,
                      });
                    }
                  }}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-cyan-300"
                >
                  <option value="">Cambiar formato...</option>
                  {MATERIAL_SHEET_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <label>
                  <span className="text-[10px] text-slate-400 block">
                    Ancho ({roundMm(workbenchConfig.sheetWidthMm / 10, 1)} cm)
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={workbenchConfig.machineBedWidthMm}
                    aria-label="Ancho de plancha en conexión (mm)"
                    value={sheetWidthDraft}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSheetWidthDraft(raw);
                      const num = Number(raw);
                      if (raw !== '' && Number.isFinite(num) && num >= 10) {
                        handleUpdateSheetDimensions(num, workbenchConfig.sheetHeightMm);
                      }
                    }}
                    onBlur={() =>
                      setSheetWidthDraft(String(workbenchConfig.sheetWidthMm))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">
                    Tirada / Alto (mm)
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={workbenchConfig.machineBedHeightMm}
                    aria-label="Alto de plancha en conexión (mm)"
                    value={sheetHeightDraft}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSheetHeightDraft(raw);
                      const num = Number(raw);
                      if (raw !== '' && Number.isFinite(num) && num >= 10) {
                        handleUpdateSheetDimensions(workbenchConfig.sheetWidthMm, num);
                      }
                    }}
                    onBlur={() =>
                      setSheetHeightDraft(String(workbenchConfig.sheetHeightMm))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">
                    Largo Rollo (m)
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={100}
                    step={0.5}
                    value={roundMm(workbenchConfig.rollTotalLengthMm / 1000, 2)}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        rollTotalLengthMm: Math.max(
                          500,
                          Math.round((Number(e.target.value) || 5) * 1000)
                        ),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-amber-300"
                  />
                </label>
              </div>
            </div>
          </div>
          )}

          {/* SECCIÓN 3: DOCK INFERIOR DERECHO CON PESTAÑAS "3. Enviar a Vank 9060" | "Biblioteca de materiales" */}
          {sidebarView === 'laser' && (
          <div className="p-3 space-y-2.5 flex-1 flex flex-col">
            {/* Pestañas estilo LightBurn Pro 2.2 */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setBottomDockTab('laser')}
                  className={`px-3 py-1 rounded-t text-xs font-bold border-b-2 transition ${
                    bottomDockTab === 'laser'
                      ? 'bg-slate-900 border-orange-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  3. Enviar a Vank 9060
                </button>
                <button
                  type="button"
                  onClick={() => setBottomDockTab('material_library')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-t text-xs font-bold border-b-2 transition ${
                    bottomDockTab === 'material_library'
                      ? 'bg-slate-900 border-orange-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Biblioteca de materiales ({materialLibrary.length})</span>
                </button>
              </div>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  validation.isValidForMachineSend
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : validation.isValidForExport
                      ? 'bg-amber-950 text-amber-300 border border-amber-700'
                      : 'bg-red-950 text-red-300 border border-red-700'
                }`}
              >
                {validation.isValidForMachineSend
                  ? 'Ready · Vank 9060'
                  : validation.isValidForExport
                    ? 'Falta vel/potencia Ruida'
                    : 'Revisar geometría'}
              </span>
            </div>

            {bottomDockTab === 'laser' ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[10px] text-slate-400 block mb-1">
                        Iniciar desde (Start From)
                      </span>
                      <select
                        aria-label="Comenzar desde"
                        value={workbenchConfig.startFromMode}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...workbenchConfig,
                            startFromMode: e.target.value as StartFromMode,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                      >
                        <option value="user_origin">Origen del usuario</option>
                        <option value="current_position">Posición actual</option>
                        <option value="absolute_coords">Coordenadas absolutas</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-[10px] text-slate-400 block mb-1">
                        Esquina Home de la Vank
                      </span>
                      <select
                        aria-label="Esquina Home de la Vank"
                        value={workbenchConfig.machineOriginCorner}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...workbenchConfig,
                            machineOriginCorner:
                              e.target.value as MachineOriginCorner,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                      >
                        <option value="top_right">
                          Superior Derecha (Estándar Ruida)
                        </option>
                        <option value="top_left">Superior Izquierda</option>
                        <option value="bottom_left">Inferior Izquierda</option>
                        <option value="bottom_right">Inferior Derecha</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    <span className="text-[10px] text-slate-400 mb-1.5">
                      Origen del trabajo
                    </span>
                    <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800">
                      {JOB_ORIGIN_ANCHORS.map((anchor) => {
                        const active =
                          workbenchConfig.jobOriginAnchor === anchor.id;
                        return (
                          <button
                            key={anchor.id}
                            type="button"
                            title={anchor.label}
                            aria-label={`Origen del trabajo: ${anchor.label}`}
                            onClick={() =>
                              onUpdateConfig({
                                ...workbenchConfig,
                                jobOriginAnchor: anchor.id,
                              })
                            }
                            className={`w-5 h-5 rounded-full flex items-center justify-center border transition ${
                              active
                                ? 'bg-emerald-500 border-white text-slate-950 shadow'
                                : 'bg-slate-800 border-slate-700 hover:bg-slate-700'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                active ? 'bg-slate-950' : 'bg-slate-400'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Dispositivo Vank 9060 (192.168.0.195) + Prueba de Conexión en Vivo */}
                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Conexión Red LAN / Wi-Fi con Vank 9060</span>
                    </span>
                    <button
                      type="button"
                      disabled={isProbingRuida}
                      onClick={() => void handleProbeRuidaConnection()}
                      className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-[10px] shadow"
                    >
                      {isProbingRuida
                        ? 'Probando red...'
                        : `🔌 Probar Conexión (${workbenchConfig.ruidaIpAddress})`}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-1">
                      <span className="text-[10px] text-slate-400 block">
                        IP Vank 9060
                      </span>
                      <input
                        type="text"
                        value={workbenchConfig.ruidaIpAddress}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...workbenchConfig,
                            ruidaIpAddress: e.target.value,
                          })
                        }
                        placeholder="192.168.0.195"
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-cyan-300 font-bold"
                      />
                    </label>
                    <label className="col-span-1">
                      <span className="text-[10px] text-slate-400 block">
                        Puerto UDP Ruida
                      </span>
                      <input
                        type="number"
                        value={workbenchConfig.ruidaPort}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...workbenchConfig,
                            ruidaPort: Number(e.target.value) || 50200,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-slate-300"
                      />
                    </label>
                    <label className="col-span-1">
                      <span className="text-[10px] text-slate-400 block">
                        Nombre en Vank
                      </span>
                      <input
                        type="text"
                        maxLength={8}
                        value={workbenchConfig.ruidaJobName}
                        onChange={(e) =>
                          onUpdateConfig({
                            ...workbenchConfig,
                            ruidaJobName: e.target.value.toUpperCase(),
                          })
                        }
                        placeholder="ASTRA01"
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-emerald-300 uppercase font-bold"
                      />
                    </label>
                  </div>

                  {/* Guía rápida de preparación física en la Vank 9060 */}
                  <div className="p-2 rounded bg-slate-950/90 border border-slate-800/90 space-y-1 text-[10px] text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-300">
                        Pasos en la máquina antes de darle Start:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateConfig({
                            ...workbenchConfig,
                            startFromMode: 'user_origin',
                            jobOriginAnchor: 'top_right',
                            machineOriginCorner: 'top_right',
                          });
                          onNotify(
                            'Origen configurado igual a tu LightBurn: Iniciar desde Origen del usuario · Origen del trabajo Superior Derecha.'
                          );
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold"
                      >
                        Usar Origen Superior Derecha (LightBurn)
                      </button>
                    </div>
                    <div>
                      1. Posicioná el puntero láser rojo en la esquina{' '}
                      <strong className="text-white">
                        {JOB_ORIGIN_ANCHORS.find(
                          (a) => a.id === workbenchConfig.jobOriginAnchor
                        )?.label ?? workbenchConfig.jobOriginAnchor}
                      </strong>{' '}
                      del rollo de Ecocuero de 73 cm y apretá{' '}
                      <strong className="text-amber-300">ORIGIN</strong> en el panel de la Vank.
                    </div>
                    <div>
                      2. Enviá el trabajo a{' '}
                      <strong className="text-cyan-300">
                        {workbenchConfig.ruidaIpAddress}
                      </strong>{' '}
                      (o abrilo en LightBurn con 1 clic) y presioná{' '}
                      <strong className="text-emerald-300">FRAME</strong> para verificar el rectángulo de{' '}
                      <strong className="text-white">
                        {validation.occupiedBoundsMm
                          ? `${roundMm(validation.occupiedBoundsMm.width / 10, 1)} × ${roundMm(validation.occupiedBoundsMm.height / 10, 1)} cm`
                          : '0 × 0 cm'}
                      </strong>.
                    </div>
                  </div>
                </div>

                {validation.issues.length > 0 && (
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {validation.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded text-[11px] flex items-start gap-1.5 border ${
                          issue.severity === 'error'
                            ? 'bg-red-950/40 border-red-800 text-red-200'
                            : 'bg-amber-950/40 border-amber-800 text-amber-200'
                        }`}
                      >
                        {issue.severity === 'error' ? (
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                        )}
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <label
                  className={`flex items-start gap-2 p-2 rounded-lg border text-[11px] cursor-pointer transition ${
                    safetyHighlight && !safetyConfirmed
                      ? 'bg-amber-950/70 border-amber-400 text-amber-100 ring-2 ring-amber-400/70'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={safetyConfirmed}
                    onChange={(e) => {
                      setSafetyConfirmed(e.target.checked);
                      if (e.target.checked) setSafetyHighlight(false);
                    }}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span>
                    <strong>Verificación de operador:</strong> Confirmo material libre de PVC, foco y altura Z ajustados, chiller/extracción encendidos y parámetros de velocidad/potencia validados.
                  </span>
                </label>

                {ruidaStatusMsg && (
                  <div
                    role="alert"
                    className={`p-2 rounded-lg border text-xs ${
                      ruidaStatusMsg.type === 'success'
                        ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                        : ruidaStatusMsg.type === 'error'
                          ? 'bg-red-950/60 border-red-700 text-red-200'
                          : 'bg-cyan-950/60 border-cyan-700 text-cyan-200'
                    }`}
                  >
                    {ruidaStatusMsg.text}
                  </div>
                )}

                {/* Botonera de envío estilo LightBurn ("Enviar", "Guardar RD file", "Abrir en LightBurn") */}
                <div className="space-y-1.5 pt-0.5">
                  <button
                    type="button"
                    disabled={!validation.isValidForMachineSend || isSendingToRuida}
                    onClick={() => void handleSendToVankRuida()}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      {isSendingToRuida
                        ? ruidaUploadProgress
                          ? `Enviando ${ruidaUploadProgress.percent}% (${ruidaUploadProgress.current_packet}/${ruidaUploadProgress.total_packets} paq.)...`
                          : 'Enviando a Ruida RDC8445S...'
                        : `Enviar a Vank 9060 (${workbenchConfig.ruidaIpAddress})`}
                    </span>
                  </button>
                  {isSendingToRuida && ruidaUploadProgress && (
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                      <div
                        className="bg-emerald-400 h-full transition-all duration-150"
                        style={{ width: `${ruidaUploadProgress.percent}%` }}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!validation.isValidForExport}
                      onClick={() => void handleOpenOrSaveLbrn2(true)}
                      className="py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>
                        {isTauri()
                          ? 'Abrir en LightBurn (.lbrn2)'
                          : 'Guardar Proyecto (.lbrn2)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={!validation.isValidForMachineSend}
                      onClick={() => void handleDownloadRdFile()}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Guardar RD file (USB)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!validation.isValidForExport}
                      onClick={() => void handleOpenOrSaveLbrn2(false)}
                      className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 font-semibold text-[11px] flex items-center justify-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Guardar .lbrn2 en Carpeta</span>
                    </button>

                    <button
                      type="button"
                      disabled={!validation.isValidForExport}
                      onClick={handleExportWorkbenchSvg}
                      className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-300 font-semibold text-[11px] flex items-center justify-center gap-1.5"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Exportar Tirada (.SVG)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!validation.isValidForExport}
                      onClick={() => void handleExportWorkbenchVector('dxf')}
                      title="Exportar plancha 1:1 en milímetros (R12 AC1009, 0.0001 mm) con capas C00 Grabado, C01 Orificios y C02 Corte"
                      className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-amber-700/50 text-amber-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Guardar DXF (1:1 mm)</span>
                    </button>

                    <button
                      type="button"
                      disabled={!validation.isValidForExport}
                      onClick={() => void handleExportWorkbenchVector('ai')}
                      title="Exportar plancha Adobe Illustrator (.AI) 1:1 en milímetros multi-capa de alta precisión"
                      className="py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-orange-700/50 text-orange-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-orange-400" />
                      <span>Guardar .AI (Illustrator)</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* PESTAÑA: BIBLIOTECA DE MATERIALES (ESTILO LIGHTBURN) */
              <div className="space-y-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300">
                      Guardar Calibración Actual en Biblioteca
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCalibrationMatrixModal(true)}
                      className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/60 text-amber-300 text-[10px] font-bold"
                    >
                      🧪 Abrir Matriz Vel×Pot
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={libraryEntryName}
                      onChange={(e) => setLibraryEntryName(e.target.value)}
                      placeholder="Ej: Ecocuero 73cm — Grabado Nítido"
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={libraryNotes}
                      onChange={(e) => setLibraryNotes(e.target.value)}
                      placeholder="Notas (ej: Int 0.073mm · 348 DPI)"
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveCurrentLayersToLibrary}
                    className="w-full py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] flex items-center justify-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>+ Guardar Capas Actuales (C00/C01/C02) en Biblioteca</span>
                  </button>
                </div>

                {/* Lista de presets guardados en la Biblioteca de Materiales */}
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {materialLibrary.length === 0 ? (
                    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-slate-400 text-[11px] text-center">
                      Todavía no guardaste presets en la Biblioteca de Materiales.
                      Configurá C00/C01/C02 o usá la Matriz de Calibración y guardalos acá.
                    </div>
                  ) : (
                    materialLibrary.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">
                            {entry.materialName}
                          </div>
                          <div className="text-[10px] font-mono text-cyan-300 truncate">
                            C00: {entry.engrave.speedMmPerSec}mm/s ·{' '}
                            {entry.engrave.maxPowerPercent}% (Int{' '}
                            {entry.engrave.lineIntervalMm}mm) | C02:{' '}
                            {entry.cut.speedMmPerSec}mm/s ·{' '}
                            {entry.cut.maxPowerPercent}%
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplyLibraryEntry(entry)}
                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px]"
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLibraryEntry(entry.id)}
                            className="p-1 text-slate-400 hover:text-red-400"
                            title="Eliminar preset"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          )}
          </div>

          {/* DOCK FIJO INFERIOR DE CONEXIÓN Y ENVÍO RÁPIDO A VANK 9060 (SIEMPRE A MANO Y VISIBLE) */}
          {(sidebarView === 'layers' || sidebarView === 'jobs') && (
            <div className="shrink-0 z-20 bg-[#0f1520]/95 backdrop-blur border-t border-slate-700 p-2.5 space-y-2 text-xs shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      ruidaProbeResult?.udpHandshakeOk
                        ? 'bg-emerald-400 animate-pulse'
                        : ruidaProbeResult?.reachable
                          ? 'bg-amber-400'
                          : validation.isValidForMachineSend
                            ? 'bg-cyan-400'
                            : 'bg-slate-500'
                    }`}
                  />
                  <span className="font-bold text-white text-[11px]">
                    Vank 9060 ({workbenchConfig.ruidaIpAddress}:{workbenchConfig.ruidaPort})
                  </span>
                  {ruidaProbeResult?.latencyMs !== undefined &&
                    ruidaProbeResult?.latencyMs !== null && (
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                          ruidaProbeResult.udpHandshakeOk
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                            : 'bg-amber-950/70 text-amber-300 border-amber-700/60'
                        }`}
                      >
                        {ruidaProbeResult.transportMode?.startsWith('TCP')
                          ? 'TCP'
                          : 'UDP'}{' '}
                        {ruidaProbeResult.latencyMs}ms
                      </span>
                    )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isProbingRuida}
                    onClick={() => void handleProbeRuidaConnection()}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 font-bold text-[10px]"
                  >
                    {isProbingRuida ? 'Probando...' : '🔌 Probar Red'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarView('laser')}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-[10px]"
                  >
                    Ajustar Origen
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-md px-2 py-1">
                <span className="text-[10px] text-slate-400 shrink-0 font-semibold">
                  Nombre archivo en Vank:
                </span>
                <input
                  type="text"
                  maxLength={8}
                  aria-label="Nombre archivo en Vank"
                  placeholder="EJ: CHURITAS"
                  value={workbenchConfig.ruidaJobName}
                  onChange={(e) =>
                    onUpdateConfig({
                      ...workbenchConfig,
                      ruidaJobName: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9_-]/g, '')
                        .slice(0, 8),
                    })
                  }
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded px-2 py-0.5 font-mono text-[11px] font-bold text-amber-200 uppercase focus:outline-none"
                />
                <span className="text-[9px] text-slate-500 font-mono shrink-0">
                  máx 8
                </span>
              </div>

              {ruidaStatusMsg && (
                <div
                  className={`p-1.5 rounded border text-[10px] leading-tight max-h-14 overflow-y-auto ${
                    ruidaStatusMsg.type === 'success'
                      ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
                      : ruidaStatusMsg.type === 'error'
                        ? 'bg-red-950/70 border-red-700 text-red-200'
                        : 'bg-cyan-950/70 border-cyan-700 text-cyan-200'
                  }`}
                >
                  {ruidaStatusMsg.text}
                </div>
              )}

              {!validation.isValidForMachineSend && (
                <div className="p-1.5 rounded border border-amber-700/70 bg-amber-950/50 text-amber-200 text-[10px] leading-tight">
                  {validation.issues.find(
                    (i) =>
                      i.severity === 'error' ||
                      i.code === 'LAYER_PARAMS_UNCONFIGURED'
                  )?.message ??
                    'Completá velocidad/potencia en las capas activas para habilitar el envío.'}
                </div>
              )}

              <label
                className={`flex items-center gap-1.5 text-[10px] cursor-pointer px-1.5 py-1 rounded border transition ${
                  safetyHighlight && !safetyConfirmed
                    ? 'border-amber-400 bg-amber-950/70 text-amber-100 ring-2 ring-amber-400/70'
                    : 'border-transparent text-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(e) => {
                    setSafetyConfirmed(e.target.checked);
                    if (e.target.checked) setSafetyHighlight(false);
                  }}
                  className="accent-emerald-500"
                />
                <span>
                  Confirmo foco Z, extracción/chiller encendidos y parámetros validados
                </span>
              </label>

              {isSendingToRuida && ruidaUploadProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-emerald-300">
                    <span>
                      Enviando paquete {ruidaUploadProgress.current_packet}/
                      {ruidaUploadProgress.total_packets}
                    </span>
                    <span>{ruidaUploadProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                    <div
                      className="bg-emerald-400 h-full transition-all duration-150"
                      style={{ width: `${ruidaUploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={!validation.isValidForMachineSend || isSendingToRuida}
                  title={
                    !validation.isValidForMachineSend
                      ? 'Configurá velocidad y potencia válidas sin superposiciones en la plancha'
                      : !safetyConfirmed
                        ? 'Requiere marcar el check de seguridad arriba del botón'
                        : `Enviar trabajo a Vank 9060 (${workbenchConfig.ruidaIpAddress})`
                  }
                  onClick={() => void handleSendToVankRuida()}
                  className="py-2 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-[11px] flex items-center justify-center gap-1 shadow"
                >
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isSendingToRuida ? 'Enviando...' : 'Enviar a Vank'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!validation.isValidForExport}
                  onClick={() => void handleOpenOrSaveLbrn2(true)}
                  className="py-2 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>Abrir LightBurn</span>
                </button>
                <button
                  type="button"
                  disabled={!validation.isValidForMachineSend}
                  onClick={() => void handleDownloadRdFile()}
                  className="py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-emerald-300 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Guardar .RD</span>
                </button>
                <button
                  type="button"
                  disabled={!validation.isValidForExport}
                  onClick={() => void handleExportWorkbenchVector('dxf')}
                  title="Exportar plancha DXF R12 1:1 mm con alta precisión"
                  className="py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-amber-700/60 text-amber-200 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                  <span>Guardar DXF</span>
                </button>
                <button
                  type="button"
                  disabled={!validation.isValidForExport}
                  onClick={() => void handleExportWorkbenchVector('ai')}
                  title="Exportar plancha Adobe Illustrator .AI 1:1 mm multi-capa"
                  className="py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-orange-700/60 text-orange-200 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 text-orange-400" />
                  <span>Guardar .AI</span>
                </button>
                <button
                  type="button"
                  disabled={!validation.isValidForExport}
                  onClick={handleExportWorkbenchSvg}
                  title="Exportar tirada completa SVG 1:1 mm"
                  className="py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-cyan-200 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                  <span>Guardar .SVG</span>
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* 3. BARRA INFERIOR DE PALETA DE 30 COLORES LIGHTBURN (00..29 + T1, T2) */}
      <footer className="h-8 bg-[#0e131b] border-t border-slate-800 px-3 flex items-center justify-between gap-2 text-[10px] shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0.5">
          {LIGHTBURN_PALETTE_COLORS.map((c) => {
            const isActiveJobLayer = c.index <= 2;
            const isSelected = selectedLayerCutIndex === c.index;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  if (isActiveJobLayer) {
                    setSelectedLayerCutIndex(c.index);
                  }
                }}
                title={
                  isActiveJobLayer
                    ? `Seleccionar capa C${c.code}`
                    : `Color LightBurn C${c.code} (Usado en Matriz de Calibración)`
                }
                className={`w-5 h-5 rounded-sm font-mono text-[9px] font-bold flex items-center justify-center border transition ${
                  isSelected
                    ? 'ring-2 ring-white border-white scale-110 z-10'
                    : isActiveJobLayer
                      ? 'border-white/50 opacity-100 hover:scale-105'
                      : 'border-slate-700/60 opacity-65'
                }`}
                style={{
                  backgroundColor: c.hex,
                  color:
                    c.index === 4 || c.index === 6 || c.index === 11 || c.index === 17
                      ? '#000000'
                      : '#ffffff',
                }}
              >
                {c.code}
              </button>
            );
          })}
          <span className="w-5 h-5 rounded-sm font-mono text-[9px] font-bold flex items-center justify-center bg-orange-500 text-white ml-1">
            T1
          </span>
          <span className="w-5 h-5 rounded-sm font-mono text-[9px] font-bold flex items-center justify-center bg-sky-500 text-white">
            T2
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-slate-400 whitespace-nowrap">
          <span>
            Dispositivo: <strong className="text-white">Vank 9060</strong> (
            {workbenchConfig.ruidaIpAddress})
          </span>
          <span>·</span>
          <span>
            Tirada: {validation.totalPieces} u. ({rollMetrics.usedLengthCm} cm)
          </span>
        </div>
      </footer>

      {/* 4. MODAL INTERACTIVO: GENERADOR DE MATRIZ DE CALIBRACIÓN (POTENCIA × VELOCIDAD ESTILO LIGHTBURN) */}
      {showCalibrationMatrixModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Generador de Matriz de Calibración de Potencia y Velocidad"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl bg-[#0d121a] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-4 py-3 bg-gradient-to-r from-slate-900 to-amber-500/20 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Generador de Matriz de Calibración (Potencia × Velocidad) — Vank 9060
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Probá una grilla N×M en un retazo de {material.name}, hacé clic en la celda que mejor quedó y aplicala directo a tu capa
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCalibrationMatrixModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
              {/* Controles de rango de Velocidad, Potencia e Intervalo */}
              <div className="lg:col-span-5 space-y-3">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCalibrationConfig({ ...DEFAULT_ENGRAVE_TEST_CONFIG });
                      setSelectedCalibrationCell(null);
                    }}
                    className={`py-2 px-2.5 rounded-lg font-bold text-xs border transition ${
                      calibrationConfig.testType === 'engrave_grid'
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Matriz de Grabado (C00)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCalibrationConfig({ ...DEFAULT_CUT_TEST_CONFIG });
                      setSelectedCalibrationCell(null);
                    }}
                    className={`py-2 px-2.5 rounded-lg font-bold text-xs border transition ${
                      calibrationConfig.testType === 'cut_grid'
                        ? 'bg-red-500/20 border-red-400 text-red-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Matriz de Corte (C01 / C02)
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                  <div className="font-bold text-slate-200">
                    1. Rango de Velocidad — Filas (mm/s)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Vel. Mín (mm/s)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={calibrationConfig.minSpeedMmS}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            minSpeedMmS: Math.max(1, Number(e.target.value) || 10),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Vel. Máx (mm/s)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={calibrationConfig.maxSpeedMmS}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            maxSpeedMmS: Math.max(1, Number(e.target.value) || 100),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Filas (2–5)
                      </span>
                      <input
                        type="number"
                        min={2}
                        max={5}
                        value={calibrationConfig.speedSteps}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            speedSteps: Math.max(
                              2,
                              Math.min(5, Number(e.target.value) || 5)
                            ),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-cyan-300"
                      />
                    </label>
                  </div>

                  <div className="font-bold text-slate-200 pt-1">
                    2. Rango de Potencia — Columnas (%)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Pot. Mín (%)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={calibrationConfig.minPowerPercent}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            minPowerPercent: Math.max(
                              1,
                              Math.min(100, Number(e.target.value) || 10)
                            ),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Pot. Máx (%)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={calibrationConfig.maxPowerPercent}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            maxPowerPercent: Math.max(
                              1,
                              Math.min(100, Number(e.target.value) || 50)
                            ),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Columnas (2–5)
                      </span>
                      <input
                        type="number"
                        min={2}
                        max={5}
                        value={calibrationConfig.powerSteps}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            powerSteps: Math.max(
                              2,
                              Math.min(5, Number(e.target.value) || 5)
                            ),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-amber-300"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Intervalo (mm)
                      </span>
                      <input
                        type="number"
                        min={0.03}
                        max={0.5}
                        step={0.001}
                        value={calibrationConfig.lineIntervalMm}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            lineIntervalMm: roundMm(
                              Math.max(0.03, Number(e.target.value) || 0.073),
                              3
                            ),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-cyan-300"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Muestra (mm)
                      </span>
                      <input
                        type="number"
                        min={5}
                        max={25}
                        value={calibrationConfig.cellSizeMm}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            cellSizeMm: Math.max(5, Number(e.target.value) || 10),
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white"
                      />
                    </label>
                    <label>
                      <span className="text-[10px] text-slate-400 block">
                        Capa Destino
                      </span>
                      <select
                        value={calibrationConfig.targetRole}
                        onChange={(e) =>
                          setCalibrationConfig({
                            ...calibrationConfig,
                            targetRole: e.target.value as
                              | 'ENGRAVE'
                              | 'HOLES'
                              | 'CUT',
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white"
                      >
                        <option value="ENGRAVE">C00 Grabado</option>
                        <option value="HOLES">C01 Orificios</option>
                        <option value="CUT">C02 Corte Ext.</option>
                      </select>
                    </label>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono pt-1">
                    Tamaño total del retazo:{' '}
                    <strong className="text-emerald-300">
                      {calibrationGrid.totalWidthMm} × {calibrationGrid.totalHeightMm} mm
                    </strong>{' '}
                    ({calibrationGrid.cells.length} muestras)
                  </div>
                </div>

                {/* Botones para mandar la matriz a la Vank 9060 o abrirla en LightBurn */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleSendCalibrationMatrixToVank()}
                    className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      Enviar Matriz a Vank 9060 ({workbenchConfig.ruidaIpAddress})
                    </span>
                  </button>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleExportCalibrationLbrn2(true)}
                      className="py-1.5 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] flex items-center justify-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>LightBurn .lbrn2</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadCalibrationRd}
                      className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 font-bold text-[11px] flex items-center justify-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Matriz .RD</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCalibrationSvg}
                      className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1"
                    >
                      <FileCode2 className="w-3 h-3" />
                      <span>Matriz .SVG</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Grilla Visual Interactiva N×M: Clic en la celda ganadora para aplicarla */}
              <div className="lg:col-span-7 flex flex-col justify-between p-3 rounded-xl bg-[#070a0f] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    3. Hacé clic en la muestra ganadora para cargar sus valores
                  </span>
                  <span className="text-[10px] font-mono text-cyan-300">
                    Int: {calibrationConfig.lineIntervalMm} mm (
                    {Math.round(25.4 / calibrationConfig.lineIntervalMm)} DPI)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-1.5 text-center">
                    <thead>
                      <tr>
                        <th className="p-1 text-[10px] font-mono text-slate-400">
                          Vel \ Pot
                        </th>
                        {calibrationGrid.powerValues.map((p) => (
                          <th
                            key={`col-p-${p}`}
                            className="p-1 text-[11px] font-mono font-bold text-amber-300 bg-slate-900/90 rounded border border-slate-800"
                          >
                            {p}%
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calibrationGrid.speedValues.map((s, rIdx) => (
                        <tr key={`row-s-${s}`}>
                          <td className="p-1.5 text-[11px] font-mono font-bold text-cyan-300 bg-slate-900/90 rounded border border-slate-800 whitespace-nowrap">
                            {s} mm/s
                          </td>
                          {calibrationGrid.powerValues.map((p, cIdx) => {
                            const cell = calibrationGrid.cells.find(
                              (item) => item.row === rIdx && item.col === cIdx
                            )!;
                            const isChosen =
                              selectedCalibrationCell?.cutIndex === cell.cutIndex;

                            return (
                              <td key={cell.layerCode}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedCalibrationCell(cell)}
                                  className={`w-full py-2 px-1.5 rounded-lg border font-mono text-[10px] flex flex-col items-center justify-center gap-0.5 transition ${
                                    isChosen
                                      ? 'bg-emerald-500/25 border-emerald-400 ring-2 ring-emerald-400 text-white scale-105'
                                      : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                                  }`}
                                >
                                  <span
                                    className="px-1.5 py-0.2 rounded text-[9px] font-bold"
                                    style={{
                                      backgroundColor: cell.hexColor,
                                      color: '#ffffff',
                                    }}
                                  >
                                    {cell.layerCode}
                                  </span>
                                  <span className="font-bold text-white">
                                    {s} / {p}%
                                  </span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Barra de confirmación de la celda ganadora seleccionada */}
                {selectedCalibrationCell ? (
                  <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-600/70 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-emerald-300">
                        Celda Seleccionada: {selectedCalibrationCell.layerCode} →{' '}
                        {selectedCalibrationCell.speedMmPerSec} mm/s ·{' '}
                        {selectedCalibrationCell.maxPowerPercent}%
                      </div>
                      <div className="text-[10px] text-slate-300">
                        Se aplicará a la capa{' '}
                        {calibrationConfig.targetRole === 'ENGRAVE'
                          ? 'C00 (Grabado)'
                          : calibrationConfig.targetRole === 'HOLES'
                            ? 'C01 (Orificios)'
                            : 'C02 (Corte Exterior)'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          handleApplyWinningCalibrationCell(
                            selectedCalibrationCell,
                            false
                          );
                          setShowCalibrationMatrixModal(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                      >
                        ✓ Aplicar a Capa
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleApplyWinningCalibrationCell(
                            selectedCalibrationCell,
                            true
                          );
                          setShowCalibrationMatrixModal(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs"
                      >
                        💾 Aplicar y Guardar en Biblioteca
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400 text-center">
                    Seleccioná arriba cualquier celda de la grilla (Vel × Pot) para cargar esa calibración en tu capa activa.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. POP-UP CARTEL DE ESPERA DE START / CRONÓMETRO EN VIVO DURANTE EL GRABADO Y CORTE */}
      {machineTimer.phase === 'armed' && !machineTimer.popupMinimized && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Monitor esperando arranque de la Vank 9060"
          className="fixed bottom-12 right-5 z-50 w-[390px] max-w-[calc(100vw-2rem)] rounded-2xl bg-[#0e1623] border-2 border-cyan-500/70 shadow-2xl shadow-cyan-950/60 p-4 text-slate-100"
        >
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
              <div>
                <h4 className="text-xs font-extrabold text-cyan-200 uppercase tracking-wide">
                  Pedido listo en Vank 9060 ({workbenchConfig.ruidaIpAddress})
                </h4>
                <p className="text-[11px] text-slate-300">
                  {machineTimer.jobName} · {machineTimer.totalPieces} u. · Est.{' '}
                  <strong className="text-white">
                    {formatDurationTimer(machineTimer.estimatedTotalSec)}
                  </strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMachineTimer((prev) => ({ ...prev, popupMinimized: true }))
                }
                title="Minimizar cartel"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMachineTimer(createInitialJobTimerState())}
                title="Desactivar monitor"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-2 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span
                className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                  motionCalibration.source === 'controller'
                    ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-300'
                    : motionCalibration.source === 'empirical'
                      ? 'bg-cyan-950/60 border-cyan-600/60 text-cyan-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
              >
                {motionCalibration.source === 'controller'
                  ? '✓ Calibrado Automático Vank 9060'
                  : motionCalibration.source === 'empirical'
                    ? '🧠 Auto-calibrado Vank'
                    : '⚡ Física Ruida RDC8445S'}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Rampa {Math.round(motionCalibration.scanAccelMmPerSec2)} mm/s² · ×
                {motionCalibration.empiricalTimeMultiplier.toFixed(2)}
              </span>
            </div>
            {ruidaControllerFiles.length > 0 && (
              <label className="flex items-center justify-between gap-2 text-[10px] text-slate-300">
                <span className="font-semibold text-slate-400 shrink-0">
                  Archivo en máquina:
                </span>
                <select
                  value={activeVankFileName || machineTimer.jobName}
                  onChange={(e) => {
                    const chosen = e.target.value.trim().toUpperCase();
                    setActiveVankFileName(chosen);
                    const rem = rememberedFileEstimates[chosen];
                    setMachineTimer((prev) => ({
                      ...prev,
                      jobName: chosen,
                      totalPieces: rem?.totalPieces || prev.totalPieces,
                      estimatedTotalSec: rem?.estimatedTotalSec || prev.estimatedTotalSec,
                    }));
                  }}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-cyan-200 max-w-[200px]"
                >
                  {!ruidaControllerFiles.some(
                    (f) => f.name === (activeVankFileName || machineTimer.jobName)
                  ) && (
                    <option value={activeVankFileName || machineTimer.jobName}>
                      {activeVankFileName || machineTimer.jobName}
                    </option>
                  )}
                  {ruidaControllerFiles.map((f) => (
                    <option key={f.index} value={f.name}>
                      #{f.index + 1} · {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div>
              {isTauri()
                ? machineLiveStatus?.reachable
                  ? '● Monitor continuo activo: detecta cualquier START en la Vank 9060 (enviado desde Astra, LightBurn o USB) incluso tras Stop/reinicio.'
                  : '⏳ Buscando estado de la Vank 9060 en red local... Cuando presiones START podés activar el cronómetro abajo si no responde.'
                : 'Cuando presiones START en la máquina hacé clic abajo para abrir el cronómetro con cuenta regresiva y alerta al finalizar.'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setMachineTimer((prev) =>
                  startJobTimerExecution(prev, { source: 'manual' })
                )
              }
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow"
            >
              <Play className="w-3.5 h-3.5" />
              <span>¡Arrancó! Abrir Cronómetro</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setMachineTimer((prev) => ({
                  ...prev,
                  soundEnabled: !prev.soundEnabled,
                }))
              }
              title={
                machineTimer.soundEnabled
                  ? 'Alarma sonora activada'
                  : 'Alarma sonora silenciada'
              }
              className={`p-2 rounded-xl border text-xs ${
                machineTimer.soundEnabled
                  ? 'bg-emerald-950/50 border-emerald-600/60 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              {machineTimer.soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {(machineTimer.phase === 'running' || machineTimer.phase === 'paused') &&
        !machineTimer.popupMinimized && (
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Cronómetro de Grabado y Corte en Vank 9060"
            className={`fixed bottom-12 right-5 z-50 w-[410px] max-w-[calc(100vw-2rem)] rounded-2xl bg-[#0b131d] border-2 shadow-2xl p-4 text-slate-100 ${
              machineTimer.phase === 'paused'
                ? 'border-amber-400 shadow-amber-950/60'
                : 'border-emerald-400 shadow-emerald-950/70'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 ${
                    machineTimer.phase === 'paused'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400 animate-ping'
                  }`}
                />
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wider text-emerald-300">
                    {machineTimer.phase === 'paused'
                      ? '❚❚ Vank 9060 Pausada'
                      : machineTimer.source === 'hardware'
                        ? '● Grabando / Cortando en Vank 9060'
                        : '● Cronómetro Activo — Pedido en Curso'}
                  </div>
                  <div className="text-xs font-bold text-white flex flex-wrap items-center gap-1.5">
                    <span>
                      {machineTimer.jobName} · {machineTimer.totalPieces} etiquetas
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                        motionCalibration.source === 'controller'
                          ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300'
                          : motionCalibration.source === 'empirical'
                            ? 'bg-cyan-950/70 border-cyan-600/60 text-cyan-300'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      {motionCalibration.source === 'controller'
                        ? '✓ Calibrado Vank'
                        : motionCalibration.source === 'empirical'
                          ? '🧠 Auto-ajustado'
                          : '⚡ Física Ruida'}
                    </span>
                  </div>
                  {ruidaControllerFiles.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">Archivo:</span>
                      <select
                        value={machineTimer.jobName}
                        onChange={(e) => {
                          const chosen = e.target.value.trim().toUpperCase();
                          setActiveVankFileName(chosen);
                          const rem = rememberedFileEstimates[chosen];
                          setMachineTimer((prev) => ({
                            ...prev,
                            jobName: chosen,
                            totalPieces: rem?.totalPieces || prev.totalPieces,
                            estimatedTotalSec:
                              rem?.estimatedTotalSec || prev.estimatedTotalSec,
                          }));
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-cyan-200 max-w-[190px]"
                      >
                        {!ruidaControllerFiles.some(
                          (f) => f.name === machineTimer.jobName
                        ) && (
                          <option value={machineTimer.jobName}>
                            {machineTimer.jobName}
                          </option>
                        )}
                        {ruidaControllerFiles.map((f) => (
                          <option key={f.index} value={f.name}>
                            #{f.index + 1} · {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setMachineTimer((prev) => ({
                      ...prev,
                      soundEnabled: !prev.soundEnabled,
                    }))
                  }
                  title="Activar/silenciar alerta sonora al terminar"
                  className={`p-1.5 rounded-lg border text-xs ${
                    machineTimer.soundEnabled
                      ? 'bg-emerald-950/50 border-emerald-600/50 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {machineTimer.soundEnabled ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMachineTimer((prev) => ({ ...prev, popupMinimized: true }))
                  }
                  title="Minimizar pop-up al encabezado"
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 mb-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    {liveTimerSnapshot.overtimeSec > 0
                      ? 'Tiempo excedido sobre est.'
                      : 'Falta aprox. para terminar'}
                  </div>
                  <div
                    className={`text-4xl font-black font-mono tabular-nums tracking-tight ${
                      liveTimerSnapshot.overtimeSec > 0
                        ? 'text-amber-300'
                        : machineTimer.phase === 'paused'
                          ? 'text-amber-200'
                          : 'text-emerald-300'
                    }`}
                  >
                    {liveTimerSnapshot.overtimeSec > 0
                      ? `+${formatDurationTimer(liveTimerSnapshot.overtimeSec)}`
                      : formatDurationTimer(liveTimerSnapshot.remainingSec)}
                  </div>
                </div>
                <div className="text-right space-y-0.5">
                  <div className="text-[10px] text-slate-400">
                    Transcurrido:{' '}
                    <span className="font-mono font-bold text-slate-100 tabular-nums">
                      {formatDurationTimer(liveTimerSnapshot.elapsedSec)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Total est.:{' '}
                    <span className="font-mono font-semibold text-slate-200 tabular-nums">
                      {formatDurationTimer(machineTimer.estimatedTotalSec)}
                    </span>
                  </div>
                  {liveTimerSnapshot.estimatedFinishAtMs && (
                    <div className="text-[10px] text-cyan-300 font-semibold">
                      Termina aprox.{' '}
                      {new Date(
                        liveTimerSnapshot.estimatedFinishAtMs
                      ).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                  <span>Progreso estimado</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {liveTimerSnapshot.progressPercent}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      machineTimer.phase === 'paused'
                        ? 'bg-amber-400'
                        : 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                    }`}
                    style={{ width: `${liveTimerSnapshot.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setMachineTimer((prev) =>
                    prev.phase === 'paused'
                      ? resumeJobTimerExecution(prev)
                      : pauseJobTimerExecution(prev)
                  )
                }
                className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1"
              >
                {machineTimer.phase === 'paused' ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Reanudar</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pausar</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setMachineTimer((prev) => ({
                    ...prev,
                    estimatedTotalSec: prev.estimatedTotalSec + 60,
                  }))
                }
                className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-200 font-bold text-[11px] flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+1 min</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setMachineTimer((prev) => finishJobTimerExecution(prev))
                }
                className="py-1.5 px-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[11px] flex items-center justify-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Terminó</span>
              </button>
            </div>
          </div>
        )}

      {/* 6. POP-UP ALERTA FINAL CUANDO TERMINA LA MÁQUINA DE GRABAR */}
      {machineTimer.phase === 'finished' && !machineTimer.popupMinimized && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Alerta Pedido Terminado en Vank 9060"
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0b1614] border-2 border-emerald-400 shadow-2xl shadow-emerald-500/30 p-6 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400/60 flex items-center justify-center">
              <Bell className="w-7 h-7 text-emerald-300 animate-bounce" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                Aviso Automático Vank 9060
              </div>
              <h3 className="text-xl font-black text-white">
                ¡Terminó la máquina de grabar!
              </h3>
              <p className="text-sm text-slate-300">
                Pedido <strong className="text-white">{machineTimer.jobName}</strong> (
                <strong className="text-emerald-300">{machineTimer.totalPieces} u.</strong>) completado.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-950/90 border border-emerald-800/60 text-xs">
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Duración Real</div>
                <div className="text-lg font-black font-mono text-emerald-300 tabular-nums">
                  {formatDurationTimer(liveTimerSnapshot.elapsedSec)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Finalizado a las</div>
                <div className="text-lg font-black font-mono text-cyan-200 tabular-nums">
                  {machineTimer.finishedAtMs
                    ? new Date(machineTimer.finishedAtMs).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '--:--'}
                </div>
              </div>
            </div>

            {autoPowerOffRemainingSec !== null && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/70 text-xs text-rose-200 flex items-center justify-between gap-2">
                <div className="text-left">
                  <div className="font-bold">
                    ⏻ Auto-apagado 220 V tras enfriamiento en{' '}
                    <span className="font-mono text-white">
                      {formatDurationTimer(autoPowerOffRemainingSec)}
                    </span>
                  </div>
                  <div className="text-[10px] text-rose-300/80">
                    Dejando circular agua del chiller antes de cortar energía.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoPowerOffRemainingSec(null)}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-white shrink-0"
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => playWorkshopCompletionAlertChime()}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Volume2 className="w-4 h-4 text-emerald-300" />
                <span>Sonar Alerta</span>
              </button>
              <button
                type="button"
                onClick={() => setMachineTimer(createInitialJobTimerState())}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Entendido · Cerrar Alerta</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 7. MODAL DE APAGADO COMPLETO DE MÁQUINA VANK 9060 (STOP RUIDA + RELÉ 220 V) */}
      {showPowerOffModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Apagado completo de Vank 9060"
          className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#0d121a] border-2 border-rose-500/70 shadow-2xl shadow-rose-950/60 p-5 text-slate-100 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-300 shrink-0">
                  <Power className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    Apagado Completo — Vank 9060 CO₂
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Frena la controladora Ruida ({workbenchConfig.ruidaIpAddress}) y corta alimentación eléctrica 220 V si tenés relé conectado.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPowerOffModal(false)}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Estado en vivo + Controles remotos directos por red a Ruida */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">
                  Estado actual Vank 9060:
                </span>
                <span
                  className={`font-bold px-2 py-0.5 rounded-md border text-[11px] ${
                    machineTimer.phase === 'running'
                      ? 'bg-amber-950/70 border-amber-600/70 text-amber-300'
                      : machineLiveStatus?.reachable
                        ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {machineTimer.phase === 'running'
                    ? '⚠ Grabando / Cortando ahora'
                    : machineLiveStatus?.reachable
                      ? '● Conectada en reposo seguro'
                      : '○ Sin enlace LAN detectado'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={isExecutingPowerAction}
                  onClick={() => void handleRuidaRemoteCommand('pause')}
                  className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pausar Ruida</span>
                </button>
                <button
                  type="button"
                  disabled={isExecutingPowerAction}
                  onClick={() => void handleRuidaRemoteCommand('stop')}
                  className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-rose-300 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>STOP Trabajo</span>
                </button>
                <button
                  type="button"
                  disabled={isExecutingPowerAction}
                  onClick={() => void handleRuidaRemoteCommand('reset')}
                  className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-[11px] flex items-center justify-center gap-1"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Reset Panel</span>
                </button>
              </div>
            </div>

            {/* Configuración de Relé Wi-Fi 220V (Shelly + Contactor / Tasmota / Webhook) */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5 text-xs">
              <div className="font-bold text-slate-200 flex items-center justify-between">
                <span>Corte eléctrico 220 V (Relé Wi-Fi + Contactor ≥25 A)</span>
                <span className="text-[10px] font-mono text-slate-400">
                  Vank + Chiller + Extractor
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">Tipo de relé local</span>
                  <select
                    value={powerRelayConfig.relayPreset}
                    onChange={(e) =>
                      handleUpdatePowerRelayConfig({
                        relayPreset: e.target.value as SmartRelayPreset,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="shelly_gen2">Shelly Plus / Pro (Gen2)</option>
                    <option value="shelly_gen1">Shelly 1 / 1PM (Gen1)</option>
                    <option value="tasmota">Sonoff / Tasmota</option>
                    <option value="custom_http">Webhook HTTP local personalizado</option>
                    <option value="none">Solo control Ruida (sin relé 220V)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] text-slate-400">
                    IP del relé o URL HTTP local
                  </span>
                  <input
                    type="text"
                    value={powerRelayConfig.relayHostOrUrl}
                    onChange={(e) =>
                      handleUpdatePowerRelayConfig({
                        relayHostOrUrl: e.target.value,
                      })
                    }
                    placeholder="ej. 192.168.0.210"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono text-cyan-200"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={powerRelayConfig.autoPowerOffOnFinish}
                    onChange={(e) =>
                      handleUpdatePowerRelayConfig({
                        autoPowerOffOnFinish: e.target.checked,
                      })
                    }
                    className="rounded border-slate-600 bg-slate-950 text-rose-500"
                  />
                  <span>Auto-apagar 220 V al terminar pedido</span>
                </label>

                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span>Enfriar chiller:</span>
                  <select
                    value={powerRelayConfig.cooldownSeconds}
                    onChange={(e) =>
                      handleUpdatePowerRelayConfig({
                        cooldownSeconds: Number(e.target.value) || 120,
                      })
                    }
                    className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200"
                  >
                    <option value={60}>1 min</option>
                    <option value={120}>2 min</option>
                    <option value={180}>3 min</option>
                    <option value={300}>5 min</option>
                  </select>
                </label>
              </div>
            </div>

            {powerActionFeedback && (
              <div
                className={`p-2.5 rounded-xl border text-xs ${
                  powerActionFeedback.type === 'success'
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                    : powerActionFeedback.type === 'error'
                      ? 'bg-rose-950/70 border-rose-700 text-rose-200'
                      : 'bg-amber-950/50 border-amber-700/70 text-amber-200'
                }`}
              >
                {powerActionFeedback.text}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPowerOffModal(false)}
                className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isExecutingPowerAction}
                onClick={() => void handleExecuteFullMachineShutdown()}
                className="py-2 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-2 shadow-lg shadow-rose-900/50"
              >
                <Power className="w-4 h-4" />
                <span>
                  {isExecutingPowerAction
                    ? 'Apagando...'
                    : '⏻ Confirmar Apagado Completo'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
