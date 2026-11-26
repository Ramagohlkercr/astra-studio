import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,describe} from 'vitest';
import App from '../App';
import {createInitialOrdersCatalog} from '../core/projects/projectManager';

describe('EditorSizes — Edición fluida de tamaño del logo', () => {
 it('edits visible dimensions rather than transparent canvas dimensions',()=>{
  const orders=createInitialOrdersCatalog();
  const el:any=orders[0].labelDesign.elements[0];
  el.contentBoundsNormalized={minX:.2,minY:.25,maxX:.8,maxY:.75,width:.6,height:.5,centerNormX:.5,centerNormY:.5};
  localStorage.setItem('laserhouse_studio_orders_v1',JSON.stringify(orders));
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:/4.*Grabado/}));
  const fields=screen.getAllByRole('spinbutton').filter(el=>el.getAttribute('aria-label') !== 'Margen para costura (mm)');
  fireEvent.change(fields[0],{target:{value:'8'}});
  expect((fields[0] as HTMLInputElement).value).toBe('8');
  fireEvent.change(fields[1],{target:{value:'3'}});
  expect((fields[1] as HTMLInputElement).value).toBe('3');
  localStorage.clear();
 });

 it('permite borrar y escribir medidas nuevas de varios dígitos y editar desde Paso 1 y Rotativo',()=>{
  const orders=createInitialOrdersCatalog();
  localStorage.setItem('laserhouse_studio_orders_v1',JSON.stringify(orders));
  render(<App/>);

  // En Paso 1 también se puede editar Ancho / Alto (mm) sin rebotes al vaciar el campo
  const widthInputStep1 = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
  fireEvent.focus(widthInputStep1);
  fireEvent.change(widthInputStep1,{target:{value:''}});
  expect(widthInputStep1.value).toBe('');
  fireEvent.change(widthInputStep1,{target:{value:'28'}});
  expect(widthInputStep1.value).toBe('28');
  fireEvent.blur(widthInputStep1);

  // Al abrir el módulo Rotativo también permite editar el tamaño base del logo
  fireEvent.click(screen.getByRole('button',{name:/Rotativo/i}));
  const rotaryLogoWidth = screen.getByLabelText('Ancho del logo en rotativo (mm)') as HTMLInputElement;
  fireEvent.focus(rotaryLogoWidth);
  fireEvent.change(rotaryLogoWidth,{target:{value:''}});
  expect(rotaryLogoWidth.value).toBe('');
  fireEvent.change(rotaryLogoWidth,{target:{value:'55'}});
  expect(rotaryLogoWidth.value).toBe('55');
  fireEvent.blur(rotaryLogoWidth);
  localStorage.clear();
 });
});
