import {compatibleCutConfig, supportsSharedCuts} from './core/geometry/sharedCuts';
import {rotateArtworkExactly} from './core/geometry/preciseRotation';
import {arrangeFoldedLabel, unfoldLabel, placeFoldedFaces, scaleFoldedFaces, syncFoldedFaces, FoldOptions, FoldPlacement} from './core/geometry/foldedLabel';
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
import { VankWorkbenchModal } from './components/VankWorkbenchModal';
import { DEFAULT_ROTARY_CONFIG, RotaryConfig } from './core/rotary/rotaryEngine';
import {
  analyzeStepMaterialSavings,
  applyWorkbenchLayersToMaterialProfile,
  autoArrangeWorkbenchJobs,
  buildOptimalSavingNestingConfig,
  createWorkbenchJobFromOrder,
  evaluateBalancedLayoutPresets,
  syncLayersWithMaterialProfile,
} from './core/workbench/workbenchEngine';
import {
  detectExternalLaserFormat,
  importExternalLaserFile,
  mergeComplementaryImportedJobs,
  mergeImportedLayerUpdates,
} from './core/workbench/externalLaserFileImporter';
import {
  createDefaultWorkbenchConfig,
  ECOCUERO_BED_PASS_HEIGHT_MM,
  ECOCUERO_ROLL_TOTAL_LENGTH_MM,
  ECOCUERO_ROLL_WIDTH_MM,
  isEcocueroMaterial,
  LightBurnCutMode,
  VANK_9060_DEFAULT_IP,
  WorkbenchConfig,
  WorkbenchJobItem,
  WorkbenchLayerConfig,
} from './core/workbench/workbenchTypes';
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
  const [nestingConfig, setNestingConfig] = useState<NestingConfig>(() => {
    const isInitialEco =
      initialOrder.materialId === 'ECOCUERO_SUELA' ||
      isEcocueroMaterial(initialOrder.materialProfileSnapshot);
    const shouldNormalizeTo73cm =
      isInitialEco && initialOrder.nestingConfig.sheetWidthMm === 900;
    return compatibleCutConfig(initialOrder.labelDesign, {
      ...initialOrder.nestingConfig,
      sheetWidthMm: shouldNormalizeTo73cm
        ? ECOCUERO_ROLL_WIDTH_MM
        : initialOrder.nestingConfig.sheetWidthMm,
      layoutMode: initialOrder.nestingConfig.layoutMode ?? 'blocks',
    });
  });

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
  const [rotaryConfig, setRotaryConfig] = useState<RotaryConfig>(() => initialOrder.rotaryConfig ?? DEFAULT_ROTARY_CONFIG);
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState<boolean>(false);
  const [workbenchInitialView, setWorkbenchInitialView] = useState<
    'all' | 'layers' | 'jobs' | 'laser'
  >('all');
  const [workbenchConfig, setWorkbenchConfig] = useState<WorkbenchConfig>(() => {
    const mat = initialOrder.materialProfileSnapshot ?? INITIAL_MATERIALS_CATALOG[0];
    const isEco = isEcocueroMaterial(mat);
    return createDefaultWorkbenchConfig(
      isEco ? ECOCUERO_ROLL_WIDTH_MM : initialOrder.nestingConfig.sheetWidthMm,
      isEco ? ECOCUERO_BED_PASS_HEIGHT_MM : initialOrder.nestingConfig.sheetHeightMm,
      mat
    );
  });
  const [workbenchJobs, setWorkbenchJobs] = useState<WorkbenchJobItem[]>([]);
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

  const stepSavings = useMemo(
    () => analyzeStepMaterialSavings(labelDesign, nestingResult, activeBatchIndex),
    [labelDesign, nestingResult, activeBatchIndex]
  );

  const balancedPresets = useMemo(() => {
    const isEco = isEcocueroMaterial(activeMaterial);
    const baseCfg = isEco && nestingConfig.sheetWidthMm === 900
      ? {
          ...nestingConfig,
          sheetWidthMm: ECOCUERO_ROLL_WIDTH_MM,
          sheetHeightMm: ECOCUERO_BED_PASS_HEIGHT_MM,
        }
      : nestingConfig;
    return evaluateBalancedLayoutPresets(labelDesign, baseCfg);
  }, [labelDesign, nestingConfig, activeMaterial]);

  const formatSecToMinSec = (sec: number) => {
    const total = Math.max(1, Math.round(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  };

  const handleApplyMaxStepSaving = (useSharedCuts = false) => {
    const isEco = isEcocueroMaterial(activeMaterial);
    const baseCfg = isEco
      ? {
          ...nestingConfig,
          sheetWidthMm: ECOCUERO_ROLL_WIDTH_MM,
          sheetHeightMm: ECOCUERO_BED_PASS_HEIGHT_MM,
        }
      : nestingConfig;
    const optimalCfg = buildOptimalSavingNestingConfig(
      labelDesign,
      baseCfg,
      useSharedCuts
    );
    pushStateWithHistory(labelDesign, optimalCfg);
    notify(
      `🔥 Ahorro Máximo aplicado: Todo el ancho (${optimalCfg.sheetWidthMm} mm), margen 2 mm, separación ${optimalCfg.gapXMm} mm y rotación óptima.`
    );
  };

  const handleFillStepLastRow = () => {
    if (stepSavings.freeSlotsInLastRow <= 0) return;
    const nextQty = nestingConfig.requestedQuantity + stepSavings.freeSlotsInLastRow;
    pushStateWithHistory(labelDesign, {
      ...nestingConfig,
      requestedQuantity: nextQty,
    });
    notify(
      `+${stepSavings.freeSlotsInLastRow} etiquetas agregadas en el hueco libre de la última fila (0.0 cm de material adicional).`
    );
  };

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
    rawDesign: LabelDesign,
    nextNesting?: NestingConfig,
    nextMatId?: string
  ) => {
    // En etiquetas para doblar, la cara que no se tocó sigue a la que se editó.
    const nextDesign = syncFoldedFaces(latestDesign.current, rawDesign);
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

  // Estado editable local para dimensiones visibles del logo (evita saltos al borrar dígitos)
  const [logoWidthStr, setLogoWidthStr] = useState<string>('');
  const [logoHeightStr, setLogoHeightStr] = useState<string>('');
  const isEditingLogoSizeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!selectedElement) {
      setLogoWidthStr('');
      setLogoHeightStr('');
      return;
    }
    const norm = getElementNormalizedContentBounds(selectedElement);
    const visW = roundMm(selectedElement.widthMm * norm.width, 2);
    const visH = roundMm(selectedElement.heightMm * norm.height, 2);
    if (!isEditingLogoSizeRef.current) {
      setLogoWidthStr(String(visW));
      setLogoHeightStr(String(visH));
    }
  }, [
    selectedElement?.id,
    selectedElement?.widthMm,
    selectedElement?.heightMm,
    selectedElement?.contentBoundsNormalized,
  ]);

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

  const applyFold = (fold: FoldOptions | null, mode: 'refit' | 'preserve' = 'refit') => {
    try {
      const next = fold ? arrangeFoldedLabel(labelDesign, fold, mode) : unfoldLabel(labelDesign);
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
      try { pushStateWithHistory(arrangeFoldedLabel(updated, updated.fold, 'preserve')); }
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
    if (!selectedElement || selectedElement.locked) return;
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
  const handleUpdateElementSizeMm = (
    newW: number,
    newH?: number,
    xMm?: number,
    yMm?: number,
    targetElementId?: string
  ) => {
    const targetEl = targetElementId
      ? labelDesign.elements.find((el) => el.id === targetElementId) || selectedElement
      : selectedElement;
    if (!targetEl) return;

    const norm = getElementNormalizedContentBounds(targetEl);
    const visAspect =
      (targetEl.widthMm * norm.width) /
      Math.max(0.1, targetEl.heightMm * norm.height);
    const aspect =
      targetEl.aspectRatio > 0
        ? targetEl.aspectRatio
        : targetEl.widthMm / Math.max(0.1, targetEl.heightMm);

    const minBoxW = Math.max(0.2, roundMm(0.5 / Math.max(0.05, norm.width), 2));
    const minBoxH = Math.max(0.2, roundMm(0.5 / Math.max(0.05, norm.height), 2));
    const safeW = Math.max(minBoxW, roundMm(newW, 2));
    const safeH =
      targetEl.lockAspectRatio || newH === undefined
        ? Math.max(minBoxH, roundMm(safeW / aspect, 2))
        : Math.max(minBoxH, roundMm(newH, 2));
    const nextAspect =
      !targetEl.lockAspectRatio && newH !== undefined
        ? roundMm(safeW / Math.max(0.1, safeH), 4)
        : targetEl.aspectRatio || roundMm(visAspect, 4);

    let updatedEl: LabelElement;
    if (targetEl.type === 'vector_text') {
      const scaleFactor =
        targetEl.heightMm > 0 ? safeH / targetEl.heightMm : 1;
      const nextFontSize = roundMm(
        Math.max(0.8, targetEl.fontSizeMm * scaleFactor),
        2
      );
      updatedEl = {
        ...targetEl,
        widthMm: safeW,
        heightMm: safeH,
        aspectRatio: nextAspect,
        fontSizeMm: nextFontSize,
      };
    } else {
      updatedEl = {
        ...targetEl,
        widthMm: safeW,
        heightMm: safeH,
        aspectRatio: nextAspect,
      };
    }

    if (xMm !== undefined && yMm !== undefined) {
      updatedEl = { ...updatedEl, xMm, yMm };
    } else {
      const before = getElementVisibleBoundingBoxMm(targetEl);
      const after = getElementVisibleBoundingBoxMm(updatedEl);
      updatedEl = {
        ...updatedEl,
        xMm: updatedEl.xMm + (before.minX + before.maxX - after.minX - after.maxX) / 2,
        yMm: updatedEl.yMm + (before.minY + before.maxY - after.minY - after.maxY) / 2,
      };
    }
    const updatedEls = labelDesign.elements.map((el) =>
      el.id === targetEl.id ? updatedEl : el
    );
    pushStateWithHistory({
      ...labelDesign,
      elements: updatedEls,
    });
  };

  const handleLogoVisibleWidthInput = (raw: string) => {
    setLogoWidthStr(raw);
    const numVal = Number(raw.replace(',', '.'));
    if (!selectedElement || !Number.isFinite(numVal) || numVal < 0.5 || raw.trim() === '') {
      return;
    }
    const norm = getElementNormalizedContentBounds(selectedElement);
    const nextBoxW = numVal / Math.max(0.05, norm.width);
    if (selectedElement.lockAspectRatio) {
      handleUpdateElementSizeMm(nextBoxW);
      const aspect =
        selectedElement.aspectRatio > 0
          ? selectedElement.aspectRatio
          : selectedElement.widthMm / Math.max(0.1, selectedElement.heightMm);
      const nextVisH = roundMm((nextBoxW / aspect) * norm.height, 2);
      setLogoHeightStr(String(nextVisH));
    } else {
      handleUpdateElementSizeMm(nextBoxW, selectedElement.heightMm);
    }
  };

  const handleLogoVisibleHeightInput = (raw: string) => {
    setLogoHeightStr(raw);
    const numVal = Number(raw.replace(',', '.'));
    if (!selectedElement || !Number.isFinite(numVal) || numVal < 0.5 || raw.trim() === '') {
      return;
    }
    const norm = getElementNormalizedContentBounds(selectedElement);
    const nextBoxH = numVal / Math.max(0.05, norm.height);
    if (selectedElement.lockAspectRatio) {
      const aspect =
        selectedElement.aspectRatio > 0
          ? selectedElement.aspectRatio
          : selectedElement.widthMm / Math.max(0.1, selectedElement.heightMm);
      const nextBoxW = nextBoxH * aspect;
      handleUpdateElementSizeMm(nextBoxW, nextBoxH);
      setLogoWidthStr(String(roundMm(nextBoxW * norm.width, 2)));
    } else {
      handleUpdateElementSizeMm(selectedElement.widthMm, nextBoxH);
    }
  };

  const handleLogoVisibleSizeBlur = () => {
    isEditingLogoSizeRef.current = false;
    if (!selectedElement) return;
    const norm = getElementNormalizedContentBounds(selectedElement);
    setLogoWidthStr(String(roundMm(selectedElement.widthMm * norm.width, 2)));
    setLogoHeightStr(String(roundMm(selectedElement.heightMm * norm.height, 2)));
  };

  const handleToggleLockAspectRatio = () => {
    if (!selectedElement) return;
    const nextLocked = !selectedElement.lockAspectRatio;
    const updatedEls = labelDesign.elements.map((el) =>
      el.id === selectedElement.id
        ? {
            ...el,
            lockAspectRatio: nextLocked,
            aspectRatio: roundMm(el.widthMm / Math.max(0.1, el.heightMm), 4),
          }
        : el
    );
    pushStateWithHistory({ ...labelDesign, elements: updatedEls });
  };

  const handleScaleSelectedElement = (factor: number) => {
    if (!selectedElement || factor <= 0) return;
    const nextW = selectedElement.widthMm * factor;
    const nextH = selectedElement.heightMm * factor;
    handleUpdateElementSizeMm(nextW, nextH);
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
      const files = (['combined', 'engrave_only', 'cut_only'] as const).map(mode => ({
        name: `${mode === 'combined' ? 'LightBurn_COMPLETO' : mode === 'engrave_only' ? 'Grabado' : 'Corte'}_Tanda_${activeBatchIndex + 1}.svg`,
        content: exportProductionSvg(labelDesign, nestingResult, activeMaterial, {mode, batchIndex: activeBatchIndex}).svgContent,
      }));
      requestLogoSave([...files, {name: 'Ajustes_LightBurn.txt', content: 'IMPORTACIÓN ALINEADA EN LIGHTBURN\nImportá solamente LightBurn_COMPLETO_Tanda_' + (activeBatchIndex + 1) + '.svg: contiene grabado, orificios y corte en su posición relativa exacta.\nNo importes además Grabado y Corte: duplicarías el trabajo. Los archivos separados son alternativas; al importarlos por separado LightBurn puede centrar cada contenido y desalinearlos, especialmente en etiquetas para doblar.\n\n' + lightburnGuide(lightburnProfile)}]);
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
    setRotaryConfig(ord.rotaryConfig ?? DEFAULT_ROTARY_CONFIG);
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
      rotaryConfig,
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

  const handleUpdateMainLayer = (
    cutIndex: number,
    patch: Partial<WorkbenchLayerConfig>
  ) => {
    const nextLayers = workbenchConfig.layers.map((l) =>
      l.cutIndex === cutIndex ? { ...l, ...patch } : l
    );
    setWorkbenchConfig((prev) => ({
      ...prev,
      layers: nextLayers,
    }));
    const updatedMat = applyWorkbenchLayersToMaterialProfile(
      nextLayers,
      activeMaterial
    );
    setMaterials((prev) =>
      prev.map((m) => (m.id === updatedMat.id ? updatedMat : m))
    );
  };

  const handleApplyLightBurnVankPreset = () => {
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
    setWorkbenchConfig((prev) => ({
      ...prev,
      layers: nextLayers,
    }));
    const updatedMat = applyWorkbenchLayersToMaterialProfile(
      nextLayers,
      activeMaterial
    );
    setMaterials((prev) =>
      prev.map((m) => (m.id === updatedMat.id ? updatedMat : m))
    );
    notify(
      '✓ Calibración LightBurn Vank 9060 cargada: C00 Grabado 600 mm/s · 30% · Int. 0.073 mm (348 DPI) | C01 y C02 Corte 100 mm/s · 100%.'
    );
  };

  const handleSendToWorkbench = (
    mode: 'active_batch' | 'single_piece' | 'open_only' = 'active_batch',
    initialView: 'all' | 'layers' | 'jobs' | 'laser' = 'all'
  ) => {
    setWorkbenchInitialView(initialView);
    const isEco = isEcocueroMaterial(activeMaterial);
    const targetSheetW = isEco ? ECOCUERO_ROLL_WIDTH_MM : nestingConfig.sheetWidthMm;
    const targetSheetH = isEco ? ECOCUERO_BED_PASS_HEIGHT_MM : nestingConfig.sheetHeightMm;

    const updatedCfg: WorkbenchConfig = {
      ...workbenchConfig,
      ruidaIpAddress:
        workbenchConfig.ruidaIpAddress === '192.168.1.100' || !workbenchConfig.ruidaIpAddress
          ? VANK_9060_DEFAULT_IP
          : workbenchConfig.ruidaIpAddress,
      sheetWidthMm: targetSheetW,
      sheetHeightMm: targetSheetH,
      sheetSafetyMarginMm:
        workbenchConfig.savingPreset === 'extreme_zero_waste' ? 2 : workbenchConfig.sheetSafetyMarginMm,
      isRollMaterial: isEco || targetSheetW === ECOCUERO_ROLL_WIDTH_MM,
      rollTotalLengthMm: ECOCUERO_ROLL_TOTAL_LENGTH_MM,
      layers: syncLayersWithMaterialProfile(workbenchConfig.layers, activeMaterial),
    };
    setWorkbenchConfig(updatedCfg);

    if (mode !== 'open_only' || workbenchJobs.length === 0) {
      const useZeroWaste =
        updatedCfg.packingMode === 'continuous_zero_waste' || updatedCfg.isRollMaterial;
      const nextJob = createWorkbenchJobFromOrder({
        design: labelDesign,
        nesting: nestingResult,
        batchIndex: activeBatchIndex,
        mode:
          mode === 'single_piece'
            ? 'single_piece'
            : useZeroWaste
              ? 'roll_strip'
              : 'active_batch',
        projectName,
        clientName,
        orderId: activeOrderId,
        existingJobs: mode === 'open_only' ? [] : workbenchJobs,
        config: updatedCfg,
      });
      setWorkbenchJobs((prev) => {
        const list =
          mode === 'open_only' && prev.length === 0 ? [nextJob] : [...prev, nextJob];
        return autoArrangeWorkbenchJobs(
          list,
          updatedCfg,
          updatedCfg.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
          useZeroWaste
        );
      });
    }
    setIsWorkbenchOpen(true);
  };

  const renderDirectLayersCalibrationBox = () => (
    <div className="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-white text-xs flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Velocidad y Potencia (Capas C00 · C01 · C02)</span>
        </span>
        <button
          type="button"
          onClick={handleApplyLightBurnVankPreset}
          className="px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-semibold text-[10px] transition"
        >
          ⚡ Preset 600/30 · 100/100
        </button>
      </div>

      <div className="space-y-1.5">
        {workbenchConfig.layers.map((layer) => {
          const isEng = layer.role === 'ENGRAVE';
          const shortTitle = isEng
            ? 'Grabado'
            : layer.role === 'HOLES'
              ? 'Orificios'
              : 'Corte Ext.';
          return (
            <div
              key={layer.cutIndex}
              className="grid grid-cols-12 items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800/90"
            >
              <div className="col-span-4 flex items-center gap-1.5 min-w-0">
                <span
                  className="w-4 h-4 rounded-sm font-mono text-[9px] font-bold flex items-center justify-center border border-white/30 text-white shrink-0"
                  style={{ backgroundColor: layer.hexColor }}
                >
                  {layer.cutIndex.toString().padStart(2, '0')}
                </span>
                <span className="font-semibold text-slate-200 text-[11px] truncate">
                  {shortTitle}
                </span>
              </div>

              <label className="col-span-3 flex items-center gap-1">
                <input
                  type="number"
                  min={0.1}
                  max={1000}
                  step={1}
                  placeholder={isEng ? '600' : '100'}
                  value={layer.speedMmPerSec ?? ''}
                  onChange={(e) =>
                    handleUpdateMainLayer(layer.cutIndex, {
                      speedMmPerSec:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  title={`Velocidad ${layer.code} (mm/s)`}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded px-1.5 py-1 font-mono text-[11px] text-emerald-300 font-bold"
                />
                <span className="text-[9px] text-slate-500 font-mono">mm/s</span>
              </label>

              <label className="col-span-2 flex items-center gap-0.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder={isEng ? '30' : '100'}
                  value={layer.maxPowerPercent ?? ''}
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? null : Number(e.target.value);
                    handleUpdateMainLayer(layer.cutIndex, {
                      maxPowerPercent: val,
                      minPowerPercent:
                        layer.minPowerPercent === null && val !== null
                          ? val
                          : layer.minPowerPercent,
                    });
                  }}
                  title={`Potencia ${layer.code} (%)`}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded px-1.5 py-1 font-mono text-[11px] text-amber-300 font-bold"
                />
                <span className="text-[9px] text-slate-500 font-mono">%</span>
              </label>

              {layer.mode !== 'line' ? (
                <label className="col-span-3 flex items-center gap-0.5">
                  <input
                    type="number"
                    min={0.02}
                    max={1.0}
                    step={0.001}
                    value={layer.lineIntervalMm}
                    onChange={(e) =>
                      handleUpdateMainLayer(layer.cutIndex, {
                        lineIntervalMm: roundMm(
                          Math.max(0.02, Number(e.target.value) || 0.073),
                          3
                        ),
                      })
                    }
                    title="Intervalo de línea (mm)"
                    className="w-full bg-slate-900 border border-slate-700/80 rounded px-1.5 py-1 font-mono text-[11px] text-cyan-300 font-bold"
                  />
                  <span className="text-[9px] text-slate-500 font-mono">mm</span>
                </label>
              ) : (
                <span className="col-span-3 text-[10px] font-mono text-slate-400 text-right pr-1">
                  {layer.passes} pas.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

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
    setRotaryConfig(DEFAULT_ROTARY_CONFIG);
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

          <button
            onClick={() => handleSendToWorkbench('open_only', 'layers')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 rounded text-emerald-300 font-semibold transition-colors"
            title="Abrir Mesa de Trabajo Vank 9060 (Calibración de Capas, Rollo 73 cm y Envío a Máquina)"
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mesa Vank 9060</span>
            {workbenchJobs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 font-mono text-[10px] font-bold">
                {workbenchJobs.length}
              </span>
            )}
          </button>

          <label
            className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 cursor-pointer transition-colors"
            title="Abrir proyecto (.lhstudio.json / .json) o archivo externo de grabado y corte (.dxf, .svg, .lbrn2, .ai, .rd, .png, .jpg)"
          >
            Abrir archivo
            <input
              type="file"
              aria-label="Abrir archivo de proyecto"
              accept=".json,.lhstudio.json,.dxf,.svg,.lbrn2,.lbrn,.ai,.rd,.png,.jpg,.jpeg,.webp,.bmp"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const extFormat = file.name ? detectExternalLaserFormat(file.name) : null;
                  if (extFormat) {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const imported = await importExternalLaserFile({
                      fileName: file.name,
                      bytes,
                      config: workbenchConfig,
                    });
                    const nextCfg = mergeImportedLayerUpdates(
                      workbenchConfig,
                      imported.layerUpdates
                    );
                    if (imported.summary.hasAppliedLayerParams) {
                      setWorkbenchConfig(nextCfg);
                    }
                    const useZeroWaste =
                      nextCfg.packingMode === 'continuous_zero_waste' ||
                      nextCfg.isRollMaterial ||
                      isEcocueroMaterial(activeMaterial);
                    const merged = mergeComplementaryImportedJobs(
                      workbenchJobs,
                      imported.jobs
                    );
                    const arranged = autoArrangeWorkbenchJobs(
                      merged.jobs,
                      nextCfg,
                      nextCfg.savingPreset === 'extreme_zero_waste' ? 1.5 : 2,
                      useZeroWaste
                    );
                    setWorkbenchJobs(arranged);
                    setIsWorkbenchOpen(true);
                    const warnTxt =
                      imported.summary.warnings.length > 0
                        ? ` (${imported.summary.warnings[0]})`
                        : '';
                    notify(
                      `📂 "${file.name}" (${imported.summary.format.toUpperCase()} ${imported.summary.widthMm}×${imported.summary.heightMm} mm) abierto en Mesa Vank 9060: ${imported.summary.engravePathCount + imported.summary.rasterCount} grabados, ${imported.summary.holeContourCount} agujeros, ${imported.summary.cutContourCount} cortes.${warnTxt}`
                    );
                  } else {
                    openProject(deserializeOrderProjectFromJson(await file.text()));
                  }
                } catch (err) {
                  notify(`Error al abrir archivo: ${(err as Error).message}`);
                }
              }}
            />
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

                    {/* Edición rápida del tamaño visible del logo desde el Paso 1 */}
                    <div className="pt-2.5 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-300">
                          Tamaño del logo (mm)
                        </span>
                        <button
                          type="button"
                          onClick={handleToggleLockAspectRatio}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                            selectedElement.lockAspectRatio
                              ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                              : 'bg-slate-800 border-slate-700 text-slate-400'
                          }`}
                          title="Alternar bloqueo de proporción al cambiar ancho o alto"
                        >
                          {selectedElement.lockAspectRatio
                            ? '🔒 Proporción fija'
                            : '🔓 Libre'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 block mb-1 text-[10px]">
                            Ancho (mm):
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={logoWidthStr}
                            onFocus={() => {
                              isEditingLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleLogoVisibleWidthInput(e.target.value)
                            }
                            onBlur={handleLogoVisibleSizeBlur}
                            className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-1 text-[10px]">
                            Alto (mm):
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={logoHeightStr}
                            onFocus={() => {
                              isEditingLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleLogoVisibleHeightInput(e.target.value)
                            }
                            onBlur={handleLogoVisibleSizeBlur}
                            className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedElement(0.85)}
                          className="py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-semibold text-slate-200"
                        >
                          −15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedElement(1.15)}
                          className="py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-semibold text-slate-200"
                        >
                          +15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFitToAvailableSpace(0.5)}
                          className="py-1 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 text-[10px] font-bold text-cyan-300"
                        >
                          Máximo
                        </button>
                      </div>
                    </div>
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
                    <label className="block">Reverso del logo
                      <select aria-label="Reverso del logo" value={labelDesign.fold.reverse ?? 'rotate'} onChange={e=>applyFold({...labelDesign.fold!,reverse:e.target.value as NonNullable<FoldOptions['reverse']>},'preserve')} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                        <option value="rotate">Normal · el reverso se lee derecho al doblar</option><option value="mirror">Espejo · reflejo sobre la línea de doblez</option>
                      </select>
                    </label>
                    <label className="block">Logo en las caras
                      <select aria-label="Logo en las caras" value={labelDesign.fold.faces} onChange={e=>applyFold({...labelDesign.fold!,faces:e.target.value as FoldOptions['faces']},'preserve')} className="w-full mt-2 bg-slate-950 border border-slate-700 rounded p-2">
                        <option value="both">Ambas caras</option><option value="one">Una cara</option>
                      </select>
                    </label>
                    <p className="text-cyan-200">Pieza abierta: {labelDesign.widthMm} × {labelDesign.heightMm} mm. Doblada: {labelDesign.fold.axis==='vertical'?labelDesign.widthMm/2:labelDesign.widthMm} × {labelDesign.fold.axis==='horizontal'?labelDesign.heightMm/2:labelDesign.heightMm} mm.</p>
                    <p className="text-slate-400">Rectangular, sin orificios. La línea central es solo una guía y no se exporta. En «Normal» el reverso gira 180° y las letras no se reflejan; en «Espejo» el reverso es el reflejo exacto del frente sobre el doblez (letras en espejo). Podés mover, girar o agrandar el logo de una cara y la otra lo sigue sola. Al cambiar medidas o caras, el logo se queda donde lo pusiste.</p>
                    <div role="group" aria-label="Posición del logo en la cara" className="space-y-1">
                      <span className="block text-slate-300">Posición del logo en la cara</span>
                      <div className="grid grid-cols-3 gap-1">
                        {([['top','Arriba'],['bottom','Abajo'],['left','Izquierda'],['right','Derecha'],['center','Centro']] as [FoldPlacement,string][]).map(([where,label])=>
                          <button key={where} onClick={()=>{const next=placeFoldedFaces(labelDesign,where); if(next===labelDesign){notify('El logo ya está ahí o ocupa toda la cara. Achicalo para poder moverlo.');return;} pushStateWithHistory(next); notify(`Logo ubicado: ${label.toLowerCase()}. La otra cara lo acompaña.`);}} className="rounded bg-slate-800 border border-slate-700 p-2">{label}</button>)}
                      </div>
                    </div>
                    <div role="group" aria-label="Tamaño del logo en la cara" className="grid grid-cols-2 gap-1">
                      <button onClick={()=>{const next=scaleFoldedFaces(labelDesign,0.85); if(next===labelDesign){notify('El logo ya está en su tamaño mínimo.');return;} pushStateWithHistory(next);}} className="rounded bg-slate-800 border border-slate-700 p-2">Logo más chico (−15%)</button>
                      <button onClick={()=>{const next=scaleFoldedFaces(labelDesign,1/0.85); if(next===labelDesign){notify('El logo ya ocupa toda la cara.');return;} pushStateWithHistory(next);}} className="rounded bg-slate-800 border border-slate-700 p-2">Logo más grande (+18%)</button>
                    </div>
                    <button onClick={()=>applyFold(labelDesign.fold!,'refit')} className="w-full rounded bg-cyan-900 p-2">Reacomodar caras (centrar y ajustar tamaño)</button>
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
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 block mb-1 text-[11px]">Ancho visible (mm):</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            aria-label="Ancho visible (mm)"
                            value={logoWidthStr}
                            onFocus={() => {
                              isEditingLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleLogoVisibleWidthInput(e.target.value)
                            }
                            onBlur={handleLogoVisibleSizeBlur}
                            className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-1 text-[11px]">Alto visible (mm):</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            aria-label="Alto visible (mm)"
                            value={logoHeightStr}
                            onFocus={() => {
                              isEditingLogoSizeRef.current = true;
                            }}
                            onChange={(e) =>
                              handleLogoVisibleHeightInput(e.target.value)
                            }
                            onBlur={handleLogoVisibleSizeBlur}
                            className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-white font-mono text-xs focus:border-cyan-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          onClick={handleToggleLockAspectRatio}
                          className={`col-span-2 py-1 px-2 rounded text-[10px] font-semibold border transition ${
                            selectedElement.lockAspectRatio
                              ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                              : 'bg-slate-800 border-slate-700 text-slate-400'
                          }`}
                        >
                          {selectedElement.lockAspectRatio
                            ? '🔒 Proporción fija'
                            : '🔓 Alto/Ancho libre'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedElement(0.85)}
                          className="py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-semibold text-slate-200"
                        >
                          −15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScaleSelectedElement(1.15)}
                          className="py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-semibold text-slate-200"
                        >
                          +15%
                        </button>
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
                    <input id="logo-angle" aria-label="Rotación del logo (grados)" type="number" step="0.1" className="w-24 bg-slate-950 border border-slate-700" disabled={!selectedElement || selectedElement.locked} value={selectedElement?.rotationDeg ?? 0}
                      onChange={e => {if(Number.isFinite(e.target.valueAsNumber)) handleExactRotation(e.target.valueAsNumber);}} />
                    <span className="text-slate-400">grados</span>
                    <button disabled={!selectedElement || selectedElement.locked} className="ml-auto bg-slate-800 px-3" onClick={()=>handleExactRotation(0)}>Restablecer</button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[0,45,90,180,270].map(angle=><button key={angle} disabled={!selectedElement || selectedElement.locked} onClick={()=>handleExactRotation(angle)} className="rounded bg-slate-800 py-2 text-cyan-300" aria-label={`Fijar rotación a ${angle} grados`}>{angle}°</button>)}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[-90,-1,-0.1,0.1,1,90].map(delta=><button key={delta} disabled={!selectedElement || selectedElement.locked} onClick={()=>handleExactRotation((selectedElement?.rotationDeg ?? 0)+delta)} className="rounded bg-slate-800 py-2 text-slate-200" aria-label={`Girar ${delta} grados`}>{delta>0?'+':''}{delta}°</button>)}
                  </div>
                  <p className="text-xs text-slate-400">Gira solo el logo elegido, conservando su centro visible. Con el mouse: Shift ajusta cada 15°; Alt permite pasos de 0,1°. En etiquetas dobladas podés seleccionar cada cara por separado. Si sobresale, reducí su tamaño; Reacomodar caras vuelve a la orientación automática del doblez.</p>
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
                    onChange={(e) => {
                      const nextMatId = e.target.value;
                      const nextMat = materials.find((m) => m.id === nextMatId);
                      const isEco = isEcocueroMaterial(nextMat);
                      const nextNesting = isEco
                        ? {
                            ...nestingConfig,
                            sheetWidthMm: ECOCUERO_ROLL_WIDTH_MM,
                            sheetHeightMm: ECOCUERO_BED_PASS_HEIGHT_MM,
                          }
                        : nestingConfig;
                      pushStateWithHistory(labelDesign, nextNesting, nextMatId);
                      if (isEco) {
                        notify('Material Ecocuero: formato ajustado a Rollo 73 cm × 5 m (730 × 600 mm en mesa Vank 9060).');
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded text-slate-200">
                    {materials.map((mat) => <option key={mat.id} value={mat.id}>{mat.name}</option>)}
                  </select>
                  <div className="flex items-center gap-2 mt-2 text-slate-400">
                    <span className="w-3 h-3 rounded-full border border-slate-600" style={{ backgroundColor: activeMaterial.visual.surfaceColor }} />
                    <span>Espesor {activeMaterial.thicknessMm} mm</span>
                    {isEcocueroMaterial(activeMaterial) && (
                      <span className="text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-700/70 px-1.5 py-0.5 rounded">
                        Rollo 73 cm × 5 m
                      </span>
                    )}
                  </div>
                </div>

                <label className="block text-slate-300 space-y-2">
                  <span>Distribución de etiquetas</span>
                  <select aria-label="Distribución de etiquetas" value={nestingConfig.layoutMode ?? 'blocks'}
                    onChange={e => pushStateWithHistory(labelDesign, {...nestingConfig, layoutMode: e.target.value as NonNullable<typeof nestingConfig.layoutMode>})}
                    className="w-full bg-slate-900 border border-slate-700 p-2 rounded">
                    <option value="zero_waste">Rectángulo exacto sin huecos (0 lugares vacíos)</option>
                    <option value="sheet">Franja balanceada a lo ancho (Rollo 73 cm)</option>
                    <option value="blocks">Automática según cantidad</option>
                    <option value="5x10">5 columnas × 10 filas</option>
                    <option value="10x5">10 columnas × 5 filas</option>
                    <option value="5x5">5 columnas × 5 filas</option>
                  </select>
                  <p className="text-xs text-slate-400">«Rectángulo exacto sin huecos» busca una grilla cerrada donde todas las filas tengan la misma cantidad de etiquetas (0 lugares vacíos en la última fila) para no desperdiciar ningún rincón del recorte.</p>
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
                          aria-label="Compensación de corte (mm)"
                          type="number"
                          step="0.01"
                          min="0"
                          max="0.5"
                          value={labelDesign.kerfCompensationMm}
                          onChange={(e) =>
                            pushStateWithHistory({
                              ...labelDesign,
                              kerfCompensationMm: Math.min(0.5, Math.max(0, Number(e.target.value) || 0)),
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

                {/* TARJETA DE EQUILIBRIO: ESPACIO EN PLANCHA + VELOCIDAD DE REALIZACIÓN */}
                <div className="p-3 rounded-lg bg-gradient-to-br from-amber-950/35 to-slate-900 border border-amber-600/50 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Equilibrio: Espacio + Velocidad de Máquina</span>
                    </span>
                    <span className="text-[10px] font-mono bg-slate-950 px-2 py-0.5 rounded text-emerald-300 border border-slate-800">
                      Actual: {stepSavings.currentCols}×{stepSavings.currentRows} · {stepSavings.currentAdvanceCm} cm
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Elegí cómo equilibrar el <strong className="text-white">ahorro de material (0 huecos vacíos)</strong> y la <strong className="text-cyan-300">velocidad de barrido láser</strong> (menos filas = menos frenadas del cabezal X):
                  </p>

                  {/* 3 Tarjetas comparativas de Equilibrio Espacio vs Velocidad */}
                  <div className="space-y-1.5">
                    {balancedPresets.map((preset) => {
                      const isCurrent =
                        stepSavings.currentCols === preset.cols &&
                        stepSavings.currentRows === preset.rows;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            pushStateWithHistory(labelDesign, preset.configToApply);
                            notify(
                              `${preset.title} aplicado: ${preset.cols} col × ${preset.rows} filas (${preset.emptySlots} lugares vacíos · ~${formatSecToMinSec(preset.estimatedMachineTimeSec)}).`
                            );
                          }}
                          className={`w-full p-2 rounded-lg border text-left transition-all ${
                            isCurrent
                              ? 'bg-cyan-950/70 border-cyan-400 text-white shadow'
                              : 'bg-slate-950/80 hover:bg-slate-900 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-[11px] text-white">
                              {preset.id === 'equilibrium'
                                ? '⚡ '
                                : preset.id === 'max_speed'
                                  ? '🚀 '
                                  : '📦 '}
                              {preset.title}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
                              ~{formatSecToMinSec(preset.estimatedMachineTimeSec)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-[10px] font-mono">
                            <span className="text-amber-300 font-bold">
                              {preset.cols} col × {preset.rows} filas ({preset.blockWidthMm}×{preset.blockHeightMm} mm)
                            </span>
                            <span
                              className={
                                preset.emptySlots === 0
                                  ? 'text-emerald-400 font-bold'
                                  : 'text-slate-400'
                              }
                            >
                              {preset.emptySlots === 0
                                ? '✓ 0 vacíos (100% lleno)'
                                : `${preset.emptySlots} vacíos (${preset.blockFillPercent}% lleno)`}
                            </span>
                          </div>
                          {preset.freeSideWidthCm > 1 && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              Deja <strong className="text-slate-200">{preset.freeSideWidthCm} cm libres al costado</strong> de la plancha.
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {stepSavings.freeSlotsInLastRow > 0 && (
                    <div className="p-2 rounded bg-emerald-950/40 border border-emerald-700/60 space-y-1.5">
                      <div className="text-[11px] text-emerald-200 leading-tight">
                        <strong>
                          💡 Quedan {stepSavings.freeSlotsInLastRow} lugares vacíos en la última fila
                        </strong>{' '}
                        ({roundMm(stepSavings.freeWidthInLastRowMm / 10, 1)} cm libres en esa fila).
                      </div>
                      <button
                        type="button"
                        onClick={handleFillStepLastRow}
                        className="w-full py-1.5 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          Completar última fila (+{stepSavings.freeSlotsInLastRow} etiquetas gratis · 0 cm extra)
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* ACCIÓN DIRECTA: MANDAR A PLANCHA / MESA DE TRABAJO VANK 9060 */}
                <div className="pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleSendToWorkbench('active_batch', 'layers')}
                    className="w-full py-2.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span>Abrir en Mesa Vank 9060 (Calibrar Capas y Rollo 73 cm)</span>
                  </button>
                </div>
              </div>
            )}

            {/* CONTENIDO ESPECÍFICO DEL PASO 6: REVISAR Y EXPORTAR */}
            {currentStep === 'export' && (
              <div className="space-y-4 text-xs">
                {/* CALIBRACIÓN DIRECTA DE VELOCIDAD Y POTENCIA DE LAS 3 CAPAS (C00 / C01 / C02) */}
                {renderDirectLayersCalibrationBox()}

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
                  handleUpdateElementSizeMm(nw, nh, x, y, id);
                }}
                onRotateElement={(id, rot, xMm, yMm) => {
                  const updatedEls = labelDesign.elements.map((el) =>
                    el.id === id && !el.locked ? {...rotateArtworkExactly(el,rot), ...(xMm!==undefined && yMm!==undefined ? {xMm,yMm} : {})} : el
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

                {/* PANEL DE EQUILIBRIO: AHORRO DE PLANCHA + VELOCIDAD DE MÁQUINA ANTES DE EXPORTAR */}
                <div className="p-3.5 rounded-xl bg-gradient-to-br from-amber-950/35 to-slate-900 border border-amber-600/50 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Equilibrio: Aprovechamiento de Plancha + Velocidad de Realización</span>
                    </span>
                    <span className="font-mono text-emerald-300 bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800">
                      Actual: <strong>{stepSavings.currentCols} col × {stepSavings.currentRows} fil</strong> · Avance: <strong>{stepSavings.currentAdvanceCm} cm</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {balancedPresets.map((preset) => {
                      const isCurrent =
                        stepSavings.currentCols === preset.cols &&
                        stepSavings.currentRows === preset.rows;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            pushStateWithHistory(labelDesign, preset.configToApply);
                            notify(
                              `${preset.title} aplicado: ${preset.cols} col × ${preset.rows} filas (${preset.emptySlots} lugares vacíos · ~${formatSecToMinSec(preset.estimatedMachineTimeSec)}).`
                            );
                          }}
                          className={`p-2.5 rounded-lg border text-left transition-all ${
                            isCurrent
                              ? 'bg-cyan-950/70 border-cyan-400 text-white shadow'
                              : 'bg-slate-950/80 hover:bg-slate-900 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-[11px] text-white truncate">
                              {preset.id === 'equilibrium'
                                ? '⚡ Equilibrio Ideal'
                                : preset.id === 'max_speed'
                                  ? '🚀 Más Rápido'
                                  : '📦 Compacto'}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 shrink-0">
                              ~{formatSecToMinSec(preset.estimatedMachineTimeSec)}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-amber-300 font-bold mt-1">
                            {preset.cols} col × {preset.rows} filas
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {preset.blockWidthMm}×{preset.blockHeightMm} mm
                          </div>
                          <div
                            className={`text-[10px] font-mono mt-0.5 ${
                              preset.emptySlots === 0
                                ? 'text-emerald-400 font-bold'
                                : 'text-slate-400'
                            }`}
                          >
                            {preset.emptySlots === 0
                              ? '✓ 0 lugares vacíos'
                              : `${preset.emptySlots} vacíos (${preset.blockFillPercent}% lleno)`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {stepSavings.freeSlotsInLastRow > 0 && (
                    <button
                      type="button"
                      onClick={handleFillStepLastRow}
                      className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>
                        💡 Completar última fila (+{stepSavings.freeSlotsInLastRow} etiquetas gratis · 0 cm extra de rollo)
                      </span>
                    </button>
                  )}
                </div>

                {!validationReport.isValid && <div className="studio-export-errors" role="alert">
                  <p>Revisá los errores antes de descargar:</p>
                  {validationReport.issues.some(issue => issue.code === 'KERF_COLLAPSES_HOLE') && <div className="space-y-2 my-3">
                    <p>Compensación actual: {labelDesign.kerfCompensationMm} mm. Se resta al diámetro de cada orificio. No es la separación entre etiquetas ni el margen de costura.</p>
                    <p>Si todavía no mediste el ancho de corte, podés preparar los contornos con sus medidas nominales, sin compensación.</p>
                    <button className="px-3 py-2 rounded bg-slate-800 border border-slate-500 text-white" onClick={() => pushStateWithHistory({ ...labelDesign, kerfCompensationMm: 0 })}>Usar medidas nominales (compensación 0 mm)</button>
                    <button className="px-3 py-2 rounded border border-slate-500 ml-2" onClick={() => { setShowAdvancedProduction(true); setCurrentStep('production'); }}>Revisar compensación en Producción</button>
                  </div>}
                  <ul>{validationReport.issues.filter((issue, index, issues) => issue.severity === 'error' && issues.findIndex(other => other.severity === 'error' && other.message === issue.message) === index).map((issue,index) => <li key={index}>{issue.message.replace(/"[^"]+"/g, 'del logo')}</li>)}</ul>
                </div>}
                {hasRasterExport && <p className="studio-notice">SVG conserva tu imagen. Para descargar DXF, primero vectorizá el logo.</p>}
                {/* Acciones principales de exportación */}
                <div className="space-y-3 pt-2">
                  <button
                    disabled={!validationReport.isValid || isProcessingImage}
                    onClick={() => handleSendToWorkbench('active_batch')}
                    className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-transform hover:scale-[1.01]"
                  >
                    <Layers className="w-5 h-5" />
                    <span>Mandar a Mesa / Plancha y Cargar en Vank 9060 (LightBurn / Ruida)</span>
                  </button>

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
                  <p className="text-xs text-slate-400 text-center">Para LightBurn importá sólo LightBurn_COMPLETO: conserva la alineación entre logo y corte, también en etiquetas para doblar. Incluye además los SVG separados como alternativa; no los importes junto al completo.</p>
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

      {isRotaryOpen && <RotaryPanel design={labelDesign} config={rotaryConfig} onConfigChange={setRotaryConfig} onDesignChange={(nextDesign) => pushStateWithHistory(nextDesign)} onClose={() => setIsRotaryOpen(false)} onSave={files => { setIsRotaryOpen(false); requestLogoSave(files); }} />}

      {isWorkbenchOpen && (
        <VankWorkbenchModal
          design={labelDesign}
          nesting={nestingResult}
          activeBatchIndex={activeBatchIndex}
          material={activeMaterial}
          projectName={projectName}
          clientName={clientName}
          activeOrderId={activeOrderId}
          ordersCatalog={orders}
          workbenchConfig={workbenchConfig}
          workbenchJobs={workbenchJobs}
          initialSidebarView={workbenchInitialView}
          onUpdateConfig={setWorkbenchConfig}
          onUpdateJobs={setWorkbenchJobs}
          onSaveMaterialParameters={(updatedMat) => {
            setMaterials((prev) =>
              prev.map((m) => (m.id === updatedMat.id ? updatedMat : m))
            );
          }}
          onRequestSaveFiles={(files) => {
            requestLogoSave(files);
          }}
          onNotify={notify}
          onClose={() => setIsWorkbenchOpen(false)}
        />
      )}

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

      {/* 5. TOAST DE NOTIFICACIÓN FLOTANTE (ubicado abajo a la izquierda para no tapar la botonera de envío Vank) */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => setStatusMessage(null)}
          title="Clic para cerrar"
          className="studio-toast fixed bottom-10 left-4 z-50 max-w-md cursor-pointer bg-[#161b22]/95 backdrop-blur border border-cyan-500/60 shadow-xl rounded-lg px-3.5 py-2 text-xs text-cyan-200 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
        >
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
