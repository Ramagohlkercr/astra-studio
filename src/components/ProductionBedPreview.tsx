import React, { useState } from 'react';
import { compileLabelGeometry, roundMm } from '../core/geometry/geometryEngine';
import {
  GeometricValidationReport,
  LabelDesign,
  LIGHTBURN_LAYERS,
  MaterialProfile,
  NestingResult,
} from '../core/types';

interface ProductionBedPreviewProps {
  design: LabelDesign;
  material: MaterialProfile;
  nesting: NestingResult;
  validation: GeometricValidationReport;
  activeBatchIndex: number;
  onSelectBatchIndex: (index: number) => void;
}

export const ProductionBedPreview: React.FC<ProductionBedPreviewProps> = ({
  design,
  material,
  nesting,
  validation,
  activeBatchIndex,
  onSelectBatchIndex,
}) => {
  const [cameraMode, setCameraMode] = useState<'focus_occupied' | 'full_sheet' | 'full_machine'>(
    'focus_occupied'
  );
  const [showEngraveLayer, setShowEngraveLayer] = useState(true);
  const [showHolesLayer, setShowHolesLayer] = useState(true);
  const [showCutLayer, setShowCutLayer] = useState(true);
  const [hoveredPieceIndex, setHoveredPieceIndex] = useState<number | null>(null);

  const batch = nesting.batches[activeBatchIndex] || nesting.batches[0];
  const rotated90 = nesting.appliedRotationDeg === 90;

  // Compilamos una vez el símbolo maestro de la etiqueta en (0,0) y cada instancia se posiciona en (inst.xMm, inst.yMm)
  // exactamente con la misma matemática que exportProductionSvg y exportProductionDxf
  const masterSymbol = compileLabelGeometry(design, {
    offsetXMm: 0,
    offsetYMm: 0,
    rotated90,
    instanceIdPrefix: 'master',
  });

  // Calcular el viewBox de cámara según el modo elegido
  let vbMinX = -15;
  let vbMinY = -15;
  let vbWidth = nesting.config.machineBedWidthMm + 30;
  let vbHeight = nesting.config.machineBedHeightMm + 30;

  if (cameraMode === 'full_sheet') {
    const pad = Math.max(12, Math.max(nesting.config.sheetWidthMm, nesting.config.sheetHeightMm) * 0.05);
    vbMinX = -pad;
    vbMinY = -pad;
    vbWidth = nesting.config.sheetWidthMm + pad * 2;
    vbHeight = nesting.config.sheetHeightMm + pad * 2;
  } else if (cameraMode === 'focus_occupied' && batch && batch.placedInstances.length > 0) {
    const ob = batch.occupiedBounds;
    const pad = Math.max(10, Math.max(ob.width, ob.height) * 0.08);
    vbMinX = roundMm(Math.max(-15, ob.minX - pad));
    vbMinY = roundMm(Math.max(-15, ob.minY - pad));
    vbWidth = roundMm(ob.width + pad * 2);
    vbHeight = roundMm(ob.height + pad * 2);
  }

  const hoveredInst =
    hoveredPieceIndex !== null && batch
      ? batch.placedInstances.find((p) => p.instanceIndex === hoveredPieceIndex)
      : null;

  return (
    <div className="production-preview flex flex-col w-full h-full bg-[#090c10]">
      {/* Barra de controles de Vista de Producción */}
      <div className="production-toolbar flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-[#11161f] border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-300 uppercase tracking-wider">
            Vista
          </span>
          <button
            type="button"
            onClick={() => setCameraMode('focus_occupied')}
            className={`px-2.5 py-1 rounded font-medium transition ${
              cameraMode === 'focus_occupied'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Lote
          </button>
          <button
            type="button"
            onClick={() => setCameraMode('full_sheet')}
            className={`px-2.5 py-1 rounded font-medium transition ${
              cameraMode === 'full_sheet'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Plancha
          </button>
          <button
            type="button"
            onClick={() => setCameraMode('full_machine')}
            className={`px-2.5 py-1 rounded font-medium transition ${
              cameraMode === 'full_machine'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            Mesa completa
          </button>
        </div>

        {/* Selector de Tandas si hay más de 1 tanda */}
        {nesting.totalBatches > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Tanda:</span>
            {nesting.batches.map((b, idx) => (
              <button
                key={b.batchNumber}
                type="button"
                onClick={() => onSelectBatchIndex(idx)}
                className={`px-2 py-0.5 rounded font-mono ${
                  idx === activeBatchIndex
                    ? 'bg-sky-500/25 text-sky-300 border border-sky-500/50'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                #{b.batchNumber} ({b.count}u)
              </button>
            ))}
          </div>
        )}

        {/* Filtro de Capas de Producción LightBurn */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showEngraveLayer}
              onChange={(e) => setShowEngraveLayer(e.target.checked)}
              className="accent-slate-500"
            />
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-black border border-slate-500" />
            <span className="text-slate-300 font-mono">00 Grabado</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showHolesLayer}
              onChange={(e) => setShowHolesLayer(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#0000FF]" />
            <span className="text-slate-300 font-mono">01 Agujeros</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showCutLayer}
              onChange={(e) => setShowCutLayer(e.target.checked)}
              className="accent-red-500"
            />
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#FF0000]" />
            <span className="text-slate-300 font-mono">02 Corte</span>
          </label>
        </div>
      </div>

      {/* Lienzo Vectorial de Mesa de Producción */}
      <div className="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden p-3">
        <svg
          className="w-full h-full max-h-full rounded border border-slate-800 bg-[#0b0f17]"
          viewBox={`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern
              id="bed-grid-10mm"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(148, 163, 184, 0.08)"
                strokeWidth="0.2"
              />
            </pattern>
            <pattern
              id="bed-grid-50mm"
              width="50"
              height="50"
              patternUnits="userSpaceOnUse"
            >
              <rect width="50" height="50" fill="url(#bed-grid-10mm)" />
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="rgba(148, 163, 184, 0.18)"
                strokeWidth="0.35"
              />
            </pattern>

            {/* Símbolo maestro de etiqueta para renderizado instantáneo de hasta 1000+ unidades */}
            <g id="production-label-symbol">
              <path
                d={masterSymbol.outerCutContour.svgPathD}
                fill={material.visual.surfaceColor}
                fillOpacity={0.22}
                stroke="none"
              />
              {showEngraveLayer &&
                masterSymbol.engravingItems.map((eng) =>
                  eng.kind === 'vector_path' && eng.svgPathD ? (
                    <path
                      key={eng.id}
                      d={eng.svgPathD}
                      fill={eng.filled ? '#e2e8f0' : 'none'}
                      fillRule={eng.fillRule || 'evenodd'}
                      stroke={eng.filled ? 'none' : '#e2e8f0'}
                      strokeWidth={eng.strokeWidthMm || 0.3}
                    />
                  ) : eng.kind === 'raster_image' && eng.dataUrl ? (
                    <image
                      key={eng.id}
                      x={eng.xMm}
                      y={eng.yMm}
                      width={eng.widthMm}
                      height={eng.heightMm}
                      preserveAspectRatio="none"
                      href={eng.dataUrl}
                    />
                  ) : null
                )}
              {showHolesLayer &&
                masterSymbol.holeContours.map((hc) => (
                  <path
                    key={hc.id}
                    d={hc.svgPathD}
                    fill="#090c10"
                    stroke={LIGHTBURN_LAYERS.HOLES.hexColor}
                    strokeWidth="0.22"
                  />
                ))}
              {showCutLayer && (
                <path
                  d={masterSymbol.outerCutContour.svgPathD}
                  fill="none"
                  stroke={LIGHTBURN_LAYERS.CUT.hexColor}
                  strokeWidth="0.24"
                />
              )}
            </g>
          </defs>

          {/* Área máxima de la máquina Vank 9060 CO2 (900 x 600 mm) */}
          <rect
            x={0}
            y={0}
            width={nesting.config.machineBedWidthMm}
            height={nesting.config.machineBedHeightMm}
            fill="url(#bed-grid-50mm)"
            stroke="#334155"
            strokeWidth="0.6"
          />

          {/* Plancha o recorte de material colocado sobre la mesa */}
          <rect
            x={0}
            y={0}
            width={nesting.config.sheetWidthMm}
            height={nesting.config.sheetHeightMm}
            fill={material.visual.surfaceColor}
            fillOpacity={0.07}
            stroke="#f59e0b"
            strokeWidth="0.45"
          />

          {/* Línea de márgenes de seguridad del material */}
          <rect
            x={nesting.config.marginLeftMm}
            y={nesting.config.marginTopMm}
            width={Math.max(
              0,
              nesting.config.sheetWidthMm -
                nesting.config.marginLeftMm -
                nesting.config.marginRightMm
            )}
            height={Math.max(
              0,
              nesting.config.sheetHeightMm -
                nesting.config.marginTopMm -
                nesting.config.marginBottomMm
            )}
            fill="none"
            stroke={LIGHTBURN_LAYERS.GUIDE.hexColor}
            strokeWidth="0.25"
            strokeDasharray="1.5 1.5"
            opacity={0.65}
          />

          {/* Todas las etiquetas posicionadas en coordenadas reales (mm) */}
          {batch &&
            batch.placedInstances.map((inst) => (
              <g
                key={inst.instanceIndex}
                transform={`translate(${inst.xMm}, ${inst.yMm})`}
                onMouseEnter={() => setHoveredPieceIndex(inst.instanceIndex)}
                onMouseLeave={() => setHoveredPieceIndex(null)}
                className="cursor-pointer"
              >
                <use href="#production-label-symbol" />
                {hoveredPieceIndex === inst.instanceIndex && (
                  <rect
                    x={-0.3}
                    y={-0.3}
                    width={inst.widthMm + 0.6}
                    height={inst.heightMm + 0.6}
                    fill="rgba(56, 189, 248, 0.15)"
                    stroke="#38bdf8"
                    strokeWidth="0.35"
                  />
                )}
              </g>
            ))}

          {/* Envolvente del bloque ocupado con cotas */}
          {batch && batch.placedInstances.length > 0 && (
            <g pointerEvents="none">
              <rect
                x={batch.occupiedBounds.minX}
                y={batch.occupiedBounds.minY}
                width={batch.occupiedBounds.width}
                height={batch.occupiedBounds.height}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="0.25"
                strokeDasharray="1.2 0.8"
              />
              <text
                x={batch.occupiedBounds.minX}
                y={batch.occupiedBounds.minY - 1.5}
                fill="#38bdf8"
                fontSize={Math.max(2.2, vbWidth * 0.011)}
                fontFamily="monospace"
                fontWeight="bold"
              >
                Tanda {batch.batchNumber} · {batch.occupiedBounds.width} ×{' '}
                {batch.occupiedBounds.height} mm ({batch.count} u. | {batch.columnsUsed} col ×{' '}
                {batch.rowsUsed} filas | Sep: {nesting.config.gapXMm}×{nesting.config.gapYMm} mm)
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Inspector inferior de pieza bajo el cursor y estado de validación */}
      <div className="production-status flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#11161f] border-t border-slate-800 text-xs shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                validation.isValid ? 'bg-emerald-400' : 'bg-red-500'
              }`}
            />
            <span className="font-semibold text-slate-200">
              {validation.isValid
                ? 'Geometría verificada · Escala 1:1'
                : 'Atención: Revisar advertencias geométricas'}
            </span>
          </div>
          <span className="text-slate-400 font-mono">
            Piezas en tanda: <strong className="text-amber-300">{batch?.count || 0}</strong> / Total pedido:{' '}
            <strong className="text-slate-200">{nesting.totalRequestedQuantity}</strong>
          </span>
          <span className="text-slate-400 font-mono">
            Cortes: <strong className="text-red-400">{validation.totalProductiveCutContours}</strong> | Agujeros:{' '}
            <strong className="text-blue-400">{validation.totalProductiveHoleContours}</strong> | Líneas duplicadas:{' '}
            <strong className="text-emerald-400">{validation.duplicateCutSegmentsCount}</strong>
          </span>
        </div>

        <div className="font-mono text-slate-300">
          {hoveredInst ? (
            <span className="text-sky-300">
              Etiqueta #{hoveredInst.instanceIndex} (Fila {hoveredInst.row + 1}, Col{' '}
              {hoveredInst.col + 1}) → X: {hoveredInst.xMm} mm, Y: {hoveredInst.yMm} mm (
              {hoveredInst.widthMm}×{hoveredInst.heightMm} mm)
            </span>
          ) : (
            <span className="text-slate-500">
              Pasá sobre una etiqueta para ver su posición.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
