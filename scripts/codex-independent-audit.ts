import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { createBlankLabelDesign, createInitialOrdersCatalog, serializeOrderProjectToJson, deserializeOrderProjectFromJson } from '../src/core/projects/projectManager';
import { computeNestingLayout, DEFAULT_NESTING_CONFIG } from '../src/core/nesting/nestingEngine';
import { exportProductionSvg } from '../src/core/exporters/svgExporter';
import { exportProductionDxf } from '../src/core/exporters/dxfExporter';
import { INITIAL_MATERIALS_CATALOG } from '../src/core/materials/materialsCatalog';
const start=performance.now(); let layouts=0, pieces=0, exports=0; const measurements:any[]=[];
const dims=[[10,10],[20,10],[40,20],[35,15],[27.5,12.5],[60,40],[17.125,9.75]];
for(const [w,h] of dims) for(const qty of [1,25,50,100,200,300,500,1000]) for(const [sw,sh] of [[900,600],[600,400],[200,200],[80,60]]) {
 const d=createBlankLabelDesign(w,h,'rectangle');d.elements=[];
 const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:qty,sheetWidthMm:sw,sheetHeightMm:sh});
 const t=performance.now();assert.equal(n.errors.length,0);assert.equal(n.batches.reduce((a,b)=>a+b.count,0),qty);
 for(const b of n.batches){const rows=new Map<number,any[]>();for(const i of b.placedInstances){const box=i.boundingBox;assert(box.minX>=5&&box.minY>=5&&box.maxX<=sw-5+.0001&&box.maxY<=sh-5+.0001);const row=rows.get(i.row)||[];if(row.length) assert(box.minX>=row[row.length-1].boundingBox.maxX+2-.0001);row.push(i);rows.set(i.row,row);}const rr=[...rows.values()];for(let k=1;k<rr.length;k++)assert(rr[k][0].boundingBox.minY>=rr[k-1][0].boundingBox.maxY+2-.0001);}
 layouts++;pieces+=qty; if(qty===1000)measurements.push({w,h,sw,sh,nestingAndCheckMs:performance.now()-t});
}
// Separate XML parser and DXF group-code reader: no application validators.
for(const [w,h] of dims){
 const d=createBlankLabelDesign(w,h,'rectangle');d.elements=[];const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:25,rotationMode:'0'});
 const svg=exportProductionSvg(d,n,INITIAL_MATERIALS_CATALOG[0]).svgContent;
 const xml=new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
 assert.equal(xml.documentElement.getAttribute('width'),'900mm');assert.equal(xml.documentElement.getAttribute('viewBox'),'0 0 900 600');
 const cuts=xml.querySelectorAll('g[data-layer="CUT"] path');assert.equal(cuts.length,25);assert.equal(xml.querySelectorAll('image').length,0);assert.equal(xml.querySelectorAll('g[data-layer="GUIDE"]').length,0);
 const text=exportProductionDxf(d,n).dxfContent.trim().split(/\r?\n/);assert.equal(text.length%2,0);let layer='',entity='',x=0;const polys:any[]=[];let active:any=null;
 for(let k=0;k<text.length;k+=2){const c=+text[k],v=text[k+1];if(c===0){entity=v;if(v==='POLYLINE'){active={points:[],closed:false,layer:''};polys.push(active);}}if(c===8){layer=v;if(entity==='POLYLINE')active.layer=v;}if(entity==='POLYLINE'&&c===70)active.closed=(+v&1)===1;if(entity==='VERTEX'&&c===10)x=+v;if(entity==='VERTEX'&&c===20)active.points.push([x,+v]);}
 const cutPolys=polys.filter(p=>p.layer==='CORTE');assert.equal(cutPolys.length,25);
 for(const p of cutPolys){assert(p.closed);assert.deepEqual(p.points[0],p.points.at(-1));const xs=p.points.map((p:any)=>p[0]),ys=p.points.map((p:any)=>p[1]);assert(Math.abs(Math.max(...xs)-Math.min(...xs)-w)<.0001);assert(Math.abs(Math.max(...ys)-Math.min(...ys)-h)<.0001);}
 const coords=cuts[0].getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);const first=cutPolys[0].points;for(let k=0;k<first.length-1;k++){assert(Math.abs(first[k][0]-coords[k*2])<.0001);assert(Math.abs(first[k][1]-(600-coords[k*2+1]))<.0001);}
 fs.writeFileSync(`audit/fixtures/rectangle-${w}x${h}.svg`,svg);fs.writeFileSync(`audit/fixtures/rectangle-${w}x${h}.dxf`,exportProductionDxf(d,n).dxfContent);exports+=2;
}
let seed=493601;function rand(){seed=(1664525*seed+1013904223)>>>0;return seed/2**32;}
for(let k=0;k<300;k++){const d=createBlankLabelDesign(1+rand()*70,1+rand()*50,'rectangle');d.elements=[];const qty=1+Math.floor(rand()*1000);const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:qty});assert.equal(n.totalExportedQuantity,qty);assert.equal(n.batches.reduce((a,b)=>a+b.count,0),qty);layouts++;}
const p=createInitialOrdersCatalog()[0];p.labelDesign.widthMm=40;p.labelDesign.heightMm=20;assert.deepEqual(deserializeOrderProjectFromJson(serializeOrderProjectToJson(p)),p);
const result={layouts,piecesInFixedMatrix:pieces,independentlyParsedExports:exports,seed:493601,randomCases:300,totalMs:performance.now()-start,rssBytes:process.memoryUsage().rss,measurements};fs.writeFileSync('audit/independent-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
