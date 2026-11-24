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
  FileCode2,
  Grid,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCw,
  Ruler,
  Save,
  Send,
  Sparkles,
  Target,
  Trash2,
  Upload,
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
import {
  exportWorkbenchToLbrn2,
  exportWorkbenchToSvg,
} from '../core/workbench/lbrn2Exporter';
import {
  buildRuidaUdpPackets,
  compileWorkbenchToRuidaRd,
} from '../core/workbench/ruidaCompiler';
import {
  applyExtremeMaterialSavingToWorkbench,
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  computeEcocueroRollMetrics,
  createWorkbenchJobFromOrder,
  createWorkbenchJobFromUploadedLogo,
  fillLastRowFreeSlotsInWorkbench,
  simulateWorkbenchToolpath,
  syncLayersWithMaterialProfile,
  updateWorkbenchJobDesignAndQuantity,
  validateWorkbenchState,
} from '../core/workbench/workbenchEngine';
import {
  ECOCUERO_BED_PASS_HEIGHT_MM,
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
  isEcocueroMaterial,
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
  const [simProgress, setSimProgress] = useState<number>(100);
  const [safetyConfirmed, setSafetyConfirmed] = useState<boolean>(false);
  const [isSendingToRuida, setIsSendingToRuida] = useState<boolean>(false);
  const [isUploadingLogos, setIsUploadingLogos] = useState<boolean>(false);
  const [ruidaStatusMsg, setRuidaStatusMsg] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [orderToAppendId, setOrderToAppendId] = useState<string>('');

  const multiLogoInputRef = useRef<HTMLInputElement | null>(null);
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

  const validation = useMemo(
    () => validateWorkbenchState(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

  const simulation = useMemo(
    () => simulateWorkbenchToolpath(workbenchJobs, workbenchConfig),
    [workbenchJobs, workbenchConfig]
  );

  const rollMetrics = useMemo(
    () => computeEcocueroRollMetrics(workbenchJobs, workbenchConfig),
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

  // Activar medida real del Rollo Ecocuero 73 cm x 5 m y optimizar tirada
  const handleApplyEcocueroRoll73cm = () => {
    const nextCfg: WorkbenchConfig = {
      ...workbenchConfig,
      sheetWidthMm: ECOCUERO_ROLL_WIDTH_MM,
      sheetHeightMm: ECOCUERO_BED_PASS_HEIGHT_MM,
      isRollMaterial: true,
      rollTotalLengthMm: ECOCUERO_ROLL_TOTAL_LENGTH_MM,
    };
    onUpdateConfig(nextCfg);
    const arranged = autoArrangeWorkbenchJobs(workbenchJobs, nextCfg, 4, true);
    onUpdateJobs(arranged);
    onNotify(
      'Rollo de Ecocuero 73 cm × 5 m (730 × 600 mm en mesa) aplicado y trabajos optimizados a todo el ancho.'
    );
  };

  // Subir múltiples archivos de logo (PNG, JPG, SVG) a la vez para combinarlos en la misma tirada
  const handleMultiLogoFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    e.target.value = '';

    setIsUploadingLogos(true);
    try {
      let currentList = [...workbenchJobs];
      let lastCreatedId: string | null = null;
      let addedCount = 0;

      for (const file of fileArray) {
        const cleanName = file.name.replace(/\.[^.]+$/, '');
        const isSvg =
          file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

        if (isSvg) {
          const svgText = await file.text();
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
            config: workbenchConfig,
          });
          currentList.push(newJob);
          lastCreatedId = newJob.id;
          addedCount++;
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
            config: workbenchConfig,
          });
          currentList.push(newJob);
          lastCreatedId = newJob.id;
          addedCount++;
        }
      }

      // Acomodar todos los trabajos automáticamente aprovechando el ancho (73 cm si es rollo)
      const arranged = autoArrangeWorkbenchJobs(
        currentList,
        workbenchConfig,
        4,
        workbenchConfig.isRollMaterial || isEco
      );
      onUpdateJobs(arranged);
      if (lastCreatedId) setSelectedJobId(lastCreatedId);
      onNotify(
        `${addedCount} trabajo(s) con logos distintos cargados y acomodados en la misma tirada.`
      );
    } catch (err) {
      onNotify(
        `Error al procesar logos para la tirada: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setIsUploadingLogos(false);
    }
  };

  // Acciones de agregar trabajos a la plancha
  const handleAddActiveBatch = () => {
    const newJob = createWorkbenchJobFromOrder({
      design,
      nesting,
      batchIndex: activeBatchIndex,
      mode: workbenchConfig.isRollMaterial || isEco ? 'roll_strip' : 'active_batch',
      projectName,
      clientName,
      orderId: activeOrderId,
      existingJobs: workbenchJobs,
      config: workbenchConfig,
    });
    const next = autoArrangeWorkbenchJobs(
      [...workbenchJobs, newJob],
      workbenchConfig,
      4,
      workbenchConfig.isRollMaterial || isEco
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
      4,
      workbenchConfig.isRollMaterial || isEco
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
      workbenchConfig.savingPreset === 'extreme_zero_waste' ? 1.5 : 4,
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
    onNotify(
      '🔥 Ahorro Extremo activado: Flujo continuo pieza a pieza sin huecos entre logos, margen 2 mm, separación 0.5 mm y rotación óptima.'
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
    const copy: WorkbenchJobItem = {
      ...structuredClone(selectedJob),
      id: `wb-job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${selectedJob.name.replace(/\s*\(\d+\s*u\.\)$/, '')} Copia (${selectedJob.pieceCount} u.)`,
    };
    const next = autoArrangeWorkbenchJobs(
      [...workbenchJobs, copy],
      workbenchConfig,
      4,
      false
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
    // Si cambió la cantidad o las medidas de etiqueta, reacomodar automáticamente la tirada para que no colisionen
    if (
      updates.pieceCount !== undefined ||
      updates.widthMm !== undefined ||
      updates.heightMm !== undefined ||
      updates.autoFitColumnsToRoll
    ) {
      onUpdateJobs(autoArrangeWorkbenchJobs(updatedList, workbenchConfig, 4, false));
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
      {/* Input oculto para subir múltiples logos a la vez */}
      <input
        ref={multiLogoInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.svg"
        aria-label="Subir varios logos a la tirada"
        onChange={handleMultiLogoFilesSelected}
        className="hidden"
      />

      {/* 1. CABECERA SUPERIOR ESTILO LIGHTBURN */}
      <header className="min-h-14 py-2 bg-[#11161f] border-b border-slate-800 px-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-white truncate">
                Mesa de Trabajo y Tirada Multi-Logo — Vank 9060 CO₂
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-amber-950/90 text-amber-300 border border-amber-700/80 shrink-0">
                {workbenchConfig.sheetWidthMm === 730
                  ? 'Rollo Ecocuero 73 cm × 5 m'
                  : `Plancha ${workbenchConfig.sheetWidthMm}×${workbenchConfig.sheetHeightMm} mm`}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate hidden sm:block">
              Combiná varios logos, medidas y cantidades en la misma tirada de 73 cm y cargalo directo a la Vank 9060
            </p>
          </div>
        </div>

        {/* Botonera rápida de inserción multi-trabajo en plancha */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isUploadingLogos}
            onClick={() => multiLogoInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition-colors whitespace-nowrap"
            title="Seleccionar varios archivos de logos (PNG, JPG o SVG) para combinarlos en la misma tirada"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isUploadingLogos
                ? 'Cargando logos...'
                : '+ Subir Varios Logos a la Tirada'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleAddActiveBatch}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow transition-colors whitespace-nowrap"
            title="Agregar el diseño actual del editor a la tirada"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>+ Sumar Diseño Actual</span>
          </button>

          <button
            type="button"
            onClick={handleApplyExtremeSaving}
            disabled={workbenchJobs.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-extrabold disabled:opacity-40 shadow transition-colors whitespace-nowrap"
            title="Activar Ahorro Extremo: Flujo continuo sin huecos entre logos, margen 2 mm, separación 0.5 mm y rotación óptima"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>🔥 Ahorro Extremo {roundMm(workbenchConfig.sheetWidthMm / 10, 1)} cm</span>
          </button>

          {rollMetrics.freeSlotsInLastRow > 0 && (
            <button
              type="button"
              onClick={handleFillLastRowFreeSlots}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/70 text-emerald-300 text-xs font-bold transition-colors whitespace-nowrap"
              title="Rellenar los lugares vacíos de la última fila sin gastar ni 1 mm adicional de rollo"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Completar Fila (+{rollMetrics.freeSlotsInLastRow} u. gratis)</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span>Volver</span>
          </button>
        </div>
      </header>

      {/* 2. CUERPO PRINCIPAL: LIENZO 900x600 MM + DOCKS LATERALES ESTILO LIGHTBURN */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ÁREA IZQUIERDA/CENTRAL: MESA DE TRABAJO Y SIMULADOR */}
        <div className="flex-1 flex flex-col bg-[#080b10] relative min-w-0 overflow-hidden">
          {/* Sub-barra de vista de cámara y reproductor de simulación */}
          <div className="min-h-10 py-1.5 bg-[#0e131b] border-b border-slate-800/90 px-3 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-0.5">
                Vista:
              </span>
              <button
                type="button"
                onClick={() => setCameraView('sheet')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition whitespace-nowrap ${
                  cameraView === 'sheet'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Rollo/Plancha ({workbenchConfig.sheetWidthMm}×{workbenchConfig.sheetHeightMm} mm)
              </button>
              <button
                type="button"
                onClick={() => setCameraView('machine')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition whitespace-nowrap ${
                  cameraView === 'machine'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Mesa Vank 900×600
              </button>
              <button
                type="button"
                onClick={() => setCameraView('occupied')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition whitespace-nowrap ${
                  cameraView === 'occupied'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Enfocar Tirada
              </button>
            </div>

            {/* Controles del Simulador de Recorrido (Preview LightBurn) */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = !showSimulation;
                  setShowSimulation(next);
                  if (!next) setIsPlayingSim(false);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition whitespace-nowrap ${
                  showSimulation
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Simulador</span>
              </button>

              {showSimulation && (
                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg">
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
                    className="w-20 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-[10px] text-cyan-300 w-8 text-right">
                    {Math.round(simProgress)}%
                  </span>
                </div>
              )}

              <div className="flex items-center gap-1.5 font-mono text-[11px] bg-slate-900/90 border border-slate-800 px-2 py-1 rounded whitespace-nowrap">
                <span className="text-amber-300 font-bold">
                  {validation.totalJobs} logo(s)
                </span>
                <span className="text-slate-600">·</span>
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
                {/* Símbolos maestros en (0,0) por trabajo para renderizado instantáneo (<use>) */}
                {workbenchJobs
                  .filter((j) => j.visible)
                  .map((job, jobIndex) => {
                    const isSelected = selectedJob?.id === job.id;
                    const jobColors = ['#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#f472b6'];
                    const jobAccentColor = jobColors[jobIndex % jobColors.length];
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
                          fill={material.visual.surfaceColor}
                          fillOpacity={0.68}
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
                        {(!holesLayerCfg || holesLayerCfg.visible) &&
                          master.holeContours.map((hole) => (
                            <path
                              key={hole.id}
                              d={hole.svgPathD}
                              fill="#090c10"
                              stroke="#2563eb"
                              strokeWidth="0.35"
                            />
                          ))}
                        {(!cutLayerCfg || cutLayerCfg.visible) &&
                          master.outerCutContour && (
                            <path
                              d={master.outerCutContour.svgPathD}
                              fill="none"
                              stroke="#ef4444"
                              strokeWidth="0.45"
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
                  fillOpacity={0.22}
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
                        y1={workbenchConfig.sheetOffsetYMm + rollMetrics.usedLengthMm}
                        x2={
                          workbenchConfig.sheetOffsetXMm +
                          workbenchConfig.sheetWidthMm
                        }
                        y2={workbenchConfig.sheetOffsetYMm + rollMetrics.usedLengthMm}
                        stroke="#10b981"
                        strokeWidth="0.7"
                        strokeDasharray="4 2"
                      />
                      <text
                        x={
                          workbenchConfig.sheetOffsetXMm +
                          workbenchConfig.sheetWidthMm -
                          4
                        }
                        y={
                          workbenchConfig.sheetOffsetYMm +
                          rollMetrics.usedLengthMm +
                          5
                        }
                        textAnchor="end"
                        fill="#34d399"
                        fontSize="4.6"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        ▲ AVANCE DE ROLLO EN ESTA TIRADA: {rollMetrics.usedLengthCm} cm ({rollMetrics.usedLengthMm} mm) · Restan {rollMetrics.remainingRollLengthCm} cm de 5 m
                      </text>
                    </g>
                  )}

                <text
                  x={workbenchConfig.sheetOffsetXMm + 4}
                  y={workbenchConfig.sheetOffsetYMm + workbenchConfig.sheetHeightMm - 3}
                  fill="#38bdf8"
                  fontSize="4.8"
                  fontFamily="monospace"
                  opacity={0.85}
                >
                  {workbenchConfig.sheetWidthMm === 730
                    ? `ROLLO ECOCUERO 73 CM × 5 M (Tirada activa en mesa: 730×${workbenchConfig.sheetHeightMm} mm)`
                    : `PLANCHA: ${material.name} (${workbenchConfig.sheetWidthMm}×${workbenchConfig.sheetHeightMm} mm)`}
                </text>
              </g>

              {/* 3. TRABAJOS POSICIONADOS EN LA PLANCHA / ROLLO */}
              {workbenchJobs
                .filter((j) => j.visible)
                .map((job, jobIndex) => {
                  const isSelected = selectedJob?.id === job.id;
                  const jobColors = ['#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#f472b6'];
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

                      {job.instances.map((inst) => (
                        <use
                          key={`${job.id}-inst-${inst.instanceIndex}`}
                          href={`#wb-master-${job.id}`}
                          x={inst.localXMm}
                          y={inst.localYMm}
                        />
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
            <div className="absolute bottom-3 left-4 bg-[#11161f]/90 border border-slate-800 rounded-lg px-3 py-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-300 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block border border-white/60" />
                <span>
                  Origen ({validation.jobOriginPointMm.x},{' '}
                  {validation.jobOriginPointMm.y} mm)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                <span>Home ({workbenchConfig.machineOriginCorner})</span>
              </div>
              <span className="text-slate-500">•</span>
              <span className="text-emerald-300 font-mono">
                Avance tirada: {rollMetrics.usedLengthCm} cm de 500 cm (5 m)
              </span>
            </div>
          </div>
        </div>

        {/* PANEL LATERAL DERECHO: ROLLO 73CM + MULTI-TRABAJO + CAPAS + CONTROL VANK 9060 */}
        <aside className="w-[420px] xl:w-[475px] bg-[#0d1117] border-l border-slate-800 flex flex-col overflow-y-auto shrink-0 divide-y divide-slate-800">
          {/* SECCIÓN 1: ROLLO ECOCUERO 73 CM × 5 M Y TIRADA MULTI-TRABAJO */}
          <div className="p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Ruler className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Rollo Ecocuero 73 cm × 5 m · Trabajos ({workbenchJobs.length})
                </span>
              </h3>
              {workbenchConfig.sheetWidthMm !== 730 && (
                <button
                  type="button"
                  onClick={handleApplyEcocueroRoll73cm}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[10px] font-bold"
                >
                  Usar Rollo Ecocuero 73 cm
                </button>
              )}
            </div>

            {/* Tarjeta de Consumo Real del Rollo de Ecocuero (73 cm x 5 m) */}
            <div className="p-2.5 rounded-lg bg-gradient-to-br from-amber-950/30 to-slate-900 border border-amber-700/40 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-300">
                  Rollo Ecocuero: {rollMetrics.rollWidthCm} cm ancho × 5 m (500 cm)
                </span>
                <div className="flex items-center gap-1">
                  {rollMetrics.savedRollLengthCm > 0 && (
                    <span className="text-[10px] font-mono bg-emerald-950 px-1.5 py-0.5 rounded text-emerald-300 border border-emerald-700 font-bold">
                      Ahorro: -{rollMetrics.savedRollLengthCm} cm
                    </span>
                  )}
                  <span className="text-[10px] font-mono bg-slate-950/80 px-1.5 py-0.5 rounded text-cyan-300 border border-slate-800">
                    Ancho: {rollMetrics.widthUtilizationPercent}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/70 p-2 rounded border border-slate-800/80">
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Avance en Tirada
                  </span>
                  <span className="font-mono font-bold text-emerald-400 text-xs">
                    {rollMetrics.usedLengthCm} cm
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono block">
                    ({rollMetrics.usedLengthMm} mm)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Restante de 5 m
                  </span>
                  <span className="font-mono font-bold text-cyan-300 text-xs">
                    {rollMetrics.remainingRollLengthCm} cm
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono block">
                    ({rollMetrics.remainingRollLengthMeters} m)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Rinde el Rollo 5m
                  </span>
                  <span className="font-mono font-bold text-amber-300 text-xs">
                    {rollMetrics.estimatedRunsPerRoll > 0
                      ? `~${rollMetrics.estimatedRunsPerRoll} tiradas`
                      : '—'}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono block">
                    ({rollMetrics.rollConsumptionPercent}% del rollo)
                  </span>
                </div>
              </div>

              {/* Aviso de Hueco Libre en la Última Fila (Etiquetas gratis sin gastar más rollo) */}
              {rollMetrics.freeSlotsInLastRow > 0 ? (
                <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-600/60 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-emerald-200 leading-tight">
                    <span className="font-bold text-emerald-300 block">
                      💡 Quedan {rollMetrics.freeSlotsInLastRow} lugares libres en la última fila
                    </span>
                    <span className="text-[10px] text-slate-300">
                      ({rollMetrics.freeWidthInLastRowCm} cm libres que ya entran en el corte del rollo)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFillLastRowFreeSlots}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] shrink-0 shadow"
                  >
                    + Completar (+{rollMetrics.freeSlotsInLastRow} u. gratis)
                  </button>
                </div>
              ) : (
                workbenchJobs.length > 0 && (
                  <div className="px-2 py-1 rounded bg-emerald-950/30 border border-emerald-800/50 text-[10px] text-emerald-300 flex items-center justify-between">
                    <span>✓ Última fila 100% completa de punta a punta (0 lugares vacíos)</span>
                    <span className="font-mono font-bold">
                      Eficiencia: {rollMetrics.stripAreaEfficiencyPercent}%
                    </span>
                  </div>
                )
              )}

              {/* Botones para subir varios trabajos y activar Ahorro Extremo Cero Desperdicio */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={isUploadingLogos}
                  onClick={() => multiLogoInputRef.current?.click()}
                  className="py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 shadow"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>+ Subir Varios Logos</span>
                </button>
                <button
                  type="button"
                  onClick={handleApplyExtremeSaving}
                  disabled={workbenchJobs.length === 0}
                  className="py-1.5 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-[11px] flex items-center justify-center gap-1.5 shadow"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>🔥 Ahorro Extremo 73 cm</span>
                </button>
              </div>

              {/* Combinar también desde biblioteca de pedidos guardados */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Combinar otro pedido en la plancha"
                  value={orderToAppendId}
                  onChange={(e) => handleAddFromCatalogOrder(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-cyan-300"
                >
                  <option value="">
                    + Sumar pedido guardado de la biblioteca (se intercala sin huecos)...
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

            {/* Lista de trabajos / logos en la tirada actual + Editor individual de medida y cantidad */}
            {workbenchJobs.length > 0 && (
              <div className="space-y-2">
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
                        <span className="font-mono text-[10px] text-amber-400 mr-1.5">
                          #{idx + 1}
                        </span>
                        <span className="font-semibold">{job.name}</span>
                        <span className="text-[10px] text-cyan-300 font-mono ml-2">
                          {job.labelDesign.widthMm}×{job.labelDesign.heightMm} mm
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono ml-1.5">
                          ({job.columns} col × {job.rows} fil)
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
                          value={selectedJob.labelDesign.widthMm}
                          onChange={(e) =>
                            handleUpdateSelectedJobDesignOrQty({
                              widthMm: Math.max(5, Number(e.target.value) || 10),
                              autoFitColumnsToRoll: true,
                            })
                          }
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
                          value={selectedJob.labelDesign.heightMm}
                          onChange={(e) =>
                            handleUpdateSelectedJobDesignOrQty({
                              heightMm: Math.max(5, Number(e.target.value) || 10),
                              autoFitColumnsToRoll: true,
                            })
                          }
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

            {/* Dimensiones de la Plancha o Rollo en Mesa */}
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
                      const nextCfg: WorkbenchConfig = {
                        ...workbenchConfig,
                        sheetWidthMm: preset.widthMm,
                        sheetHeightMm: preset.heightMm,
                        isRollMaterial: preset.widthMm === 730,
                      };
                      onUpdateConfig(nextCfg);
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
                    max={900}
                    value={workbenchConfig.sheetWidthMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetWidthMm: Math.max(
                          10,
                          Math.min(900, Number(e.target.value) || 100)
                        ),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  <span className="text-[10px] text-slate-400 block">
                    Tirada Mesa (mm)
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={600}
                    value={workbenchConfig.sheetHeightMm}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...workbenchConfig,
                        sheetHeightMm: Math.max(
                          10,
                          Math.min(600, Number(e.target.value) || 100)
                        ),
                      })
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

          {/* SECCIÓN 2: CORTES / CAPAS (CUTS / LAYERS ESTILO LIGHTBURN) */}
          <div className="p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Cortes / Capas
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSyncFromMaterial}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
                >
                  Cargar de material
                </button>
                <button
                  type="button"
                  onClick={handleSaveLayersToMaterial}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-950/80 hover:bg-cyan-900 text-[10px] text-cyan-300 border border-cyan-800 font-semibold"
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
                    : `Cargar Tirada en Memoria Vank 9060 (${workbenchConfig.ruidaIpAddress})`}
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
                  <span>Exportar Tirada (.SVG)</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
