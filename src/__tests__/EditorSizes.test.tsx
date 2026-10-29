import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect} from 'vitest';
import App from '../App';
import {createInitialOrdersCatalog} from '../core/projects/projectManager';
it('edits visible dimensions rather than transparent canvas dimensions',()=>{
 const orders=createInitialOrdersCatalog();
 const el:any=orders[0].labelDesign.elements[0];
 el.contentBoundsNormalized={minX:.2,minY:.25,maxX:.8,maxY:.75,width:.6,height:.5,centerNormX:.5,centerNormY:.5};
 localStorage.setItem('laserhouse_studio_orders_v1',JSON.stringify(orders));
 render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:/4.*Grabado/}));
 const fields=screen.getAllByRole('spinbutton');
 fireEvent.change(fields[0],{target:{value:'8'}});
 expect((fields[0] as HTMLInputElement).value).toBe('8');
 fireEvent.change(fields[1],{target:{value:'3'}});
 expect((fields[1] as HTMLInputElement).value).toBe('3');
 localStorage.clear();
});
