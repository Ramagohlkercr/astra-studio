import React, {useEffect, useMemo, useRef, useState} from 'react';
import {computeRotaryLayout, DEFAULT_ROTARY_CONFIG, RotaryConfig, RotaryType} from '../core/rotary/rotaryEngine';
import {exportRotarySvg} from '../core/exporters/rotaryExporter';
import {LogoOutputFile} from '../core/exporters/logoFolder';
import {LabelDesign} from '../core/types';

interface Props {
  design: LabelDesign;
  onSave: (files: LogoOutputFile[]) => void;
  onClose: () => void;
}

export function RotaryPanel({design, onSave, onClose}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState<RotaryConfig>(DEFAULT_ROTARY_CONFIG);
  useEffect(() => { dialog.current?.showModal?.(); }, []);

  const layout = useMemo(() => computeRotaryLayout(config, design), [config, design]);
  const num = (key: keyof RotaryConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig(c => ({...c, [key]: e.target.value === '' ? NaN : Number(e.target.value)}));

  const save = () => {
    const art = exportRotarySvg(design, config);
    onSave([
      {name: art.svgFilename, content: art.svgContent},
      {name: art.instructionsFilename, content: art.instructionsText},
    ]);
  };

  const field = 'w-full bg-slate-950 border border-slate-700 rounded px-3 py-2';
  const pad = 8;
  const scale = Math.min(360 / Math.max(layout.canvasWidthMm, 1), 160 / Math.max(layout.canvasHeightMm, 1));
  const dw = design.widthMm * scale, dh = design.heightMm * scale;

  return (
    <dialog ref={dialog} className="studio-orders-dialog" aria-labelledby="rotary-title" onCancel={onClose}>
      <div className="p-6 space-y-4 max-w-xl">
        <h3 id="rotary-title" className="font-semibold text-white">Rotativo (Vank 9060)</h3>
        <p className="text-sm text-slate-400">
          Genera el diseño actual desenrollado sobre un objeto cilíndrico recto. El ancho del diseño corre a lo largo del eje y el alto da la vuelta al objeto.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1"><span>Tipo de rotativo</span>
            <select className={field} value={config.rotaryType} onChange={e => setConfig(c => ({...c, rotaryType: e.target.value as RotaryType}))}>
              <option value="roller">Rodillos</option>
              <option value="chuck">Mandril</option>
            </select>
          </label>
          <label className="space-y-1"><span>Diámetro del objeto (mm)</span>
            <input className={field} type="number" min={5} max={300} step="0.1" value={Number.isNaN(config.objectDiameterMm) ? '' : config.objectDiameterMm} onChange={num('objectDiameterMm')} />
          </label>
          <label className="space-y-1"><span>Largo útil (mm)</span>
            <input className={field} type="number" min={1} step="0.1" value={Number.isNaN(config.usefulLengthMm) ? '' : config.usefulLengthMm} onChange={num('usefulLengthMm')} />
          </label>
          <label className="space-y-1"><span>Arco a grabar (°)</span>
            <input className={field} type="number" min={1} max={360} step="1" value={Number.isNaN(config.arcDeg) ? '' : config.arcDeg} onChange={num('arcDeg')} />
          </label>
        </div>

        <div className="studio-notice text-sm space-y-1">
          <p>Circunferencia: <b>{layout.circumferenceMm} mm</b> · Lienzo: <b>{layout.canvasWidthMm} × {layout.canvasHeightMm} mm</b></p>
          <p>Diseño: {design.widthMm} × {design.heightMm} mm ({layout.designArcDeg}° de la vuelta)</p>
        </div>

        {layout.valid && (
          <svg role="img" aria-label="Vista previa del objeto desenrollado" width={layout.canvasWidthMm * scale + pad * 2} height={layout.canvasHeightMm * scale + pad * 2} className="mx-auto">
            <rect x={pad} y={pad} width={layout.canvasWidthMm * scale} height={layout.canvasHeightMm * scale} fill="none" stroke="#64748b" strokeDasharray="4 3" />
            <rect x={pad + layout.offsetXMm * scale} y={pad + layout.offsetYMm * scale} width={dw} height={dh} fill="#22d3ee33" stroke="#22d3ee" />
          </svg>
        )}

        {layout.errors.map(m => <p key={m} role="alert" className="text-sm text-red-300">{m}</p>)}
        {layout.warnings.map(m => <p key={m} className="text-sm text-amber-300">{m}</p>)}
        <p className="text-xs text-slate-400">Sólo grabado. Potencia, velocidad y pasos por vuelta los cargás vos en LightBurn o en la Ruida.</p>

        <div className="flex justify-end gap-3">
          <button type="button" className="studio-secondary-action" onClick={onClose}>Cerrar</button>
          <button type="button" disabled={!layout.valid} className="bg-cyan-600 text-white px-4 py-2 disabled:opacity-40" onClick={save}>Guardar archivos</button>
        </div>
      </div>
    </dialog>
  );
}
