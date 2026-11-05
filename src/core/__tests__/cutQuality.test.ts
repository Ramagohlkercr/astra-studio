import {it,expect} from 'vitest';
import {buildShapeClosedContour,buildCircularHoleContour,validateLabelAndBatchGeometry} from '../geometry/geometryEngine';
import {createBlankLabelDesign} from '../projects/projectManager';
import {computeNestingLayout,DEFAULT_NESTING_CONFIG} from '../nesting/nestingEngine';
it('uses the corner radius for DXF sampling, retaining 0.005 mm chord tolerance',()=>{
 const contour=buildShapeClosedContour({id:'cut',layer:'CUT',shape:'rounded_rect',widthMm:200,heightMm:100,cornerRadiusMm:1,offsetXMm:0,offsetYMm:0});
 expect(contour.points.length).toBeLessThan(50);
 const pts=contour.points.filter(p=>p.x>=199&&p.y<=1);
 for(let i=1;i<pts.length;i++){
 const x=(pts[i-1].x+pts[i].x)/2-199,y=(pts[i-1].y+pts[i].y)/2-1;
 expect(1-Math.hypot(x,y)).toBeLessThanOrEqual(0.0051);
 }
});
it('includes cardinal extrema for exact hole dimensions',()=>{
 const c=buildCircularHoleContour({id:'hole',centerXMm:10,centerYMm:10,nominalDiameterMm:5,kerfCompensationMm:0});
 expect(Math.max(...c.points.map(p=>p.x))-Math.min(...c.points.map(p=>p.x))).toBe(5);
 expect(Math.max(...c.points.map(p=>p.y))-Math.min(...c.points.map(p=>p.y))).toBe(5);
});
it('blocks kerf that would silently substitute a hole diameter',()=>{
 const d=createBlankLabelDesign(30,20);d.elements=[];d.holes={preset:'two_horizontal',diameterMm:0.5,edgeDistanceMm:3,customHoles:[]};d.kerfCompensationMm=0.4;
 const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:1});
 expect(validateLabelAndBatchGeometry(d,n).issues.some(i=>i.code==='KERF_COLLAPSES_HOLE')).toBe(true);
});

import {exportProductionSvg} from '../exporters/svgExporter';
import {exportProductionDxf} from '../exporters/dxfExporter';
import {INITIAL_MATERIALS_CATALOG} from '../materials/materialsCatalog';
it('exports each straight rectangle as one continuous closed contour in SVG and DXF',()=>{
 const d=createBlankLabelDesign(40,15);d.shape='rectangle';d.elements=[];
 const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:2});
 const svg=exportProductionSvg(d,n,INITIAL_MATERIALS_CATALOG[0],{mode:'cut_only'}).svgContent;
 const paths=[...svg.matchAll(/<path[^>]*id="[^"]*-cut"[^>]*d="([^"]+)"/g)];
 expect(paths).toHaveLength(2);
 for(const p of paths){expect(p[1].match(/M/g)).toHaveLength(1);expect(p[1].match(/L/g)).toHaveLength(3);expect(p[1].trim().endsWith('Z')).toBe(true);}
 const dxf=exportProductionDxf(d,n).dxfContent;
 expect(dxf.match(/\nPOLYLINE\n/g)).toHaveLength(2);
 expect(dxf.match(/\nSEQEND\n/g)).toHaveLength(2);
});
