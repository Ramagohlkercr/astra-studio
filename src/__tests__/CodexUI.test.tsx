import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';
import { createInitialOrdersCatalog, serializeOrderProjectToJson } from '../core/projects/projectManager';
describe('Codex UI regressions',()=>{
 it('offers reopening the saved project file',()=>{render(<App/>);expect(screen.getByLabelText('Abrir archivo de proyecto')).toBeDefined();});
 it('shows validation failure when no piece fits instead of crashing or claiming ready',()=>{render(<App/>);fireEvent.click(screen.getByRole('button',{name:/2.*Medidas/}));fireEvent.change(screen.getByPlaceholderText('40'),{target:{value:'900'}});fireEvent.change(screen.getByPlaceholderText('20'),{target:{value:'600'}});fireEvent.click(screen.getByRole('button',{name:/6.*Exportar/}));expect(screen.getByText('Exportación bloqueada: corregí la geometría')).toBeDefined();});
});

it('selects the imported logo when reopening a different project',async()=>{render(<App/>);const p=createInitialOrdersCatalog()[0];p.labelDesign.elements[0].id='other-id';p.labelDesign.elements[0].name='REOPENED-AUDIT-LOGO';p.labelDesign.elements=p.labelDesign.elements.slice(0,1);const file={text:async()=>serializeOrderProjectToJson(p)};fireEvent.change(screen.getByLabelText('Abrir archivo de proyecto'),{target:{files:[file]}});await waitFor(()=>expect(screen.getByText('REOPENED-AUDIT-LOGO')).toBeDefined());});
