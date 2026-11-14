import {describe,it,expect} from 'vitest';
import {arrangeFoldedLabel,unfoldLabel} from '../geometry/foldedLabel';
import {createInitialOrdersCatalog} from '../projects/projectManager';
import {getElementVisibleBoundingBoxMm,compileLabelGeometry,computeGroupVisibleBoundingBox} from '../geometry/geometryEngine';
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

import {syncFoldedFaces,placeFoldedFaces,scaleFoldedFaces} from '../geometry/foldedLabel';
const folded=(axis:'horizontal'|'vertical')=>arrangeFoldedLabel({...createInitialOrdersCatalog()[0].labelDesign,widthMm:40,heightMm:60},{axis,faces:'both'});
const groups=(d:ReturnType<typeof folded>)=>{const n=d.elements.length/2;return {f:computeGroupVisibleBoundingBox(d.elements.slice(0,n)),b:computeGroupVisibleBoundingBox(d.elements.slice(n))};};
const pair=(d:ReturnType<typeof folded>)=>{const n=d.elements.length/2;return {f:d.elements[0],b:d.elements[n]};};
describe('Folded faces follow each other',()=>{
 it('moving the front moves the back (horizontal: point reflection)',()=>{
  const d=folded('horizontal');const {f}=pair(d);
  const moved={...d,elements:d.elements.map(e=>e.id===f.id?{...e,xMm:e.xMm+3,yMm:e.yMm-4}:e)};
  const out=syncFoldedFaces(d,moved);const {f:nf,b:nb}=pair(out);
  expect(nb.xMm).toBeCloseTo(40-nf.xMm,3);expect(nb.yMm).toBeCloseTo(60-nf.yMm,3);
  expect(nb.rotationDeg).toBe((nf.rotationDeg+180)%360);
 });
 it('moving the back moves the front (vertical: translation)',()=>{
  const d=folded('vertical');const {b}=pair(d);
  const moved={...d,elements:d.elements.map(e=>e.id===b.id?{...e,xMm:e.xMm+2,yMm:e.yMm+5}:e)};
  const out=syncFoldedFaces(d,moved);const {f:nf,b:nb}=pair(out);
  expect(nf.xMm).toBeCloseTo(nb.xMm-20,3);expect(nf.yMm).toBeCloseTo(nb.yMm,3);
 });
 it('syncs size and visibility changes too',()=>{
  const d=folded('vertical');const {f}=pair(d);
  const out=syncFoldedFaces(d,{...d,elements:d.elements.map(e=>e.id===f.id?{...e,widthMm:e.widthMm/2,heightMm:e.heightMm/2}:e)});
  expect(pair(out).b.widthMm).toBeCloseTo(f.widthMm/2,3);
 });
 it('leaves layout changes and plain designs alone',()=>{
  const d=folded('horizontal');
  const resized={...d,heightMm:80};
  expect(syncFoldedFaces(d,resized)).toBe(resized);
  const plain={...createInitialOrdersCatalog()[0].labelDesign};
  expect(syncFoldedFaces(plain,plain)).toBe(plain);
 });
});
describe('Folded placement',()=>{
 it('places the logo at the top and mirrors it to the bottom of the back',()=>{
  const d=placeFoldedFaces(folded('horizontal'),'top');
  const {f:fb,b:bb}=groups(d);
  expect(fb.minY).toBeLessThan(2);
  expect(bb.maxY).toBeGreaterThan(58);
 });
 it('bottom keeps the logo near the fold line of the front face',()=>{
  const d=placeFoldedFaces(folded('horizontal'),'bottom');
  expect(groups(d).f.maxY).toBeGreaterThan(28);
 });
 it('preserve mode keeps positions and refit re-centers',()=>{
  const d=placeFoldedFaces(folded('horizontal'),'top');
  const before=groups(d).f;
  const kept=arrangeFoldedLabel({...d,heightMm:70},{axis:'horizontal',faces:'both'},'preserve');
  expect(groups(kept).f.minY).toBeCloseTo(before.minY,1);
  const refit=arrangeFoldedLabel({...d,heightMm:70},{axis:'horizontal',faces:'both'});
  const rb=groups(refit).f;
  expect((rb.minY+rb.maxY)/2).toBeCloseTo(17.5,0);
 });
 it('preserve mode pulls an out-of-face logo back inside',()=>{
  const d=folded('horizontal');const {f}=pair(d);
  const off={...d,elements:d.elements.map(e=>e.id===f.id?{...e,yMm:55}:e)};
  const out=arrangeFoldedLabel(off,{axis:'horizontal',faces:'both'},'preserve');
  expect(groups(out).f.maxY).toBeLessThanOrEqual(30);
 });
});

