import React, { useRef, useState } from 'react';
import { compileLabelGeometry, roundMm } from '../core/geometry/geometryEngine';
import {
  LabelDesign,
  LIGHTBURN_LAYERS,
  MaterialProfile,
  Point2D,
} from '../core/types';

interface LabelEditorCanvasProps {
  design: LabelDesign;
  material: MaterialProfile;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onMoveElement: (id: string, newXMm: number, newYMm: number) => void;
  onResizeElement?: (id: string, newWidthMm: number, newHeightMm: number) => void;
  onRotateElement?: (id: string, newRotationDeg: number) => void;
  zoomLevel: number; // 1.0 = base scale (~18 px/mm)
  onZoomChange: (nextZoom: number) => void;
  showMillimeterGrid: boolean;
  showSafetyGuides: boolean;
  snapToGridMm: number; // 0 = off, 0.5 = 0.5mm, 1 = 1mm
  renderStyle: 'realistic_material' | 'technical_lightburn';
}

type InteractionMode = 'idle' | 'move' | 'resize' | 'rotate';
type ResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

interface DragState {
  mode: InteractionMode;
  elementId: string;
  corner?: ResizeCorner;
  startPt: Point2D;
  initXMm: number;
  initYMm: number;
  initWidthMm: number;
  initHeightMm: number;
  aspectRatio: number;
  lockAspectRatio: boolean;
  initRotationDeg: number;
}

