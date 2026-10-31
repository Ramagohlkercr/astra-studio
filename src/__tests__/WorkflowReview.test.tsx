import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import {createInitialOrdersCatalog} from '../core/projects/projectManager';
beforeEach(()=>localStorage.clear());
afterEach(cleanup);
describe('Full workflow regressions',()=>{
 it('undoes material changes without losing the block layout default',()=>{
  render(<App/>); fireEvent.click(screen.getByRole('button',{name:/5.*Producción/}));
  const select=screen.getByRole('combobox',{name:'Material'}) as HTMLSelectElement;
  const original=select.value; const other=select.options[1].value;
  fireEvent.change(select,{target:{value:other}}); expect(select.value).toBe(other);
  fireEvent.click(screen.getByTitle('Deshacer (Ctrl+Z)')); expect(select.value).toBe(original);
  expect((screen.getByRole('combobox',{name:'Distribución de etiquetas'}) as HTMLSelectElement).value).toBe('blocks');
  fireEvent.click(screen.getByTitle('Rehacer (Ctrl+Y)'));expect(select.value).toBe(other);
 });
 it('disables manufacturing downloads for invalid geometry',()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:/2.*Medidas/}));
  fireEvent.change(screen.getByPlaceholderText('40'),{target:{value:'900'}});
  fireEvent.change(screen.getByPlaceholderText('20'),{target:{value:'600'}});
  fireEvent.click(screen.getByRole('button',{name:/6.*Exportar/}));
  for(const b of screen.getAllByRole('button',{name:/SVG|DXF/}))expect((b as HTMLButtonElement).disabled).toBe(true);
 });
 it('resets a stale export batch when quantity decreases',()=>{
  const p=createInitialOrdersCatalog()[0];p.nestingConfig={...p.nestingConfig,requestedQuantity:500,sheetWidthMm:200,sheetHeightMm:200};localStorage.setItem('laserhouse_studio_orders_v1',JSON.stringify([p]));
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:/6.*Exportar/}));
  const batch=screen.getByRole('combobox',{name:'Tanda a exportar'}) as HTMLSelectElement;
  expect(batch.options.length).toBeGreaterThan(1);fireEvent.change(batch,{target:{value:String(batch.options.length-1)}});
  fireEvent.click(screen.getByRole('button',{name:/Producción/}));fireEvent.click(screen.getByRole('button',{name:'50'}));
  fireEvent.click(screen.getByRole('button',{name:/6.*Exportar/}));
  expect((screen.getByRole('combobox',{name:'Tanda a exportar'}) as HTMLSelectElement).value).toBe('0');
 });
 it('restores a saved custom material snapshot on startup',()=>{
  const p=createInitialOrdersCatalog()[0];
  p.materialProfileSnapshot={...p.materialProfileSnapshot!,id:'CUSTOM-SAVED',name:'Material de prueba guardado'};
  p.materialId='CUSTOM-SAVED';localStorage.setItem('laserhouse_studio_orders_v1',JSON.stringify([p]));
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:/5.*Producción/}));
  expect((screen.getByRole('combobox',{name:'Material'}) as HTMLSelectElement).value).toBe('CUSTOM-SAVED');
 });
 it('shows a useful empty search result',()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Pedidos'}));
  fireEvent.change(screen.getByPlaceholderText(/Buscar pedidos/),{target:{value:'missing-order-xyz'}});
  expect(screen.getByText('No encontramos pedidos')).toBeDefined();
 });
});