describe('Folded scaling',()=>{
 it('shrinks the group, opening room to place it, and the back follows',()=>{
  const d=folded('horizontal');
  const small=scaleFoldedFaces(scaleFoldedFaces(d,0.5),0.8);
  expect(small).not.toBe(d);
  expect(groups(small).f.height).toBeLessThan(groups(d).f.height*0.45);
  expect(groups(small).b.height).toBeCloseTo(groups(small).f.height,2);
  const top=placeFoldedFaces(small,'top');
  expect(top).not.toBe(small);
  expect(groups(top).f.minY).toBeLessThan(2);
  expect(groups(top).b.maxY).toBeGreaterThan(58);
 });
 it('never grows beyond the safe zone and reports no-ops',()=>{
  const d=folded('horizontal');
  expect(scaleFoldedFaces(d,1.5)).toBe(d);
  const top=placeFoldedFaces(d,'top');
  expect(placeFoldedFaces(top,'top')).toBe(top);
 });
});

import {rasterImageTransform} from '../geometry/geometryEngine';
const mirrorFolded=(axis:'horizontal'|'vertical')=>arrangeFoldedLabel({...createInitialOrdersCatalog()[0].labelDesign,widthMm:40,heightMm:60},{axis,faces:'both',reverse:'mirror'});
describe('Folded mirror reverse',()=>{
 it.each(['horizontal','vertical'] as const)('back is the exact reflection of the front across the fold line (%s)',axis=>{
  const d=mirrorFolded(axis);const g=groups(d);
  if(axis==='horizontal'){expect(g.b.minY).toBeCloseTo(60-g.f.maxY,2);expect(g.b.maxY).toBeCloseTo(60-g.f.minY,2);expect(g.b.minX).toBeCloseTo(g.f.minX,2);expect(g.b.maxX).toBeCloseTo(g.f.maxX,2);}
  else{expect(g.b.minX).toBeCloseTo(40-g.f.maxX,2);expect(g.b.maxX).toBeCloseTo(40-g.f.minX,2);expect(g.b.minY).toBeCloseTo(g.f.minY,2);}
  const n=d.elements.length/2;
  d.elements.slice(n).forEach(e=>expect(e.mirrored).toBe(true));
  d.elements.slice(0,n).forEach(e=>expect(e.mirrored).toBeFalsy());
 });
 it('mirrored art really is flipped in the compiled geometry',()=>{
  const d=mirrorFolded('vertical');const n=d.elements.length/2;
  const comp=compileLabelGeometry(d).engravingItems;
  const fb=comp.slice(0,n),bb=comp.slice(n);
  fb.forEach((f,i)=>{
   expect(bb[i].boundingBox.width).toBeCloseTo(f.boundingBox.width,1);
   expect(bb[i].boundingBox.minX).toBeCloseTo(40-f.boundingBox.maxX,1);
  });
  // text points: the first glyph point of the front sits on the opposite side in the back
  const ft=fb.find(e=>e.id.includes('text'))??fb[fb.length-1],bt=bb[fb.indexOf(ft)];
  const fx=ft.polylines![0].points[0].x,bx=bt.polylines![0].points[0].x;
  expect(bx).toBeCloseTo(40-fx,1);
 });
 it('syncs edits both ways and keeps the reflection',()=>{
  const d=mirrorFolded('horizontal');const n=d.elements.length/2;
  const moved={...d,elements:d.elements.map((e,i)=>i===0?{...e,xMm:e.xMm+2,yMm:e.yMm+3,rotationDeg:20}:e)};
  const out=syncFoldedFaces(d,moved);
  expect(out.elements[n].xMm).toBeCloseTo(out.elements[0].xMm,3);
  expect(out.elements[n].yMm).toBeCloseTo(60-out.elements[0].yMm,3);
  expect(out.elements[n].rotationDeg).toBeCloseTo(160,3);
  const back=syncFoldedFaces(out,{...out,elements:out.elements.map((e,i)=>i===n?{...e,yMm:e.yMm-1}:e)});
  expect(back.elements[0].yMm).toBeCloseTo(60-back.elements[n].yMm,3);
  expect(back.elements[0].rotationDeg).toBeCloseTo(20,3);
 });
 it('switching the reverse mode keeps front positions',()=>{
  const d=placeFoldedFaces(folded('horizontal'),'top');
  const m=arrangeFoldedLabel({...d,fold:{...d.fold!,reverse:'mirror'}},{...d.fold!,reverse:'mirror'},'preserve');
  expect(groups(m).f.minY).toBeCloseTo(groups(d).f.minY,2);
  expect(m.elements.some(e=>e.mirrored)).toBe(true);
 });
 it('raster image transform composes rotation and flip',()=>{
  expect(rasterImageTransform({xMm:0,yMm:0,widthMm:10,heightMm:4})).toBeUndefined();
  expect(rasterImageTransform({xMm:0,yMm:0,widthMm:10,heightMm:4,rotationDeg:30})).toBe('rotate(30 5 2)');
  expect(rasterImageTransform({xMm:0,yMm:0,widthMm:10,heightMm:4,rotationDeg:30,mirrored:true})).toBe('rotate(30 5 2) translate(5 0) scale(-1 1) translate(-5 0)');
 });
});
