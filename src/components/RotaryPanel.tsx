import React, {useEffect, useMemo, useRef, useState} from 'react';
import {computeRotaryLayout, RotaryConfig, RotaryType} from '../core/rotary/rotaryEngine';
import {exportRotarySvg, exportRotaryGuideSvg, exportRotaryDxf} from '../core/exporters/rotaryExporter';
import {LogoOutputFile} from '../core/exporters/logoFolder';
import {LabelDesign} from '../core/types';

interface Props {
  design: LabelDesign;
  config: RotaryConfig;
  onConfigChange: (config: RotaryConfig) => void;
  onSave: (files: LogoOutputFile[]) => void;
  onClose: () => void;
}

/** Medidas orientativas: medí siempre el objeto real antes de producir. */
export const ROTARY_PRESETS: {id: string; label: string; patch: Partial<RotaryConfig>}[] = [
  {id: 'vaso', label: 'Vaso recto Ø 75', patch: {objectDiameterMm: 75, endDiameterMm: undefined, usefulLengthMm: 90}},
  {id: 'botella', label: 'Botella de vino Ø 75', patch: {objectDiameterMm: 75, endDiameterMm: undefined, usefulLengthMm: 140}},
  {id: 'lata', label: 'Lata 330 ml Ø 66', patch: {objectDiameterMm: 66, endDiameterMm: undefined, usefulLengthMm: 90}},
  {id: 'termo', label: 'Termo Ø 73', patch: {objectDiameterMm: 73, endDiameterMm: undefined, usefulLengthMm: 150}},
  {id: 'tumbler', label: 'Tumbler cónico Ø 90 → 65', patch: {objectDiameterMm: 90, endDiameterMm: 65, usefulLengthMm: 120}},
];

