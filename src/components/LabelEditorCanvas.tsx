import React, { useRef, useState } from 'react';
import { compileLabelGeometry, roundMm } from '../core/geometry/geometryEngine';
import {
  LabelDesign,
  LIGHTBURN_LAYERS,
  MaterialProfile,
} from '../core/types';

interface LabelEditorCanvasProps {
  design: LabelDesign;
  material: MaterialProfile;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onMoveElement: (id: string, newXMm: number, newYMm: number) => void;
  zoomLevel: number; // 1.0 = base scale (~18 px/mm)
  onZoomChange: (nextZoom: number) => void;
  showMillimeterGrid: boolean;
  showSafetyGuides: boolean;
  snapToGridMm: number; // 0 = off, 0.5 = 0.5mm, 1 = 1mm
  renderStyle: 'realistic_material' | 'technical_lightburn';
}

export const LabelEditorCanvas: React.FC<LabelEditorCanvasProps> = ({
  design,
  material,
  selectedElementId,
  onSelectElement,
  onMoveElement,
  zoomLevel,
  onZoomChange,
  showMillimeterGrid,
  showSafetyGuides,
  snapToGridMm,
  renderStyle,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetMm, setDragOffsetMm] = useState<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0,
  });

  const compiled = compileLabelGeometry(design);
  const paddingMm = Math.max(6, Math.max(design.widthMm, design.heightMm) * 0.32);
  const viewMinX = -paddingMm;
  const viewMinY = -paddingMm;
  const viewWidthMm = design.widthMm + paddingMm * 2;
  const viewHeightMm = design.heightMm + paddingMm * 2;

  const clientToMillimeters = (clientX: number, clientY: number) => {
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
    setDraggingId(elementId);
    setDragOffsetMm({ dx: pt.x - elXMm, dy: pt.y - elYMm });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    const pt = clientToMillimeters(e.clientX, e.clientY);
    let nx = pt.x - dragOffsetMm.dx;
    let ny = pt.y - dragOffsetMm.dy;

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
    onMoveElement(draggingId, nx, ny);
  };

  const handlePointerUp = () => {
    setDraggingId(null);
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

  return (
    <div
      className="relative w-full h-full flex items-center justify-center overflow-auto bg-[#090c10] select-none"
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
          <linearGradient id="mirror-sheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="45%" stopColor="#94a3b8" />
            <stop offset="55%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#64748b" />
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
            !isTechnical && material.visual.metallic
              ? 'url(#mirror-sheen)'
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
                {rawEl && (
                  <rect
                    x={rawEl.xMm - rawEl.widthMm / 2 - 0.25}
                    y={rawEl.yMm - rawEl.heightMm / 2 - 0.25}
                    width={rawEl.widthMm + 0.5}
                    height={rawEl.heightMm + 0.5}
                    fill="transparent"
                    stroke={isSelected ? '#f59e0b' : 'transparent'}
                    strokeWidth="0.12"
                    strokeDasharray="0.35 0.25"
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
