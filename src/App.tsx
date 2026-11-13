import {compatibleCutConfig, supportsSharedCuts} from './core/geometry/sharedCuts';
import {rotateArtworkExactly} from './core/geometry/preciseRotation';
import {arrangeFoldedLabel, unfoldLabel, FoldOptions} from './core/geometry/foldedLabel';
import {LIGHTBURN_PROFILES, LightburnProfile, lightburnGuide} from './core/exporters/lightburnGuide';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { LogoOutputFile, logoNameError, logoFolderZip } from './core/exporters/logoFolder';
import { alignArtwork, artworkDpi, mergeProcessedArtwork, EdgeAlignment } from './core/geometry/editorActions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Grid,
  Info,
  Layers,
  Lock,
  Maximize2,
  Move,
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
import { RotaryPanel } from './components/RotaryPanel';
import { exportProductionDxf } from './core/exporters/dxfExporter';
import {
  parseAndAuditDxfR12,
  parseAndAuditLightBurnSvg,
} from './core/exporters/fileFormatValidator';
import { generateProductionSummaryReport } from './core/exporters/productionSummaryExporter';
import { exportProductionSvg } from './core/exporters/svgExporter';
import {
  centerAllElementsGeometrically,
  centerElementGeometrically,
  checkElementsFitSafeZone,
  compileLabelGeometry,
  computeSafeEngravingZone,
  DimensionUnit,
  fitAllElementsToAvailableSpace,
  fitElementIntoSafeZone,
  fitElementToAvailableSpace,
  formatDimensionValue,
  getElementNormalizedContentBounds,
  getElementVisibleBoundingBoxMm,
  nudgeElementMm,
  parseDimensionValue,
  roundMm,
  validateLabelAndBatchGeometry,
} from './core/geometry/geometryEngine';
import { generateKerfCalibrationPatternSvg } from './core/geometry/kerfCalibrationGenerator';
import { processImageDataUrlInBrowser } from './core/image/browserImageLoader';
import {
  computeEffectiveDpi,
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
  HoleConfiguration,
  HolePreset,
  HoleSpec,
  ImageProcessingOptions,
  LabelDesign,
  LabelElement,
  LabelShapeType,
  LIGHTBURN_LAYERS,
  MaterialProfile,
  NestingConfig,
  OrderProject,
  RasterLogoElement,
  SvgLogoElement,
} from './core/types';

export type WizardStepId =
  | 'logo'
  | 'dimensions'
  | 'holes'
  | 'engraving'
  | 'production'
  | 'export';

interface WizardStepDef {
  id: WizardStepId;
  number: number;
  label: string;
  title: string;
  subtitle: string;
}

const SHAPE_LABELS: Record<LabelShapeType, string> = { rounded_rect: 'Esquinas redondeadas', rectangle: 'Rectangular', square: 'Cuadrada', circle: 'Circular', oval: 'Ovalada', capsule: 'Cápsula', octagon_tag: 'Octágono', custom_polygon: 'Personalizada' };
const HOLE_LABELS: Record<HolePreset, string> = { none: 'Sin perforaciones', single_left: 'Uno lateral', single_top: 'Uno superior', two_horizontal: 'Dos laterales', two_vertical: 'Dos verticales', four_corners: 'Cuatro esquinas', custom: 'Personalizados' };

