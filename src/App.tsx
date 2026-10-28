import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Grid,
  Layers,
  Lock,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  Plus,
  Redo2,
  RotateCw,
  Save,
  ShieldAlert,
  Sliders,
  Sparkles,
  Target,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { LabelEditorCanvas } from './components/LabelEditorCanvas';
import { ProductionBedPreview } from './components/ProductionBedPreview';
import { exportProductionDxf } from './core/exporters/dxfExporter';
import {
  parseAndAuditDxfR12,
  parseAndAuditLightBurnSvg,
} from './core/exporters/fileFormatValidator';
import { generateProductionSummaryReport } from './core/exporters/productionSummaryExporter';
import { exportProductionSvg, SvgExportMode } from './core/exporters/svgExporter';
import {
  computeSafeEngravingZone,
  fitElementIntoSafeZone,
  roundMm,
  validateLabelAndBatchGeometry,
} from './core/geometry/geometryEngine';
import { generateKerfCalibrationPatternSvg } from './core/geometry/kerfCalibrationGenerator';
import { processImageDataUrlInBrowser } from './core/image/browserImageLoader';
import {
  DEFAULT_IMAGE_PROCESSING,
  parseSvgLogoString,
} from './core/image/imageProcessor';
import { INITIAL_MATERIALS_CATALOG } from './core/materials/materialsCatalog';
import { computeNestingLayout } from './core/nesting/nestingEngine';
import {
  createBlankLabelDesign,
  createInitialOrdersCatalog,
  deserializeOrderProjectFromJson,
  duplicateOrderWithQuantity,
  loadOrdersFromStorage,
  MATERIAL_SHEET_PRESETS,
  serializeOrderProjectToJson,
  STANDARD_DIMENSION_PRESETS,
  STANDARD_QUANTITY_PRESETS,
  upsertOrderProject,
} from './core/projects/projectManager';
import {
  HolePreset,
  HoleSpec,
  ImageProcessingOptions,
  LabelDesign,
  LabelElement,
  LabelShapeType,
  MaterialProfile,
  NestingConfig,
  OrderProject,
  RasterLogoElement,
} from './core/types';

type ActiveWorkspaceTab = 'editor' | 'production' | 'inspector';
type LeftSidebarSection = 'materials' | 'geometry' | 'elements';

interface HistorySnapshot {
  labelDesign: LabelDesign;
  nestingConfig: NestingConfig;
  materialId: string;
}

