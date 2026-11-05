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