export const LabelEditorCanvas: React.FC<LabelEditorCanvasProps> = ({
  design,
  material,
  selectedElementId,
  onSelectElement,
  onMoveElement,
  onResizeElement,
  onRotateElement,
  zoomLevel,
  onZoomChange,
  showMillimeterGrid,
  showSafetyGuides,
  snapToGridMm,
  renderStyle,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const compiled = compileLabelGeometry(design);
  const paddingMm = Math.max(6, Math.max(design.widthMm, design.heightMm) * 0.32);
  const viewMinX = -paddingMm;
  const viewMinY = -paddingMm;
  const viewWidthMm = design.widthMm + paddingMm * 2;
  const viewHeightMm = design.heightMm + paddingMm * 2;

  const clientToMillimeters = (clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scaleX = viewWidthMm / rect.width;
    const scaleY = viewHeightMm / rect.height;
    return {
      x: viewMinX + (clientX - rect.left) * scaleX,
      y: viewMinY + (clientY - rect.top) * scaleY,
    };
  };

  const selectedEl = design.elements.find((e) => e.id === selectedElementId);

  const handleElementPointerDown = (
    e: React.PointerEvent,
    elementId: string,
    elXMm: number,
    elYMm: number,
    locked: boolean
  ) => {
    e.stopPropagation();
    onSelectElement(elementId);
    if (locked) return;
    const pt = clientToMillimeters(e.clientX, e.clientY);
    const el = design.elements.find((item) => item.id === elementId);
    if (!el) return;

    setDragState({
      mode: 'move',
      elementId,
      startPt: pt,
      initXMm: elXMm,
      initYMm: elYMm,
      initWidthMm: el.widthMm,
      initHeightMm: el.heightMm,
      aspectRatio: el.aspectRatio || el.widthMm / el.heightMm,
      lockAspectRatio: el.lockAspectRatio,
      initRotationDeg: el.rotationDeg || 0,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handleResizeHandlePointerDown = (
    e: React.PointerEvent,
    corner: ResizeCorner
  ) => {
    e.stopPropagation();
    if (!selectedEl || selectedEl.locked) return;
    const pt = clientToMillimeters(e.clientX, e.clientY);

    setDragState({
      mode: 'resize',
      elementId: selectedEl.id,
      corner,
      startPt: pt,
      initXMm: selectedEl.xMm,
      initYMm: selectedEl.yMm,
      initWidthMm: selectedEl.widthMm,
      initHeightMm: selectedEl.heightMm,
      aspectRatio: selectedEl.aspectRatio || selectedEl.widthMm / selectedEl.heightMm,
      lockAspectRatio: selectedEl.lockAspectRatio,
      initRotationDeg: selectedEl.rotationDeg || 0,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handleRotateHandlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!selectedEl || selectedEl.locked) return;
    const pt = clientToMillimeters(e.clientX, e.clientY);

    setDragState({
      mode: 'rotate',
      elementId: selectedEl.id,
      startPt: pt,
      initXMm: selectedEl.xMm,
      initYMm: selectedEl.yMm,
      initWidthMm: selectedEl.widthMm,
      initHeightMm: selectedEl.heightMm,
      aspectRatio: selectedEl.aspectRatio || selectedEl.widthMm / selectedEl.heightMm,
      lockAspectRatio: selectedEl.lockAspectRatio,
      initRotationDeg: selectedEl.rotationDeg || 0,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const pt = clientToMillimeters(e.clientX, e.clientY);

    if (dragState.mode === 'move') {
      const dx = pt.x - dragState.startPt.x;
      const dy = pt.y - dragState.startPt.y;
      let nx = dragState.initXMm + dx;
      let ny = dragState.initYMm + dy;

      // Ajuste magnético al centro si está muy cerca (< 0.35 mm)
      const centerX = design.widthMm / 2;
      const centerY = design.heightMm / 2;
      if (Math.abs(nx - centerX) < 0.35) {
        nx = centerX;
      } else if (snapToGridMm > 0) {
        nx = Math.round(nx / snapToGridMm) * snapToGridMm;
      }

      if (Math.abs(ny - centerY) < 0.35) {
        ny = centerY;
      } else if (snapToGridMm > 0) {
        ny = Math.round(ny / snapToGridMm) * snapToGridMm;
      }

      nx = roundMm(Math.max(0, Math.min(design.widthMm, nx)), 2);
      ny = roundMm(Math.max(0, Math.min(design.heightMm, ny)), 2);
      onMoveElement(dragState.elementId, nx, ny);
    } else if (dragState.mode === 'resize' && onResizeElement) {
      const dx = pt.x - dragState.startPt.x;
      const dy = pt.y - dragState.startPt.y;

      let factorX = 1;
      let factorY = 1;
      if (dragState.corner === 'se') {
        factorX = 1;
        factorY = 1;
      } else if (dragState.corner === 'sw') {
        factorX = -1;
        factorY = 1;
      } else if (dragState.corner === 'ne') {
        factorX = 1;
        factorY = -1;
      } else if (dragState.corner === 'nw') {
        factorX = -1;
        factorY = -1;
      }

      let deltaW = dx * factorX * 2;
      let newW = Math.max(1.0, dragState.initWidthMm + deltaW);
      let newH = dragState.initHeightMm;

      if (dragState.lockAspectRatio) {
        newH = Math.max(0.8, roundMm(newW / dragState.aspectRatio, 2));
      } else {
        let deltaH = dy * factorY * 2;
        newH = Math.max(0.8, dragState.initHeightMm + deltaH);
      }

      newW = roundMm(newW, 2);
      newH = roundMm(newH, 2);
      onResizeElement(dragState.elementId, newW, newH);
    } else if (dragState.mode === 'rotate' && onRotateElement) {
      const centerX = dragState.initXMm;
      const centerY = dragState.initYMm;
      const radians = Math.atan2(pt.y - centerY, pt.x - centerX);
      let degrees = Math.round((radians * 180) / Math.PI + 90);
      if (degrees < 0) degrees += 360;
      degrees = degrees % 360;
      onRotateElement(dragState.elementId, degrees);
    }
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  // Generar marcas de regla milimétrica
  const ticksX: number[] = [];
  for (let x = 0; x <= Math.ceil(design.widthMm); x += 1) {
    ticksX.push(x);
  }
  const ticksY: number[] = [];
  for (let y = 0; y <= Math.ceil(design.heightMm); y += 1) {
    ticksY.push(y);
  }

  const baseScalePx = 18 * zoomLevel;
  const displayWidthPx = Math.max(380, Math.round(viewWidthMm * baseScalePx));
  const displayHeightPx = Math.max(280, Math.round(viewHeightMm * baseScalePx));

  const isTechnical = renderStyle === 'technical_lightburn';
  const surfaceFill = isTechnical ? '#FFFFFF' : material.visual.surfaceColor;
  const engraveColor = isTechnical
    ? LIGHTBURN_LAYERS.ENGRAVE.hexColor
    : material.visual.engraveColor;
  const cutStroke = isTechnical
    ? LIGHTBURN_LAYERS.CUT.hexColor
    : material.visual.cutStrokeColor;
  const holeStroke = LIGHTBURN_LAYERS.HOLES.hexColor;

  // Handles de selección si hay un elemento activo
  const handleRadius = 0.45;
  const handleDistRot = 2.0;

  return (
    <div
      className="relative w-full h-full flex flex-col items-center justify-center overflow-auto bg-[#090c10] select-none"
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          onZoomChange(roundMm(Math.max(0.4, Math.min(4.0, zoomLevel * factor)), 2));
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => onSelectElement(null)}
    >
      {/* Aviso de Simulación Visual de Material */}
      <div className="absolute top-3 left-4 z-10 pointer-events-none flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#11161f]/85 border border-slate-700/80 shadow text-[11px] text-slate-300 backdrop-blur-sm">
        <span
          className="w-2.5 h-2.5 rounded-full inline-block border border-slate-600"
          style={{ backgroundColor: material.visual.surfaceColor }}
        />
        <span className="font-medium text-amber-300">
          {isTechnical ? 'Modo Técnico LightBurn' : material.name}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          {!isTechnical && '· Simulación orientativa (Exportación vectorial 1:1)'}
        </span>
      </div>

      <svg
        ref={svgRef}
        width={displayWidthPx}
        height={displayHeightPx}
        viewBox={`${viewMinX} ${viewMinY} ${viewWidthMm} ${viewHeightMm}`}
        className="shadow-2xl rounded border border-slate-800/80 bg-[#0d1219]"
      >
        <defs>
          <pattern
            id="mm-grid-minor"
            width="1"
            height="1"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 1 0 L 0 0 0 1"
              fill="none"
              stroke="rgba(148, 163, 184, 0.10)"
              strokeWidth="0.04"
            />
          </pattern>
          <pattern
            id="mm-grid-major"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width="5" height="5" fill="url(#mm-grid-minor)" />
            <path
              d="M 5 0 L 0 0 0 5"
              fill="none"
              stroke="rgba(148, 163, 184, 0.24)"
              strokeWidth="0.07"
            />
          </pattern>

          {/* Textura y Gradiente para Ecocuero Suela */}
          <linearGradient id="suela-leather-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C98B59" />
            <stop offset="45%" stopColor="#B37746" />
            <stop offset="100%" stopColor="#965D32" />
          </linearGradient>

          {/* Gradiente y Brillo para Acrílico Espejo Plateado */}
          <linearGradient id="mirror-sheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="35%" stopColor="#94a3b8" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>

          {/* Efecto de Acrílico Transparente con sutil relieve */}
          <linearGradient id="glass-specular" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(248, 250, 252, 0.25)" />
            <stop offset="30%" stopColor="rgba(248, 250, 252, 0.05)" />
            <stop offset="70%" stopColor="rgba(248, 250, 252, 0.12)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.3)" />
          </linearGradient>
        </defs>

        {/* Rejilla milimétrica exacta */}
        {showMillimeterGrid && (
          <rect
            x={viewMinX}
            y={viewMinY}
            width={viewWidthMm}
            height={viewHeightMm}
            fill="url(#mm-grid-major)"
          />
        )}

        {/* Si el material es Poliamida Blanca (Cinta 30 mm), mostrar banda de cinta de referencia */}
        {material.fixedRibbonWidthMm && (
          <g>
            <rect
              x={-paddingMm * 0.6}
              y={(design.heightMm - material.fixedRibbonWidthMm) / 2}
              width={design.widthMm + paddingMm * 1.2}
              height={material.fixedRibbonWidthMm}
              fill="rgba(248, 250, 252, 0.06)"
              stroke="#64748b"
              strokeWidth="0.08"
              strokeDasharray="0.6 0.4"
            />
            <text
              x={0}
              y={(design.heightMm - material.fixedRibbonWidthMm) / 2 - 0.5}
              fill="#94a3b8"
              fontSize="0.85"
              fontFamily="monospace"
            >
              Cinta textil {material.fixedRibbonWidthMm} mm
            </text>
          </g>
        )}

        {/* Superficie física de la etiqueta (Contorno de Corte Exterior Capa 02) */}
        <path
          d={compiled.outerCutContour.svgPathD}
          fill={
            isTechnical
              ? surfaceFill
              : material.id === 'ECOCUERO_SUELA'
                ? 'url(#suela-leather-grad)'
                : material.visual.metallic
                  ? 'url(#mirror-sheen)'
                  : material.id === 'ACRILICO_TRANSPARENTE'
                    ? 'url(#glass-specular)'
                    : surfaceFill
          }
          fillOpacity={isTechnical ? 1 : material.visual.opacity}
          stroke={cutStroke}
          strokeWidth={isTechnical ? 0.16 : 0.22}
        />

        {/* Guía de margen de seguridad y ejes centrales (Capa T1 no productiva) */}
        {showSafetyGuides && (
          <g pointerEvents="none">
            <path
              d={compiled.safetyGuideContour.svgPathD}
              fill="none"
              stroke={LIGHTBURN_LAYERS.GUIDE.hexColor}
              strokeWidth="0.09"
              strokeDasharray="0.45 0.35"
              opacity={0.85}
            />
            <line
              x1={design.widthMm / 2}
              y1={0}
              x2={design.widthMm / 2}
              y2={design.heightMm}
              stroke={LIGHTBURN_LAYERS.GUIDE.hexColor}
              strokeWidth="0.06"
              strokeDasharray="0.3 0.3"
              opacity={0.5}
            />
            <line
              x1={0}
              y1={design.heightMm / 2}
              x2={design.widthMm}
              y2={design.heightMm / 2}
              stroke={LIGHTBURN_LAYERS.GUIDE.hexColor}
              strokeWidth="0.06"
              strokeDasharray="0.3 0.3"
              opacity={0.5}
            />
          </g>
        )}

        {/* Elementos de Grabado (Capa 00 #000000) */}
        <g
          transform={
            material.mirrorArtworkForBackEngrave
              ? `translate(${design.widthMm}, 0) scale(-1, 1)`
              : undefined
          }
        >
          {compiled.engravingItems.map((eng) => {
            const rawEl = design.elements.find((e) => eng.id.endsWith(e.id));
            const isSelected = rawEl && rawEl.id === selectedElementId;
            return (
              <g
                key={eng.id}
                className="cursor-move"
                onPointerDown={(e) => {
                  if (rawEl) {
                    handleElementPointerDown(
                      e,
                      rawEl.id,
                      rawEl.xMm,
                      rawEl.yMm,
                      rawEl.locked
                    );
                  }
                }}
              >
                {eng.kind === 'vector_path' && eng.svgPathD && (
                  <path
                    d={eng.svgPathD}
                    fill={eng.filled ? engraveColor : 'none'}
                    fillRule={eng.fillRule || 'evenodd'}
                    stroke={eng.filled ? 'none' : engraveColor}
                    strokeWidth={eng.strokeWidthMm || 0.3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {eng.kind === 'raster_image' && eng.dataUrl && (
                  <image
                    x={eng.xMm}
                    y={eng.yMm}
                    width={eng.widthMm}
                    height={eng.heightMm}
                    preserveAspectRatio="none"
                    href={eng.dataUrl}
                    transform={
                      eng.rotationDeg
                        ? `rotate(${eng.rotationDeg} ${roundMm((eng.xMm || 0) + (eng.widthMm || 0) / 2)} ${roundMm((eng.yMm || 0) + (eng.heightMm || 0) / 2)})`
                        : undefined
                    }
                  />
                )}
                {/* Caja de selección interactiva */}
                {rawEl && isSelected && (
                  <rect
                    x={rawEl.xMm - rawEl.widthMm / 2 - 0.2}
                    y={rawEl.yMm - rawEl.heightMm / 2 - 0.2}
                    width={rawEl.widthMm + 0.4}
                    height={rawEl.heightMm + 0.4}
                    fill="transparent"
                    stroke="#f59e0b"
                    strokeWidth="0.14"
                    strokeDasharray="0.4 0.25"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Agujeros de costura / sujeción (Capa 01 #0000FF) */}
        {compiled.holeContours.map((hole) => (
          <path
            key={hole.id}
            d={hole.svgPathD}
            fill={isTechnical ? 'none' : '#090c10'}
            stroke={holeStroke}
            strokeWidth={isTechnical ? 0.15 : 0.2}
          />
        ))}

        {/* CONTROLES DE MANIPULACIÓN INTERACTIVA (MANIJAS DE RESIZE Y ROTACIÓN CON MOUSE) */}
        {selectedEl && (
          <g>
            {/* Esquina Noroeste (NW) */}
            <circle
              cx={selectedEl.xMm - selectedEl.widthMm / 2}
              cy={selectedEl.yMm - selectedEl.heightMm / 2}
              r={handleRadius}
              fill="#ffffff"
              stroke="#f59e0b"
              strokeWidth="0.12"
              className="cursor-nwse-resize hover:scale-125 transition-transform"
              onPointerDown={(e) => handleResizeHandlePointerDown(e, 'nw')}
            />
            {/* Esquina Noreste (NE) */}
            <circle
              cx={selectedEl.xMm + selectedEl.widthMm / 2}
              cy={selectedEl.yMm - selectedEl.heightMm / 2}
              r={handleRadius}
              fill="#ffffff"
              stroke="#f59e0b"
              strokeWidth="0.12"
              className="cursor-nesw-resize hover:scale-125 transition-transform"
              onPointerDown={(e) => handleResizeHandlePointerDown(e, 'ne')}
            />
            {/* Esquina Sureste (SE) */}
            <circle
              cx={selectedEl.xMm + selectedEl.widthMm / 2}
              cy={selectedEl.yMm + selectedEl.heightMm / 2}
              r={handleRadius}
              fill="#ffffff"
              stroke="#f59e0b"
              strokeWidth="0.12"
              className="cursor-nwse-resize hover:scale-125 transition-transform"
              onPointerDown={(e) => handleResizeHandlePointerDown(e, 'se')}
            />
            {/* Esquina Suroeste (SW) */}
            <circle
              cx={selectedEl.xMm - selectedEl.widthMm / 2}
              cy={selectedEl.yMm + selectedEl.heightMm / 2}
              r={handleRadius}
              fill="#ffffff"
              stroke="#f59e0b"
              strokeWidth="0.12"
              className="cursor-nesw-resize hover:scale-125 transition-transform"
              onPointerDown={(e) => handleResizeHandlePointerDown(e, 'sw')}
            />

            {/* Manija de Rotación Superior (ROT) */}
            <line
              x1={selectedEl.xMm}
              y1={selectedEl.yMm - selectedEl.heightMm / 2}
              x2={selectedEl.xMm}
              y2={selectedEl.yMm - selectedEl.heightMm / 2 - handleDistRot}
              stroke="#f59e0b"
              strokeWidth="0.1"
              strokeDasharray="0.2 0.15"
            />
            <circle
              cx={selectedEl.xMm}
              cy={selectedEl.yMm - selectedEl.heightMm / 2 - handleDistRot}
              r={handleRadius * 1.15}
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth="0.12"
              className="cursor-grab hover:scale-125 transition-transform"
              onPointerDown={handleRotateHandlePointerDown}
            >
              <title>Arrastrar con el mouse para rotar el elemento</title>
            </circle>
          </g>
        )}

        {/* Cotas dimensionales técnicas en milímetros reales */}
        <g pointerEvents="none">
          {/* Cota horizontal superior (Ancho en mm) */}
          <line
            x1={0}
            y1={-1.8}
            x2={design.widthMm}
            y2={-1.8}
            stroke="#38bdf8"
            strokeWidth="0.09"
          />
          <line x1={0} y1={-2.5} x2={0} y2={-0.6} stroke="#38bdf8" strokeWidth="0.09" />
          <line
            x1={design.widthMm}
            y1={-2.5}
            x2={design.widthMm}
            y2={-0.6}
            stroke="#38bdf8"
            strokeWidth="0.09"
          />
          <text
            x={design.widthMm / 2}
            y={-2.35}
            textAnchor="middle"
            fill="#38bdf8"
            fontSize="1.15"
            fontFamily="monospace"
            fontWeight="bold"
          >
            {design.widthMm} mm
            {design.kerfCompensationMm > 0
              ? ` (Corte: ${compiled.effectiveCutWidthMm} mm)`
              : ''}
          </text>

          {/* Cota vertical izquierda (Alto en mm) */}
          <line
            x1={-1.8}
            y1={0}
            x2={-1.8}
            y2={design.heightMm}
            stroke="#38bdf8"
            strokeWidth="0.09"
          />
          <line x1={-2.5} y1={0} x2={-0.6} y2={0} stroke="#38bdf8" strokeWidth="0.09" />
          <line
            x1={-2.5}
            y1={design.heightMm}
            x2={-0.6}
            y2={design.heightMm}
            stroke="#38bdf8"
            strokeWidth="0.09"
          />
          <text
            x={-2.4}
            y={design.heightMm / 2}
            textAnchor="middle"
            fill="#38bdf8"
            fontSize="1.15"
            fontFamily="monospace"
            fontWeight="bold"
            transform={`rotate(-90 -2.4 ${design.heightMm / 2})`}
          >
            {design.heightMm} mm
          </text>

          {/* Marcas de regla cada 5 mm en eje X */}
          {ticksX
            .filter((t) => t % 5 === 0)
            .map((t) => (
              <text
                key={`tx-${t}`}
                x={t}
                y={design.heightMm + 1.6}
                textAnchor="middle"
                fill="#64748b"
                fontSize="0.75"
                fontFamily="monospace"
              >
                {t}
              </text>
            ))}

          {/* Marcas de regla cada 5 mm en eje Y */}
          {ticksY
            .filter((t) => t % 5 === 0)
            .map((t) => (
              <text
                key={`ty-${t}`}
                x={design.widthMm + 1.4}
                y={t + 0.28}
                textAnchor="start"
                fill="#64748b"
                fontSize="0.75"
                fontFamily="monospace"
              >
                {t}
              </text>
            ))}
        </g>
      </svg>
    </div>
  );
};
