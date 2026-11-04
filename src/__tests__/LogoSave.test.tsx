import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {beforeEach, afterEach, it, expect, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import App from '../App';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
beforeEach(()=>{localStorage.clear();vi.mocked(invoke).mockReset();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};});
afterEach(cleanup);
function prepare(){render(<App/>);fireEvent.click(screen.getByText('Probar con un logo de ejemplo'));fireEvent.click(screen.getByRole('button',{name:'SVG Huecos'}));fireEvent.click(screen.getByRole('button',{name:/6.*Exportar/}));fireEvent.click(screen.getByRole('button',{name:'Descargar grabado y corte (SVG)'}));}
it('asks for a name before saving engraving and cutting together',async()=>{
 prepare();expect(invoke).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Nombre del logo o archivo'),{target:{value:'Clara Tejidos'}});
 vi.mocked(invoke).mockResolvedValue({folder:'/Documents/ASTRA LOGOS/Clara Tejidos',files:['Grabado.svg','Corte.svg']});
 fireEvent.click(screen.getByRole('button',{name:'Guardar archivos'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
 const args=vi.mocked(invoke).mock.calls[0][1] as any;
 expect(args.logoName).toBe('Clara Tejidos');expect(args.files).toHaveLength(3);
 expect(args.files[0].name).toMatch(/Grabado/);expect(args.files[1].name).toMatch(/Corte/);
 expect(args.files[0].content).toContain('CAPA_00_GRABADO');
 expect(args.files[0].content).not.toContain('id="CAPA_02_CORTE"');
 expect(args.files[1].content).toContain('CAPA_02_CORTE');
 expect(args.files[2].name).toBe('Ajustes_LightBurn.txt');
 expect(args.files[2].content).toContain('DPI: 254.0');
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Guardar archivos'})).toBeNull());
});
it('cancel does not write files',()=>{prepare();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(invoke).not.toHaveBeenCalled();});
it('rejects paths and keeps the dialog available after a write error',async()=>{
 prepare();fireEvent.change(screen.getByLabelText('Nombre del logo o archivo'),{target:{value:'../fuera'}});
 fireEvent.click(screen.getByRole('button',{name:'Guardar archivos'}));expect(invoke).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Nombre del logo o archivo'),{target:{value:'Clara'}});
 vi.mocked(invoke).mockRejectedValue('Sin permisos');fireEvent.click(screen.getByRole('button',{name:'Guardar archivos'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Sin permisos'));
 expect((screen.getByRole('button',{name:'Guardar archivos'}) as HTMLButtonElement).disabled).toBe(false);
});