const WIZARD_STEPS: WizardStepDef[] = [
  {
    id: 'logo',
    number: 1,
    label: 'Logo',
    title: 'Tu logotipo',
    subtitle:
      'Cargá un PNG, JPG o SVG para empezar a diseñar tu etiqueta.',
  },
  {
    id: 'dimensions',
    number: 2,
    label: 'Medidas',
    title: 'Medidas y forma',
    subtitle:
      'Define las dimensiones físicas reales (mm) y la forma geométrica. El logo se adapta sin deformarse.',
  },
  {
    id: 'holes',
    number: 3,
    label: 'Orificios',
    title: 'Orificios de sujeción',
    subtitle:
      'Indicá si la etiqueta lleva orificios de fijación. Sin agujeros por defecto para una superficie limpia.',
  },
  {
    id: 'engraving',
    number: 4,
    label: 'Grabado',
    title: 'Ajustar el grabado',
    subtitle:
      'Ajustá el tamaño, la posición y la orientación del logo sobre la etiqueta.',
  },
  {
    id: 'production',
    number: 5,
    label: 'Producción',
    title: 'Preparar la producción',
    subtitle:
      'Elegí el material, la cantidad y el tamaño de plancha.',
  },
  {
    id: 'export',
    number: 6,
    label: 'Exportar',
    title: 'Revisar y exportar',
    subtitle:
      'Revisá el pedido y descargá los archivos para tu software de corte.',
  },
];

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

  const [materials, setMaterials] = useState<MaterialProfile[]>(() => initialOrder.materialProfileSnapshot ? [...INITIAL_MATERIALS_CATALOG.filter(m => m.id !== initialOrder.materialId), initialOrder.materialProfileSnapshot] : INITIAL_MATERIALS_CATALOG);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(
    initialOrder.materialId
  );

  const [labelDesign, setLabelDesign] = useState<LabelDesign>(initialOrder.labelDesign);
  const [nestingConfig, setNestingConfig] = useState<NestingConfig>(
    compatibleCutConfig(initialOrder.labelDesign, {...initialOrder.nestingConfig, layoutMode: initialOrder.nestingConfig.layoutMode ?? 'blocks'})
  );

  // Navegación principal del Asistente de 6 pasos
  const [currentStep, setCurrentStep] = useState<WizardStepId>('logo');

  // Estado de edición interactiva
  const [selectedElementId, setSelectedElementId] = useState<string | null>(() => {
    return initialOrder.labelDesign.elements[0]?.id || null;
  });
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [showMillimeterGrid, setShowMillimeterGrid] = useState<boolean>(true);
  const [showSafetyGuides, setShowSafetyGuides] = useState<boolean>(true);
  const [snapToGridMm, setSnapToGridMm] = useState<number>(0.5);
  const [renderStyle, setRenderStyle] = useState<'realistic_material' | 'technical_lightburn'>(
    'realistic_material'
  );
  const [activeBatchIndex, setActiveBatchIndex] = useState<number>(0);
  const [isOrdersModalOpen, setIsOrdersModalOpen] = useState<boolean>(false);
  const [isRotaryOpen, setIsRotaryOpen] = useState<boolean>(false);
  const ordersDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOrdersModalOpen) ordersDialog.current?.showModal?.();
  }, [isOrdersModalOpen]);
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lightburnProfile, setLightburnProfile] = useState<LightburnProfile>('balanced');
  const [pendingFiles, setPendingFiles] = useState<LogoOutputFile[] | null>(null);
  const [logoFolderName, setLogoFolderName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingFiles, setIsSavingFiles] = useState(false);
  const saveDialog = useRef<HTMLDialogElement>(null);
  const savingFiles = useRef(false);
  useEffect(() => { if (pendingFiles) saveDialog.current?.showModal?.(); }, [pendingFiles]);


  // Unidad de visualización de medidas (mm o cm) - Las medidas se almacenan internamente siempre en mm
  const [dimensionUnit, setDimensionUnit] = useState<DimensionUnit>('mm');
  const [inputWidthStr, setInputWidthStr] = useState<string>(() =>
    formatDimensionValue(initialOrder.labelDesign.widthMm, 'mm')
  );
  const [inputHeightStr, setInputHeightStr] = useState<string>(() =>
    formatDimensionValue(initialOrder.labelDesign.heightMm, 'mm')
  );

  // Sincronizar inputs locales con el estado del diseño respetando la edición del usuario
  useEffect(() => {
    const parsedW = parseDimensionValue(inputWidthStr, dimensionUnit);
    if (!parsedW.valid || Math.abs(parsedW.valueMm - labelDesign.widthMm) > 0.001) {
      setInputWidthStr(formatDimensionValue(labelDesign.widthMm, dimensionUnit));
    }
    const parsedH = parseDimensionValue(inputHeightStr, dimensionUnit);
    if (!parsedH.valid || Math.abs(parsedH.valueMm - labelDesign.heightMm) > 0.001) {
      setInputHeightStr(formatDimensionValue(labelDesign.heightMm, dimensionUnit));
    }
  }, [labelDesign.widthMm, labelDesign.heightMm, dimensionUnit]);

  // Chequeo de área segura para el diseño actual
  const safeZoneCheck = useMemo(() => {
    return checkElementsFitSafeZone(labelDesign.elements, labelDesign);
  }, [labelDesign]);

  // Acordeón de opciones avanzadas
  const [showAdvancedProduction, setShowAdvancedProduction] = useState<boolean>(false);
  const [showAdvancedImageOptions, setShowAdvancedImageOptions] = useState<boolean>(false);

  // Undo / Redo History
  const [history, setHistory] = useState<HistorySnapshot[]>([
    {
      labelDesign: structuredClone(initialOrder.labelDesign),
      nestingConfig: {...structuredClone(initialOrder.nestingConfig), layoutMode: initialOrder.nestingConfig.layoutMode ?? 'blocks'},
      materialId: initialOrder.materialId,
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  const activeMaterial = useMemo(() => {
    return (
      materials.find((m) => m.id === selectedMaterialId) || INITIAL_MATERIALS_CATALOG[0]
    );
  }, [materials, selectedMaterialId]);

  const nestingResult = useMemo(() => {
    return computeNestingLayout(labelDesign, nestingConfig);
  }, [labelDesign, nestingConfig]);

  const validationReport = useMemo(() => {
    return validateLabelAndBatchGeometry(labelDesign, nestingResult, activeBatchIndex);
  }, [labelDesign, nestingResult, activeBatchIndex]);

  useEffect(() => {
    setActiveBatchIndex(index => Math.min(index, Math.max(0, nestingResult.batches.length - 1)));
  }, [nestingResult.batches.length]);

  const hasRasterExport = labelDesign.elements.some(el => el.visible && el.type === 'logo_raster' &&
    (el.processing.mode !== 'vector' || el.vectorizedPathsNormalized.length === 0));
  const activeBatch = nestingResult.batches[activeBatchIndex] || nestingResult.batches[0];

  const notify = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const canvasInteraction = useRef(false);
  const latestDesign = useRef(labelDesign);
  latestDesign.current = labelDesign;
  const imageRequest = useRef(0);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const pushStateWithHistory = (
    nextDesign: LabelDesign,
    nextNesting?: NestingConfig,
    nextMatId?: string
  ) => {
    if (canvasInteraction.current) {
      setLabelDesign(nextDesign);
      return;
    }
    const compatibleNesting = compatibleCutConfig(nextDesign, nextNesting || nestingConfig);
    if ((nextNesting || nestingConfig).sharedCutLines && !compatibleNesting.sharedCutLines) notify('Corte individual activado: esta forma o compensación no admite líneas compartidas.');
    const snap: HistorySnapshot = {
      labelDesign: structuredClone(nextDesign),
      nestingConfig: structuredClone(compatibleNesting),
      materialId: nextMatId || selectedMaterialId,
    };
    const sliced = history.slice(0, historyIndex + 1);
    setHistory([...sliced, snap]);
    setHistoryIndex(sliced.length);
    setLabelDesign(nextDesign);
    setNestingConfig(compatibleNesting);
    if (nextMatId) setSelectedMaterialId(nextMatId);
  };

  useEffect(() => {
    const corrected = compatibleCutConfig(labelDesign,nestingConfig);
    if (corrected !== nestingConfig) {
      setNestingConfig(corrected);
      setHistory(items=>items.map(item=>({...item,nestingConfig:compatibleCutConfig(item.labelDesign,item.nestingConfig)})));
    }
  },[labelDesign,nestingConfig]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setLabelDesign(structuredClone(prev.labelDesign));
      setNestingConfig(structuredClone(prev.nestingConfig));
      setSelectedMaterialId(prev.materialId);
      notify('Acción deshecha.');
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setLabelDesign(structuredClone(next.labelDesign));
      setNestingConfig(structuredClone(next.nestingConfig));
      setSelectedMaterialId(next.materialId);
      notify('Acción rehecha.');
    }
  };

  // Atajos de teclado para Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // Sincronizar selección si no hay elemento seleccionado
  useEffect(() => {
    if (!selectedElementId && labelDesign.elements.length > 0) {
      setSelectedElementId(labelDesign.elements[0].id);
    }
  }, [labelDesign.elements, selectedElementId]);

  // Selección de elemento actual
  const selectedElement = useMemo(() => {
    return labelDesign.elements.find((e) => e.id === selectedElementId) || null;
  }, [labelDesign.elements, selectedElementId]);

  // ==========================================
  // MANIPULACIÓN DEL LOGOTIPO / IMAGEN
  // ==========================================

  const handleImageUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'svg' || file.type === 'image/svg+xml') {
      const text = await file.text();
      let parsed: ReturnType<typeof parseSvgLogoString>;
      try { parsed = parseSvgLogoString(text); }
      catch (err) { notify(`Error al importar SVG: ${(err as Error).message}`); return; }

      const rawEl: SvgLogoElement = {
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
        contentBoundsNormalized: parsed.contentBoundsNormalized,
      };

      const fittedEl = fitElementToAvailableSpace(rawEl, labelDesign, 0.9999, 'safe_zone_center');

      pushStateWithHistory({
        ...labelDesign,
        elements: [fittedEl],
      });
      setSelectedElementId(fittedEl.id);
      notify(
        `Logo SVG "${file.name}" cargado y centrado geométricamente (${fittedEl.widthMm}×${fittedEl.heightMm} mm).`
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

        const fittedRaster = fitElementToAvailableSpace(
          rasterEl,
          labelDesign,
          0.9999, 'safe_zone_center'
        ) as RasterLogoElement;

        pushStateWithHistory({
          ...labelDesign,
          elements: [fittedRaster],
        });
        setSelectedElementId(fittedRaster.id);
        notify(
          `Imagen "${file.name}" importada (${fittedRaster.pixelWidth}×${fittedRaster.pixelHeight} px, ${Math.round(fittedRaster.effectiveDpi)} DPI).`
        );
      } catch (err) {
        notify(`No se pudo procesar la imagen: ${(err as Error).message}`);
      }
    };
    reader.readAsDataURL(file);
  };

  // Carga de logos de muestra reales
  const handleLoadSampleLogo = async (
    kind: 'svg_hex' | 'svg_hollow' | 'png_sample'
  ) => {
    if (kind === 'svg_hex') {
      const sampleSvg = `<svg viewBox="0 0 44 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M 8 2 L 36 2 L 42 14 L 36 26 L 8 26 L 2 14 Z" />
        <path d="M 14 8 L 20 8 L 20 18 L 30 18 L 30 22 L 14 22 Z" />
      </svg>`;
      const parsed = parseSvgLogoString(sampleSvg);
      const rawEl: SvgLogoElement = {
        id: `logo-svg-sample-${Date.now()}`,
        name: 'Logo Hexagonal LH',
        type: 'logo_svg',
        xMm: roundMm(labelDesign.widthMm / 2, 2),
        yMm: roundMm(labelDesign.heightMm / 2, 2),
        widthMm: 12,
        heightMm: roundMm(12 / parsed.aspectRatio, 2),
        aspectRatio: parsed.aspectRatio,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: sampleSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
        contentBoundsNormalized: parsed.contentBoundsNormalized,
      };
      const fitted = fitElementToAvailableSpace(rawEl, labelDesign, 0.9999, 'safe_zone_center');
      pushStateWithHistory({
        ...labelDesign,
        elements: [fitted],
      });
      setSelectedElementId(fitted.id);
      notify('Logo SVG Hexagonal LH cargado y centrado.');
      return;
    }

    if (kind === 'svg_hollow') {
      const sampleSvg = `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
        <path d="M 10 8 L 50 8 L 58 30 L 50 52 L 10 52 L 2 30 Z M 20 18 L 20 42 L 40 42 L 40 18 Z" />
        <path d="M 70 12 L 112 12 L 112 48 L 70 48 Z M 80 22 L 80 38 L 102 38 L 102 22 Z" />
        <line x1="62" y1="10" x2="62" y2="50" />
      </svg>`;
      const parsed = parseSvgLogoString(sampleSvg);
      const rawEl: SvgLogoElement = {
        id: `logo-svg-hollow-${Date.now()}`,
        name: 'Logo SVG con Huecos Internos',
        type: 'logo_svg',
        xMm: roundMm(labelDesign.widthMm / 2, 2),
        yMm: roundMm(labelDesign.heightMm / 2, 2),
        widthMm: 14,
        heightMm: 7,
        aspectRatio: parsed.aspectRatio,
        lockAspectRatio: true,
        rotationDeg: 0,
        locked: false,
        visible: true,
        rawSvgContent: sampleSvg,
        normalizedPaths: parsed.normalizedPaths,
        originalViewBox: parsed.originalViewBox,
        contentBoundsNormalized: parsed.contentBoundsNormalized,
      };
      const fitted = fitElementToAvailableSpace(rawEl, labelDesign, 0.9999, 'safe_zone_center');
      pushStateWithHistory({
        ...labelDesign,
        elements: [fitted],
      });
      setSelectedElementId(fitted.id);
      notify('Logo SVG con huecos internos y contornos cerrados cargado.');
      return;
    }

    // PNG de muestra con fondo transparente
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 240, 120);

    // Emblema circular con hueco y texto
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(60, 60, 42, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(60, 60, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(60, 60, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillRect(120, 25, 16, 70);
    ctx.fillRect(120, 79, 42, 16);
    ctx.fillRect(172, 25, 16, 70);
    ctx.fillRect(208, 25, 16, 70);
    ctx.fillRect(172, 52, 52, 15);

    const dataUrl = canvas.toDataURL('image/png');
    const rasterEl = await processImageDataUrlInBrowser({
      dataUrl,
      name: 'Logo_PNG_Muestra_LH',
      targetWidthMm: 12,
      centerXMm: roundMm(labelDesign.widthMm / 2, 2),
      centerYMm: roundMm(labelDesign.heightMm / 2, 2),
      options: DEFAULT_IMAGE_PROCESSING,
    });
    const fitted = fitElementToAvailableSpace(
      rasterEl,
      labelDesign,
      0.9999, 'safe_zone_center'
    ) as RasterLogoElement;
    pushStateWithHistory({
      ...labelDesign,
      elements: [fitted],
    });
    setSelectedElementId(fitted.id);
    notify('Logo PNG monocromático de muestra cargado.');
  };

  // Re-procesamiento en vivo de opciones de imagen (umbral, contraste, etc.)
  const handleUpdateImageProcessing = async (
    updates: Partial<ImageProcessingOptions>
  ) => {
    if (!selectedElement || selectedElement.type !== 'logo_raster' || isProcessingImage) return;
    const request = ++imageRequest.current;
    const sourceDesign = labelDesign;
    setIsProcessingImage(true);
    const newOptions: ImageProcessingOptions = {
      ...selectedElement.processing,
      ...updates,
    };

    try {
      const reprocessed = await processImageDataUrlInBrowser({
        dataUrl: selectedElement.originalDataUrl,
        name: selectedElement.name,
        targetWidthMm: selectedElement.widthMm,
        centerXMm: selectedElement.xMm,
        centerYMm: selectedElement.yMm,
        options: newOptions,
        existingId: selectedElement.id,
      });

      if (request !== imageRequest.current || latestDesign.current !== sourceDesign) return;
      const updatedEls = labelDesign.elements.map((el) =>
        el.id === selectedElement.id ? mergeProcessedArtwork(selectedElement, reprocessed) : el
      );
      pushStateWithHistory({
        ...labelDesign,
        elements: updatedEls,
      });
    } catch (err) {
      notify(`Error al procesar parámetros de imagen: ${(err as Error).message}`);
    } finally {
      if (request === imageRequest.current) setIsProcessingImage(false);
    }
  };

  // ==========================================
  // PASO 2: FORMA Y MEDIDAS DE LA ETIQUETA
  // ==========================================

  const applyFold = (fold: FoldOptions | null) => {
    try {
      const next = fold ? arrangeFoldedLabel(labelDesign, fold) : unfoldLabel(labelDesign);
      pushStateWithHistory(next);
      setSelectedElementId(next.elements[0]?.id ?? null);
      notify(fold ? 'Etiqueta para doblar preparada. Las medidas corresponden a la pieza abierta.' : 'Formato simple restaurado.');
    } catch (error) { notify((error as Error).message); }
  };

  const applyDimensionUpdate = (wMm: number, hMm: number) => {
    const safeW = roundMm(Math.max(1, Math.min(900, wMm)), 3);
    const safeH = roundMm(Math.max(1, Math.min(600, hMm)), 3);

    const updated: LabelDesign = {
      ...labelDesign,
      widthMm: safeW,
      heightMm: safeH,
    };

    if (updated.fold) {
      try { pushStateWithHistory(arrangeFoldedLabel(updated, updated.fold)); }
      catch (error) { notify((error as Error).message); }
      return;
    }
    // Centrar los elementos geométricamente manteniendo intacto tamaño y relación de aspecto
    const centeredElements = centerAllElementsGeometrically(
      labelDesign.elements,
      updated,
      'label_center'
    );

    pushStateWithHistory({
      ...updated,
      elements: centeredElements,
    });
  };

  const handleApplyDimensionPreset = (w: number, h: number) => {
    applyDimensionUpdate(w, h);
    notify(`Medida actualizada a ${w} × ${h} mm.`);
  };

  const handleWidthInputChange = (val: string) => {
    setInputWidthStr(val);
    const parsed = parseDimensionValue(val, dimensionUnit);
    if (parsed.valid) {
      applyDimensionUpdate(parsed.valueMm, labelDesign.heightMm);
    }
  };

  const handleWidthInputBlur = () => {
    const parsed = parseDimensionValue(inputWidthStr, dimensionUnit);
    if (!parsed.valid) {
      setInputWidthStr(formatDimensionValue(labelDesign.widthMm, dimensionUnit));
    }
  };

  const handleHeightInputChange = (val: string) => {
    setInputHeightStr(val);
    const parsed = parseDimensionValue(val, dimensionUnit, 600);
    if (parsed.valid) {
      applyDimensionUpdate(labelDesign.widthMm, parsed.valueMm);
    }
  };

  const handleHeightInputBlur = () => {
    const parsed = parseDimensionValue(inputHeightStr, dimensionUnit);
    if (!parsed.valid) {
      setInputHeightStr(formatDimensionValue(labelDesign.heightMm, dimensionUnit));
    }
  };

  const handleFitLogoToSafeZone = () => {
    const adaptedElements = fitAllElementsToAvailableSpace(
      labelDesign.elements,
      labelDesign,
      0.9999, 'safe_zone_center'
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: adaptedElements,
    });
    notify('Diseño ajustado proporcionalmente al área segura.');
  };

  const handleUpdateLabelShape = (shape: LabelShapeType) => {
    const updated: LabelDesign = {
      ...labelDesign,
      shape,
      ...(shape === 'circle' ? { widthMm: Math.min(labelDesign.widthMm, labelDesign.heightMm), heightMm: Math.min(labelDesign.widthMm, labelDesign.heightMm) } : {}),
    };
    const centeredElements = centerAllElementsGeometrically(
      labelDesign.elements,
      updated,
      'label_center'
    );
    pushStateWithHistory({
      ...updated,
      elements: centeredElements,
    });
    notify(`Forma cambiada a ${shape}.`);
  };

  // ==========================================
  // PASO 3: ORIFICIOS
  // ==========================================

  const handleSetHolePreset = (preset: HolePreset) => {
    const updatedHoles: HoleConfiguration = {
      ...labelDesign.holes,
      preset,
      diameterMm: labelDesign.holes.diameterMm || 2.0,
      edgeDistanceMm: labelDesign.holes.edgeDistanceMm || 2.5,
      customHoles:
        preset === 'custom' && (!labelDesign.holes.customHoles || labelDesign.holes.customHoles.length === 0)
          ? [
              {
                id: 'hole-custom-1',
                x: roundMm(labelDesign.holes.edgeDistanceMm || 2.5),
                y: roundMm(labelDesign.heightMm / 2),
                diameterMm: labelDesign.holes.diameterMm || 2.0,
              },
            ]
          : labelDesign.holes.customHoles,
    };

    const nextDesign: LabelDesign = {
      ...labelDesign,
      holes: updatedHoles,
    };

    // Si los nuevos agujeros invaden el logo, avisar o re-adaptar
    pushStateWithHistory(nextDesign);
    notify(
      preset === 'none'
        ? 'Etiqueta sin orificios.'
        : `Orificios configurados: ${preset} (${updatedHoles.diameterMm} mm de diámetro).`
    );
  };

  const handleUpdateHoleDiameter = (diam: number) => {
    const safeD = Math.max(0.5, Math.min(10, diam));
    pushStateWithHistory({
      ...labelDesign,
      holes: {
        ...labelDesign.holes,
        diameterMm: safeD,
      },
    });
  };

  const handleUpdateHoleEdgeDistance = (dist: number) => {
    const safeDist = Math.max(0.8, Math.min(labelDesign.widthMm / 2 - 1, dist));
    pushStateWithHistory({
      ...labelDesign,
      holes: {
        ...labelDesign.holes,
        edgeDistanceMm: safeDist,
      },
    });
  };

  // ==========================================
  // PASO 4: CENTRADO, AJUSTE Y MICROMOVIMIENTO
  // ==========================================

  // 1. Centrado Geométrico Exacto (Alinear contenido visible con centro físico W/2, H/2)
  const handleCenterLogoGeometrically = () => {
    if (labelDesign.elements.length === 0) return;
    const centeredEls = centerAllElementsGeometrically(
      labelDesign.elements,
      labelDesign,
      'label_center'
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: centeredEls,
    });
    notify(
      `Logotipo centrado geométricamente en el centro físico de la etiqueta (${roundMm(labelDesign.widthMm / 2, 2)}, ${roundMm(labelDesign.heightMm / 2, 2)} mm).`
    );
  };

  // 2. Centrado en Zona Libre entre orificios
  const handleCenterInSafeZone = () => {
    if (labelDesign.elements.length === 0) return;
    const centeredEls = centerAllElementsGeometrically(
      labelDesign.elements,
      labelDesign,
      'safe_zone_center'
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: centeredEls,
    });
    notify('Logotipo centrado en el área libre entre orificios.');
  };

  // 3. Ajustar al Espacio Disponible (Escala proporcional máxima a la zona segura)
  const [sewingMarginMm, setSewingMarginMm] = useState(2);
  const handleFitToAvailableSpace = (marginMm = labelDesign.safetyMarginMm) => {
    if (labelDesign.elements.length === 0) return;
    const fittedDesign = {...labelDesign, safetyMarginMm: marginMm};
    if (fittedDesign.fold) {
      try { pushStateWithHistory(arrangeFoldedLabel(fittedDesign, fittedDesign.fold)); }
      catch (error) { notify((error as Error).message); }
      return;
    }
    const fittedEls = fitAllElementsToAvailableSpace(
      labelDesign.elements,
      fittedDesign,
      0.9999,
      'safe_zone_center'
    );
    pushStateWithHistory({
      ...labelDesign,
      safetyMarginMm: marginMm,
      elements: fittedEls,
    });
    notify('Logotipo ajustado proporcionalmente al espacio seguro disponible.');
  };

  // 4. Ajuste Óptico / Micromovimiento (0.1 mm y 0.01 mm)
  const handleExactRotation = (degrees:number) => {
    if (!selectedElement) return;
    pushStateWithHistory({...labelDesign,elements:labelDesign.elements.map(el=>el.id===selectedElement.id?rotateArtworkExactly(el,degrees):el)});
  };

  const handleNudge = (deltaX: number, deltaY: number) => {
    if (!selectedElement) return;
    const nudged = nudgeElementMm(selectedElement, deltaX, deltaY, labelDesign);
    const updatedEls = labelDesign.elements.map((el) =>
      el.id === selectedElement.id ? nudged : el
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: updatedEls,
    });
  };

  // 5. Alineación rápida a bordes seguros
  const handleAlignToEdge = (alignment: EdgeAlignment) => {
    if (!selectedElement) return;
    const updated = alignArtwork(selectedElement, labelDesign, alignment);
    pushStateWithHistory({...labelDesign, elements: labelDesign.elements.map(el => el.id === updated.id ? updated : el)});
  };

  // 6. Cambio manual de tamaño en milímetros
  const handleUpdateElementSizeMm = (newW: number, newH?: number, xMm?: number, yMm?: number) => {
    if (!selectedElement) return;
    const norm = getElementNormalizedContentBounds(selectedElement);
    const aspect =
      selectedElement.aspectRatio > 0
        ? selectedElement.aspectRatio
        : selectedElement.widthMm / Math.max(0.1, selectedElement.heightMm);

    const safeW = Math.max(1.0, roundMm(newW, 2));
    const safeH =
      selectedElement.lockAspectRatio || newH === undefined
        ? roundMm(safeW / aspect, 2)
        : Math.max(1.0, roundMm(newH, 2));

    let updatedEl: LabelElement;
    if (selectedElement.type === 'vector_text') {
      const scaleFactor = selectedElement.heightMm > 0 ? safeH / selectedElement.heightMm : 1;
      const nextFontSize = roundMm(
        Math.max(0.8, selectedElement.fontSizeMm * scaleFactor),
        2
      );
      updatedEl = {
        ...selectedElement,
        widthMm: safeW,
        heightMm: safeH,
        fontSizeMm: nextFontSize,
      };
    } else {
      updatedEl = {
        ...selectedElement,
        widthMm: safeW,
        heightMm: safeH,
      };
    }

    if (xMm !== undefined && yMm !== undefined) updatedEl = {...updatedEl, xMm, yMm};
    else {
      const before = getElementVisibleBoundingBoxMm(selectedElement);
      const after = getElementVisibleBoundingBoxMm(updatedEl);
      updatedEl = {...updatedEl, xMm: updatedEl.xMm+(before.minX+before.maxX-after.minX-after.maxX)/2,
        yMm: updatedEl.yMm+(before.minY+before.maxY-after.minY-after.maxY)/2};
    }
    const updatedEls = labelDesign.elements.map((el) =>
      el.id === selectedElement.id ? updatedEl : el
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: updatedEls,
    });
  };

  // ==========================================
  // PASO 5: PRODUCCIÓN (MATERIAL, CANTIDAD, ANIDADO)
  // ==========================================

  const handleSetRequestedQuantity = (qty: number) => {
    const safeQty = Math.max(1, Math.min(10000, Math.round(Number.isFinite(qty) ? qty : 1)));
    pushStateWithHistory(labelDesign, {
      ...nestingConfig,
      requestedQuantity: safeQty,
    });
    notify(`Cantidad de producción actualizada: ${safeQty} etiquetas.`);
  };

  const handleSelectMaterialSheet = (presetWidth: number, presetHeight: number) => {
    pushStateWithHistory(labelDesign, {
      ...nestingConfig,
      sheetWidthMm: presetWidth,
      sheetHeightMm: presetHeight,
    });
    notify(`Recorte de material definido en ${presetWidth} × ${presetHeight} mm.`);
  };

  // ==========================================
  // PASO 6: EXPORTADORES (SVG, DXF, PROYECTO, KERF)
  // ==========================================

  const requestLogoSave = (files: LogoOutputFile[]) => {
    setSaveName(logoFolderName || selectedElement?.name?.replace(/\.(png|jpe?g|svg)$/i, '') || projectName);
    setSaveError(null);
    setPendingFiles(files);
  };

  const triggerDownload = (_filename: string, content: string, mimeType: string) => {
    const name = mimeType === 'application/json' ? 'Proyecto.lhstudio.json'
      : mimeType === 'application/dxf' ? `Produccion_Tanda_${activeBatchIndex + 1}.dxf`
      : mimeType === 'image/svg+xml' ? 'Calibracion_Kerf.svg' : `Hoja_de_Taller_Tanda_${activeBatchIndex + 1}.txt`;
    requestLogoSave([{name, content}]);
  };

  const confirmLogoSave = async () => {
    if (!pendingFiles || savingFiles.current) return;
    const name = saveName.trim();
    const error = logoNameError(name);
    if (error) { setSaveError(error); return; }
    savingFiles.current = true; setIsSavingFiles(true); setSaveError(null);
    try {
      if (isTauri()) {
        const result = await invoke<{folder: string; files: string[]}>('save_logo_files', {logoName: name, files: pendingFiles});
        notify(`${result.files.length} archivo(s) guardado(s) en ${result.folder}`);
      } else {
        const bytes = logoFolderZip(name, pendingFiles);
        const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'}));
        const link = document.createElement('a'); link.href = url; link.download = `${name}_Astra_grabados_logo.zip`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('ZIP descargado con la carpeta Astra grabados logo y sus archivos. Descomprimilo para acceder.');
      }
      setLogoFolderName(name); setPendingFiles(null);
    } catch (error) {
      setSaveError(`No se pudo completar el guardado: ${error instanceof Error ? error.message : String(error)}. Podés reintentar.`);
    } finally { savingFiles.current = false; setIsSavingFiles(false); }
  };

  const handleExportSvg = () => {
    try {
      const files = (['engrave_only', 'cut_only'] as const).map(mode => ({
        name: `${mode === 'engrave_only' ? 'Grabado' : 'Corte'}_Tanda_${activeBatchIndex + 1}.svg`,
        content: exportProductionSvg(labelDesign, nestingResult, activeMaterial, {mode, batchIndex: activeBatchIndex}).svgContent,
      }));
      requestLogoSave([...files, {name: 'Ajustes_LightBurn.txt', content: lightburnGuide(lightburnProfile)}]);
    } catch (err) { notify(`Error al preparar grabado y corte: ${(err as Error).message}`); }
  };

  const handleExportDxf = () => {
    try {
      const artifact = exportProductionDxf(
        labelDesign,
        nestingResult,
        activeBatchIndex
      );
      triggerDownload(artifact.filenameSuggested, artifact.dxfContent, 'application/dxf');

    } catch (err) {
      notify(`Error al exportar DXF: ${(err as Error).message}`);
    }
  };

  const handleExportSummaryReport = () => {
    try {
      const artifact = generateProductionSummaryReport({
        project: {
          id: activeOrderId,
          projectName,
          clientName,
          notes: orderNotes,
        },
        design: labelDesign,
        material: activeMaterial,
        nesting: nestingResult,
        batchIndex: activeBatchIndex,
      });
      triggerDownload(artifact.filenameSuggested, artifact.reportText, 'text/plain');

    } catch (err) {
      notify(`Error al generar resumen: ${(err as Error).message}`);
    }
  };

  const openProject = (ord: OrderProject) => {
    setLogoFolderName('');
    setActiveOrderId(ord.id); setProjectName(ord.projectName); setClientName(ord.clientName);
    setOrderNotes(ord.notes); setSelectedMaterialId(ord.materialId);
    if (ord.materialProfileSnapshot) setMaterials(prev => [...prev.filter(m => m.id !== ord.materialId), ord.materialProfileSnapshot]);
    setSelectedElementId(ord.labelDesign.elements[0]?.id ?? null);
    setLabelDesign(structuredClone(ord.labelDesign)); setNestingConfig({...structuredClone(ord.nestingConfig), layoutMode: ord.nestingConfig.layoutMode ?? 'blocks'});
    setActiveBatchIndex(0);
    setHistory([{labelDesign: structuredClone(ord.labelDesign), nestingConfig: {...structuredClone(ord.nestingConfig), layoutMode: ord.nestingConfig.layoutMode ?? 'blocks'}, materialId: ord.materialId}]);
    setHistoryIndex(0); setIsOrdersModalOpen(false); setCurrentStep('logo');
    notify(`Pedido "${ord.projectName}" abierto.`);
  };

  const handleSaveOrderProject = () => {
    const project: OrderProject = {
      id: activeOrderId || `order-${Date.now()}`,
      projectName,
      clientName,
      createdAt: orders.find(order => order.id === activeOrderId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: orderNotes,
      materialId: selectedMaterialId,
      materialProfileSnapshot: activeMaterial,
      labelDesign,
      nestingConfig,
      exportedFilesHistory: orders.find(order => order.id === activeOrderId)?.exportedFilesHistory ?? [],
    };
    const jsonStr = serializeOrderProjectToJson(project);
    let catalogSaved = true;
    try { setOrders(upsertOrderProject(orders, project)); }
    catch { catalogSaved = false; }
    triggerDownload(`${projectName.replace(/\s+/g, '_')}.lhstudio.json`, jsonStr, 'application/json');
    if (!catalogSaved) notify('El catálogo local no se guardó. Guardá el archivo del proyecto para conservarlo.');
  };

  const handleDownloadKerfPattern = () => {
    const artifact = generateKerfCalibrationPatternSvg(activeMaterial.name);
    triggerDownload(artifact.filenameSuggested, artifact.svgContent, 'image/svg+xml');

  };

  const handleCreateNewBlankOrder = () => {
    const blank = createBlankLabelDesign(20, 10, 'rounded_rect');
    const newOrder: OrderProject = {
      id: `order-new-${Date.now()}`,
      projectName: 'Nuevo Pedido 20x10',
      clientName: 'Cliente Nuevo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: '',
      materialId: 'ECOCUERO_SUELA',
      materialProfileSnapshot: INITIAL_MATERIALS_CATALOG[0],
      labelDesign: blank,
      nestingConfig: {
        ...initialOrder.nestingConfig,
        layoutMode: 'blocks',
        requestedQuantity: 200,
      },
      exportedFilesHistory: [],
    };
    setSelectedElementId(null);
    setActiveBatchIndex(0);
    setLogoFolderName('');
    setActiveOrderId(newOrder.id);
    setProjectName(newOrder.projectName);
    setClientName(newOrder.clientName);
    setOrderNotes(newOrder.notes);
    setSelectedMaterialId(newOrder.materialId);
    setLabelDesign(newOrder.labelDesign);
    setNestingConfig(newOrder.nestingConfig);
    setHistory([
      {
        labelDesign: structuredClone(newOrder.labelDesign),
        nestingConfig: structuredClone(newOrder.nestingConfig),
        materialId: newOrder.materialId,
      },
    ]);
    setHistoryIndex(0);
    setCurrentStep('logo');
    notify('Nuevo pedido iniciado (Etiqueta en blanco 20×10 mm sin agujeros).');
  };

  // Navegación secuencial Atrás / Continuar
  const filteredOrders = orders.filter(order =>
    `${order.projectName} ${order.clientName}`.toLowerCase().includes(orderSearchQuery.trim().toLowerCase()));
  const currentStepIndex = WIZARD_STEPS.findIndex((s) => s.id === currentStep);

  const handleGoNext = () => {
    if (currentStepIndex < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[currentStepIndex + 1].id);
    }
  };

  const handleGoPrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(WIZARD_STEPS[currentStepIndex - 1].id);
    }
  };

  // ==========================================
  // RENDERIZADO PRINCIPAL
  // ==========================================

  return (
    <div className="studio-shell flex flex-col h-screen w-screen bg-[#090c10] text-slate-100 font-sans select-none overflow-hidden">
      {/* 1. TOP HEADER INDUSTRIAL */}
      <header className="studio-header h-13 bg-[#11161f] border-b border-slate-800 flex items-center justify-between px-4 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="studio-brand-mark"></span>
            <h1 className="studio-brand font-semibold text-white flex items-center gap-1.5">
              <span>Astra Studio</span>
            </h1>
          </div>
          <span className="text-slate-600">|</span>
          <div className="studio-project-fields flex items-center gap-2">
            <label><span>Pedido</span><input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="bg-slate-900/80 border border-slate-700/80 text-xs px-2 py-1 rounded text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
              placeholder="Nombre del pedido"
              title="Nombre del proyecto"
            /></label>
            <label><span>Cliente</span><input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="bg-slate-900/80 border border-slate-700/80 text-xs px-2 py-1 rounded text-slate-400 focus:outline-none focus:border-cyan-500 font-medium"
              placeholder="Cliente"
              title="Cliente"
            /></label>
          </div>
        </div>

        {/* Acciones Rápidas de Proyecto y Undo/Redo */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-lg p-0.5 mr-2">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="Deshacer (Ctrl+Z)"
              className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="Rehacer (Ctrl+Y)"
              className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setIsOrdersModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 transition-colors"
            title="Catálogo de pedidos guardados"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Pedidos</span>
          </button>

          <button
            onClick={() => setIsRotaryOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 transition-colors"
            title="Generar archivo para accesorio rotativo"
          >
            <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Rotativo</span>
          </button>

          <label className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 cursor-pointer">
            Abrir archivo
            <input type="file" aria-label="Abrir archivo de proyecto" accept=".json,.lhstudio.json" className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { openProject(deserializeOrderProjectFromJson(await file.text())); }
                catch (err) { notify(`Error al abrir proyecto: ${(err as Error).message}`); }
                e.target.value = '';
              }} />
          </label>
          <button
            onClick={handleSaveOrderProject}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 transition-colors"
            title="Guardar archivo de proyecto editable (.lhstudio.json)"
          >
            <Save className="w-3.5 h-3.5 text-emerald-400" />
            <span>Guardar</span>
          </button>

          <button
            onClick={handleCreateNewBlankOrder}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-800 rounded text-cyan-300 transition-colors"
            title="Crear nueva etiqueta en blanco (sin agujeros por defecto)"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>+ Nuevo</span>
          </button>
        </div>
      </header>

      {/* 2. BARRA DE PROGRESO DEL ASISTENTE DE 6 PASOS */}
      <nav aria-label="Progreso del asistente" className="studio-steps h-11 bg-[#0d1117] border-b border-slate-800/90 flex items-center justify-between px-4 z-10 shrink-0">
        <div className="flex items-center gap-1 w-full max-w-5xl">
          {WIZARD_STEPS.map((step, idx) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStepIndex > idx;
            return (
              <React.Fragment key={step.id}>
                <button
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => setCurrentStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : isCompleted
                        ? 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800/80'
                        : 'text-slate-500 hover:text-slate-400 border border-transparent'
                  }`}
                >
                  <span
                    className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isActive
                        ? 'bg-cyan-500 text-slate-950 font-black'
                        : isCompleted
                          ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {step.number}
                  </span>
                  <span className="hidden sm:inline font-semibold">{step.label}</span>
                </button>
                {idx < WIZARD_STEPS.length - 1 && (
                  <div className="flex-1 max-w-6 h-px bg-slate-800 mx-1"></div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Resumen de Estado Rápido */}
        <div className="hidden lg:flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
          <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 font-mono text-cyan-400">
            {labelDesign.widthMm}×{labelDesign.heightMm} mm
          </span>
          <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 font-mono text-slate-300">
            {labelDesign.holes.preset === 'none' ? 'Sin orificios' : `${labelDesign.holes.diameterMm}mm agujeros`}
          </span>
          <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 font-mono text-amber-300">
            {nestingConfig.requestedQuantity} u.
          </span>
        </div>
      </nav>

      {/* 3. CONTENEDOR CENTRAL DEL ASISTENTE */}
      <main className="studio-main flex-1 flex overflow-hidden">
        {/* PANEL LATERAL DE CONTROLES DEL PASO ACTIVO (Ancho ~400px) */}
        <aside aria-label="Controles del paso actual" className="studio-sidebar w-105 min-w-[360px] max-w-[440px] bg-[#0d1117] border-r border-slate-800 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="studio-controls p-4 space-y-4" key={currentStep}>
            {/* Cabecera del paso */}
            <div className="studio-step-heading border-b border-slate-800/80 pb-3">
              <span className="text-[10px] font-bold tracking-wider uppercase text-cyan-400 font-mono">
                Paso {WIZARD_STEPS[currentStepIndex].number} de 6
              </span>
              <h2 className="text-sm font-bold text-white mt-0.5">
                {WIZARD_STEPS[currentStepIndex].title}
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {WIZARD_STEPS[currentStepIndex].subtitle}
              </p>
            </div>

            {/* CONTENIDO ESPECÍFICO DEL PASO 1: IMPORTAR LOGO */}
            {currentStep === 'logo' && (
              <div className="space-y-4">
                {/* Zona de Drop para Archivos */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleImageUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  className="border-2 border-dashed border-slate-700 hover:border-cyan-500/80 rounded-xl p-5 text-center bg-slate-900/40 hover:bg-slate-900/80 transition-all cursor-pointer group"
                  onClick={() => {
                    const input = document.getElementById('logo-file-input') as HTMLInputElement;
                    input?.click();
                  }}
                >
                  <input
                    id="logo-file-input"
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleImageUpload(e.target.files[0]);
                      }
                    }}
                  />
                  <div className="w-10 h-10 rounded-full bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                    <Upload className="w-5 h-5 text-cyan-400" />
                  </div>
                  <p className="text-xs font-semibold text-slate-200">
                    Arrastrá el logotipo aquí o hacé clic para seleccionar
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1 font-mono">
                    Formatos admitidos: PNG, JPG y SVG vectorial
                  </p>
                </div>

                {/* Logos de Prueba Rápidos */}
                <div>
                  <details className="studio-disclosure"><summary>Probar con un logo de ejemplo</summary>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      onClick={() => handleLoadSampleLogo('svg_hex')}
                      className="px-2 py-1.5 text-[11px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 font-medium text-center"
                    >
                      SVG Hexágono
                    </button>
                    <button
                      onClick={() => handleLoadSampleLogo('svg_hollow')}
                      className="px-2 py-1.5 text-[11px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 font-medium text-center"
                    >
                      SVG Huecos
                    </button>
                    <button
                      onClick={() => handleLoadSampleLogo('png_sample')}
                      className="px-2 py-1.5 text-[11px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 font-medium text-center"
                    >
                      PNG Emblema
                    </button>
                  </div></details>
                </div>

                {/* Si hay un elemento seleccionado, mostrar diagnósticos y controles de ajuste */}
                {selectedElement ? (
                  <div className="space-y-3 bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">
                        {selectedElement.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 font-mono text-cyan-400">
                        {selectedElement.type === 'logo_svg' ? 'Vector SVG' : 'Imagen Raster'}
                      </span>
                    </div>

                    {/* Detección de transparencia y límites visibles */}
                    {selectedElement.contentBoundsNormalized && (
                      <div className="text-[11px] space-y-1 bg-slate-950/70 p-2 rounded border border-slate-800/80">
                        <div className="flex justify-between text-slate-400">
                          <span>Área visible detectada:</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {roundMm(selectedElement.widthMm * selectedElement.contentBoundsNormalized.width, 2)} ×{' '}
                            {roundMm(selectedElement.heightMm * selectedElement.contentBoundsNormalized.height, 2)} mm
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Fondo detectado:</span>
                          <span className="font-mono text-slate-300">
                            {selectedElement.type === 'logo_raster' && selectedElement.processing.removeBackground
                              ? 'Fondo claro eliminado'
                              : 'Transparente / Nativo'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Advertencia de Resolución / Calidad (DPI) para imágenes Raster */}
                    {selectedElement.type === 'logo_raster' && selectedElement.processing.mode === 'raster' && (
                      <div
                        className={`p-2 rounded border text-[11px] flex items-start gap-1.5 ${
                          artworkDpi(selectedElement) >= 200
                            ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                            : 'bg-amber-950/30 border-amber-800/40 text-amber-300'
                        }`}
                      >
                        {artworkDpi(selectedElement) >= 200 ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                        )}
                        <div>
                          <div className="font-bold">
                            {artworkDpi(selectedElement) >= 200
                              ? `Resolución de origen (${Math.round(artworkDpi(selectedElement))} DPI)`
                              : `Calidad baja (${Math.round(artworkDpi(selectedElement))} DPI)`}
                          </div>
                          <div className="text-[10px] opacity-90">
                            {artworkDpi(selectedElement) >= 200
                              ? 'DPI de la imagen al tamaño actual. El intervalo de grabado se configura por separado en LightBurn.'
                              : 'Recomendado ≥ 200 DPI para evitar bordes pixelados.'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Controles de procesado si es imagen raster */}
                    {selectedElement.type === 'logo_raster' && (
                      <fieldset disabled={isProcessingImage} aria-busy={isProcessingImage} className="space-y-2 pt-2 border-t border-slate-800 text-xs min-w-0">
                        <div className="flex items-center justify-between">
                          <label className="text-slate-300 flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedElement.processing.removeBackground}
                              onChange={(e) =>
                                handleUpdateImageProcessing({ removeBackground: e.target.checked })
                              }
                              className="rounded bg-slate-800 border-slate-700 text-cyan-500"
                            />
                            <span>Eliminar fondo claro</span>
                          </label>
                          <label className="text-slate-300 flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedElement.processing.invert}
                              onChange={(e) =>
                                handleUpdateImageProcessing({ invert: e.target.checked })
                              }
                              className="rounded bg-slate-800 border-slate-700 text-cyan-500"
                            />
                            <span>Invertir grabado</span>
                          </label>
                        </div>

                        {/* Sliders de Umbral y Contraste */}
                        <div>
                          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                            <span>Umbral de grabado:</span>
                            <span className="font-mono text-cyan-400">
                              {selectedElement.processing.threshold}
                            </span>
                          </div>
                          <input
                            aria-label="Umbral de grabado" type="range"
                            min="40"
                            max="220"
                            value={selectedElement.processing.threshold}
                            onChange={(e) =>
                              handleUpdateImageProcessing({ threshold: Number(e.target.value) })
                            }
                            className="w-full accent-cyan-500 cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                            <span>Contraste:</span>
                            <span className="font-mono text-cyan-400">
                              {selectedElement.processing.contrast}
                            </span>
                          </div>
                          <input
                            aria-label="Contraste" type="range"
                            min="-50"
                            max="80"
                            value={selectedElement.processing.contrast}
                            onChange={(e) =>
                              handleUpdateImageProcessing({ contrast: Number(e.target.value) })
                            }
                            className="w-full accent-cyan-500 cursor-pointer"
                          />
                        </div>

                        {/* Modo de salida */}
                        <div className="pt-1 flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">Modo de grabado:</span>
                          <div className="flex gap-1 text-[11px]">
                            <button
                              onClick={() => handleUpdateImageProcessing({ mode: 'raster' })}
                              className={`px-2 py-0.5 rounded ${
                                selectedElement.processing.mode === 'raster'
                                  ? 'bg-cyan-500 text-slate-950 font-bold'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              Monocromático
                            </button>
                            <button
                              onClick={() => handleUpdateImageProcessing({ mode: 'vector' })}
                              className={`px-2 py-0.5 rounded ${
                                selectedElement.processing.mode === 'vector'
                                  ? 'bg-cyan-500 text-slate-950 font-bold'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              Vectorizar
                            </button>
                          </div>
                        </div>
                        {isProcessingImage && <p role="status">Procesando imagen…</p>}
                      </fieldset>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded bg-slate-900/40 border border-slate-800 text-xs text-slate-500 text-center">
                    Carga un archivo o utiliza un logo de muestra para continuar.
                  </div>
                )}
              </div>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 2: MEDIDAS Y FORMA */}
            {currentStep === 'dimensions' && (
              <div className="space-y-4 text-xs">
                <div className="space-y-2 rounded-lg border border-cyan-900 bg-slate-900 p-3">
                  <label className="block">Formato de etiqueta
                    <select aria-label="Formato de etiqueta" value={labelDesign.fold ? 'fold' : 'plain'} onChange={e=>applyFold(e.target.value==='fold'?{axis:'horizontal',faces:'both'}:null)} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                      <option value="plain">Simple</option><option value="fold">Para doblar</option>
                    </select>
                  </label>
                  {labelDesign.fold && <>
                    <label className="block">Dirección del doblez
                      <select aria-label="Dirección del doblez" value={labelDesign.fold.axis} onChange={e=>applyFold({...labelDesign.fold!,axis:e.target.value as FoldOptions['axis']})} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                        <option value="horizontal">Horizontal · mitad superior e inferior</option><option value="vertical">Vertical · mitad izquierda y derecha</option>
                      </select>
                    </label>
                    <label className="block">Logo en las caras
                      <select aria-label="Logo en las caras" value={labelDesign.fold.faces} onChange={e=>applyFold({...labelDesign.fold!,faces:e.target.value as FoldOptions['faces']})} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                        <option value="both">Ambas caras</option><option value="one">Una cara</option>
                      </select>
                    </label>
                    <p className="text-cyan-200">Pieza abierta: {labelDesign.widthMm} × {labelDesign.heightMm} mm. Doblada: {labelDesign.fold.axis==='vertical'?labelDesign.widthMm/2:labelDesign.widthMm} × {labelDesign.fold.axis==='horizontal'?labelDesign.heightMm/2:labelDesign.heightMm} mm.</p>
                    <p className="text-slate-400">Rectangular, sin orificios. La línea central es solo una guía y no se exporta. En horizontal, el reverso gira 180°; las letras no se reflejan. Después de cambiar el logo, usá Reacomodar caras.</p>
                    <button onClick={()=>applyFold(labelDesign.fold!)} className="w-full rounded bg-cyan-900 p-2">Reacomodar caras</button>
                  </>}
                </div>
                {/* Selector de unidad mm / cm */}
                <div className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-300 font-semibold text-xs">Unidad de medida:</span>
                  <div className="flex gap-1 bg-slate-950 p-1 rounded border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setDimensionUnit('mm')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                        dimensionUnit === 'mm'
                          ? 'bg-cyan-500 text-slate-950 shadow-sm font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Milímetros (mm)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDimensionUnit('cm')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                        dimensionUnit === 'cm'
                          ? 'bg-cyan-500 text-slate-950 shadow-sm font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Centímetros (cm)
                    </button>
                  </div>
                </div>

                {/* Presets frecuentes de taller */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-400 font-semibold">
                      Medidas frecuentes de taller:
                    </span>
                    {STANDARD_DIMENSION_PRESETS.some(
                      (p) =>
                        Math.abs(p.widthMm - labelDesign.widthMm) < 0.05 &&
                        Math.abs(p.heightMm - labelDesign.heightMm) < 0.05
                    ) ? (
                      <span className="text-[10px] text-cyan-400 font-mono">Preset sugerido</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        Personalizada
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {STANDARD_DIMENSION_PRESETS.map((p) => {
                      const isSelected =
                        Math.abs(labelDesign.widthMm - p.widthMm) < 0.05 &&
                        Math.abs(labelDesign.heightMm - p.heightMm) < 0.05;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => handleApplyDimensionPreset(p.widthMm, p.heightMm)}
                          className={`px-2 py-1.5 rounded font-mono text-[11px] border transition-all ${
                            isSelected
                              ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-sm'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Dimensiones físicas personalizadas */}
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-slate-300 font-semibold">
                    <span>Medidas personalizadas:</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-bold">
                      {labelDesign.widthMm} × {labelDesign.heightMm} mm
                      {` (${roundMm(labelDesign.widthMm / 10, 2)} × ${roundMm(labelDesign.heightMm / 10, 2)} cm)`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-slate-400 text-xs">
                          Ancho ({dimensionUnit}):
                        </label>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {dimensionUnit === 'cm'
                            ? `${labelDesign.widthMm} mm`
                            : `${roundMm(labelDesign.widthMm / 10, 2)} cm`}
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={inputWidthStr}
                        onChange={(e) => handleWidthInputChange(e.target.value)}
                        onBlur={handleWidthInputBlur}
                        placeholder={dimensionUnit === 'cm' ? '4' : '40'}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 px-2.5 py-1.5 rounded text-white font-mono text-xs outline-none"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-slate-400 text-xs">
                          Alto ({dimensionUnit}):
                        </label>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {dimensionUnit === 'cm'
                            ? `${labelDesign.heightMm} mm`
                            : `${roundMm(labelDesign.heightMm / 10, 2)} cm`}
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={inputHeightStr}
                        onChange={(e) => handleHeightInputChange(e.target.value)}
                        onBlur={handleHeightInputBlur}
                        placeholder={dimensionUnit === 'cm' ? '2' : '20'}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 px-2.5 py-1.5 rounded text-white font-mono text-xs outline-none"
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-400 leading-tight">
                    * Acepta coma o punto decimal libremente (ej. 4 × 2 cm = 40 × 20 mm, 3,5 × 1,5 cm = 35 × 15 mm).
                  </p>
                </div>

                {/* Alerta visible si el logo excede la nueva zona segura */}
                {!safeZoneCheck.fits && (
                  <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-lg flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-amber-300 text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                      <div>
                        <span>El diseño excede el área segura para {labelDesign.widthMm} × {labelDesign.heightMm} mm.</span>
                        <p className="text-[11px] text-amber-300/80 font-normal mt-0.5">
                          El logo se mantiene centrado con su escala original. Podés adaptarlo automáticamente:
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleFitLogoToSafeZone}
                      className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs rounded border border-amber-500/40 font-semibold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Ajustar logo al área disponible con 1 clic
                    </button>
                  </div>
                )}

                {/* Selector de Forma */}
                <div>
                  <span className="text-slate-400 font-semibold block mb-1.5">
                    Forma de la etiqueta:
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'rounded_rect', label: 'Esquinas redondeadas' },
                      { id: 'rectangle', label: 'Rectangular recta' },
                      { id: 'circle', label: 'Circular' },
                      { id: 'oval', label: 'Ovalada' },
                      { id: 'capsule', label: 'Cápsula' },
                      { id: 'octagon_tag', label: 'Octágono Tag' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleUpdateLabelShape(s.id as LabelShapeType)}
                        className={`px-2 py-1.5 rounded text-left border text-[11px] transition-colors ${
                          labelDesign.shape === s.id
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500 font-bold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Radio de esquina si es rounded_rect */}
                {labelDesign.shape === 'rounded_rect' && (
                  <div className="bg-slate-900/60 p-2.5 rounded border border-slate-800">
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>Radio de esquina:</span>
                      <span className="font-mono text-cyan-400">{labelDesign.cornerRadiusMm} mm</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max={Math.min(10, Math.min(labelDesign.widthMm, labelDesign.heightMm) / 2)}
                      step="0.5"
                      value={labelDesign.cornerRadiusMm}
                      onChange={(e) =>
                        pushStateWithHistory({
                          ...labelDesign,
                          cornerRadiusMm: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 3: ORIFICIOS */}
            {currentStep === 'holes' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h3 className="font-bold text-slate-200 text-xs mb-1">¿La etiqueta lleva orificios?</h3>
                  <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                    Si se aplicará con remaches o costura, selecciona la distribución deseada.
                  </p>

                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'none', label: 'Sin agujeros (Lisa)', desc: 'Predeterminado' },
                      { id: 'single_left', label: '1 Agujero lateral', desc: 'Llaveros' },
                      { id: 'single_top', label: '1 Agujero superior', desc: 'Colgantes' },
                      { id: 'two_horizontal', label: '2 Agujeros laterales', desc: 'Costura horizontal' },
                      { id: 'two_vertical', label: '2 Agujeros verticales', desc: 'Costura vertical' },
                      { id: 'four_corners', label: '4 Agujeros en esquinas', desc: 'Remachado perimetral' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleSetHolePreset(opt.id as HolePreset)}
                        className={`p-2 rounded border text-left transition-all ${
                          labelDesign.holes.preset === opt.id
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500 font-bold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
                        }`}
                      >
                        <div className="font-semibold text-[11px]">{opt.label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Si no lleva agujeros, mensaje despejado */}
                {labelDesign.holes.preset === 'none' ? (
                  <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>Etiqueta lisa sin orificios. Todo el espacio interior queda libre para el grabado.</span>
                  </div>
                ) : (
                  /* Controles paramétricos de agujeros */
                  <div className="space-y-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-slate-400 block mb-1">Diámetro (mm):</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="8"
                          aria-label="Diámetro de orificios (mm)" value={labelDesign.holes.diameterMm}
                          onChange={(e) => handleUpdateHoleDiameter(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 block mb-1">Distancia al borde (mm):</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="20"
                          value={labelDesign.holes.edgeDistanceMm}
                          onChange={(e) => handleUpdateHoleEdgeDistance(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                        />
                      </div>
                    </div>

                    {/* Verificación de invasión de logo sobre orificios */}
                    {validationReport.engraveInvasionCount > 0 && (
                      <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs space-y-1.5">
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                          <span>El grabado actual invade los orificios</span>
                        </div>
                        <p className="text-[11px] text-amber-200/90 leading-relaxed">
                          Se detectó invasión del logotipo sobre los agujeros de costura.
                        </p>
                        <button
                          onClick={() => handleFitToAvailableSpace()}
                          className="w-full py-1 px-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] transition-colors"
                        >
                          ⚡ Ajustar logo para no invadir orificios
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 4: CENTRADO Y Tamaño del grabado */}
            {currentStep === 'engraving' && (
              <fieldset disabled={!selectedElement} className="space-y-4 text-xs min-w-0">
                {!selectedElement && <p className="studio-notice">Cargá un logo en el primer paso para ajustar el grabado.</p>}
                {/* Herramientas Principales de Centrado */}
                <div className="space-y-2">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
                    Posición del logo
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleCenterLogoGeometrically}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-colors shadow-sm"
                      title="Alinear contenido visible exactamente con el centro físico de la etiqueta"
                    >
                      <Target className="w-4 h-4" />
                      <span>Centrar logo</span>
                    </button>
                    <button
                      onClick={handleCenterInSafeZone}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors"
                      title="Centrar en el área libre entre agujeros"
                    >
                      <Move className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Entre orificios</span>
                    </button>
                  </div>
                </div>

                {/* Ajuste de Tamaño Proporcional */}
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
                    Tamaño del Grabado
                  </span>
                  <button
                    onClick={() => handleFitToAvailableSpace(0.5)}
                    className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Máximo tamaño del logo</span>
                  </button>
                  <p className="text-xs text-slate-400">Conserva las proporciones, centra el dibujo visible y respeta los orificios. El ajuste máximo deja 0,5 mm al borde.</p>
                  <label className="block text-xs text-slate-300">Margen para costura por lado (mm)
                    <input type="number" aria-label="Margen para costura (mm)" min="0.5" max={Math.min(labelDesign.widthMm,labelDesign.heightMm)*0.35} step="0.1" value={sewingMarginMm}
                      onChange={e => setSewingMarginMm(Math.max(0.5,Math.min(Math.min(labelDesign.widthMm,labelDesign.heightMm)*0.35,Number(e.target.value)||0.5)))}
                      className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2" />
                  </label>
                  <button onClick={() => handleFitToAvailableSpace(sewingMarginMm)} className="w-full py-2 rounded bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-semibold">Acomodar para costura</button>

                  {selectedElement && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-slate-400 block mb-1 text-[11px]">Ancho visible (mm):</label>
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max={labelDesign.widthMm}
                          value={roundMm(
                            selectedElement.widthMm *
                              getElementNormalizedContentBounds(selectedElement).width,
                            2
                          )}
                          onChange={(e) => handleUpdateElementSizeMm(Number(e.target.value) / getElementNormalizedContentBounds(selectedElement).width)}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 block mb-1 text-[11px]">Alto visible (mm):</label>
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max={labelDesign.heightMm}
                          value={roundMm(
                            selectedElement.heightMm *
                              getElementNormalizedContentBounds(selectedElement).height,
                            2
                          )}
                          onChange={(e) => {
                            const newH = Number(e.target.value) / getElementNormalizedContentBounds(selectedElement).height;
                            const aspect = selectedElement.widthMm / selectedElement.heightMm;
                            handleUpdateElementSizeMm(newH * aspect, newH);
                          }}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="studio-control-card space-y-2">
                  <label className="block text-slate-300">Logo a girar
                    <select aria-label="Logo a girar" value={selectedElement?.id ?? ''} onChange={e=>setSelectedElementId(e.target.value)} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                      {!selectedElement && <option value="">Seleccioná un logo</option>}
                      {labelDesign.elements.filter(el=>el.visible).map((el,i)=><option key={el.id} value={el.id}>{i+1}. {el.name}</option>)}
                    </select>
                  </label>
                  <label htmlFor="logo-angle" className="block text-slate-300">Rotación del logo</label>
                  <div className="flex items-center gap-2">
                    <input id="logo-angle" aria-label="Rotación del logo (grados)" type="number" step="0.1" className="w-24 bg-slate-950 border border-slate-700" disabled={!selectedElement} value={selectedElement?.rotationDeg ?? 0}
                      onChange={e => {if(Number.isFinite(e.target.valueAsNumber)) handleExactRotation(e.target.valueAsNumber);}} />
                    <span className="text-slate-400">grados</span>
                    <button disabled={!selectedElement} className="ml-auto bg-slate-800 px-3" onClick={()=>handleExactRotation(0)}>Restablecer</button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[0,90,180,270].map(angle=><button key={angle} disabled={!selectedElement} onClick={()=>handleExactRotation(angle)} className="rounded bg-slate-800 py-2 text-cyan-300" aria-label={`Fijar rotación a ${angle} grados`}>{angle}°</button>)}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[-90,-1,1,90].map(delta=><button key={delta} disabled={!selectedElement} onClick={()=>handleExactRotation((selectedElement?.rotationDeg ?? 0)+delta)} className="rounded bg-slate-800 py-2 text-slate-200" aria-label={`Girar ${delta} grados`}>{delta>0?'+':''}{delta}°</button>)}
                  </div>
                  <p className="text-xs text-slate-400">Gira solo el logo elegido, conservando su centro visible. En etiquetas dobladas podés seleccionar cada cara por separado. Si sobresale, reducí su tamaño; Reacomodar caras vuelve a la orientación automática del doblez.</p>
                </div>

                {/* Alineación Asistida a Bordes Seguros */}
                <div className="space-y-1.5 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block mb-1">
                    Alinear con los márgenes
                  </span>
                  <div className="grid grid-cols-3 gap-1 text-[11px]">
                    <button
                      onClick={() => handleAlignToEdge('safe_left')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-medium"
                    >
                      Margen Izq.
                    </button>
                    <button
                      onClick={() => handleAlignToEdge('center_x')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-cyan-300 font-medium"
                    >
                      Centrar X
                    </button>
                    <button
                      onClick={() => handleAlignToEdge('safe_right')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-medium"
                    >
                      Margen Der.
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px]">
                    <button
                      onClick={() => handleAlignToEdge('safe_top')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-medium"
                    >
                      Margen Sup.
                    </button>
                    <button
                      onClick={() => handleAlignToEdge('center_y')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-cyan-300 font-medium"
                    >
                      Centrar Y
                    </button>
                    <button
                      onClick={() => handleAlignToEdge('safe_bottom')}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-medium"
                    >
                      Margen Inf.
                    </button>
                  </div>
                </div>

                {/* Ajuste fino (0.1 mm y 0.01 mm) */}
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
                    Ajuste fino
                  </span>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Paso 0.1 mm:</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleNudge(-0.1, 0)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 font-mono"
                        title="Desplazar 0.1 mm a la izquierda"
                      >
                        ◄
                      </button>
                      <button
                        onClick={() => handleNudge(0, -0.1)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 font-mono"
                        title="Desplazar 0.1 mm hacia arriba"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handleNudge(0, 0.1)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 font-mono"
                        title="Desplazar 0.1 mm hacia abajo"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => handleNudge(0.1, 0)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 font-mono"
                        title="Desplazar 0.1 mm a la derecha"
                      >
                        ►
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Paso 0.01 mm (ultra-fino):</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleNudge(-0.01, 0)}
                        className="px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded text-slate-300 font-mono text-[10px]"
                        title="Desplazar 0.01 mm izquierda"
                      >
                        ◄
                      </button>
                      <button
                        onClick={() => handleNudge(0, -0.01)}
                        className="px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded text-slate-300 font-mono text-[10px]"
                        title="Desplazar 0.01 mm arriba"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handleNudge(0, 0.01)}
                        className="px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded text-slate-300 font-mono text-[10px]"
                        title="Desplazar 0.01 mm abajo"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => handleNudge(0.01, 0)}
                        className="px-1.5 py-0.5 bg-slate-800/80 hover:bg-slate-700 rounded text-slate-300 font-mono text-[10px]"
                        title="Desplazar 0.01 mm derecha"
                      >
                        ►
                      </button>
                    </div>
                  </div>
                </div>

                {/* Advertencia si el grabado invade orificios o contornos */}
                {validationReport.engraveInvasionCount > 0 && (
                  <div className="p-3 rounded bg-red-950/40 border border-red-800/60 text-red-300 text-xs space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-red-400" />
                      <span>El grabado invade la línea de corte u orificios</span>
                    </div>
                    <button
                      onClick={() => handleFitToAvailableSpace()}
                      className="w-full py-1.5 px-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors"
                    >
                      ⚡ Auto-corregir a Zona Segura
                    </button>
                  </div>
                )}
              </fieldset>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 5: PRODUCCIÓN */}
            {currentStep === 'production' && (
              <div className="space-y-4 text-xs">
                <div className="studio-material">
                  <label htmlFor="production-material" className="block text-slate-300 font-semibold mb-2">Material</label>
                  <select id="production-material" value={selectedMaterialId}
                    onChange={(e) => pushStateWithHistory(labelDesign, nestingConfig, e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded text-slate-200">
                    {materials.map((mat) => <option key={mat.id} value={mat.id}>{mat.name}</option>)}
                  </select>
                  <div className="flex items-center gap-2 mt-2 text-slate-400">
                    <span className="w-3 h-3 rounded-full border border-slate-600" style={{ backgroundColor: activeMaterial.visual.surfaceColor }} />
                    Espesor {activeMaterial.thicknessMm} mm
                  </div>
                </div>

                <label className="block text-slate-300 space-y-2">
                  <span>Distribución de etiquetas</span>
                  <select aria-label="Distribución de etiquetas" value={nestingConfig.layoutMode ?? 'blocks'}
                    onChange={e => pushStateWithHistory(labelDesign, {...nestingConfig, layoutMode: e.target.value as NonNullable<typeof nestingConfig.layoutMode>})}
                    className="w-full bg-slate-900 border border-slate-700 p-2 rounded">
                    <option value="5x10">5 columnas × 10 filas</option>
                    <option value="10x5">10 columnas × 5 filas</option>
                    <option value="5x5">5 columnas × 5 filas</option>
                    <option value="blocks">Automática según cantidad</option>
                    <option value="sheet">Aprovechar ancho de plancha</option>
                  </select>
                  <p className="text-xs text-slate-400">Las columnas van a lo ancho y las filas hacia abajo. Si la cantidad supera el bloque, se generan más tandas; si el material es pequeño, se adapta al espacio disponible.</p>
                </label>
                <label className="block rounded border border-cyan-900 bg-slate-900 p-3 space-y-2">
                  <span className="flex items-center gap-2"><input type="checkbox" aria-label="Corte por líneas compartidas" disabled={!supportsSharedCuts(labelDesign) || labelDesign.kerfCompensationMm!==0} checked={nestingConfig.sharedCutLines ?? false} onChange={e=>pushStateWithHistory(labelDesign,{...nestingConfig,sharedCutLines:e.target.checked,gapXMm:e.target.checked?0:0.1,gapYMm:e.target.checked?0:0.1})} />Corte por líneas compartidas</span>
                  <p className="text-xs text-slate-400">Disponible solo para rectángulos sin redondeo y sin compensación. Al cambiar a otra forma se activa el corte individual. Une las etiquetas con separación 0 y corta cada borde común una vez. Compensación de corte: 0. El ancho del haz reduce ligeramente el tamaño final.</p>
                </label>
                {/* Cantidad requerida con botones de 1 clic */}
                <div>
                  <span className="text-slate-400 font-semibold block mb-1.5">
                    Cantidad de etiquetas
                  </span>
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {STANDARD_QUANTITY_PRESETS.map((qty) => (
                      <button
                        key={qty}
                        onClick={() => handleSetRequestedQuantity(qty)}
                        className={`py-1.5 rounded font-mono text-xs border font-bold transition-all ${
                          nestingConfig.requestedQuantity === qty
                            ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
                        }`}
                      >
                        {qty}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">Personalizada:</span>
                    <input
                      type="number"
                      step="10"
                      min="1"
                      max="10000"
                      aria-label="Cantidad personalizada" value={nestingConfig.requestedQuantity}
                      onChange={(e) => handleSetRequestedQuantity(Number(e.target.value))}
                      className="w-24 bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                    />
                    <span className="text-slate-400 text-[11px]">unidades</span>
                  </div>
                </div>

                {/* Tamaño del recorte de material */}
                <div>
                  <span className="text-slate-400 font-semibold block mb-1.5">
                    Tamaño de plancha
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MATERIAL_SHEET_PRESETS.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => handleSelectMaterialSheet(s.widthMm, s.heightMm)}
                        className={`p-2 rounded text-left border text-[11px] transition-all ${
                          nestingConfig.sheetWidthMm === s.widthMm &&
                          nestingConfig.sheetHeightMm === s.heightMm
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500 font-bold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
                        }`}
                      >
                        <div className="font-semibold">{s.label}</div>
                        <div className="text-[10px] text-slate-400">{s.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Métricas de producción calculadas */}
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total a cortar:</span>
                    <span className="font-mono text-white font-bold">
                      {nestingResult.totalExportedQuantity} piezas
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tandas de corte:</span>
                    <span className="font-mono text-cyan-400 font-bold">
                      {nestingResult.totalBatches} {nestingResult.totalBatches === 1 ? 'tanda' : 'tandas'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Distribución por tanda:</span>
                    <span className="font-mono text-slate-300">
                      {activeBatch.columnsUsed} col × {activeBatch.rowsUsed} filas ({activeBatch.count} piezas)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Aprovechamiento:</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {activeBatch.sheetUtilizationPercent}%
                    </span>
                  </div>
                </div>

                {/* Opciones avanzadas de anidado y Kerf en acordeón */}
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowAdvancedProduction(!showAdvancedProduction)}
                    className="w-full p-2 bg-slate-900 flex items-center justify-between text-slate-400 hover:text-white text-xs font-semibold"
                  >
                    <span>Opciones avanzadas (Kerf y Separación)</span>
                    {showAdvancedProduction ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {showAdvancedProduction && (
                    <div className="p-3 bg-slate-950/70 space-y-2.5 text-xs border-t border-slate-800">
                      <div>
                        <div className="flex justify-between text-slate-400 mb-1">
                          <span>Compensación de Kerf (mm):</span>
                          <span className="font-mono text-cyan-400">
                            {labelDesign.kerfCompensationMm} mm
                          </span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="0.5"
                          value={labelDesign.kerfCompensationMm}
                          onChange={(e) =>
                            pushStateWithHistory({
                              ...labelDesign,
                              kerfCompensationMm: Number(e.target.value),
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 block mb-1">Separación X (mm):</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="20"
                            disabled={nestingConfig.sharedCutLines} aria-label="Separación horizontal (mm)" value={nestingConfig.gapXMm}
                            onChange={(e) =>
                              pushStateWithHistory(labelDesign, {
                                ...nestingConfig,
                                gapXMm: Number(e.target.value),
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-1">Separación Y (mm):</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="20"
                            disabled={nestingConfig.sharedCutLines} aria-label="Separación vertical (mm)" value={nestingConfig.gapYMm}
                            onChange={(e) =>
                              pushStateWithHistory(labelDesign, {
                                ...nestingConfig,
                                gapYMm: Number(e.target.value),
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs"
                          />
                        </div>
                      </div>

                      <button
                        onClick={handleDownloadKerfPattern}
                        className="w-full py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-medium text-[11px] flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar Patrón Calibración Kerf (100×20 mm)</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 6: REVISAR Y EXPORTAR */}
            {currentStep === 'export' && (
              <div className="space-y-4 text-xs">
                {/* Resumen Técnico */}
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
                    Resumen Técnico de Fabricación
                  </span>
                  <div className="space-y-1 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Etiqueta:</span>
                      <span className="font-mono font-bold text-white">
                        {labelDesign.widthMm} × {labelDesign.heightMm} mm ({SHAPE_LABELS[labelDesign.shape] ?? labelDesign.shape})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Orificios:</span>
                      <span className="font-mono text-cyan-400">
                        {labelDesign.holes.preset === 'none' ? 'Sin perforaciones' : `${HOLE_LABELS[labelDesign.holes.preset]} (${labelDesign.holes.diameterMm} mm)`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Material:</span>
                      <span className="font-mono text-amber-300">{activeMaterial.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cantidad Total:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {nestingResult.totalExportedQuantity} unidades
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tandas de corte:</span>
                      <span className="font-mono text-slate-300">
                        {nestingResult.totalBatches} ({activeBatch?.count ?? 0} u. en tanda {activeBatchIndex + 1})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <label className="block text-sm">Perfil sugerido para LightBurn
                    <select aria-label="Perfil sugerido para LightBurn" value={lightburnProfile} onChange={e=>setLightburnProfile(e.target.value as LightburnProfile)} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                      {Object.entries(LIGHTBURN_PROFILES).map(([key,p])=><option key={key} value={key}>{p.name} · {Math.round(25.4/p.interval)} DPI · {p.interval} mm</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-slate-400">La descarga incluye una guía para aplicar estos valores en LightBurn. El SVG no cambia los ajustes de la máquina. Velocidad y potencia requieren calibración para tu material.</p>
                </div>

                {/* Auditoría Geométrica en Vivo */}
                <div className="space-y-1.5 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
                    Auditoría de Validación Técnica
                  </span>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Escala física 1:1 en milímetros verificada</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Capas técnicas asignadas (#000000, #0000FF, #FF0000)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${validationReport.isValid ? 'text-emerald-400' : 'text-red-400'}`}>
                      {validationReport.isValid ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                      <span>{validationReport.isValid ? nestingConfig.sharedCutLines ? 'Líneas compartidas sin cortes duplicados' : 'Contornos cerrados y sin superposiciones' : 'Hay errores geométricos: revisar antes de exportar'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{validationReport.overlappingPiecesCount} colisiones entre piezas en plancha</span>
                    </div>
                  </div>
                </div>

                {validationReport.issues.map((issue, idx) => <p key={idx} className={issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>{issue.message}</p>)}
                {hasRasterExport && <p className="studio-notice">El logo contiene una imagen: usá SVG para conservar el grabado. DXF requiere vectorizarla en el paso Logo.</p>}
                <label className="block space-y-2">Tanda a exportar
                  <select aria-label="Tanda a exportar" className="w-full bg-slate-900 border border-slate-700" value={activeBatchIndex} onChange={e => setActiveBatchIndex(Number(e.target.value))}>
                    {nestingResult.batches.map((batch, index) => <option value={index} key={index}>Tanda {index + 1} · {batch.count} etiquetas</option>)}
                  </select>
                </label>
                <p className="text-slate-400">Cada archivo de corte contiene la tanda seleccionada. Descargá todas las tandas para completar el pedido.</p>
                <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 flex items-start gap-1.5">
                  <Info className="w-4 h-4 shrink-0 text-cyan-400 mt-0.5" />
                  <p className="leading-relaxed">
                    Revisá escala, capas y parámetros en tu software de corte. La vista previa no sustituye una prueba física en el material.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* BOTONERA DE NAVEGACIÓN INFERIOR (ATRÁS / CONTINUAR) */}
          <div className="studio-step-footer p-3 bg-[#11161f] border-t border-slate-800 flex items-center justify-between shrink-0">
            <button
              onClick={handleGoPrev}
              disabled={currentStepIndex === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:hover:bg-slate-800 transition-colors font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Atrás</span>
            </button>

            <button
              onClick={() => currentStep === 'export' ? setCurrentStep('engraving') : handleGoNext()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-30 disabled:hover:bg-cyan-600 font-bold transition-colors shadow-sm"
            >
              <span>{currentStep === 'export' ? 'Volver al diseño' : currentStepIndex === WIZARD_STEPS.length - 2 ? 'Revisar Pedido' : 'Continuar'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </aside>

        {/* ÁREA DE VISUALIZACIÓN PRINCIPAL (GRAN LIENZO EN VIVO) */}
        <section aria-label="Visualizador del diseño y mesa de corte" className="studio-workspace flex-1 flex flex-col bg-[#090c10] relative overflow-hidden">
          <div className="studio-workspace-heading">
            <div><span className="studio-eyebrow">{currentStep === 'production' ? 'Distribución' : currentStep === 'export' ? 'Entrega' : 'Diseño'}</span>
              <h3>{currentStep === 'production' ? 'Mesa de producción' : currentStep === 'export' ? 'Archivos del pedido' : 'Vista previa de la etiqueta'}</h3></div>
            <span className="studio-dimension-chip">{labelDesign.widthMm} × {labelDesign.heightMm} mm</span>
          </div>
          {/* Si estamos en paso 1, 2, 3 o 4: Mostrar el Canvas de Etiqueta */}
          {['logo', 'dimensions', 'holes', 'engraving'].includes(currentStep) && (
            <div className="flex-1 min-h-0 w-full relative">
              <LabelEditorCanvas
                design={labelDesign}
                material={activeMaterial}
                selectedElementId={selectedElementId}
                onSelectElement={(id) => setSelectedElementId(id)}
                onInteractionStart={() => { canvasInteraction.current = true; }}
                onInteractionEnd={() => { canvasInteraction.current = false; pushStateWithHistory(labelDesign); }}
                onMoveElement={(id, nx, ny) => {
                  const updatedEls = labelDesign.elements.map((el) =>
                    el.id === id ? { ...el, xMm: roundMm(nx, 2), yMm: roundMm(ny, 2) } : el
                  );
                  pushStateWithHistory({
                    ...labelDesign,
                    elements: updatedEls,
                  });
                }}
                onResizeElement={(id, nw, nh, x, y) => {
                  handleUpdateElementSizeMm(nw, nh, x, y);
                }}
                onRotateElement={(id, rot) => {
                  const updatedEls = labelDesign.elements.map((el) =>
                    el.id === id ? { ...el, rotationDeg: roundMm(rot, 1) } : el
                  );
                  pushStateWithHistory({
                    ...labelDesign,
                    elements: updatedEls,
                  });
                }}
                zoomLevel={zoomLevel}
                onZoomChange={setZoomLevel}
                showMillimeterGrid={showMillimeterGrid}
                showSafetyGuides={showSafetyGuides}
                snapToGridMm={snapToGridMm}
                renderStyle={renderStyle}
              />

              {/* Barra de herramientas flotante de vista previa */}
              <div className="studio-canvas-tools absolute bottom-3 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#11161f]/90 border border-slate-700/80 shadow text-xs text-slate-300 backdrop-blur-sm">
                <div className="studio-zoom">
                  <button aria-label="Alejar vista" disabled={zoomLevel <= 0.4} onClick={() => setZoomLevel(z => Math.max(.4, Math.round((z-.2)*10)/10))}><ZoomOut className="w-4 h-4" /></button>
                  <button aria-label="Ajustar vista a la ventana" title="Ajustar vista a la ventana" onClick={() => setZoomLevel(1)}>{Math.round(zoomLevel*100)}%</button>
                  <button aria-label="Acercar vista" disabled={zoomLevel >= 4} onClick={() => setZoomLevel(z => Math.min(4, Math.round((z+.2)*10)/10))}><ZoomIn className="w-4 h-4" /></button>
                </div>
                <button
                  onClick={() =>
                    setRenderStyle(
                      renderStyle === 'realistic_material'
                        ? 'technical_lightburn'
                        : 'realistic_material'
                    )
                  }
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-700/80 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {renderStyle === 'realistic_material'
                      ? 'Simulación orientativa'
                      : 'Capas técnicas LightBurn'}
                  </span>
                </button>
                <span className="text-slate-600">|</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMillimeterGrid}
                    onChange={(e) => setShowMillimeterGrid(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-cyan-500"
                  />
                  <span>Rejilla (mm)</span>
                </label>
                <span className="text-slate-600">|</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSafetyGuides}
                    onChange={(e) => setShowSafetyGuides(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-cyan-500"
                  />
                  <span>Ejes y cotas</span>
                </label>
              </div>
            </div>
          )}

          {/* Si estamos en paso 5: Mostrar la vista de Mesa de Producción (900x600 mm) */}
          {currentStep === 'production' && (
            <div className="flex-1 min-h-0 w-full relative">
              <ProductionBedPreview
                design={labelDesign}
                material={activeMaterial}
                nesting={nestingResult}
                validation={validationReport}
                activeBatchIndex={activeBatchIndex}
                onSelectBatchIndex={setActiveBatchIndex}
              />
            </div>
          )}

          {/* Si estamos en paso 6: Vista de Resumen y Auditoría Gráfica */}
          {currentStep === 'export' && (
            <div className="studio-export-view flex-1 min-h-0 w-full overflow-auto p-6 bg-[#090c10] flex flex-col items-center">
              <div className="max-w-2xl w-full bg-[#11161f] border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {validationReport.isValid ? 'Tu pedido está listo para exportar' : 'Exportación bloqueada: corregí la geometría'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {projectName} • Cliente: {clientName || 'General'}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${validationReport.isValid ? 'bg-emerald-950 border-emerald-700 text-emerald-300' : 'bg-red-950 border-red-700 text-red-300'}`}>
                    {validationReport.isValid ? '✓ Geometría verificada' : '⚠ Geometría inválida'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-center">
                    <span className="text-[11px] text-slate-400 block">Etiqueta</span>
                    <span className="text-sm font-bold text-white font-mono mt-1 block">
                      {labelDesign.widthMm} × {labelDesign.heightMm} mm
                    </span>
                    <span className="text-[10px] text-cyan-400 font-mono mt-0.5 block">
                      {SHAPE_LABELS[labelDesign.shape] ?? labelDesign.shape}
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-center">
                    <span className="text-[11px] text-slate-400 block">Cantidad Total</span>
                    <span className="text-sm font-bold text-emerald-400 font-mono mt-1 block">
                      {nestingResult.totalExportedQuantity} u.
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                      en {nestingResult.totalBatches} tanda(s)
                    </span>
                  </div>

                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-center">
                    <span className="text-[11px] text-slate-400 block">Material</span>
                    <span className="text-xs font-bold text-amber-300 mt-1 block truncate">
                      {activeMaterial.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                      {nestingConfig.sheetWidthMm} × {nestingConfig.sheetHeightMm} mm
                    </span>
                  </div>
                </div>

                {!validationReport.isValid && <div className="studio-export-errors" role="alert">
                  <p>Revisá los errores antes de descargar:</p>
                  <ul>{validationReport.issues.filter(issue => issue.severity === 'error').slice(0, 3).map((issue,index) => <li key={index}>{issue.message.replace(/"[^"]+"/g, 'del logo')}</li>)}</ul>
                </div>}
                {hasRasterExport && <p className="studio-notice">SVG conserva tu imagen. Para descargar DXF, primero vectorizá el logo.</p>}
                {/* Acciones principales de exportación */}
                <div className="space-y-3 pt-2">
                  <button
                    disabled={!validationReport.isValid || isProcessingImage}
                    onClick={handleExportSvg}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-transform hover:scale-[1.01]"
                  >
                    <Download className="w-5 h-5" />
                    <span>Descargar grabado y corte (SVG)</span>
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled={!validationReport.isValid || hasRasterExport || isProcessingImage}
                    title={hasRasterExport ? 'Para DXF, vectorizá el logo o usá SVG.' : undefined}
                    onClick={handleExportDxf}
                      className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                      <FileCode2 className="w-4 h-4 text-cyan-400" />
                      <span>Descargar DXF R12 (RDWorks)</span>
                    </button>
                    <button
                      onClick={handleExportSummaryReport}
                      className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                      <Save className="w-4 h-4 text-slate-400" />
                      <span>Descargar Hoja de Taller (TXT)</span>
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 text-center">Dos SVG separados: grabado y corte con orificios. Se guardan juntos en Astra grabados logo.</p>
                  <button onClick={handleSaveOrderProject} className="studio-secondary-action w-full">Guardar .lhstudio.json</button>
                  <p className="text-xs text-slate-400 text-center">Tanda {activeBatchIndex + 1} de {nestingResult.totalBatches} · {activeBatch?.count ?? 0} etiquetas en el archivo</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {pendingFiles && <dialog ref={saveDialog} className="studio-orders-dialog" aria-labelledby="save-logo-title"
        onCancel={event => { if (isSavingFiles) event.preventDefault(); else setPendingFiles(null); }}>
        <form className="p-6 space-y-4" onSubmit={event => {event.preventDefault(); void confirmLogoSave();}}>
          <h3 id="save-logo-title" className="font-semibold text-white">Guardar en Astra grabados logo</h3>
          <p className="text-sm text-slate-400">Elegí el nombre del logo. Sus archivos quedarán juntos en una carpeta con ese nombre.</p>
          <label className="block text-sm space-y-2"><span>Nombre del logo o archivo</span>
            <input autoFocus required disabled={isSavingFiles} value={saveName} onChange={event => {setSaveName(event.target.value); setSaveError(null);}}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2" aria-describedby="logo-save-destination" />
          </label>
          <div id="logo-save-destination" className="studio-notice text-sm break-words">
            <p>{isTauri() ? 'Escritorio / Astra grabados logo' : 'ZIP / Astra grabados logo'} / {saveName.trim() || 'Nombre del logo'}</p>
            <ul className="mt-2 space-y-1">{pendingFiles.map(file => <li key={file.name}>{file.name}</li>)}</ul>
          </div>
          <p className="text-xs text-slate-400">{isTauri() ? 'Si ya existen archivos con ese nombre, se guarda una nueva versión numerada.' : 'En el navegador se descarga un ZIP que conserva esta estructura de carpetas.'}</p>
          {saveError && <p role="alert" className="text-sm text-red-300">{saveError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={isSavingFiles} className="studio-secondary-action" onClick={() => setPendingFiles(null)}>Cancelar</button>
            <button type="submit" disabled={isSavingFiles} className="bg-cyan-600 text-white px-4 py-2">{isSavingFiles ? 'Guardando…' : isTauri() ? 'Guardar archivos' : 'Descargar carpeta ZIP'}</button>
          </div>
        </form>
      </dialog>}

      {isRotaryOpen && <RotaryPanel design={labelDesign} onClose={() => setIsRotaryOpen(false)} onSave={files => { setIsRotaryOpen(false); requestLogoSave(files); }} />}

      {/* 4. MODAL DE CATÁLOGO DE PEDIDOS */}
      {isOrdersModalOpen && (
        <dialog ref={ordersDialog} onCancel={() => setIsOrdersModalOpen(false)} aria-labelledby="orders-title" className="studio-orders-dialog">
          <div className="bg-[#11161f] border border-slate-800 rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="orders-title" className="font-bold text-sm text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-cyan-400" />
                <span>Biblioteca de Pedidos</span>
              </h3>
              <button
                onClick={() => setIsOrdersModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1"
              >
                Cerrar
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar pedidos por cliente o producto..."
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 px-3 py-1.5 rounded text-xs text-white focus:outline-none focus:border-cyan-500"
              />
              {orderSearchQuery && (
                <button
                  onClick={() => setOrderSearchQuery('')}
                  className="px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredOrders.length === 0 && <div className="studio-empty"><FolderOpen className="w-8 h-8" /><h4>No encontramos pedidos</h4><p>Probá con otro nombre de pedido o cliente.</p></div>}
              {filteredOrders                .map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="font-bold text-xs text-white">{ord.projectName}</div>
                      <div className="text-[11px] text-slate-400">
                        {ord.clientName} • {ord.labelDesign.widthMm}×{ord.labelDesign.heightMm} mm • {ord.nestingConfig.requestedQuantity} u.
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          openProject(ord);
                        }}
                        className="px-2.5 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium"
                      >
                        Abrir
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </dialog>
      )}

      {/* 5. TOAST DE NOTIFICACIÓN FLOTANTE */}
      {statusMessage && (
        <div role="status" aria-live="polite" className="studio-toast fixed bottom-4 right-4 z-50 bg-[#161b22] border border-cyan-500/60 shadow-xl rounded-lg px-3.5 py-2 text-xs text-cyan-200 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
