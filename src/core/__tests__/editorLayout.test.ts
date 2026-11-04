import {describe,it,expect} from 'vitest';
import {resizeArtwork} from '../geometry/editorResize';
import {createBlankLabelDesign} from '../projects/projectManager';
import {computeNestingLayout,DEFAULT_NESTING_CONFIG} from '../nesting/nestingEngine';
import {LabelElement} from '../types';
const logo = (angle=0): LabelElement => ({...createBlankLabelDesign().elements[0],type:'logo_svg',id:'logo',name:'logo',xMm:20,yMm:10,widthMm:20,heightMm:10,rotationDeg:angle,lockAspectRatio:true,rawSvgContent:'',normalizedPaths:[],originalViewBox:{minX:0,minY:0,width:100,height:100},contentBoundsNormalized:{minX:.5,minY:.2,maxX:.9,maxY:.8,width:.4,height:.6,centerNormX:.7,centerNormY:.5}});
describe('Editor resize',()=>{
 for(const angle of [0,45,90,180])for(const corner of ['nw','ne','se','sw'] as const)it(`keeps opposite visible corner fixed ${angle}/${corner}`,()=>{
 const e=logo(angle);const sx=corner.includes('e')?1:-1,sy=corner.includes('s')?1:-1;
 const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const r=resizeArtwork(e,corner,{x:2*sx*c-3*sy*s,y:2*sx*s+3*sy*c});
 expect(r.widthMm).toBeGreaterThan(e.widthMm);expect(r.widthMm/r.heightMm).toBeCloseTo(2,3);
 const anchor=(el:any)=>{const x=(.7-.5-sx*.4/2)*el.widthMm,y=(-sy*.6/2)*el.heightMm;return [el.xMm+x*c-y*s,el.yMm+x*s+y*c];};
 anchor(r).forEach((v,i)=>expect(v).toBeCloseTo(anchor(e)[i],3));
 });
 it('vertical movement resizes proportionally',()=>{expect(resizeArtwork(logo(),'se',{x:0,y:5}).widthMm).toBeGreaterThan(20);});
 it('shrinking never flips the artwork',()=>{const r=resizeArtwork(logo(),'se',{x:-1000,y:-1000});expect(r.widthMm).toBeGreaterThan(0);expect(r.heightMm).toBeGreaterThan(0);});
});
describe('Production blocks',()=>{
 it.each([[25,5,5],[50,10,5],[100,10,10],[200,10,20]])('%i pieces in %ix%i', (qty,cols,rows)=>{const d=createBlankLabelDesign(20,10);d.elements=[];const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,rotationMode:'0',layoutMode:'blocks',requestedQuantity:qty});expect(n.totalExportedQuantity).toBe(qty);expect(n.batches[0].columnsUsed).toBe(cols);expect(n.batches[0].rowsUsed).toBe(rows);});
 it('fits small offcuts and splits batches without losing pieces',()=>{const n=computeNestingLayout(createBlankLabelDesign(20,10),{...DEFAULT_NESTING_CONFIG,layoutMode:'blocks',sheetWidthMm:80,sheetHeightMm:60,requestedQuantity:103});expect(n.batches.reduce((a,b)=>a+b.count,0)).toBe(103);for(const b of n.batches)for(const i of b.placedInstances){expect(i.boundingBox.maxX).toBeLessThanOrEqual(75);expect(i.boundingBox.maxY).toBeLessThanOrEqual(55);}});
});

describe('Explicit grid orientation',()=>{
 it.each([['5x10',5,10],['10x5',10,5],['5x5',5,5]] as const)('%s preserves chosen columns and rows and splits quantities',(layoutMode,cols,rows)=>{
 const n=computeNestingLayout(createBlankLabelDesign(20,10),{...DEFAULT_NESTING_CONFIG,rotationMode:'0',layoutMode,requestedQuantity:103});
 expect(n.batches[0].columnsUsed).toBe(cols);expect(n.batches[0].rowsUsed).toBe(rows);expect(n.totalExportedQuantity).toBe(103);
 expect(n.batches.every(b=>b.count<=cols*rows)).toBe(true);
 });
});

it('keeps 0.1 mm between neighboring cutting bounds in both directions',()=>{
 const n=computeNestingLayout(createBlankLabelDesign(20,10),{...DEFAULT_NESTING_CONFIG,rotationMode:'0',layoutMode:'5x10',requestedQuantity:50});
 const pieces=n.batches[0].placedInstances;
 expect(pieces[1].boundingBox.minX-pieces[0].boundingBox.maxX).toBeCloseTo(0.1,4);
 expect(pieces[5].boundingBox.minY-pieces[0].boundingBox.maxY).toBeCloseTo(0.1,4);
});

import {fitAllElementsToAvailableSpace, computeSafeEngravingZone, getElementVisibleBoundingBoxMm} from '../geometry/geometryEngine';
describe('Maximum logo and sewing fit',()=>{
 it.each([0,45,90])('fills available visible bounds without distortion at %s degrees',(angle)=>{
 const d={...createBlankLabelDesign(40,20),safetyMarginMm:0.5}; const el=logo(angle);
 const fitted=fitAllElementsToAvailableSpace([el],d,1,'safe_zone_center')[0];
 const box=getElementVisibleBoundingBoxMm(fitted),zone=computeSafeEngravingZone(d);
 expect(fitted.widthMm/fitted.heightMm).toBeCloseTo(el.widthMm/el.heightMm,3);
 expect(box.width).toBeLessThanOrEqual(zone.width+0.001);expect(box.height).toBeLessThanOrEqual(zone.height+0.001);
 expect(Math.max(box.width/zone.width,box.height/zone.height)).toBeCloseTo(1,3);
 const sewn=fitAllElementsToAvailableSpace([fitted],{...d,safetyMarginMm:2},1,'safe_zone_center')[0];
 const sewnBox=getElementVisibleBoundingBoxMm(sewn);
 expect(sewnBox.minX).toBeGreaterThanOrEqual(1.999);expect(sewnBox.minY).toBeGreaterThanOrEqual(1.999);
 expect(sewn.widthMm).toBeLessThan(fitted.widthMm);
 });
});
