import {describe,it,expect} from 'vitest';
import {arrangeFoldedLabel,unfoldLabel} from '../geometry/foldedLabel';
import {createInitialOrdersCatalog} from '../projects/projectManager';
import {getElementVisibleBoundingBoxMm,compileLabelGeometry} from '../geometry/geometryEngine';
describe('Folded labels',()=>{
 it.each(['horizontal','vertical'] as const)('places two readable faces for %s fold',axis=>{
  const d={...createInitialOrdersCatalog()[0].labelDesign,widthMm:40,heightMm:60};
  const out=arrangeFoldedLabel(d,{axis,faces:'both'});
  expect(out.elements).toHaveLength(d.elements.length*2);
  const a=out.elements[0],b=out.elements[d.elements.length];const ab=getElementVisibleBoundingBoxMm(a),bb=getElementVisibleBoundingBoxMm(b);
  if(axis==='horizontal'){expect(ab.maxY).toBeLessThan(30);expect(bb.minY).toBeGreaterThan(30);expect(b.rotationDeg).toBe((a.rotationDeg+180)%360);}
  else{expect(ab.maxX).toBeLessThan(20);expect(bb.minX).toBeGreaterThan(20);expect(b.rotationDeg).toBe(a.rotationDeg);}
  expect(arrangeFoldedLabel(out,{axis,faces:'both'}).elements).toHaveLength(out.elements.length);
  expect(arrangeFoldedLabel(out,{axis,faces:'one'}).elements).toHaveLength(d.elements.length);
  expect(unfoldLabel(out).fold).toBeUndefined();
  expect(compileLabelGeometry(out).holeContours).toHaveLength(0);
 });
 it('rejects faces too small for the margin',()=>{
  const d={...createInitialOrdersCatalog()[0].labelDesign,widthMm:2,heightMm:2};
  expect(()=>arrangeFoldedLabel(d,{axis:'horizontal',faces:'both'})).toThrow();
 });
});