export function App() {
  const [orders, setOrders] = useState<OrderProject[]>(() => loadOrdersFromStorage());
  const [activeOrderId, setActiveOrderId] = useState<string>(() => {
    const initial = loadOrdersFromStorage();
    return initial[0]?.id || 'order-ref-200-ecocuero-20x10';
  });

  const initialOrder = useMemo(() => {
    return (
      orders.find((o) => o.id === activeOrderId) || createInitialOrdersCatalog()[0]
    );
  }, []);

  const [projectName, setProjectName] = useState<string>(initialOrder.projectName);
  const [clientName, setClientName] = useState<string>(initialOrder.clientName);
  const [orderNotes, setOrderNotes] = useState<string>(initialOrder.notes);

  const [materials, setMaterials] = useState<MaterialProfile[]>(INITIAL_MATERIALS_CATALOG);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(
    initialOrder.materialId
  );

  const [labelDesign, setLabelDesign] = useState<LabelDesign>(initialOrder.labelDesign);
  const [nestingConfig, setNestingConfig] = useState<NestingConfig>(
    initialOrder.nestingConfig
  );

  // Undo / Redo History
  const [history, setHistory] = useState<HistorySnapshot[]>([
    {
      labelDesign: structuredClone(initialOrder.labelDesign),
      nestingConfig: structuredClone(initialOrder.nestingConfig),
      materialId: initialOrder.materialId,
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  const pushStateWithHistory = (
    nextDesign: LabelDesign,
    nextNesting: NestingConfig = nestingConfig,
    nextMatId: string = selectedMaterialId
  ) => {
    setLabelDesign(nextDesign);
    setNestingConfig(nextNesting);
    setSelectedMaterialId(nextMatId);

    setHistory((prev) => {
      const sliced = prev.slice(0, historyIndex + 1);
      const next = [
        ...sliced,
        {
          labelDesign: structuredClone(nextDesign),
          nestingConfig: structuredClone(nextNesting),
          materialId: nextMatId,
        },
      ].slice(-40);
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const prevIdx = historyIndex - 1;
    const snap = history[prevIdx];
    setHistoryIndex(prevIdx);
    setLabelDesign(structuredClone(snap.labelDesign));
    setNestingConfig(structuredClone(snap.nestingConfig));
    setSelectedMaterialId(snap.materialId);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    const snap = history[nextIdx];
    setHistoryIndex(nextIdx);
    setLabelDesign(structuredClone(snap.labelDesign));
    setNestingConfig(structuredClone(snap.nestingConfig));
    setSelectedMaterialId(snap.materialId);
  };

  const [workspaceTab, setWorkspaceTab] = useState<ActiveWorkspaceTab>('editor');
  const [leftSection, setLeftSection] = useState<LeftSidebarSection>('geometry');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    initialOrder.labelDesign.elements[0]?.id || null
  );
  const [activeBatchIndex, setActiveBatchIndex] = useState<number>(0);

  // Controles visuales del editor (no alteran jamás las medidas de producción)
  const [zoomLevel, setZoomLevel] = useState<number>(1.35);
  const [showMillimeterGrid, setShowMillimeterGrid] = useState<boolean>(true);
  const [showSafetyGuides, setShowSafetyGuides] = useState<boolean>(true);
  const [snapToGridMm, setSnapToGridMm] = useState<number>(0.5);
  const [renderStyle, setRenderStyle] = useState<
    'realistic_material' | 'technical_lightburn'
  >('realistic_material');

  const [showOrdersModal, setShowOrdersModal] = useState<boolean>(false);
  const [showValidationBlockModal, setShowValidationBlockModal] = useState<boolean>(false);
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectJsonInputRef = useRef<HTMLInputElement | null>(null);

  const activeMaterial = useMemo(() => {
    return (
      materials.find((m) => m.id === selectedMaterialId) || materials[0]
    );
  }, [materials, selectedMaterialId]);

  const nestingResult = useMemo(() => {
    return computeNestingLayout(labelDesign, nestingConfig);
  }, [labelDesign, nestingConfig]);

  useEffect(() => {
    if (activeBatchIndex >= nestingResult.batches.length) {
      setActiveBatchIndex(0);
    }
  }, [nestingResult.batches.length, activeBatchIndex]);

  const validationReport = useMemo(() => {
    return validateLabelAndBatchGeometry(
      labelDesign,
      nestingResult,
      activeBatchIndex
    );
  }, [labelDesign, nestingResult, activeBatchIndex]);

  const selectedElement = useMemo(() => {
    return labelDesign.elements.find((e) => e.id === selectedElementId) || null;
  }, [labelDesign.elements, selectedElementId]);

  const notify = (msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => {
      setStatusBanner((curr) => (curr === msg ? null : curr));
    }, 4500);
  };

  const handleAutoFixCriticalErrors = () => {
    const nextElements = labelDesign.elements.map((el) =>
      fitElementIntoSafeZone(el, labelDesign, 0.82)
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: nextElements,
    });
    setShowValidationBlockModal(false);
    notify('Elementos reajustados automáticamente a la zona segura. Errores críticos resueltos.');
  };

  const filteredOrders = useMemo(() => {
    if (!orderSearchQuery.trim()) return orders;
    const q = orderSearchQuery.toLowerCase();
    return orders.filter(
      (o) =>
        o.projectName.toLowerCase().includes(q) ||
        o.clientName.toLowerCase().includes(q) ||
        o.materialId.toLowerCase().includes(q) ||
        `${o.labelDesign.widthMm}x${o.labelDesign.heightMm}`.includes(q)
    );
  }, [orders, orderSearchQuery]);

  // Crear nueva etiqueta limpia SIN agujeros automáticos (Sprint 2 Punto 3)
  const handleCreateNewBlankProject = () => {
    const blankDesign = createBlankLabelDesign(20, 10, 'rounded_rect');
    const newId = `order-${Date.now()}`;
    setActiveOrderId(newId);
    setProjectName('Nuevo Proyecto Etiquetas');
    setClientName('Cliente LaserHouse');
    setOrderNotes('');
    pushStateWithHistory(blankDesign, {
      ...nestingConfig,
      requestedQuantity: 100,
    });
    setSelectedElementId(blankDesign.elements[0]?.id || null);
    setWorkspaceTab('editor');
    notify('Nueva etiqueta creada (20×10 mm, sin agujeros por defecto).');
  };

  // Cambiar dimensión de etiqueta y recentrar proporcionalmente elementos
  const updateLabelDimensions = (
    newWidthMm: number,
    newHeightMm: number,
    newShape?: LabelShapeType,
    newCornerRadiusMm?: number
  ) => {
    const w = roundMm(Math.max(4, Math.min(890, newWidthMm)), 2);
    const h = roundMm(Math.max(4, Math.min(590, newHeightMm)), 2);
    const ratioX = labelDesign.widthMm > 0 ? w / labelDesign.widthMm : 1;
    const ratioY = labelDesign.heightMm > 0 ? h / labelDesign.heightMm : 1;

    const updatedElements = labelDesign.elements.map((el) => ({
      ...el,
      xMm: roundMm(el.xMm * ratioX, 2),
      yMm: roundMm(el.yMm * ratioY, 2),
    }));

    pushStateWithHistory({
      ...labelDesign,
      shape: newShape ?? labelDesign.shape,
      widthMm: w,
      heightMm: h,
      cornerRadiusMm:
        newCornerRadiusMm !== undefined
          ? roundMm(newCornerRadiusMm, 2)
          : labelDesign.cornerRadiusMm,
      elements: updatedElements,
    });
  };

  // Mover elemento en el lienzo
  const handleMoveElement = (id: string, newXMm: number, newYMm: number) => {
    setLabelDesign((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.id === id ? { ...el, xMm: newXMm, yMm: newYMm } : el
      ),
    }));
  };

  // Actualizar elemento seleccionado
  const updateSelectedElement = (patch: Partial<LabelElement>) => {
    if (!selectedElementId) return;
    const nextElements = labelDesign.elements.map((el) => {
      if (el.id !== selectedElementId) return el;
      const updated = { ...el, ...patch } as LabelElement;
      if (updated.lockAspectRatio && updated.aspectRatio > 0) {
        if ('widthMm' in patch && !('heightMm' in patch)) {
          updated.heightMm = roundMm(updated.widthMm / updated.aspectRatio, 2);
        } else if ('heightMm' in patch && !('widthMm' in patch)) {
          updated.widthMm = roundMm(updated.heightMm * updated.aspectRatio, 2);
        }
      }
      return updated;
    });
    pushStateWithHistory({
      ...labelDesign,
      elements: nextElements,
    });
  };

  // Ajustar elemento seleccionado a la zona segura (evitando agujeros y márgenes)
  const handleFitSelectedToSafeZone = () => {
    if (!selectedElement) return;
    const fitted = fitElementIntoSafeZone(selectedElement, labelDesign, 0.84);
    pushStateWithHistory({
      ...labelDesign,
      elements: labelDesign.elements.map((el) =>
        el.id === selectedElement.id ? fitted : el
      ),
    });
    notify(
      `Elemento "${selectedElement.name}" centrado y ajustado a la zona segura (${fitted.widthMm}×${fitted.heightMm} mm).`
    );
  };

  // Alineación precisa del elemento seleccionado dentro de la etiqueta y la zona segura
  const alignSelectedElement = (
    mode: 'safe_left' | 'safe_right' | 'safe_top' | 'safe_bottom' | 'center_x' | 'center_y'
  ) => {
    if (!selectedElement) return;
    const safe = computeSafeEngravingZone(labelDesign);
    let nx = selectedElement.xMm;
    let ny = selectedElement.yMm;

    if (mode === 'safe_left') {
      nx = roundMm(safe.minX + selectedElement.widthMm / 2, 2);
    } else if (mode === 'safe_right') {
      nx = roundMm(safe.maxX - selectedElement.widthMm / 2, 2);
    } else if (mode === 'center_x') {
      nx = roundMm(labelDesign.widthMm / 2, 2);
    }

    if (mode === 'safe_top') {
      ny = roundMm(safe.minY + selectedElement.heightMm / 2, 2);
    } else if (mode === 'safe_bottom') {
      ny = roundMm(safe.maxY - selectedElement.heightMm / 2, 2);
    } else if (mode === 'center_y') {
      ny = roundMm(labelDesign.heightMm / 2, 2);
    }

    updateSelectedElement({ xMm: nx, yMm: ny });
  };

  // Descarga del patrón físico de calibración de Kerf (10 líneas de corte para medir con calibre)
  const handleExportKerfPattern = () => {
    const kerf = generateKerfCalibrationPatternSvg(activeMaterial.name);
    triggerBrowserDownload(kerf.svgContent, kerf.filenameSuggested, 'image/svg+xml;charset=utf-8');
    notify(`Patrón de calibración de Kerf generado: ${kerf.filenameSuggested}`);
  };

  // Reprocesar imagen raster cuando cambian sus controles de umbral/brillo/contraste/vectorización
  const handleReprocessRasterElement = async (
    el: RasterLogoElement,
    nextOptions: ImageProcessingOptions
  ) => {
    try {
      const reprocessed = await processImageDataUrlInBrowser({
        dataUrl: el.originalDataUrl,
        name: el.name,
        targetWidthMm: el.widthMm,
        centerXMm: el.xMm,
        centerYMm: el.yMm,
        options: nextOptions,
        existingId: el.id,
      });
      reprocessed.rotationDeg = el.rotationDeg;
      reprocessed.locked = el.locked;
      pushStateWithHistory({
        ...labelDesign,
        elements: labelDesign.elements.map((item) =>
          item.id === el.id ? reprocessed : item
        ),
      });
    } catch (err) {
      notify(`Error al procesar imagen: ${(err as Error).message}`);
    }
  };

  // Importar archivo de logo real (SVG, PNG, JPG/JPEG)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'svg' || file.type === 'image/svg+xml') {
      const text = await file.text();
      const parsed = parseSvgLogoString(text);

      const rawEl: LabelElement = {
        id: `logo-svg-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'logo_svg',
        xMm: roundMm(labelDesign.widthMm / 2, 2),
        yMm: roundMm(labelDesign.heightMm / 2, 2),
        widthMm: 10,
        heightMm: roundMm(10 / parsed.aspectRatio, 2),
        aspectRatio: parsed.aspectRatio,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: text,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
      };
      const fittedEl = fitElementIntoSafeZone(rawEl, labelDesign, 0.8);

      pushStateWithHistory({
        ...labelDesign,
        elements: [...labelDesign.elements, fittedEl],
      });
      setSelectedElementId(fittedEl.id);
      setLeftSection('elements');
      notify(
        `Logo SVG "${file.name}" importado y ajustado a la zona segura (${fittedEl.widthMm}×${fittedEl.heightMm} mm).`
      );
      return;
    }

    // PNG / JPG / JPEG
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const rasterEl = await processImageDataUrlInBrowser({
          dataUrl,
          name: file.name.replace(/\.[^.]+$/, ''),
          targetWidthMm: roundMm(labelDesign.widthMm * 0.6, 2),
          centerXMm: roundMm(labelDesign.widthMm / 2, 2),
          centerYMm: roundMm(labelDesign.heightMm / 2, 2),
          options: DEFAULT_IMAGE_PROCESSING,
        });
        const fittedRaster = fitElementIntoSafeZone(
          rasterEl,
          labelDesign,
          0.8
        ) as RasterLogoElement;

        pushStateWithHistory({
          ...labelDesign,
          elements: [...labelDesign.elements, fittedRaster],
        });
        setSelectedElementId(fittedRaster.id);
        setLeftSection('elements');
        notify(
          `Imagen "${file.name}" procesada (${fittedRaster.vectorizedPathsNormalized.length} contornos cerrados, ${Math.round(fittedRaster.effectiveDpi)} DPI).`
        );
      } catch (err) {
        notify(`No se pudo procesar la imagen: ${(err as Error).message}`);
      }
    };
    reader.readAsDataURL(file);
  };

  // Generador de logos PNG/SVG de prueba reales (con transparencia, con fondo blanco y con huecos internos)
  const handleLoadSampleClientLogo = async (
    kind: 'png_transparent' | 'png_white_bg' | 'svg_hollow'
  ) => {
    if (kind === 'svg_hollow') {
      const sampleSvg = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M 10 8 L 50 8 L 58 30 L 50 52 L 10 52 L 2 30 Z M 20 18 L 20 42 L 40 42 L 40 18 Z" />
        <path d="M 70 12 L 112 12 L 112 48 L 70 48 Z M 80 22 L 80 38 L 102 38 L 102 22 Z" />
        <line x1="62" y1="10" x2="62" y2="50" />
      </svg>`;
      const parsed = parseSvgLogoString(sampleSvg);
      const rawEl: LabelElement = {
        id: `logo-svg-sample-${Date.now()}`,
        name: 'Logo_Cliente_SVG_Huecos',
        type: 'logo_svg',
        xMm: roundMm(labelDesign.widthMm / 2, 2),
        yMm: roundMm(labelDesign.heightMm / 2, 2),
        widthMm: 12,
        heightMm: 6,
        aspectRatio: parsed.aspectRatio,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: sampleSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
      };
      const fitted = fitElementIntoSafeZone(rawEl, labelDesign, 0.8);
      pushStateWithHistory({
        ...labelDesign,
        elements: [fitted],
      });
      setSelectedElementId(fitted.id);
      notify('Logo SVG de prueba con huecos internos y trazo abierto cargado y ajustado a zona segura.');
      return;
    }

    // Generar PNG real en Canvas (con fondo transparente o con fondo blanco)
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (kind === 'png_white_bg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 240, 120);
    } else {
      ctx.clearRect(0, 0, 240, 120);
    }

    // Dibujar emblema negro con hueco interno (anillo + letras "LH")
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(60, 60, 42, 0, Math.PI * 2);
    ctx.fill();

    // Hueco interior del anillo
    if (kind === 'png_white_bg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(60, 60, 24, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(60, 60, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // Punto central dentro del hueco
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(60, 60, 9, 0, Math.PI * 2);
    ctx.fill();

    // Letras gruesas "LH" a la derecha
    ctx.fillRect(120, 25, 16, 70);
    ctx.fillRect(120, 79, 42, 16);
    ctx.fillRect(172, 25, 16, 70);
    ctx.fillRect(208, 25, 16, 70);
    ctx.fillRect(172, 52, 52, 15);

    const dataUrl = canvas.toDataURL('image/png');
    const rasterEl = await processImageDataUrlInBrowser({
      dataUrl,
      name:
        kind === 'png_transparent'
          ? 'Logo_PNG_Transparente'
          : 'Logo_PNG_Fondo_Blanco',
      targetWidthMm: 12,
      centerXMm: roundMm(labelDesign.widthMm / 2, 2),
      centerYMm: roundMm(labelDesign.heightMm / 2, 2),
      options: DEFAULT_IMAGE_PROCESSING,
    });
    const fitted = fitElementIntoSafeZone(
      rasterEl,
      labelDesign,
      0.82
    ) as RasterLogoElement;
    pushStateWithHistory({
      ...labelDesign,
      elements: [fitted],
    });
    setSelectedElementId(fitted.id);
    notify(
      `Logo ${kind === 'png_transparent' ? 'PNG con transparencia' : 'PNG con fondo blanco'} vectorizado con conservación de huecos (${fitted.vectorizedPathsNormalized.length} contornos cerrados).`
    );
  };

  // Agregar texto vectorial paramétrico
  const handleAddVectorText = () => {
    const newText: LabelElement = {
      id: `text-${Date.now()}`,
      name: 'Texto Grabado',
      type: 'vector_text',
      xMm: roundMm(labelDesign.widthMm / 2, 2),
      yMm: roundMm(labelDesign.heightMm / 2, 2),
      widthMm: roundMm(Math.min(12, labelDesign.widthMm * 0.7), 2),
      heightMm: 2.2,
      aspectRatio: 5.0,
      lockAspectRatio: false,
      rotationDeg: 0,
      locked: false,
      visible: true,
      text: 'LASERHOUSE',
      fontSizeMm: 2.2,
      letterSpacingMm: 0.4,
      fontStyle: 'sans_industrial',
      strokeWidthMm: 0.3,
    };
    const fitted = fitElementIntoSafeZone(newText, labelDesign, 0.75);
    pushStateWithHistory({
      ...labelDesign,
      elements: [...labelDesign.elements, fitted],
    });
    setSelectedElementId(fitted.id);
    setLeftSection('elements');
  };

  // Descargar archivo generado al disco del operador
  const triggerBrowserDownload = (
    content: string,
    filename: string,
    mimeType: string
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSvg = (mode: SvgExportMode) => {
    const critical = validationReport.issues.filter((i) => i.severity === 'error');
    if (critical.length > 0) {
      setShowValidationBlockModal(true);
      return;
    }
    const artifact = exportProductionSvg(
      labelDesign,
      nestingResult,
      activeMaterial,
      {
        mode,
        batchIndex: activeBatchIndex,
      }
    );
    triggerBrowserDownload(
      artifact.svgContent,
      artifact.filenameSuggested,
      'image/svg+xml;charset=utf-8'
    );
    notify(
      `Exportado SVG LightBurn: ${artifact.filenameSuggested} (${artifact.pieceCount} etiquetas, ${artifact.widthMm}×${artifact.heightMm} mm).`
    );
  };

  const handleExportDxf = () => {
    const critical = validationReport.issues.filter((i) => i.severity === 'error');
    if (critical.length > 0) {
      setShowValidationBlockModal(true);
      return;
    }
    const artifact = exportProductionDxf(
      labelDesign,
      nestingResult,
      activeBatchIndex
    );
    triggerBrowserDownload(
      artifact.dxfContent,
      artifact.filenameSuggested,
      'application/dxf;charset=utf-8'
    );
    notify(
      `Exportado DXF RDWorks: ${artifact.filenameSuggested} (${artifact.pieceCount} etiquetas en escala 1:1 mm).`
    );
  };

  const handleExportSummary = () => {
    const summary = generateProductionSummaryReport({
      project: { projectName, clientName, notes: orderNotes },
      design: labelDesign,
      material: activeMaterial,
      nesting: nestingResult,
      batchIndex: activeBatchIndex,
    });
    triggerBrowserDownload(
      summary.reportText,
      summary.filenameSuggested,
      'text/plain;charset=utf-8'
    );
    notify(`Exportada Hoja Técnica de Producción: ${summary.filenameSuggested}`);
  };

  const buildCurrentOrderObject = (): OrderProject => ({
    id: activeOrderId,
    projectName: projectName.trim() || labelDesign.name,
    clientName: clientName.trim() || 'Cliente LaserHouse',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: orderNotes,
    materialId: activeMaterial.id,
    materialProfileSnapshot: structuredClone(activeMaterial),
    labelDesign: structuredClone(labelDesign),
    nestingConfig: structuredClone(nestingConfig),
    exportedFilesHistory: [],
  });

  const handleSaveCurrentOrder = () => {
    const orderToSave = buildCurrentOrderObject();
    const nextOrders = upsertOrderProject(orders, orderToSave);
    setOrders(nextOrders);
    notify(`Pedido "${orderToSave.projectName}" guardado correctamente.`);
  };

  const handleDownloadProjectJson = () => {
    const orderObj = buildCurrentOrderObject();
    const jsonStr = serializeOrderProjectToJson(orderObj);
    const cleanName = orderObj.projectName.replace(/[^a-zA-Z0-9_-]+/g, '_');
    triggerBrowserDownload(
      jsonStr,
      `${cleanName}_${labelDesign.widthMm}x${labelDesign.heightMm}mm.lhstudio.json`,
      'application/json;charset=utf-8'
    );
    notify('Archivo de proyecto (.lhstudio.json) descargado con todas sus dimensiones.');
  };

  const handleImportProjectJsonFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const restored = deserializeOrderProjectFromJson(text);
      const nextOrders = upsertOrderProject(orders, restored);
      setOrders(nextOrders);
      handleLoadOrder(restored);
      notify(
        `Proyecto "${restored.projectName}" recuperado (${restored.labelDesign.widthMm}×${restored.labelDesign.heightMm} mm, ${restored.nestingConfig.requestedQuantity} u.).`
      );
    } catch (err) {
      notify(`Error al abrir proyecto: ${(err as Error).message}`);
    }
  };

  const handleLoadOrder = (ord: OrderProject) => {
    setActiveOrderId(ord.id);
    setProjectName(ord.projectName);
    setClientName(ord.clientName);
    setOrderNotes(ord.notes);
    setSelectedMaterialId(ord.materialId);
    pushStateWithHistory(
      structuredClone(ord.labelDesign),
      structuredClone(ord.nestingConfig),
      ord.materialId
    );
    setSelectedElementId(ord.labelDesign.elements[0]?.id || null);
    setShowOrdersModal(false);
    notify(
      `Pedido "${ord.projectName}" cargado (${ord.labelDesign.widthMm}×${ord.labelDesign.heightMm} mm · ${ord.nestingConfig.requestedQuantity} u.).`
    );
  };

  const handleDuplicateOrderWithNewQuantity = (
    ord: OrderProject,
    newQty: number
  ) => {
    const duplicated = duplicateOrderWithQuantity(ord, newQty);
    const nextOrders = upsertOrderProject(orders, duplicated);
    setOrders(nextOrders);
    handleLoadOrder(duplicated);
  };

  const currentBatch =
    nestingResult.batches[activeBatchIndex] || nestingResult.batches[0];

  const liveFormatAudit = useMemo(() => {
    if (workspaceTab !== 'inspector') return null;
    const svgArt = exportProductionSvg(labelDesign, nestingResult, activeMaterial, {
      mode: 'combined',
      batchIndex: activeBatchIndex,
    });
    const dxfArt = exportProductionDxf(labelDesign, nestingResult, activeBatchIndex);
    return {
      svgContent: svgArt.svgContent,
      svgAudit: parseAndAuditLightBurnSvg(svgArt.svgContent),
      dxfAudit: parseAndAuditDxfR12(dxfArt.dxfContent),
    };
  }, [workspaceTab, labelDesign, nestingResult, activeMaterial, activeBatchIndex]);

  // Gestión de agujeros personalizados (Sprint 2 Punto 3)
  const handleAddCustomHole = () => {
    const currentCustom = labelDesign.holes.customHoles || [];
    const newHole: HoleSpec = {
      id: `hole-custom-${Date.now()}`,
      x: roundMm(labelDesign.widthMm / 2, 2),
      y: roundMm(labelDesign.heightMm / 2, 2),
      diameterMm: labelDesign.holes.diameterMm || 1.6,
    };
    pushStateWithHistory({
      ...labelDesign,
      holes: {
        ...labelDesign.holes,
        preset: 'custom',
        customHoles: [...currentCustom, newHole],
      },
    });
  };

  const handleUpdateCustomHole = (id: string, patch: Partial<HoleSpec>) => {
    pushStateWithHistory({
      ...labelDesign,
      holes: {
        ...labelDesign.holes,
        customHoles: (labelDesign.holes.customHoles || []).map((h) =>
          h.id === id ? { ...h, ...patch } : h
        ),
      },
    });
  };

  const handleRemoveCustomHole = (id: string) => {
    pushStateWithHistory({
      ...labelDesign,
      holes: {
        ...labelDesign.holes,
        customHoles: (labelDesign.holes.customHoles || []).filter(
          (h) => h.id !== id
        ),
      },
    });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0e14] text-[#e6edf3] overflow-hidden select-none">
      {/* Inputs ocultos para importar logos (SVG/PNG/JPG) y proyectos (.lhstudio.json) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={projectJsonInputRef}
        type="file"
        accept=".json,.lhstudio.json,application/json"
        className="hidden"
        onChange={handleImportProjectJsonFile}
      />

      {/* BARRA SUPERIOR DE COMANDOS INDUSTRIAL */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-[#11161f] border-b border-slate-800/90 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-black text-slate-950 text-sm shadow">
              LH
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-sm text-white whitespace-nowrap">
                  LASERHOUSE STUDIO
                </span>
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                  CAD/CAM v0.3
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono whitespace-nowrap truncate max-w-[360px]">
                Vank 9060 CO₂ (900×600 mm) · Ruida RDC8445S · LightBurn
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 mx-1" />

          {/* Gestión de Proyectos / Pedidos */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCreateNewBlankProject}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-slate-700/70 transition"
              title="Crear nueva etiqueta en blanco (sin agujeros por defecto)"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Nuevo</span>
            </button>

            <button
              type="button"
              onClick={() => setShowOrdersModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-slate-700/70 transition"
              title="Abrir catálogo de pedidos guardados o importar archivo .lhstudio.json"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Pedidos ({orders.length})</span>
            </button>

            <button
              type="button"
              onClick={handleSaveCurrentOrder}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-slate-700/70 transition"
              title="Guardar trabajo actual en el registro de pedidos"
            >
              <Save className="w-3.5 h-3.5 text-emerald-400" />
              <span>Guardar</span>
            </button>

            <div className="flex items-center rounded bg-slate-900/90 border border-slate-800 p-0.5 ml-1">
              <button
                type="button"
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-35 text-slate-300"
                title="Deshacer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-35 text-slate-300"
                title="Rehacer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Selector de Modo Central */}
        <div className="flex items-center bg-[#0b0e14] p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setWorkspaceTab('editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              workspaceTab === 'editor'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>
              1. Editor de Etiqueta ({labelDesign.widthMm}×{labelDesign.heightMm} mm)
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('production')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              workspaceTab === 'production'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>
              2. Mesa de Producción ({nestingResult.totalExportedQuantity} u. ·{' '}
              {nestingResult.totalBatches}{' '}
              {nestingResult.totalBatches === 1 ? 'tanda' : 'tandas'})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('inspector')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              workspaceTab === 'inspector'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>3. Auditoría & Validación LightBurn/DXF</span>
          </button>
        </div>

        {/* Botones de Exportación Directa */}
        <div className="flex items-center gap-1.5">
          {!validationReport.isValid && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 border border-red-500/50 text-red-300 text-[11px] font-medium"
              title="Existen advertencias geométricas que deben revisarse antes de cortar"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span>Revisar alertas</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => handleExportSvg('combined')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition"
            title="Exportar SVG 1:1 en milímetros con capas separadas (#000000 Grabado, #0000FF Agujeros, #FF0000 Corte) para LightBurn"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar SVG LightBurn</span>
          </button>
          <button
            type="button"
            onClick={handleExportDxf}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-semibold text-xs transition"
            title="Exportar DXF AC1009 en milímetros reales ($INSUNITS=4) compatible con RDWorks y LightBurn"
          >
            <Download className="w-3.5 h-3.5" />
            <span>DXF RDWorks</span>
          </button>
        </div>
      </header>

      {/* Banner de notificación si existe */}
      {statusBanner && (
        <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-4 py-1.5 text-xs text-emerald-200 flex items-center justify-between">
          <span className="font-mono">{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-emerald-400 hover:text-white text-xs"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* CUERPO PRINCIPAL DE 3 PANELES */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* PANEL IZQUIERDO */}
        <aside className="w-80 bg-[#11161f] border-r border-slate-800/90 flex flex-col shrink-0">
          <div className="grid grid-cols-3 border-b border-slate-800 bg-[#0d1118] text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setLeftSection('geometry')}
              className={`py-2.5 text-center border-b-2 transition ${
                leftSection === 'geometry'
                  ? 'border-amber-500 text-amber-300 bg-[#11161f]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              1. Forma / mm
            </button>
            <button
              type="button"
              onClick={() => setLeftSection('elements')}
              className={`py-2.5 text-center border-b-2 transition ${
                leftSection === 'elements'
                  ? 'border-amber-500 text-amber-300 bg-[#11161f]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              2. Logo / Arte
            </button>
            <button
              type="button"
              onClick={() => setLeftSection('materials')}
              className={`py-2.5 text-center border-b-2 transition ${
                leftSection === 'materials'
                  ? 'border-amber-500 text-amber-300 bg-[#11161f]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              3. Material
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
            {/* SECCIÓN 1: GEOMETRÍA, MEDIDAS Y AGUJEROS OPCIONALES */}
            {leftSection === 'geometry' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Nombre de Etiqueta / Diseño
                  </label>
                  <input
                    type="text"
                    value={labelDesign.name}
                    onChange={(e) =>
                      pushStateWithHistory({ ...labelDesign, name: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-[#0b0e14] border border-slate-700 text-slate-100 font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {/* Medidas predeterminadas */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Medidas Predeterminadas (mm)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {STANDARD_DIMENSION_PRESETS.map((preset) => {
                      const active =
                        labelDesign.widthMm === preset.widthMm &&
                        labelDesign.heightMm === preset.heightMm;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            updateLabelDimensions(
                              preset.widthMm,
                              preset.heightMm,
                              preset.recommendedShape,
                              preset.recommendedCornerRadiusMm
                            )
                          }
                          className={`px-2 py-1.5 rounded font-mono text-[11px] border transition ${
                            active
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                              : 'bg-[#0b0e14] border-slate-800 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Geometría / Forma de Etiqueta */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Geometría de Corte Exterior
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { id: 'rounded_rect', label: 'Esquinas Redond.' },
                        { id: 'rectangle', label: 'Rectangular' },
                        { id: 'square', label: 'Cuadrada' },
                        { id: 'circle', label: 'Circular' },
                        { id: 'oval', label: 'Ovalada' },
                        { id: 'capsule', label: 'Cápsula / Píldora' },
                        { id: 'octagon_tag', label: 'Tag Chaflán 8L' },
                        { id: 'custom_polygon', label: 'Tag Flecha' },
                      ] as Array<{ id: LabelShapeType; label: string }>
                    ).map((sh) => (
                      <button
                        key={sh.id}
                        type="button"
                        onClick={() => {
                          const nextH =
                            sh.id === 'square' || sh.id === 'circle'
                              ? labelDesign.widthMm
                              : labelDesign.heightMm;
                          updateLabelDimensions(labelDesign.widthMm, nextH, sh.id);
                        }}
                        className={`px-2.5 py-1.5 rounded text-left text-xs border transition ${
                          labelDesign.shape === sh.id
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold'
                            : 'bg-[#0b0e14] border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {sh.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dimensiones personalizadas exactas en milímetros */}
                <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                    Cotas Físicas Reales (mm)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Ancho (X mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="4"
                        max="890"
                        value={labelDesign.widthMm}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 10;
                          const nextH =
                            labelDesign.shape === 'square' ||
                            labelDesign.shape === 'circle'
                              ? val
                              : labelDesign.heightMm;
                          updateLabelDimensions(val, nextH);
                        }}
                        className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Alto (Y mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="4"
                        max="590"
                        value={labelDesign.heightMm}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 10;
                          const nextW =
                            labelDesign.shape === 'square' ||
                            labelDesign.shape === 'circle'
                              ? val
                              : labelDesign.widthMm;
                          updateLabelDimensions(nextW, val);
                        }}
                        className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Radio esq. (mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="50"
                        disabled={labelDesign.shape !== 'rounded_rect'}
                        value={labelDesign.cornerRadiusMm}
                        onChange={(e) =>
                          pushStateWithHistory({
                            ...labelDesign,
                            cornerRadiusMm: Math.max(
                              0,
                              parseFloat(e.target.value) || 0
                            ),
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100 disabled:opacity-40"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Margen seg. (mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="15"
                        value={labelDesign.safetyMarginMm}
                        onChange={(e) =>
                          pushStateWithHistory({
                            ...labelDesign,
                            safetyMarginMm: Math.max(
                              0.5,
                              parseFloat(e.target.value) || 1.0
                            ),
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] text-slate-400 mb-1"
                        title="Compensación de ancho de haz láser (Kerf). 0 = medida nominal sin compensación."
                      >
                        Kerf (mm)
                      </label>
                      <input
                        type="number"
                        step="0.02"
                        min="0"
                        max="1.5"
                        value={labelDesign.kerfCompensationMm}
                        onChange={(e) =>
                          pushStateWithHistory({
                            ...labelDesign,
                            kerfCompensationMm: Math.max(
                              0,
                              parseFloat(e.target.value) || 0
                            ),
                          })
                        }
                        className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Configuración de Agujeros Opcionales (Sin agujeros, 1, 2, 4 o Personalizados) */}
                <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-400">
                      Agujeros Opcionales (Costura)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                      Capa 01 #0000FF
                    </span>
                  </div>

                  <select
                    aria-label="Configuración de agujeros"
                    value={labelDesign.holes.preset}
                    onChange={(e) => {
                      const nextPreset = e.target.value as HolePreset;
                      const nextCustom =
                        nextPreset === 'custom' &&
                        (!labelDesign.holes.customHoles ||
                          labelDesign.holes.customHoles.length === 0)
                          ? [
                              {
                                id: 'hole-custom-1',
                                x: roundMm(labelDesign.holes.edgeDistanceMm, 2),
                                y: roundMm(labelDesign.heightMm / 2, 2),
                                diameterMm: labelDesign.holes.diameterMm,
                              },
                            ]
                          : labelDesign.holes.customHoles;
                      pushStateWithHistory({
                        ...labelDesign,
                        holes: {
                          ...labelDesign.holes,
                          preset: nextPreset,
                          customHoles: nextCustom,
                        },
                      });
                    }}
                    className="w-full px-2 py-1.5 rounded bg-[#11161f] border border-slate-700 text-slate-100 text-xs"
                  >
                    <option value="none">Sin agujeros (Predeterminado)</option>
                    <option value="single_left">1 Agujero izquierdo</option>
                    <option value="single_top">1 Agujero superior</option>
                    <option value="two_horizontal">2 Agujeros laterales (Izq / Der)</option>
                    <option value="two_vertical">2 Agujeros verticales (Sup / Inf)</option>
                    <option value="four_corners">4 Agujeros en esquinas</option>
                    <option value="custom">Configuración personalizada (X, Y libre)</option>
                  </select>

                  {labelDesign.holes.preset !== 'none' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Diámetro Ø (mm)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.6"
                          max="15"
                          value={labelDesign.holes.diameterMm}
                          onChange={(e) =>
                            pushStateWithHistory({
                              ...labelDesign,
                              holes: {
                                ...labelDesign.holes,
                                diameterMm: Math.max(
                                  0.5,
                                  parseFloat(e.target.value) || 1.5
                                ),
                              },
                            })
                          }
                          className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Dist. al borde (mm)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.8"
                          max="30"
                          disabled={labelDesign.holes.preset === 'custom'}
                          value={labelDesign.holes.edgeDistanceMm}
                          onChange={(e) =>
                            pushStateWithHistory({
                              ...labelDesign,
                              holes: {
                                ...labelDesign.holes,
                                edgeDistanceMm: Math.max(
                                  0.8,
                                  parseFloat(e.target.value) || 2.0
                                ),
                              },
                            })
                          }
                          className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100 disabled:opacity-40"
                        />
                      </div>
                    </div>
                  )}

                  {/* Editor de agujeros personalizados (X, Y, Ø en mm) */}
                  {labelDesign.holes.preset === 'custom' && (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                          Coordenadas desde esquina sup-izq (mm)
                        </span>
                        <button
                          type="button"
                          onClick={handleAddCustomHole}
                          className="px-2 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 text-[10px] font-semibold"
                        >
                          + Agregar agujero
                        </button>
                      </div>
                      {(labelDesign.holes.customHoles || []).map((ch, idx) => (
                        <div
                          key={ch.id}
                          className="grid grid-cols-7 gap-1 items-center bg-[#11161f] p-1.5 rounded border border-slate-800"
                        >
                          <span className="text-[10px] font-mono text-slate-400 col-span-1">
                            #{idx + 1}
                          </span>
                          <input
                            type="number"
                            step="0.2"
                            value={ch.x}
                            title="X (mm)"
                            onChange={(e) =>
                              handleUpdateCustomHole(ch.id, {
                                x: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="col-span-2 px-1.5 py-0.5 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                          />
                          <input
                            type="number"
                            step="0.2"
                            value={ch.y}
                            title="Y (mm)"
                            onChange={(e) =>
                              handleUpdateCustomHole(ch.id, {
                                y: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="col-span-2 px-1.5 py-0.5 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                          />
                          <input
                            type="number"
                            step="0.1"
                            min="0.5"
                            value={ch.diameterMm}
                            title="Ø Diámetro (mm)"
                            onChange={(e) =>
                              handleUpdateCustomHole(ch.id, {
                                diameterMm: Math.max(
                                  0.5,
                                  parseFloat(e.target.value) || 1.5
                                ),
                              })
                            }
                            className="col-span-1 px-1 py-0.5 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomHole(ch.id)}
                            className="col-span-1 flex justify-center text-slate-400 hover:text-red-400"
                            title="Eliminar agujero"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* SECCIÓN 2: IMPORTACIÓN DE LOGOS, VECTORIZACIÓN Y ELEMENTOS DE GRABADO */}
            {leftSection === 'elements' && (
              <>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importar Logo Cliente (SVG / PNG / JPG)</span>
                  </button>

                  {/* Muestras de prueba reales con 1 clic (PNG transparente, PNG fondo blanco, SVG con huecos) */}
                  <div className="p-2.5 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Probar con Logos de Muestra Reales:
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => handleLoadSampleClientLogo('png_transparent')}
                        className="px-1.5 py-1 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200"
                        title="Generar e importar PNG con canal alfa transparente y anillo con hueco interno"
                      >
                        PNG Transp.
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadSampleClientLogo('png_white_bg')}
                        className="px-1.5 py-1 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200"
                        title="Generar e importar PNG con fondo blanco para probar eliminación de fondo y huecos"
                      >
                        PNG F. Blanco
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadSampleClientLogo('svg_hollow')}
                        className="px-1.5 py-1 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-200"
                        title="Importar SVG con sub-caminos calados y trazos abiertos"
                      >
                        SVG Huecos
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleAddVectorText}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 rounded bg-[#0b0e14] hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs transition"
                    >
                      <Type className="w-3.5 h-3.5 text-amber-400" />
                      <span>+ Texto Vectorial</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const borderEl: LabelElement = {
                          id: `border-${Date.now()}`,
                          name: 'Marco Grabado',
                          type: 'decorative_border',
                          xMm: roundMm(labelDesign.widthMm / 2, 2),
                          yMm: roundMm(labelDesign.heightMm / 2, 2),
                          widthMm: roundMm(
                            Math.max(4, labelDesign.widthMm - 3),
                            2
                          ),
                          heightMm: roundMm(
                            Math.max(4, labelDesign.heightMm - 3),
                            2
                          ),
                          aspectRatio:
                            labelDesign.widthMm / labelDesign.heightMm,
                          lockAspectRatio: false,
                          rotationDeg: 0,
                          locked: false,
                          visible: true,
                          insetMm: 1.5,
                          strokeWidthMm: 0.25,
                          dashed: false,
                        };
                        pushStateWithHistory({
                          ...labelDesign,
                          elements: [...labelDesign.elements, borderEl],
                        });
                        setSelectedElementId(borderEl.id);
                      }}
                      className="flex items-center justify-center gap-1.5 py-2 px-2 rounded bg-[#0b0e14] hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs transition"
                    >
                      <Layers className="w-3.5 h-3.5 text-sky-400" />
                      <span>+ Marco Interior</span>
                    </button>
                  </div>
                </div>

                {/* Lista de elementos de grabado */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Elementos en Capa 00 GRABADO ({labelDesign.elements.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {labelDesign.elements.map((el) => {
                      const isSel = el.id === selectedElementId;
                      return (
                        <div
                          key={el.id}
                          onClick={() => setSelectedElementId(el.id)}
                          className={`flex items-center justify-between px-2.5 py-2 rounded border cursor-pointer transition ${
                            isSel
                              ? 'bg-amber-500/15 border-amber-500/60 text-amber-200'
                              : 'bg-[#0b0e14] border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <div className="font-medium text-xs truncate">
                              {el.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {el.widthMm}×{el.heightMm} mm · X:{el.xMm} Y:{el.yMm}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                pushStateWithHistory({
                                  ...labelDesign,
                                  elements: labelDesign.elements.map((item) =>
                                    item.id === el.id
                                      ? { ...item, locked: !item.locked }
                                      : item
                                  ),
                                });
                              }}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400"
                              title={
                                el.locked ? 'Desbloquear' : 'Bloquear posición'
                              }
                            >
                              {el.locked ? (
                                <Lock className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <Unlock className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                pushStateWithHistory({
                                  ...labelDesign,
                                  elements: labelDesign.elements.filter(
                                    (item) => item.id !== el.id
                                  ),
                                });
                                if (selectedElementId === el.id) {
                                  setSelectedElementId(null);
                                }
                              }}
                              className="p-1 rounded hover:bg-red-950/60 text-slate-400 hover:text-red-400"
                              title="Eliminar elemento"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Controles específicos del elemento seleccionado */}
                {selectedElement && (
                  <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                        Propiedades: {selectedElement.name}
                      </span>
                    </div>

                    {/* Botón de ajuste automático a Zona Segura (evita pisar agujeros o líneas de corte) */}
                    <button
                      type="button"
                      onClick={handleFitSelectedToSafeZone}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold transition"
                      title="Centrar y escalar proporcionalmente dentro del margen de seguridad evitando agujeros"
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>Ajustar y Centrar en Zona Segura</span>
                    </button>

                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('center_x')}
                        className="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[11px]"
                        title="Centrar horizontalmente en la etiqueta"
                      >
                        <MoveHorizontal className="w-3 h-3 text-sky-400" />
                        <span>Centro X</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('center_y')}
                        className="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[11px]"
                        title="Centrar verticalmente en la etiqueta"
                      >
                        <MoveVertical className="w-3 h-3 text-sky-400" />
                        <span>Centro Y</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedElement({
                            rotationDeg:
                              (selectedElement.rotationDeg + 90) % 360,
                          })
                        }
                        className="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[11px]"
                        title="Rotar 90 grados"
                      >
                        <RotateCw className="w-3 h-3 text-amber-400" />
                        <span>Rotar 90°</span>
                      </button>
                    </div>

                    {/* Alineación rápida a bordes de zona segura */}
                    <div className="grid grid-cols-4 gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('safe_left')}
                        className="py-1 px-1 rounded bg-[#0d1219] hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300 text-center"
                        title="Alinear al margen izquierdo seguro"
                      >
                        Izq. Segura
                      </button>
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('safe_right')}
                        className="py-1 px-1 rounded bg-[#0d1219] hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300 text-center"
                        title="Alinear al margen derecho seguro"
                      >
                        Der. Segura
                      </button>
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('safe_top')}
                        className="py-1 px-1 rounded bg-[#0d1219] hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300 text-center"
                        title="Alinear al margen superior seguro"
                      >
                        Arriba
                      </button>
                      <button
                        type="button"
                        onClick={() => alignSelectedElement('safe_bottom')}
                        className="py-1 px-1 rounded bg-[#0d1219] hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-300 text-center"
                        title="Alinear al margen inferior seguro"
                      >
                        Abajo
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Ancho elem. (mm)
                        </label>
                        <input
                          type="number"
                          step="0.2"
                          min="1"
                          value={selectedElement.widthMm}
                          onChange={(e) =>
                            updateSelectedElement({
                              widthMm: Math.max(
                                0.5,
                                parseFloat(e.target.value) || 2
                              ),
                            })
                          }
                          className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Alto elem. (mm)
                        </label>
                        <input
                          type="number"
                          step="0.2"
                          min="1"
                          value={selectedElement.heightMm}
                          onChange={(e) =>
                            updateSelectedElement({
                              heightMm: Math.max(
                                0.5,
                                parseFloat(e.target.value) || 2
                              ),
                            })
                          }
                          className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                        />
                      </div>
                    </div>

                    {/* Si es Texto Vectorial */}
                    {selectedElement.type === 'vector_text' && (
                      <div className="space-y-2 pt-1 border-t border-slate-800">
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">
                            Texto a grabar (Vectorial CNC)
                          </label>
                          <input
                            type="text"
                            value={selectedElement.text}
                            onChange={(e) =>
                              updateSelectedElement({
                                text: e.target.value,
                              } as Partial<LabelElement>)
                            }
                            className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100 uppercase"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">
                              Altura letra (mm)
                            </label>
                            <input
                              type="number"
                              step="0.2"
                              min="1.0"
                              max="40"
                              value={selectedElement.fontSizeMm}
                              onChange={(e) =>
                                updateSelectedElement({
                                  fontSizeMm: Math.max(
                                    0.8,
                                    parseFloat(e.target.value) || 2
                                  ),
                                } as Partial<LabelElement>)
                              }
                              className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">
                              Espaciado (mm)
                            </label>
                            <input
                              type="number"
                              step="0.05"
                              min="0.1"
                              max="10"
                              value={selectedElement.letterSpacingMm}
                              onChange={(e) =>
                                updateSelectedElement({
                                  letterSpacingMm: Math.max(
                                    0.1,
                                    parseFloat(e.target.value) || 0.35
                                  ),
                                } as Partial<LabelElement>)
                              }
                              className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Si es Imagen Raster (PNG/JPG) */}
                    {selectedElement.type === 'logo_raster' && (
                      <div className="space-y-2.5 pt-2 border-t border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-sky-400 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5" />
                            Procesamiento y Vectorización
                          </span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              selectedElement.effectiveDpi >= 250
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {Math.round(selectedElement.effectiveDpi)} DPI
                          </span>
                        </div>

                        {/* Comparación Visual: Original vs Procesado */}
                        <div className="p-2.5 rounded-lg bg-[#080b10] border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Comparación Original vs Procesado
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {selectedElement.pixelWidth}×{selectedElement.pixelHeight} px
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-center">
                            <div className="p-1 rounded bg-[#11161f] border border-slate-700">
                              <div className="text-[9px] text-slate-400 mb-1">Archivo Original</div>
                              <div className="h-16 flex items-center justify-center overflow-hidden bg-slate-900/80 rounded border border-slate-800">
                                <img
                                  src={selectedElement.originalDataUrl}
                                  alt="Original"
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            </div>
                            <div className="p-1 rounded bg-[#11161f] border border-amber-500/40">
                              <div className="text-[9px] text-amber-300 font-semibold mb-1">
                                {selectedElement.processing.mode === 'vector' ? 'Vectorizado Láser' : 'Monocromático B/N'}
                              </div>
                              <div className="h-16 flex items-center justify-center overflow-hidden bg-white/95 rounded border border-slate-300">
                                <img
                                  src={selectedElement.processedDataUrl}
                                  alt="Procesado"
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleReprocessRasterElement(selectedElement, {
                                ...selectedElement.processing,
                                mode: 'vector',
                              })
                            }
                            className={`py-1.5 px-2 rounded text-[11px] font-medium border ${
                              selectedElement.processing.mode === 'vector'
                                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                                : 'bg-[#11161f] border-slate-700 text-slate-400'
                            }`}
                          >
                            Vectorizar ({selectedElement.vectorizedPathsNormalized.length} trazos)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleReprocessRasterElement(selectedElement, {
                                ...selectedElement.processing,
                                mode: 'raster',
                              })
                            }
                            className={`py-1.5 px-2 rounded text-[11px] font-medium border ${
                              selectedElement.processing.mode === 'raster'
                                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                                : 'bg-[#11161f] border-slate-700 text-slate-400'
                            }`}
                          >
                            Grabado Raster B/N
                          </button>
                        </div>

                        {/* Slider de Detalle Fino / Simplificación Vectorial turdSize cuando el modo es Vector */}
                        {selectedElement.processing.mode === 'vector' && (
                          <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 space-y-1">
                            <div className="flex justify-between text-[10px] text-slate-400">
                              <span>Detalle Fino / Simplificación Vector</span>
                              <span className="font-mono text-amber-300">
                                {selectedElement.processing.turdSize} px
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.2"
                              max="2.5"
                              step="0.05"
                              value={selectedElement.processing.turdSize}
                              onChange={(e) =>
                                handleReprocessRasterElement(selectedElement, {
                                  ...selectedElement.processing,
                                  turdSize: Number(e.target.value),
                                })
                              }
                              className="w-full accent-amber-500"
                            />
                            <div className="text-[9px] text-slate-500">
                              Valores menores conservan letras pequeñas y detalles finos.
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                            <span>Umbral Blanco / Negro</span>
                            <span className="font-mono">
                              {selectedElement.processing.threshold} / 255
                            </span>
                          </div>
                          <input
                            type="range"
                            min="15"
                            max="245"
                            value={selectedElement.processing.threshold}
                            onChange={(e) =>
                              handleReprocessRasterElement(selectedElement, {
                                ...selectedElement.processing,
                                threshold: Number(e.target.value),
                              })
                            }
                            className="w-full accent-amber-500"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                              <span>Brillo</span>
                              <span className="font-mono">
                                {selectedElement.processing.brightness}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="-80"
                              max="80"
                              value={selectedElement.processing.brightness}
                              onChange={(e) =>
                                handleReprocessRasterElement(selectedElement, {
                                  ...selectedElement.processing,
                                  brightness: Number(e.target.value),
                                })
                              }
                              className="w-full accent-sky-400"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                              <span>Contraste</span>
                              <span className="font-mono">
                                {selectedElement.processing.contrast}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="-80"
                              max="80"
                              value={selectedElement.processing.contrast}
                              onChange={(e) =>
                                handleReprocessRasterElement(selectedElement, {
                                  ...selectedElement.processing,
                                  contrast: Number(e.target.value),
                                })
                              }
                              className="w-full accent-sky-400"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                            <input
                              type="checkbox"
                              checked={
                                selectedElement.processing.removeBackground
                              }
                              onChange={(e) =>
                                handleReprocessRasterElement(selectedElement, {
                                  ...selectedElement.processing,
                                  removeBackground: e.target.checked,
                                })
                              }
                              className="accent-amber-500"
                            />
                            <span>Quitar fondo</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                            <input
                              type="checkbox"
                              checked={selectedElement.processing.invert}
                              onChange={(e) =>
                                handleReprocessRasterElement(selectedElement, {
                                  ...selectedElement.processing,
                                  invert: e.target.checked,
                                })
                              }
                              className="accent-amber-500"
                            />
                            <span>Invertir B/N</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* SECCIÓN 3: SISTEMA DE MATERIALES Y PERFILES DE LÁSER */}
            {leftSection === 'materials' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Catálogo de Materiales LaserHouse
                  </label>
                  <div className="space-y-1.5">
                    {materials.map((mat) => {
                      const isSel = mat.id === activeMaterial.id;
                      return (
                        <button
                          key={mat.id}
                          type="button"
                          onClick={() => {
                            setSelectedMaterialId(mat.id);
                            if (mat.fixedRibbonWidthMm) {
                              setNestingConfig((prev) => ({
                                ...prev,
                                sheetWidthMm: mat.fixedRibbonWidthMm!,
                              }));
                            }
                          }}
                          className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition ${
                            isSel
                              ? 'bg-amber-500/15 border-amber-500 text-white'
                              : 'bg-[#0b0e14] border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className="w-5 h-5 rounded-full border border-slate-600 shrink-0"
                            style={{ backgroundColor: mat.visual.surfaceColor }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-xs truncate">
                              {mat.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {mat.code} · Espesor {mat.thicknessMm} mm
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Advertencia obligatoria de seguridad para ecocuero y sintéticos */}
                {activeMaterial.safetyWarning && (
                  <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-500/40 text-amber-200 space-y-2">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-[11px] leading-relaxed">
                        {activeMaterial.safetyWarning}
                      </span>
                    </div>
                    {activeMaterial.requiresCompositionConfirmation && (
                      <label className="flex items-center gap-2 pt-1 cursor-pointer text-[11px] font-semibold text-amber-300">
                        <input
                          type="checkbox"
                          checked={
                            activeMaterial.compositionConfirmedByOperator
                          }
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setMaterials((prev) =>
                              prev.map((m) =>
                                m.id === activeMaterial.id
                                  ? {
                                      ...m,
                                      compositionConfirmedByOperator: checked,
                                    }
                                  : m
                              )
                            );
                          }}
                          className="accent-amber-500"
                        />
                        <span>
                          Confirmo composición libre de PVC/Cloro y apta para láser CO₂
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* Configuración de espesor y opciones específicas del material */}
                <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300">
                      Espesor del Material (mm)
                    </span>
                    <select
                      value={activeMaterial.thicknessMm}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setMaterials((prev) =>
                          prev.map((m) =>
                            m.id === activeMaterial.id
                              ? { ...m, thicknessMm: val }
                              : m
                          )
                        );
                      }}
                      className="px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-xs"
                    >
                      {activeMaterial.availableThicknessesMm.map((th) => (
                        <option key={th} value={th}>
                          {th} mm
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300 pt-1">
                    <input
                      type="checkbox"
                      checked={activeMaterial.mirrorArtworkForBackEngrave}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setMaterials((prev) =>
                          prev.map((m) =>
                            m.id === activeMaterial.id
                              ? { ...m, mirrorArtworkForBackEngrave: checked }
                              : m
                          )
                        );
                      }}
                      className="accent-amber-500"
                    />
                    <span>Espejar arte horizontalmente (Grabado desde dorso)</span>
                  </label>
                </div>

                {/* Parámetros editables por el operador */}
                <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Parámetros Operador (Vank 9060 CO₂)
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Ingrese únicamente parámetros validados físicamente en su máquina. Se adjuntan en la Hoja Técnica de Producción.
                  </p>

                  <div className="space-y-2 pt-1">
                    <div className="p-2 rounded bg-[#11161f] border border-slate-800">
                      <div className="text-[10px] font-mono text-slate-300 mb-1">
                        Capa 00 GRABADO (#000000)
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="number"
                          placeholder="Vel (mm/s)"
                          value={
                            activeMaterial.engraveParams.speedMmPerSec ?? ''
                          }
                          onChange={(e) => {
                            const val = e.target.value
                              ? parseFloat(e.target.value)
                              : null;
                            setMaterials((prev) =>
                              prev.map((m) =>
                                m.id === activeMaterial.id
                                  ? {
                                      ...m,
                                      engraveParams: {
                                        ...m.engraveParams,
                                        speedMmPerSec: val,
                                      },
                                    }
                                  : m
                              )
                            );
                          }}
                          className="px-2 py-1 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                        />
                        <input
                          type="number"
                          placeholder="Pot. Máx (%)"
                          value={
                            activeMaterial.engraveParams.maxPowerPercent ?? ''
                          }
                          onChange={(e) => {
                            const val = e.target.value
                              ? parseFloat(e.target.value)
                              : null;
                            setMaterials((prev) =>
                              prev.map((m) =>
                                m.id === activeMaterial.id
                                  ? {
                                      ...m,
                                      engraveParams: {
                                        ...m.engraveParams,
                                        maxPowerPercent: val,
                                      },
                                    }
                                  : m
                              )
                            );
                          }}
                          className="px-2 py-1 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                        />
                      </div>
                    </div>

                    <div className="p-2 rounded bg-[#11161f] border border-slate-800">
                      <div className="text-[10px] font-mono text-red-400 mb-1">
                        Capa 02 CORTE EXTERIOR (#FF0000)
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="number"
                          placeholder="Vel (mm/s)"
                          value={activeMaterial.cutParams.speedMmPerSec ?? ''}
                          onChange={(e) => {
                            const val = e.target.value
                              ? parseFloat(e.target.value)
                              : null;
                            setMaterials((prev) =>
                              prev.map((m) =>
                                m.id === activeMaterial.id
                                  ? {
                                      ...m,
                                      cutParams: {
                                        ...m.cutParams,
                                        speedMmPerSec: val,
                                      },
                                    }
                                  : m
                              )
                            );
                          }}
                          className="px-2 py-1 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                        />
                        <input
                          type="number"
                          placeholder="Pot. Máx (%)"
                          value={activeMaterial.cutParams.maxPowerPercent ?? ''}
                          onChange={(e) => {
                            const val = e.target.value
                              ? parseFloat(e.target.value)
                              : null;
                            setMaterials((prev) =>
                              prev.map((m) =>
                                m.id === activeMaterial.id
                                  ? {
                                      ...m,
                                      cutParams: {
                                        ...m.cutParams,
                                        maxPowerPercent: val,
                                      },
                                    }
                                  : m
                              )
                            );
                          }}
                          className="px-2 py-1 rounded bg-[#0b0e14] border border-slate-700 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ÁREA CENTRAL INTERACTIVA */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#090c10] relative">
          {workspaceTab === 'editor' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-[#11161f] border-b border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono">
                    Etiqueta:{' '}
                    <strong className="text-white">
                      {labelDesign.widthMm} × {labelDesign.heightMm} mm
                    </strong>
                  </span>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRenderStyle((prev) =>
                        prev === 'realistic_material'
                          ? 'technical_lightburn'
                          : 'realistic_material'
                      )
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                  >
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {renderStyle === 'realistic_material'
                        ? 'Vista: Simulación Material'
                        : 'Vista: Técnica Capas LightBurn'}
                    </span>
                  </button>
                </div>

                {/* Controles de Grilla Milimétrica, Guías, Imán y Zoom Visual */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={showMillimeterGrid}
                      onChange={(e) => setShowMillimeterGrid(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>Grilla mm</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={showSafetyGuides}
                      onChange={(e) => setShowSafetyGuides(e.target.checked)}
                      className="accent-amber-500"
                    />
                    <span>Guías seguridad</span>
                  </label>

                  <div className="flex items-center gap-1">
                    <span className="text-slate-400">Imán:</span>
                    <select
                      value={snapToGridMm}
                      onChange={(e) =>
                        setSnapToGridMm(parseFloat(e.target.value))
                      }
                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      <option value={0}>Libre</option>
                      <option value={0.25}>0.25 mm</option>
                      <option value={0.5}>0.5 mm</option>
                      <option value={1}>1.0 mm</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setZoomLevel((z) => roundMm(Math.max(0.4, z - 0.2), 2))
                      }
                      className="p-0.5 hover:text-amber-400"
                      title="Alejar vista (No altera medidas en mm)"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono text-[11px] px-1.5 text-slate-300">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setZoomLevel((z) => roundMm(Math.min(4.0, z + 0.2), 2))
                      }
                      className="p-0.5 hover:text-amber-400"
                      title="Acercar vista (No altera medidas en mm)"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomLevel(1.35)}
                      className="p-0.5 hover:text-amber-400 ml-0.5"
                      title="Restablecer zoom visual"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                <LabelEditorCanvas
                  design={labelDesign}
                  material={activeMaterial}
                  selectedElementId={selectedElementId}
                  onSelectElement={(id) => {
                    setSelectedElementId(id);
                    if (id) setLeftSection('elements');
                  }}
                  onMoveElement={handleMoveElement}
                  onResizeElement={(id, newW, newH) => {
                    updateSelectedElement({ widthMm: newW, heightMm: newH });
                  }}
                  onRotateElement={(id, deg) => {
                    updateSelectedElement({ rotationDeg: deg });
                  }}
                  zoomLevel={zoomLevel}
                  onZoomChange={setZoomLevel}
                  showMillimeterGrid={showMillimeterGrid}
                  showSafetyGuides={showSafetyGuides}
                  snapToGridMm={snapToGridMm}
                  renderStyle={renderStyle}
                />
              </div>
            </>
          )}

          {workspaceTab === 'production' && (
            <ProductionBedPreview
              design={labelDesign}
              material={activeMaterial}
              nesting={nestingResult}
              validation={validationReport}
              activeBatchIndex={activeBatchIndex}
              onSelectBatchIndex={setActiveBatchIndex}
            />
          )}

          {workspaceTab === 'inspector' && liveFormatAudit && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#090c10]">
              <div className="max-w-5xl mx-auto space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#11161f] border border-slate-800">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Auditoría Técnica Independiente de Formatos SVG y DXF
                    </h2>
                    <p className="text-xs text-slate-400">
                      Verificación matemática de escala 1:1 mm, contornos cerrados y colores de capas previa a la importación en LightBurn / RDWorks.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExportKerfPattern}
                      className="px-3 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-mono"
                      title="Descargar patrón físico de 100x20 mm para medir el kerf del láser con calibre digital"
                    >
                      Calibración Kerf (100×20 mm)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportSvg('engrave_only')}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700"
                    >
                      SVG Sólo Grabado
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportSvg('cut_only')}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700"
                    >
                      SVG Sólo Corte
                    </button>
                    <button
                      type="button"
                      onClick={handleExportSummary}
                      className="px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-xs font-mono text-emerald-300 border border-emerald-500/40"
                    >
                      Hoja Técnica (.TXT)
                    </button>
                  </div>
                </div>

                {/* Banner de estado de LightBurn */}
                <div className="p-3.5 rounded-lg bg-sky-950/40 border border-sky-500/30 text-xs text-sky-200 flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    i
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-white">
                      Validación Técnica Independiente (LightBurn pendiente de instalación)
                    </div>
                    <div className="text-[11px] text-slate-300 leading-relaxed">
                      Dado que LightBurn aún no está instalado en este equipo, los archivos son auditados y verificados matemáticamente por el motor geométrico de LaserHouse Studio para garantizar escala física 1:1, contornos cerrados con terminación Z y separación estricta de capas por color (<strong className="text-white">#000000</strong> Grabado, <strong className="text-blue-400">#0000FF</strong> Agujeros, <strong className="text-red-400">#FF0000</strong> Corte). Cuando adquieras e instales LightBurn, abrí el archivo de calibración y corroborá las cotas en la barra de herramientas.
                    </div>
                  </div>
                </div>

                {/* Tarjetas de Verificación Independiente SVG y DXF */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-[#11161f] border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-amber-300 uppercase">
                        Lector Independiente SVG (LightBurn)
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                          liveFormatAudit.svgAudit.isValid
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {liveFormatAudit.svgAudit.isValid
                          ? 'SVG 1:1 mm VERIFICADO'
                          : 'OBSERVACIONES'}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-300 space-y-1">
                      <div>
                        Lienzo físico: {liveFormatAudit.svgAudit.widthMm}mm ×{' '}
                        {liveFormatAudit.svgAudit.heightMm}mm (viewBox 1:1:{' '}
                        {liveFormatAudit.svgAudit.viewBoxMatchesMm1To1
                          ? 'SÍ'
                          : 'NO'}
                        )
                      </div>
                      <div>
                        Capas detectadas: 00 Grabado (
                        {liveFormatAudit.svgAudit.engraveLayerCount}) · 01
                        Agujeros ({liveFormatAudit.svgAudit.holesLayerCount}) ·
                        02 Corte ({liveFormatAudit.svgAudit.cutLayerCount})
                      </div>
                      <div>
                        Contornos cerrados (Z):{' '}
                        {liveFormatAudit.svgAudit.allCutAndHolePathsClosed
                          ? '100% Cerrados'
                          : 'Incompletos'}
                      </div>
                      {liveFormatAudit.svgAudit.measuredCutBoundsMm && (
                        <div className="text-sky-300">
                          Caja medida en SVG:{' '}
                          {liveFormatAudit.svgAudit.measuredCutBoundsMm.width} ×{' '}
                          {liveFormatAudit.svgAudit.measuredCutBoundsMm.height}{' '}
                          mm
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#11161f] border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-sky-300 uppercase">
                        Lector Independiente DXF R12 (RDWorks)
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                          liveFormatAudit.dxfAudit.isValid
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}
                      >
                        {liveFormatAudit.dxfAudit.isValid
                          ? 'DXF AC1009 VERIFICADO'
                          : 'OBSERVACIONES'}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-300 space-y-1">
                      <div>
                        Versión: {liveFormatAudit.dxfAudit.acadVer} · $INSUNITS:{' '}
                        {liveFormatAudit.dxfAudit.insUnits} (mm) · Capas:{' '}
                        {liveFormatAudit.dxfAudit.layersDefined.join(', ')}
                      </div>
                      <div>
                        Polilíneas: GRABADO (
                        {liveFormatAudit.dxfAudit.engravePolylinesCount}) ·
                        AGUJEROS ({liveFormatAudit.dxfAudit.holePolylinesCount})
                        · CORTE ({liveFormatAudit.dxfAudit.cutPolylinesCount})
                      </div>
                      <div>
                        Cierre doble (Flag 70=1 + Vértice final=inicial):{' '}
                        {liveFormatAudit.dxfAudit.allCutAndHolesClosedFlag &&
                        liveFormatAudit.dxfAudit.allCutAndHolesZeroGapLoop
                          ? 'SÍ (0.000 mm gap)'
                          : 'NO'}
                      </div>
                      {liveFormatAudit.dxfAudit.firstCutPieceSizeMm && (
                        <div className="text-emerald-300">
                          1ª Pieza medida desde vértices DXF:{' '}
                          {liveFormatAudit.dxfAudit.firstCutPieceSizeMm.width} ×{' '}
                          {liveFormatAudit.dxfAudit.firstCutPieceSizeMm.height}{' '}
                          mm
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Código fuente SVG real en vivo */}
                <div className="rounded-xl bg-[#11161f] border border-slate-800 overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#161d29] border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-amber-300">
                      Código SVG de Producción (Escala física 1:1 en mm)
                    </span>
                    <span className="font-mono text-slate-400">
                      width=&quot;{nestingConfig.sheetWidthMm}mm&quot;
                      height=&quot;{nestingConfig.sheetHeightMm}mm&quot;
                      viewBox=&quot;0 0 {nestingConfig.sheetWidthMm}{' '}
                      {nestingConfig.sheetHeightMm}&quot;
                    </span>
                  </div>
                  <pre className="p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
                    {liveFormatAudit.svgContent.slice(0, 6000)}
                    {liveFormatAudit.svgContent.length > 6000
                      ? `\n... [Archivo completo de ${liveFormatAudit.svgContent.length.toLocaleString()} bytes listo para descargar]`
                      : ''}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* PANEL DERECHO: DISTRIBUCIÓN DE MATERIAL, CANTIDADES Y EXPORTACIÓN */}
        <aside className="w-80 bg-[#11161f] border-l border-slate-800/90 flex flex-col shrink-0 overflow-y-auto p-3.5 space-y-4 text-xs">
          {/* Bloque 1: Cantidad de Etiquetas */}
          <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                Cantidad a Producir
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Conteo exacto garantizado
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1">
              {STANDARD_QUANTITY_PRESETS.map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => {
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      requestedQuantity: qty,
                    });
                    setWorkspaceTab('production');
                  }}
                  className={`py-1.5 rounded font-mono text-xs border transition ${
                    nestingConfig.requestedQuantity === qty
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                      : 'bg-[#11161f] border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {qty}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <label className="text-[11px] text-slate-400 shrink-0">
                Cantidad exacta:
              </label>
              <input
                type="number"
                min="1"
                max="20000"
                value={nestingConfig.requestedQuantity}
                onChange={(e) =>
                  pushStateWithHistory(labelDesign, {
                    ...nestingConfig,
                    requestedQuantity: Math.max(
                      1,
                      parseInt(e.target.value, 10) || 1
                    ),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded bg-[#11161f] border border-slate-700 font-mono text-sm font-bold text-amber-300"
              />
            </div>
          </div>

          {/* Bloque 2: Dimensiones Reales del Material (900x600, 600x400, 400x300, 200x200 y Personalizado) */}
          <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Recorte de Material (Máx 900×600 mm)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {MATERIAL_SHEET_PRESETS.map((sp) => {
                const isSelected =
                  nestingConfig.sheetWidthMm === sp.widthMm &&
                  nestingConfig.sheetHeightMm === sp.heightMm;
                return (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() =>
                      pushStateWithHistory(labelDesign, {
                        ...nestingConfig,
                        sheetWidthMm: sp.widthMm,
                        sheetHeightMm: sp.heightMm,
                      })
                    }
                    className={`px-2 py-1.5 rounded text-[11px] font-mono border transition ${
                      isSelected
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-[#11161f] border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}
                    title={sp.description}
                  >
                    {sp.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Ancho Material (mm)
                </label>
                <input
                  type="number"
                  step="1"
                  min="15"
                  max="900"
                  value={nestingConfig.sheetWidthMm}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      sheetWidthMm: Math.max(
                        10,
                        parseFloat(e.target.value) || 100
                      ),
                    })
                  }
                  className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Alto Material (mm)
                </label>
                <input
                  type="number"
                  step="1"
                  min="15"
                  max="600"
                  value={nestingConfig.sheetHeightMm}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      sheetHeightMm: Math.max(
                        10,
                        parseFloat(e.target.value) || 100
                      ),
                    })
                  }
                  className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                />
              </div>
            </div>

            {/* Separación X / Y y Márgenes */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Sep. X (mm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="50"
                  value={nestingConfig.gapXMm}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      gapXMm: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Sep. Y (mm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="50"
                  value={nestingConfig.gapYMm}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      gapYMm: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Margen (mm)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={nestingConfig.marginLeftMm}
                  onChange={(e) => {
                    const m = Math.max(0, parseFloat(e.target.value) || 0);
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      marginTopMm: m,
                      marginRightMm: m,
                      marginBottomMm: m,
                      marginLeftMm: m,
                    });
                  }}
                  className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 font-mono text-slate-100"
                />
              </div>
            </div>

            {/* Orientación y Centrado */}
            <div className="pt-1 space-y-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Rotación de Piezas (Optimización)
                </label>
                <select
                  value={nestingConfig.rotationMode}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      rotationMode: e.target
                        .value as NestingConfig['rotationMode'],
                    })
                  }
                  className="w-full px-2 py-1.5 rounded bg-[#11161f] border border-slate-700 text-xs"
                >
                  <option value="auto_optimize">
                    Automática Óptima (0°:{' '}
                    {nestingResult.orientationComparison.deg0Capacity}u vs 90°:{' '}
                    {nestingResult.orientationComparison.deg90Capacity}u)
                  </option>
                  <option value="0">
                    Mantener a 0° (
                    {nestingResult.orientationComparison.deg0Capacity}{' '}
                    u./plancha)
                  </option>
                  <option value="90">
                    Rotar a 90° (
                    {nestingResult.orientationComparison.deg90Capacity}{' '}
                    u./plancha)
                  </option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={nestingConfig.centerInSheet}
                  onChange={(e) =>
                    pushStateWithHistory(labelDesign, {
                      ...nestingConfig,
                      centerInSheet: e.target.checked,
                    })
                  }
                  className="accent-amber-500"
                />
                <span>Centrar bloque de etiquetas en el recorte</span>
              </label>
            </div>
          </div>

          {/* Bloque 3: Resumen de Aprovechamiento del Material y Alertas Antes de Exportar */}
          <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                {validationReport.isValid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                )}
                Aprovechamiento y Validación
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                Rot: {nestingResult.appliedRotationDeg}°
              </span>
            </div>

            <div className="space-y-1 text-[11px] font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Entran por recorte:</span>
                <span className="text-slate-200 font-bold">
                  {nestingResult.maxCapacityPerSheet} u. (
                  {nestingResult.maxColumnsPerSheet}×
                  {nestingResult.maxRowsPerSheet})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cantidad exportada:</span>
                <span className="text-amber-300 font-bold">
                  {nestingResult.totalExportedQuantity} unidades
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tandas necesarias:</span>
                <span className="text-sky-300 font-bold">
                  {nestingResult.totalBatches}{' '}
                  {nestingResult.totalBatches === 1 ? 'tanda' : 'tandas'}
                </span>
              </div>
              {currentBatch && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      Área bloque tanda #{currentBatch.batchNumber}:
                    </span>
                    <span className="text-slate-200">
                      {currentBatch.occupiedBounds.width}×
                      {currentBatch.occupiedBounds.height} mm
                    </span>
                  </div>
                  <div className="pt-1">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-slate-400">
                        Eficiencia en bloque / Uso de recorte:
                      </span>
                      <span className="text-emerald-300 font-bold">
                        {currentBatch.boundingBoxEfficiencyPercent}% /{' '}
                        {currentBatch.sheetUtilizationPercent}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-emerald-400"
                        style={{
                          width: `${Math.min(100, Math.max(4, currentBatch.sheetUtilizationPercent))}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Advertencias visibles antes de exportar */}
            {validationReport.issues.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <div className="text-[10px] font-bold uppercase text-amber-400">
                  Advertencias antes de exportar ({validationReport.issues.length}):
                </div>
                {validationReport.issues.map((iss, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded text-[10px] leading-snug ${
                      iss.severity === 'error'
                        ? 'bg-red-950/70 border border-red-500/50 text-red-200'
                        : 'bg-amber-950/60 border border-amber-500/40 text-amber-200'
                    }`}
                  >
                    {iss.message}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bloque 4: Datos del Pedido y Exportación Completa */}
          <div className="p-3 rounded-lg bg-[#0b0e14] border border-slate-800 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Datos del Pedido / Cliente
            </div>
            <input
              type="text"
              placeholder="Nombre del proyecto / pedido"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 text-xs text-slate-100"
            />
            <input
              type="text"
              placeholder="Cliente"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full px-2 py-1 rounded bg-[#11161f] border border-slate-700 text-xs text-slate-100"
            />

            <div className="pt-2 space-y-1.5">
              <button
                type="button"
                onClick={() => handleExportSvg('combined')}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar SVG Combinado (LightBurn)</span>
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleExportSvg('engrave_only')}
                  className="py-1.5 px-2 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px]"
                >
                  SVG Sólo Grabado
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSvg('cut_only')}
                  className="py-1.5 px-2 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px]"
                >
                  SVG Sólo Corte
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleExportDxf}
                  className="py-1.5 px-2 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 text-[11px] font-medium"
                >
                  DXF (RDWorks)
                </button>
                <button
                  type="button"
                  onClick={handleExportSummary}
                  className="py-1.5 px-2 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium"
                >
                  Resumen (.TXT)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadProjectJson}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px]"
                >
                  Guardar .lhstudio.json
                </button>
                <button
                  type="button"
                  onClick={() => projectJsonInputRef.current?.click()}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px]"
                >
                  Abrir .lhstudio.json
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* MODAL DE GESTIÓN DE PEDIDOS Y REPETICIÓN RÁPIDA DE PRODUCCIÓN */}
      {showOrdersModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl bg-[#11161f] border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-3.5 bg-[#161d29] border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Gestor de Pedidos y Repetición de Producción — LaserHouse Studio
                </h3>
                <p className="text-xs text-slate-400">
                  Abra un pedido anterior, busque diseños o repita cantidades (200, 500, 1000 u.) sin rehacer el diseño.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => projectJsonInputRef.current?.click()}
                  className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-medium"
                >
                  Importar .lhstudio.json
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrdersModal(false)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Barra de búsqueda de pedidos y diseños */}
            <div className="px-5 py-2.5 bg-[#0e131b] border-b border-slate-800 flex items-center gap-2">
              <input
                type="text"
                placeholder="Buscar pedidos por cliente, nombre de proyecto, material o medidas..."
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-[#11161f] border border-slate-700 text-xs text-white placeholder-slate-500 font-sans"
              />
              {orderSearchQuery && (
                <button
                  type="button"
                  onClick={() => setOrderSearchQuery('')}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 shrink-0"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              {filteredOrders.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No se encontraron pedidos con el término "{orderSearchQuery}".
                </div>
              ) : (
                filteredOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-4 rounded-lg bg-[#0b0e14] border border-slate-800 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {ord.projectName}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          {ord.nestingConfig.requestedQuantity} u.
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Cliente:{' '}
                        <strong className="text-slate-200">
                          {ord.clientName}
                        </strong>{' '}
                        · Material:{' '}
                        <span className="font-mono text-slate-300">
                          {ord.materialId}
                        </span>{' '}
                        · Medida:{' '}
                        <span className="font-mono text-sky-300">
                          {ord.labelDesign.widthMm} × {ord.labelDesign.heightMm}{' '}
                          mm
                        </span>
                      </div>
                      {ord.notes && (
                        <div className="text-[11px] text-slate-500">
                          {ord.notes}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLoadOrder(ord)}
                        className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                      >
                        Abrir Pedido
                      </button>
                      <span className="text-[10px] text-slate-500 font-mono ml-1">Repetir:</span>
                      {[50, 100, 200, 300, 500].map((qty) => (
                        <button
                          key={qty}
                          type="button"
                          onClick={() => handleDuplicateOrderWithNewQuantity(ord, qty)}
                          className="px-2 py-1 rounded bg-[#11161f] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition"
                          title={`Duplicar este diseño y organizar automáticamente ${qty} unidades`}
                        >
                          ×{qty}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE BLOQUEO POR ERRORES CRÍTICOS ANTES DE EXPORTAR */}
      {showValidationBlockModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-[#11161f] border border-red-500/70 shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 bg-red-950/80 border-b border-red-500/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h3 className="text-sm font-bold text-white">
                  Exportación Bloqueada — Errores Críticos
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowValidationBlockModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-300">
                Para garantizar la integridad física de la producción en la máquina Vank 9060 CO₂ y evitar piezas defectuosas en LightBurn / RDWorks, se requiere corregir los siguientes errores críticos antes de exportar:
              </p>
              <div className="space-y-2">
                {validationReport.issues
                  .filter((i) => i.severity === 'error')
                  .map((iss, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200"
                    >
                      <strong className="block font-mono text-[11px] text-red-300 mb-0.5">
                        [{iss.code}]
                      </strong>
                      {iss.message}
                    </div>
                  ))}
              </div>
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowValidationBlockModal(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Revisar en Editor
                </button>
                <button
                  type="button"
                  onClick={handleAutoFixCriticalErrors}
                  className="px-3.5 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow transition"
                >
                  Corregir Automáticamente en Zona Segura
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