export function RotaryPanel({design, config, onConfigChange, onSave, onClose}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const setConfig = (update: (c: RotaryConfig) => RotaryConfig) => onConfigChange(update(config));
  const [withDxf, setWithDxf] = useState(false);
  const [withGuides, setWithGuides] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal?.(); }, []);

  const layout = useMemo(() => computeRotaryLayout(config, design), [config, design]);

  const preview = useMemo(() => {
    if (!layout.valid) return null;
    try { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exportRotarySvg(design, config).svgContent)}`; } catch { return null; }
  }, [layout.valid, design, config]);

  const num = (key: 'objectDiameterMm' | 'usefulLengthMm' | 'arcDeg' | 'repeatCount' | 'axisOffsetMm' | 'angularOffsetDeg') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setConfig(c => ({...c, [key]: e.target.value === '' ? NaN : Number(e.target.value)}));
  const val = (v: number | undefined, fallback: number | string = '') => (v === undefined || Number.isNaN(v) ? fallback : v);

  const save = () => {
    const files: LogoOutputFile[] = [];
    try {
      const art = exportRotarySvg(design, config);
      files.push({name: art.svgFilename, content: art.svgContent}, {name: art.instructionsFilename, content: art.instructionsText});
      if (withDxf) { const d = exportRotaryDxf(design, config); files.push({name: d.filename, content: d.dxfContent}); }
      if (withGuides) { const g = exportRotaryGuideSvg(design, config); files.push({name: g.filename, content: g.svgContent}); }
    } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); return; }
    setSaveError(null);
    onSave(files);
  };

  const field = 'w-full bg-slate-950 border border-slate-700 rounded px-3 py-2';
  const maxW = 440, maxH = 220;
  const scale = layout.valid ? Math.min(maxW / layout.canvasWidthMm, maxH / layout.canvasHeightMm) : 1;

  return (
    <dialog ref={dialog} className="studio-orders-dialog" aria-labelledby="rotary-title" onCancel={onClose}>
      <div className="p-6 space-y-4 max-w-2xl max-h-[85vh] overflow-y-auto">
        <h3 id="rotary-title" className="font-semibold text-white">Rotativo (Vank 9060)</h3>
        <p className="text-sm text-slate-400">
          Desenrolla el diseño actual sobre un objeto cilíndrico o cónico. El ancho del diseño corre a lo largo del eje y el alto da la vuelta al objeto.
        </p>

        <label className="block text-sm space-y-1"><span>Objeto de ejemplo (medidas orientativas, medí el real)</span>
          <select aria-label="Preset de objeto" className={field} value="" onChange={e => {
            const p = ROTARY_PRESETS.find(x => x.id === e.target.value);
            if (p) setConfig(c => ({...c, ...p.patch}));
          }}>
            <option value="">Elegir…</option>
            {ROTARY_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1"><span>Tipo de rotativo</span>
            <select className={field} value={config.rotaryType} onChange={e => setConfig(c => ({...c, rotaryType: e.target.value as RotaryType}))}>
              <option value="roller">Rodillos</option>
              <option value="chuck">Mandril</option>
            </select>
          </label>
          <label className="space-y-1"><span>Largo útil (mm)</span>
            <input className={field} type="number" min={1} step="0.1" value={val(config.usefulLengthMm)} onChange={num('usefulLengthMm')} />
          </label>
          <label className="space-y-1"><span>Diámetro inicial, X = 0 (mm)</span>
            <input className={field} type="number" min={5} max={300} step="0.1" value={val(config.objectDiameterMm)} onChange={num('objectDiameterMm')} />
          </label>
          <label className="space-y-1"><span>Diámetro final, X = largo (mm)</span>
            <input className={field} type="number" min={5} max={300} step="0.1" placeholder="igual = recto" value={val(config.endDiameterMm)}
              onChange={e => setConfig(c => ({...c, endDiameterMm: e.target.value === '' ? undefined : Number(e.target.value)}))} />
          </label>
          <label className="space-y-1"><span>Arco a grabar (°)</span>
            <input className={field} type="number" min={1} max={360} step="1" value={val(config.arcDeg)} onChange={num('arcDeg')} />
          </label>
          <label className="space-y-1"><span>Copias alrededor</span>
            <input className={field} type="number" min={1} max={36} step="1" value={val(config.repeatCount, 1)} onChange={num('repeatCount')} />
          </label>
          <label className="space-y-1"><span>Desplazamiento axial (mm)</span>
            <input className={field} type="number" step="0.1" value={val(config.axisOffsetMm, 0)} onChange={num('axisOffsetMm')} />
          </label>
          <label className="space-y-1"><span>Giro del diseño (°)</span>
            <input className={field} type="number" step="1" value={val(config.angularOffsetDeg, 0)} onChange={num('angularOffsetDeg')} />
          </label>
        </div>

        <div className="studio-notice text-sm space-y-1">
          {layout.tapered && <p>Objeto cónico: cargá <b>Ø {layout.referenceDiameterMm} mm</b> en la máquina.</p>}
          <p>Circunferencia: <b>{layout.circumferenceMm} mm</b> · Lienzo: <b>{layout.canvasWidthMm} × {layout.canvasHeightMm} mm</b></p>
          <p>Diseño: {design.widthMm} × {design.heightMm} mm ({layout.designArcDeg}° de la vuelta){layout.repeatCount > 1 ? ` × ${layout.repeatCount} copias` : ''}</p>
        </div>

        {preview && (
          <div className="mx-auto border border-dashed border-slate-600 bg-white" style={{width: layout.canvasWidthMm * scale, height: layout.canvasHeightMm * scale}}>
            <img alt="Vista previa del objeto desenrollado" src={preview} width={layout.canvasWidthMm * scale} height={layout.canvasHeightMm * scale} />
          </div>
        )}
        {preview && <p className="text-xs text-slate-400 text-center">Borde superior = costura (Y = 0). Izquierda = extremo X = 0.</p>}

        {layout.errors.map(m => <p key={m} role="alert" className="text-sm text-red-300">{m}</p>)}
        {saveError && <p role="alert" className="text-sm text-red-300">{saveError}</p>}
        {layout.warnings.map(m => <p key={m} className="text-sm text-amber-300">{m}</p>)}

        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={withDxf} onChange={e => setWithDxf(e.target.checked)} />Incluir DXF para RDWorks (sólo vectorial)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={withGuides} onChange={e => setWithGuides(e.target.checked)} />Incluir SVG de guías de alineación (no productivo, para prueba de encuadre)</label>
        </div>
        <p className="text-xs text-slate-400">Sólo grabado. Potencia, velocidad y pasos por vuelta los cargás vos en LightBurn o en la Ruida.</p>

        <div className="flex justify-end gap-3">
          <button type="button" className="studio-secondary-action" onClick={onClose}>Cerrar</button>
          <button type="button" disabled={!layout.valid} className="bg-cyan-600 text-white px-4 py-2 disabled:opacity-40" onClick={save}>Guardar archivos</button>
        </div>
      </div>
    </dialog>
  );
}
