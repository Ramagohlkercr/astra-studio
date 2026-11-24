import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  FolderPlus,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Move,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Unlock,
  Wifi,
  Wind,
  X,
} from 'lucide-react';
import { rasterImageTransform, roundMm } from '../core/geometry/geometryEngine';
import { MATERIAL_SHEET_PRESETS } from '../core/projects/projectManager';
import {
  LabelDesign,
  MaterialProfile,
  NestingResult,
  OrderProject,
} from '../core/types';
import { LogoOutputFile } from '../core/exporters/logoFolder';
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../core/workbench/lbrn2Exporter';
import {
  buildRuidaUdpPackets,
  compileWorkbenchToRuidaRd,
} from '../core/workbench/ruidaCompiler';
import {
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  createWorkbenchJobFromOrder,
  simulateWorkbenchToolpath,
  syncLayersWithMaterialProfile,
  updateWorkbenchJobGrid,
  validateWorkbenchState,
} from '../core/workbench/workbenchEngine';
import {
  JobOriginAnchor,
  LightBurnCutMode,
  MachineOriginCorner,
  StartFromMode,
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
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
  onUpdateConfig,
  onUpdateJobs,
  onSaveMaterialParameters,
  onRequestSaveFiles,
  onNotify,
  onClose,
}) => {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    () => workbenchJobs[0]?.id ?? null
  );
  const [cameraView, setCameraView] = useState<'sheet' | 'machine' | 'occupied'>('sheet');
  const [showSimulation, setShowSimulation] = useState<boolean>(false);
  const [isPlayingSim, setIsPlayingSim] = useState<boolean>(false);
  const [simProgress, setSimProgress] = useState<number>(100); // 0..100%
  const [safetyConfirmed, setSafetyConfirmed] = useState<boolean>(false);
  const [isSendingToRuida, setIsSendingToRuida] = useState<boolean>(false);
  const [ruidaStatusMsg, setRuidaStatusMsg] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [orderToAppendId, setOrderToAppendId] = useState<string>('');

  // Estado de arrastre interactivo sobre el SVG de la mesa
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingJobRef = useRef<{
    jobId: string;
    startMouseX: number;
    startMouseY: number;
    initialJobX: number;
    initialJobY: number;
  } | null>(null);

  const selectedJob = useMemo(
    () => workbenchJobs.find((j) => j.id === selectedJobId) ?? workbenchJobs[0] ?? null,
    [workbenchJobs, selectedJobId]
  );

  const validation = useMemo(
    () => validateWorkbenchState(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

  const simulation = useMemo(
    () => simulateWorkbenchToolpath(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

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

  // Calcular posición instantánea del cabezal láser durante la simulación
  const simulatedLaserHead = useMemo(() => {
    if (simulation.segments.length === 0) {
      return validation.jobOriginPointMm;
    }
    const targetTime = (simProgress / 100) * simulation.totalDurationSec;
    const activeSeg =
      simulation.segments.find(
        (s) => targetTime >= s.startTimeSec && targetTime <= s.endTimeSec
      ) ?? simulation.segments[simulation.segments.length - 1];

    if (!activeSeg || activeSeg.points.length === 0) {
      return validation.jobOriginPointMm;
    }
    const ratio =
      activeSeg.durationSec > 0
        ? Math.max(0, Math.min(1, (targetTime - activeSeg.startTimeSec) / activeSeg.durationSec))
        : 1;
    const ptIdx = Math.min(
      activeSeg.points.length - 1,
      Math.floor(ratio * activeSeg.points.length)
    );
    return activeSeg.points[ptIdx];
  }, [simulation, simProgress, validation.jobOriginPointMm]);

  // Acciones de agregar trabajos a la plancha
  const handleAddActiveBatch = () => {
    const newJob = createWorkbenchJobFromOrder({
      design,
      nesting,
      batchIndex: activeBatchIndex,
      mode: 'active_batch',
      projectName,
      clientName,
      orderId: activeOrderId,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = [...workbenchJobs, newJob];
    onUpdateJobs(next);
    setSelectedJobId(newJob.id);
    onNotify(`Tanda "${newJob.name}" agregada a la plancha de trabajo.`);
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
    const newJob = createWorkbenchJobFromOrder({
      design: targetOrder.labelDesign,
      nesting,
      mode: 'custom_grid',
      customColumns: Math.min(5, Math.max(1, targetOrder.nestingConfig.requestedQuantity)),
      customRows: Math.min(
        4,
        Math.max(1, Math.ceil(targetOrder.nestingConfig.requestedQuantity / 5))
      ),
      projectName: targetOrder.projectName,
      clientName: targetOrder.clientName,
      orderId: targetOrder.id,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = [...workbenchJobs, newJob];
    onUpdateJobs(next);
    setSelectedJobId(newJob.id);
    setOrderToAppendId('');
    onNotify(`Pedido "${targetOrder.projectName}" combinado en la misma plancha.`);
  };

  const handleAutoArrangeAll = () => {
    const arranged = autoArrangeWorkbenchJobs(workbenchJobs, workbenchConfig, 4);
    onUpdateJobs(arranged);
    onNotify('Trabajos acomodados automáticamente dentro de la plancha sin superposiciones.');
  };

  const handleDuplicateSelectedJob = () => {
    if (!selectedJob) return;
    const copy: WorkbenchJobItem = {
      ...structuredClone(selectedJob),
      id: `wb-job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${selectedJob.name} (Copia)`,
      xMm: roundMm(Math.min(workbenchConfig.machineBedWidthMm - selectedJob.widthMm, selectedJob.xMm + selectedJob.widthMm + 4)),
      yMm: selectedJob.yMm,
    };
    const next = [...workbenchJobs, copy];
    onUpdateJobs(next);
    setSelectedJobId(copy.id);
    onNotify(`Trabajo "${selectedJob.name}" duplicado en la plancha.`);
  };

  const handleDeleteJob = (id: string) => {
    const next = workbenchJobs.filter((j) => j.id !== id);
    onUpdateJobs(next);
    if (selectedJobId === id) {
      setSelectedJobId(next[0]?.id ?? null);
    }
  };

  const handleUpdateSelectedJob = (patch: Partial<WorkbenchJobItem>) => {
    if (!selectedJob) return;
    const next = workbenchJobs.map((j) =>
      j.id === selectedJob.id ? { ...j, ...patch } : j
    );
    onUpdateJobs(next);
  };

  const handleUpdateSelectedJobGrid = (updates: {
    columns?: number;
    rows?: number;
    gapXMm?: number;
    gapYMm?: number;
    blockRotationDeg?: 0 | 90;
    pieceCount?: number;
  }) => {
    if (!selectedJob) return;
    const rebuilt = updateWorkbenchJobGrid(selectedJob, updates);
    onUpdateJobs(workbenchJobs.map((j) => (j.id === selectedJob.id ? rebuilt : j)));
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
    const nextX = roundMm(Math.max(0, Math.min(workbenchConfig.machineBedWidthMm - 5, drag.initialJobX + dx)), 1);
    const nextY = roundMm(Math.max(0, Math.min(workbenchConfig.machineBedHeightMm - 5, drag.initialJobY + dy)), 1);

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
      setRuidaStatusMsg({
        type: 'error',
        text: 'Confirmá la lista de verificación de seguridad antes de enviar el trabajo a la Vank 9060.',
      });
      return;
    }

    try {
      const compiled = compileWorkbenchToRuidaRd(workbenchJobs, workbenchConfig);
      const udpPackets = buildRuidaUdpPackets(compiled.rdBytes);

      if (!isTauri()) {
        // En navegador web descargamos el archivo .RD compilado directamente
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
          text: `Archivo binario Ruida "${compiled.filenameSuggested}" (${compiled.rdBytes.length} bytes) generado y descargado. Para envío directo por red UDP usá la app nativa macOS.`,
        });
        return;
      }

      setIsSendingToRuida(true);
      const packetArrays = udpPackets.map((pkt) => Array.from(pkt));
      const response = await invoke<{
        success: boolean;
        packets_sent: number;
        bytes_sent: number;
        remote_endpoint: string;
        message: string;
      }>('upload_rd_to_ruida', {
        ip: workbenchConfig.ruidaIpAddress,
        port: workbenchConfig.ruidaPort,
        packets: packetArrays,
      });

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
    }
  };

  const handleDownloadRdFile = () => {
    setRuidaStatusMsg(null);
    try {
      const compiled = compileWorkbenchToRuidaRd(workbenchJobs, workbenchConfig);
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

  // Calcular ViewBox del SVG según la vista de cámara
  let vbMinX = -28;
  let vbMinY = -28;
  let vbWidth = workbenchConfig.machineBedWidthMm + 48;
  let vbHeight = workbenchConfig.machineBedHeightMm + 48;

  if (cameraView === 'sheet') {
    const pad = Math.max(
      22,
      Math.max(workbenchConfig.sheetWidthMm, workbenchConfig.sheetHeightMm) * 0.06
    );
    vbMinX = workbenchConfig.sheetOffsetXMm - pad;
    vbMinY = workbenchConfig.sheetOffsetYMm - pad;
    vbWidth = workbenchConfig.sheetWidthMm + pad * 2;
    vbHeight = workbenchConfig.sheetHeightMm + pad * 2;
  } else if (cameraView === 'occupied' && validation.occupiedBoundsMm) {
    const ob = validation.occupiedBoundsMm;
    const pad = Math.max(15, Math.max(ob.width, ob.height) * 0.1);
    vbMinX = ob.minX - pad;
    vbMinY = ob.minY - pad;
    vbWidth = ob.width + pad * 2;
    vbHeight = ob.height + pad * 2;
  }

  // Coordenadas visuales de la esquina de Home de la máquina Ruida
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
      className="fixed inset-0 z-50 bg-[#070a0e]/95 backdrop-blur-sm flex flex-col text-slate-100 select-none"
    >
      {/* 1. CABECERA SUPERIOR ESTILO LIGHTBURN */}
      <header className="h-14 bg-[#11161f] border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">
                Mesa de Trabajo y Plancha — Vank 9060 CO₂
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Ruida RDC8445S · 900×600 mm
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Armá la plancha, configurá las capas C00/C01/C02 y cargá el trabajo directo a la Vank o a LightBurn
            </p>
          </div>
        </div>

        {/* Botonera rápida de inserción en plancha */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddActiveBatch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow transition-colors"
            title="Enviar la tanda actual del asistente a la plancha"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Mandar Tanda Actual ({nesting.batches[activeBatchIndex]?.count ?? 0} u.)</span>
          </button>

          <button
            type="button"
            onClick={handleAddSinglePiece}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
            title="Enviar 1 etiqueta suelta para acomodar en recorte"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            <span>+ 1 Etiqueta Suelta</span>
          </button>

          <button
            type="button"
            onClick={handleAutoArrangeAll}
            disabled={workbenchJobs.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 text-xs font-semibold disabled:opacity-40 transition-colors"
            title="Acomodar todos los trabajos automáticamente en la plancha"
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Acomodar en Plancha</span>
          </button>

          <div className="h-5 w-px bg-slate-800 mx-1" />

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700"
          >
            <X className="w-3.5 h-3.5" />
            <span>Volver al Editor</span>
          </button>
        </div>
      </header>

      {/* 2. CUERPO PRINCIPAL: LIENZO 900x600 MM + DOCKS LATERALES ESTILO LIGHTBURN */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ÁREA IZQUIERDA/CENTRAL: MESA DE TRABAJO Y SIMULADOR */}
        <div className="flex-1 flex flex-col bg-[#080b10] relative min-w-0">
          {/* Sub-barra de vista de cámara y reproductor de simulación */}
          <div className="h-11 bg-[#0e131b] border-b border-slate-800/90 px-4 flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">
                Cámara:
              </span>
              <button
                type="button"
                onClick={() => setCameraView('sheet')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  cameraView === 'sheet'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Plancha ({workbenchConfig.sheetWidthMm}×{workbenchConfig.sheetHeightMm} mm)
              </button>
              <button
                type="button"
                onClick={() => setCameraView('machine')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  cameraView === 'machine'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Mesa Vank 9060 (900×600 mm)
              </button>
              <button
                type="button"
                onClick={() => setCameraView('occupied')}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  cameraView === 'occupied'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Enfocar Lote
              </button>
            </div>

            {/* Controles del Simulador de Recorrido (Preview LightBurn) */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const next = !showSimulation;
                  setShowSimulation(next);
                  if (!next) setIsPlayingSim(false);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-semibold border transition ${
                  showSimulation
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Simulador de Trayectoria</span>
              </button>

              {showSimulation && (
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      if (simProgress >= 100) setSimProgress(0);
                      setIsPlayingSim(!isPlayingSim);
                    }}
                    className="p-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white"
                    title={isPlayingSim ? 'Pausar simulación' : 'Reproducir recorrido del cabezal'}
                  >
                    {isPlayingSim ? (
                      <Pause className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
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
                    className="w-28 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-cyan-300 w-10 text-right">
                    {Math.round(simProgress)}%
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 font-mono text-[11px] bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded">
                <span className="text-slate-400">Tiempo est.:</span>
                <span className="text-emerald-400 font-bold">
                  {formatDuration(simulation.totalDurationSec)}
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-cyan-300 font-bold">
                  {validation.totalPieces} u.
                </span>
              </div>
            </div>
          </div>

          {/* LIENZO INTERACTIVO SVG DE LA MESA 900x600 MM */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center p-3">
            <svg
              ref={svgRef}
              viewBox={`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}
              className="w-full h-full max-h-full select-none"
              style={{ background: '#06080c' }}
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
                    stroke="#1e293b"
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
                    stroke="#334155"
                    strokeWidth="0.45"
                  />
                </pattern>
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

              {/* 2. PLANCHA DE MATERIAL COLOCADA SOBRE LA MESA */}
              <g id="workbench-material-sheet">
                <rect
                  x={workbenchConfig.sheetOffsetXMm}
                  y={workbenchConfig.sheetOffsetYMm}
                  width={workbenchConfig.sheetWidthMm}
                  height={workbenchConfig.sheetHeightMm}
                  fill={material.visual.surfaceColor}
                  fillOpacity={0.22}
                  stroke="#38bdf8"
                  strokeWidth="0.9"
                />
                {/* Margen seguro interior de la plancha */}
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
                <text
                  x={workbenchConfig.sheetOffsetXMm + 4}
                  y={workbenchConfig.sheetOffsetYMm + workbenchConfig.sheetHeightMm - 3}
                  fill="#38bdf8"
                  fontSize="4.8"
                  fontFamily="monospace"
                  opacity={0.85}
                >
                  PLANCHA: {material.name} ({workbenchConfig.sheetWidthMm}×
                  {workbenchConfig.sheetHeightMm} mm)
                </text>
              </g>

              {/* 3. TRABAJOS POSICIONADOS EN LA PLANCHA */}
              {workbenchJobs
                .filter((j) => j.visible)
                .map((job) => {
                  const isSelected = selectedJob?.id === job.id;
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
                      {/* Caja envolvente interactiva del lote/trabajo */}
                      <rect
                        x={-1}
                        y={-1}
                        width={job.widthMm + 2}
                        height={job.heightMm + 2}
                        fill={
                          isOutSheet
                            ? 'rgba(239, 68, 68, 0.14)'
                            : isSelected
                              ? 'rgba(6, 182, 212, 0.10)'
                              : 'rgba(15, 23, 42, 0.05)'
                        }
                        stroke={
                          isOutSheet
                            ? '#ef4444'
                            : isSelected
                              ? '#22d3ee'
                              : '#64748b'
                        }
                        strokeWidth={isSelected ? '0.8' : '0.4'}
                        strokeDasharray={isSelected ? undefined : '2 1.5'}
                      />

                      {/* Etiqueta superior del bloque */}
                      <text
                        x={0}
                        y={-2.2}
                        fill={isOutSheet ? '#fca5a5' : isSelected ? '#67e8f9' : '#cbd5e1'}
                        fontSize="4.2"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {job.name} [{job.xMm}, {job.yMm} mm]
                      </text>

                      {/* Instancias de etiquetas dentro del trabajo */}
                      {job.instances.map((inst) => (
                        <g key={`${job.id}-inst-${inst.instanceIndex}`}>
                          {/* Fondo sutil de pieza */}
                          <rect
                            x={inst.localXMm}
                            y={inst.localYMm}
                            width={inst.widthMm}
                            height={inst.heightMm}
                            fill={material.visual.surfaceColor}
                            fillOpacity={0.65}
                          />

                          {/* CAPA C00: GRABADO */}
                          {(!engraveLayerCfg || engraveLayerCfg.visible) &&
                            inst.engraveItems.map((eng) => {
                              if (eng.kind === 'vector_path' && eng.svgPathD) {
                                return (
                                  <path
                                    key={eng.id}
                                    d={eng.svgPathD}
                                    fill={eng.filled ? '#111827' : 'none'}
                                    fillRule={eng.fillRule || 'evenodd'}
                                    stroke="#111827"
                                    strokeWidth={eng.filled ? 0.05 : eng.strokeWidthMm || 0.25}
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

                          {/* CAPA C01: ORIFICIOS INTERNOS */}
                          {(!holesLayerCfg || holesLayerCfg.visible) &&
                            inst.holeContours.map((hole) => (
                              <path
                                key={hole.id}
                                d={hole.svgPathD}
                                fill="#090c10"
                                stroke="#2563eb"
                                strokeWidth="0.35"
                              />
                            ))}

                          {/* CAPA C02: CORTE EXTERIOR */}
                          {(!cutLayerCfg || cutLayerCfg.visible) &&
                            inst.cutContour && (
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
                })}

              {/* 4. SUPERPOSICIÓN DEL SIMULADOR DE RECORRIDO LÁSER */}
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

                  {/* Cabezal Láser CO2 animado */}
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

              {/* 5. INDICADOR DE HOME DE MÁQUINA RUIDA (Círculo Rojo) */}
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

              {/* 6. INDICADOR DE ORIGEN DEL TRABAJO (Cuadrado Verde estilo LightBurn) */}
              <g
                transform={`translate(${validation.jobOriginPointMm.x}, ${validation.jobOriginPointMm.y})`}
                pointerEvents="none"
              >
                <rect
                  x={-2.8}
                  y={-2.8}
                  width={5.6}
                  height={5.6}
                  fill="#22c55e"
                  fillOpacity={0.85}
                  stroke="#ffffff"
                  strokeWidth="0.5"
                />
              </g>
            </svg>

            {/* Leyenda inferior flotante estilo LightBurn */}
            <div className="absolute bottom-3 left-4 bg-[#11161f]/90 border border-slate-800 rounded-lg px-3 py-1.5 flex items-center gap-4 text-[11px] text-slate-300 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block border border-white/60" />
                <span>
                  Origen del Trabajo ({validation.jobOriginPointMm.x},{' '}
                  {validation.jobOriginPointMm.y} mm)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                <span>Home Máquina ({workbenchConfig.machineOriginCorner})</span>
              </div>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">
                Arrastrá cualquier bloque con el mouse para acomodarlo en la plancha
              </span>
            </div>
          </div>
        </div>

        {/* PANEL LATERAL DERECHO: CORTES/CAPAS + PLANCHA + CONTROL VANK 9060 */}
        <aside className="w-[470px] bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-y-auto shrink-0 divide-y divide-slate-800">
          {/* SECCIÓN 1: CORTES / CAPAS (CUTS / LAYERS ESTILO LIGHTBURN) */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Cortes / Capas (Cuts / Layers)
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSyncFromMaterial}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
                  title="Cargar velocidades y potencias desde el perfil del material"
                >
                  Cargar de material
                </button>
                <button
                  type="button"
                  onClick={handleSaveLayersToMaterial}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-950/80 hover:bg-cyan-900 text-[10px] text-cyan-300 border border-cyan-800 font-semibold"
                  title="Guardar velocidades y potencias actuales en el perfil del material"
                >
                  <Save className="w-3 h-3" />
                  <span>Guardar en {material.code}</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {sortedLayers.map((layer, idx) => {
                const isMissingParams =
                  layer.outputEnabled &&
                  (layer.speedMmPerSec === null ||
                    layer.speedMmPerSec <= 0 ||
                    layer.maxPowerPercent === null ||
                    layer.maxPowerPercent <= 0);

                return (
                  <div
                    key={layer.cutIndex}
                    className={`p-2.5 rounded-lg border text-xs space-y-2 ${
                      isMissingParams
                        ? 'bg-amber-950/15 border-amber-600/50'
                        : 'bg-slate-900/90 border-slate-800'
                    }`}
                  >
                    {/* Fila superior de la capa: Color, Código, Modo, Orden, Aire, Salida, Ver */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded border border-white/30 shrink-0"
                          style={{ backgroundColor: layer.hexColor }}
                        />
                        <span className="font-mono font-bold text-white">
                          {layer.code}
                        </span>
                        <span className="font-semibold text-slate-200">
                          {layer.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`Modo de capa ${layer.code}`}
                          value={layer.mode}
                          onChange={(e) =>
                            handleUpdateLayer(layer.cutIndex, {
                              mode: e.target.value as LightBurnCutMode,
                            })
                          }
                          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-cyan-300 font-semibold"
                        >
                          <option value="fill">Fill (Relleno)</option>
                          <option value="line">Line (Corte)</option>
                          <option value="offset_fill">Offset Fill</option>
                        </select>

                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveLayerPriority(layer.cutIndex, 'up')}
                          title="Subir prioridad (ejecutar antes)"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === sortedLayers.length - 1}
                          onClick={() => handleMoveLayerPriority(layer.cutIndex, 'down')}
                          title="Bajar prioridad (ejecutar después)"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Controles numéricos de Velocidad, Potencia Máx/Mín, Pasadas e Intervalo */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <label className="block">
                        <span className="text-[10px] text-slate-400 block">
                          Vel. (mm/s)
                        </span>
                        <input
                          type="number"
                          min={0.1}
                          max={1000}
                          step={1}
                          aria-label={`Velocidad ${layer.code}`}
                          placeholder="Ej: 200"
                          value={layer.speedMmPerSec ?? ''}
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? null : Number(e.target.value);
                            handleUpdateLayer(layer.cutIndex, {
                              speedMmPerSec: val,
                            });
                          }}
                          className={`w-full bg-slate-950 border rounded px-2 py-1 text-xs font-mono ${
                            layer.speedMmPerSec === null || layer.speedMmPerSec <= 0
                              ? 'border-amber-500/80 text-amber-200'
                              : 'border-slate-700 text-white'
                          }`}
                        />
                      </label>

                      <label className="block">
                        <span className="text-[10px] text-slate-400 block">
                          Pot. Máx (%)
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={0.5}
                          aria-label={`Potencia máxima ${layer.code}`}
                          placeholder="Ej: 25"
                          value={layer.maxPowerPercent ?? ''}
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? null : Number(e.target.value);
                            handleUpdateLayer(layer.cutIndex, {
                              maxPowerPercent: val,
                              minPowerPercent:
                                layer.minPowerPercent === null && val !== null
                                  ? val
                                  : layer.minPowerPercent,
                            });
                          }}
                          className={`w-full bg-slate-950 border rounded px-2 py-1 text-xs font-mono ${
                            layer.maxPowerPercent === null || layer.maxPowerPercent <= 0
                              ? 'border-amber-500/80 text-amber-200'
                              : 'border-slate-700 text-white'
                          }`}
                        />
                      </label>

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
                          placeholder="Esquinas"
                          value={layer.minPowerPercent ?? ''}
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? null : Number(e.target.value);
                            handleUpdateLayer(layer.cutIndex, {
                              minPowerPercent: val,
                            });
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
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
                          step={1}
                          aria-label={`Pasadas ${layer.code}`}
                          value={layer.passes}
                          onChange={(e) =>
                            handleUpdateLayer(layer.cutIndex, {
                              passes: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
                        />
                      </label>
                    </div>

                    {/* Fila inferior de switches: Intervalo (si es Fill), Air Assist, Salida, Mostrar */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                      {layer.mode !== 'line' ? (
                        <label className="flex items-center gap-1.5 text-slate-300">
                          <span>Intervalo:</span>
                          <select
                            value={layer.lineIntervalMm}
                            onChange={(e) =>
                              handleUpdateLayer(layer.cutIndex, {
                                lineIntervalMm: Number(e.target.value),
                              })
                            }
                            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[10px] text-cyan-300"
                          >
                            <option value={0.08}>0.08 mm (318 DPI)</option>
                            <option value={0.1}>0.10 mm (254 DPI)</option>
                            <option value={0.125}>0.125 mm (203 DPI)</option>
                            <option value={0.15}>0.15 mm (169 DPI)</option>
                          </select>
                        </label>
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          Vector continuo 1:1
                        </span>
                      )}

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1 cursor-pointer text-slate-300">
                          <input
                            type="checkbox"
                            checked={layer.airAssist}
                            onChange={(e) =>
                              handleUpdateLayer(layer.cutIndex, {
                                airAssist: e.target.checked,
                              })
                            }
                            className="accent-cyan-500"
                          />
                          <Wind className="w-3 h-3 text-cyan-400" />
                          <span>Aire</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer text-slate-300">
                          <input
                            type="checkbox"
                            checked={layer.outputEnabled}
                            onChange={(e) =>
                              handleUpdateLayer(layer.cutIndex, {
                                outputEnabled: e.target.checked,
                              })
                            }
                            className="accent-emerald-500"
                          />
                          <span>Salida</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer text-slate-300">
                          <input
                            type="checkbox"
                            checked={layer.visible}
                            onChange={(e) =>
                              handleUpdateLayer(layer.cutIndex, {
                                visible: e.target.checked,
                              })
                            }
                            className="accent-cyan-500"
                          />
                          <span>Ver</span>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECCIÓN 2: PLANCHA Y TRABAJOS EN MESA */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Grid className="w-4 h-4 text-cyan-400" />
                <span>Plancha y Trabajos ({workbenchJobs.length})</span>
              </h3>
              {/* Selector para combinar otro pedido guardado en la misma plancha */}
              <select
                aria-label="Combinar otro pedido en la plancha"
                value={orderToAppendId}
                onChange={(e) => handleAddFromCatalogOrder(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-cyan-300"
              >
                <option value="">+ Combinar otro pedido en plancha...</option>
                {ordersCatalog.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    {ord.projectName} ({ord.labelDesign.widthMm}×{ord.labelDesign.heightMm} mm)
                  </option>
                ))}
              </select>
            </div>

            {/* Medidas de la plancha colocada en la Vank 9060 */}
            <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">
                  Recorte / Plancha en Mesa (mm)
                </span>
                <select
                  aria-label="Presets de plancha"
                  value=""
                  onChange={(e) => {
                    const preset = MATERIAL_SHEET_PRESETS.find(
                      (p) => p.label === e.target.value
                    );
                    if (preset) {
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetWidthMm: preset.widthMm,
                        sheetHeightMm: preset.heightMm,
                      });
                    }
                  }}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
                >
                  <option value="">Formatos rápidos...</option>
                  {MATERIAL_SHEET_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-xs">
                <label>
                  <span className="text-[10px] text-slate-400 block">Ancho Plancha</span>
                  <input
                    type="number"
                    min={10}
                    max={900}
                    value={workbenchConfig.sheetWidthMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetWidthMm: Math.max(10, Math.min(900, Number(e.target.value) || 100)),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">Alto Plancha</span>
                  <input
                    type="number"
                    min={10}
                    max={600}
                    value={workbenchConfig.sheetHeightMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetHeightMm: Math.max(10, Math.min(600, Number(e.target.value) || 100)),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">Posición X</span>
                  <input
                    type="number"
                    min={0}
                    max={890}
                    value={workbenchConfig.sheetOffsetXMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetOffsetXMm: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">Posición Y</span>
                  <input
                    type="number"
                    min={0}
                    max={590}
                    value={workbenchConfig.sheetOffsetYMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetOffsetYMm: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
              </div>
            </div>

            {/* Lista e Inspector del Trabajo Seleccionado en la Plancha */}
            {workbenchJobs.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {workbenchJobs.map((job) => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`px-2.5 py-1.5 rounded border text-xs flex items-center justify-between cursor-pointer transition ${
                        selectedJob?.id === job.id
                          ? 'bg-cyan-950/50 border-cyan-500/60 text-white'
                          : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="truncate">
                        <span className="font-semibold">{job.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono ml-2">
                          X:{job.xMm} Y:{job.yMm} mm ({job.widthMm}×{job.heightMm} mm)
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteJob(job.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-400"
                          title="Quitar de la plancha"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedJob && (
                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-300 truncate">
                        Ajustar: {selectedJob.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSelectedJobGrid({
                              blockRotationDeg:
                                selectedJob.blockRotationDeg === 90 ? 0 : 90,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 flex items-center gap-1"
                        >
                          <RotateCw className="w-3 h-3 text-cyan-400" />
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

                    <div className="grid grid-cols-4 gap-1.5">
                      <label>
                        <span className="text-[10px] text-slate-400 block">X (mm)</span>
                        <input
                          type="number"
                          step={0.5}
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
                        <span className="text-[10px] text-slate-400 block">Y (mm)</span>
                        <input
                          type="number"
                          step={0.5}
                          value={selectedJob.yMm}
                          onChange={(e) =>
                            handleUpdateSelectedJob({
                              yMm: roundMm(Number(e.target.value) || 0),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-400 block">Columnas</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={selectedJob.columns}
                          onChange={(e) =>
                            handleUpdateSelectedJobGrid({
                              columns: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label>
                        <span className="text-[10px] text-slate-400 block">Filas</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={selectedJob.rows}
                          onChange={(e) =>
                            handleUpdateSelectedJobGrid({
                              rows: Math.max(1, Number(e.target.value) || 1),
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
          </div>

          {/* SECCIÓN 3: PANEL LÁSER Y CARGA DIRECTA A VANK 9060 (RUIDA RDC8445S) */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald-400" />
                <span>Control Láser — Vank 9060 (Ruida)</span>
              </h3>
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
                  ? '✓ Listo para Vank 9060'
                  : validation.isValidForExport
                    ? 'Falta vel/potencia Ruida'
                    : 'Revisar geometría'}
              </span>
            </div>

            {/* Configuración de Origen y Start From (Idéntico a LightBurn) */}
            <div className="grid grid-cols-2 gap-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] text-slate-400 block mb-1">
                    Comenzar desde (Start From)
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
                    <option value="user_origin">Origen de Usuario (Ruida Origin)</option>
                    <option value="current_position">Posición Actual del Cabezal</option>
                    <option value="absolute_coords">Coordenadas Absolutas (Mesa)</option>
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
                        machineOriginCorner: e.target.value as MachineOriginCorner,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                  >
                    <option value="top_right">Superior Derecha (Estándar Ruida)</option>
                    <option value="top_left">Superior Izquierda</option>
                    <option value="bottom_left">Inferior Izquierda</option>
                    <option value="bottom_right">Inferior Derecha</option>
                  </select>
                </label>
              </div>

              {/* Grilla de 9 puntos de Origen del Trabajo (Job Origin) */}
              <div className="flex flex-col items-center justify-center">
                <span className="text-[10px] text-slate-400 mb-1.5">
                  Origen del Trabajo (Job Origin)
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800">
                  {JOB_ORIGIN_ANCHORS.map((anchor) => {
                    const active = workbenchConfig.jobOriginAnchor === anchor.id;
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
                        className={`w-5 h-5 rounded flex items-center justify-center border transition ${
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

            {/* Parámetros de Conexión de Red UDP Ruida RDC8445S */}
            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
              <label className="col-span-1">
                <span className="text-[10px] text-slate-400 block">
                  IP Vank 9060 (LAN)
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
                  placeholder="192.168.1.100"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-cyan-300"
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
                  Nombre en Pantalla
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
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-emerald-300 uppercase"
                />
              </label>
            </div>

            {/* Avisos de validación geométrica o de parámetros de capa */}
            {validation.issues.length > 0 && (
              <div className="space-y-1 max-h-28 overflow-y-auto">
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

            {/* Confirmación de seguridad pre-envío */}
            <label className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={safetyConfirmed}
                onChange={(e) => setSafetyConfirmed(e.target.checked)}
                className="mt-0.5 accent-emerald-500"
              />
              <span>
                <strong>Verificación de operador:</strong> Confirmo material libre de PVC, foco y altura Z ajustados, chiller/extracción encendidos y parámetros de velocidad/potencia validados.
              </span>
            </label>

            {ruidaStatusMsg && (
              <div
                role="alert"
                className={`p-2.5 rounded-lg border text-xs ${
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

            {/* Botones de Acción Principal hacia la Vank 9060 y LightBurn */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={!validation.isValidForMachineSend || isSendingToRuida}
                onClick={() => void handleSendToVankRuida()}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition"
              >
                <Send className="w-4 h-4" />
                <span>
                  {isSendingToRuida
                    ? 'Enviando a Ruida RDC8445S...'
                    : `Cargar Trabajo en Memoria Vank 9060 (${workbenchConfig.ruidaIpAddress})`}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2">
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
                  onClick={handleDownloadRdFile}
                  className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                  title="Descargar archivo binario .RD para pendrive USB en puerto U-Disk de la Ruida"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar .RD (USB)</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
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
                  <span>Exportar Plancha (.SVG)</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
