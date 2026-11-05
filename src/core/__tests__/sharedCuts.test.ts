import {it,expect} from 'vitest';
import {sharedCutLines} from '../geometry/sharedCuts';
import {createBlankLabelDesign} from '../projects/projectManager';
import {computeNestingLayout,DEFAULT_NESTING_CONFIG} from '../nesting/nestingEngine';
import {exportProductionSvg} from '../exporters/svgExporter';
import {exportProductionDxf} from '../exporters/dxfExporter';
import {parseAndAuditDxfR12,parseAndAuditLightBurnSvg} from '../exporters/fileFormatValidator';
import {INITIAL_MATERIALS_CATALOG} from '../materials/materialsCatalog';
import {validateLabelAndBatchGeometry} from '../geometry/geometryEngine';
it.each([50,53])('shares rectangular borders once for %s pieces including incomplete rows',qty=>{
 const d=createBlankLabelDesign(20,10);d.shape='rectangle';d.elements=[];
 const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,layoutMode:'blocks',rotationMode:'0',sharedCutLines:true,requestedQuantity:qty});
 expect(n.config.gapXMm).toBe(0);expect(validateLabelAndBatchGeometry(d,n).isValid).toBe(true);
 const lines=sharedCutLines(n.batches[0].placedInstances.map(i=>i.boundingBox));
 const length=lines.reduce((s,[a,b])=>s+Math.hypot(b.x-a.x,b.y-a.y),0);
 // 10x5 complete grid: six horizontal lines of 200 mm + eleven vertical of 50 mm.
 if(qty===50){expect(lines).toHaveLength(17);expect(length).toBe(1750);}
 expect(length).toBeLessThan(qty*60);
 const svg=exportProductionSvg(d,n,INITIAL_MATERIALS_CATALOG[0],{mode:'cut_only'}).svgContent;
 expect(parseAndAuditLightBurnSvg(svg).isValid).toBe(true);
 expect(svg.match(/id="shared-cut-/g)).toHaveLength(lines.length);
 const dxf=exportProductionDxf(d,n).dxfContent;
 expect(parseAndAuditDxfR12(dxf).isValid).toBe(true);
 expect(dxf.match(/\nPOLYLINE\n/g)).toHaveLength(lines.length);
 // Every original edge midpoint is covered by exactly one output segment.
 for(const inst of n.batches[0].placedInstances){const b=inst.boundingBox;
 for(const [x,y,v] of [[b.minX,(b.minY+b.maxY)/2,1],[b.maxX,(b.minY+b.maxY)/2,1],[(b.minX+b.maxX)/2,b.minY,0],[(b.minX+b.maxX)/2,b.maxY,0]]){
 expect(lines.filter(([a,c])=>v ? a.x===x&&c.x===x&&a.y<=y&&c.y>=y : a.y===y&&c.y===y&&a.x<=x&&c.x>=x)).toHaveLength(1);
 }}
});
it('rejects rounded shapes and kerf compensation in shared mode',()=>{
 const d=createBlankLabelDesign(20,10);d.elements=[];d.shape='circle';d.heightMm=20;
 let n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,sharedCutLines:true,requestedQuantity:2});
 expect(validateLabelAndBatchGeometry(d,n).isValid).toBe(false);
 d.shape='rectangle';d.kerfCompensationMm=0.1;n=computeNestingLayout(d,n.config);
 expect(()=>exportProductionDxf(d,n)).toThrow();
});
