import { describe, it, expect } from 'vitest';
import { centerElementGeometrically, getElementVisibleBoundingBoxMm, fitElementToAvailableSpace, compileLabelGeometry, transformNormalizedPathToMillimeters, validateLabelAndBatchGeometry } from '../geometry/geometryEngine';
import { createBlankLabelDesign, createInitialOrdersCatalog, deserializeOrderProjectFromJson, serializeOrderProjectToJson, saveOrdersToStorage } from '../projects/projectManager';
import { computeNestingLayout, DEFAULT_NESTING_CONFIG } from '../nesting/nestingEngine';
import { parseSvgLogoString } from '../image/imageProcessor';
import { exportProductionSvg } from '../exporters/svgExporter';
import { INITIAL_MATERIALS_CATALOG } from '../materials/materialsCatalog';
import { exportProductionDxf } from '../exporters/dxfExporter';
import type { SvgLogoElement } from '../types';
const design = () => { const d = createBlankLabelDesign(40,20,'rectangle'); d.elements=[]; return d; };
const logo = (): SvgLogoElement => ({id:'audit',name:'audit',type:'logo_svg',visible:true,locked:false,lockAspectRatio:true,xMm:20,yMm:10,widthMm:20,heightMm:10,aspectRatio:2,rotationDeg:90,rawSvgContent:'',normalizedPaths:['M 60 10 L 90 10 L 90 50 L 60 50 Z'],originalViewBox:{minX:0,minY:0,width:100,height:100},contentBoundsNormalized:{minX:.6,minY:.1,maxX:.9,maxY:.5,width:.3,height:.4,centerNormX:.75,centerNormY:.3}});
describe('Codex independent regressions',()=>{
 it('centers rotated visible content against compiled coordinates',()=>{const d=design();d.elements=[centerElementGeometrically(logo(),d)];const b=compileLabelGeometry(d).engravingItems[0].boundingBox;expect((b.minX+b.maxX)/2).toBeCloseTo(20,3);expect((b.minY+b.maxY)/2).toBeCloseTo(10,3);});
 it('rotates visible bounding dimensions',()=>{const b=getElementVisibleBoundingBoxMm(logo());expect(b.width).toBeCloseTo(4,3);expect(b.height).toBeCloseTo(6,3);});
 it('fits proportionally with asymmetric transparent margins and rotation',()=>{const el=logo();const fitted=fitElementToAvailableSpace(el,design());expect(fitted.widthMm/fitted.heightMm).toBeCloseTo(2,2);const b=getElementVisibleBoundingBoxMm(fitted);expect(b.width).toBeLessThanOrEqual(37.6);expect(b.height).toBeLessThanOrEqual(17.6);});
 it('rejects unsupported SVG instead of fabricating a rectangle',()=>{expect(()=>parseSvgLogoString('<svg><text>Hello</text></svg>')).toThrow();});
 it('rejects SVG transforms rather than silently dropping them',()=>{expect(()=>parseSvgLogoString('<svg viewBox="0 0 100 100"><g transform="translate(50 0)"><rect width="10" height="10"/></g></svg>')).toThrow();});
 it('rejects a circular hole crossing an oval boundary',()=>{const d=design();d.shape='oval';d.holes={preset:'custom',diameterMm:4,edgeDistanceMm:2,customHoles:[{id:'bad',x:7,y:4,diameterMm:4}]};const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:1});expect(validateLabelAndBatchGeometry(d,n).invalidHolesCount).toBeGreaterThan(0);});
 it('preserves rotated custom cut contour coordinates',()=>{const d=design();d.shape='custom_polygon';d.customPolygonNormalized=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];const a=compileLabelGeometry(d).outerCutContour.points;const b=compileLabelGeometry(d,{rotated90:true}).outerCutContour.points;expect(b).toEqual(a.map(p=>({x:20-p.y,y:p.x})));});
 it('rejects raster DXF instead of silently exporting cut only',()=>{const d=design();d.elements=[{...logo(),type:'logo_raster',originalDataUrl:'data:image/png;base64,AA==',processedDataUrl:'data:image/png;base64,AA==',pixelWidth:100,pixelHeight:100,effectiveDpi:300,processing:{mode:'raster',threshold:145,brightness:0,contrast:0,invert:false,removeBackground:true,backgroundTolerance:22,turdSize:.75},vectorizedPathsNormalized:[]}];expect(()=>exportProductionDxf(d,computeNestingLayout(d,DEFAULT_NESTING_CONFIG))).toThrow(/raster/i);});
});

describe('Codex export and curve guards',()=>{
 it('samples cubic curves for DXF rather than cutting control polygons',()=>{const r=transformNormalizedPathToMillimeters('M 0 0 C 0 100 100 100 100 0',{minX:0,minY:0,width:100,height:100},50,50,100,100);const pts=r.subPolylines[0].points;expect(pts.length).toBeGreaterThan(10);expect(Math.max(...pts.map(p=>p.y))).toBeCloseTo(75,2);});
 it('rejects invalid production geometry at DXF boundary',()=>{const d=design();d.holes={preset:'custom',diameterMm:4,edgeDistanceMm:2,customHoles:[{id:'outside',x:0,y:0,diameterMm:4}]};expect(()=>exportProductionDxf(d,computeNestingLayout(d,DEFAULT_NESTING_CONFIG))).toThrow();});
});

describe('Codex boundary and persistence regressions',()=>{
 it('places compensated toolpath inside the declared material margin',()=>{const d=design();d.kerfCompensationMm=.4;const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,requestedQuantity:1});const i=n.batches[0].placedInstances[0];const b=compileLabelGeometry(d,{offsetXMm:i.xMm,offsetYMm:i.yMm}).outerCutContour.boundingBox;expect(b.minX).toBeGreaterThanOrEqual(5);expect(b.minY).toBeGreaterThanOrEqual(5);});
 it('computes relative and horizontal SVG visible bounds from commands',()=>{const r=parseSvgLogoString('<svg viewBox="0 0 100 100"><path d="M 60 20 h 30 v 20 h -30 Z"/></svg>');expect(r.contentBoundsNormalized.minX).toBe(.6);expect(r.contentBoundsNormalized.maxX).toBe(.9);expect(r.contentBoundsNormalized.maxY).toBe(.4);});
 it('rejects corrupt nested project structure before opening',()=>{const p=createInitialOrdersCatalog()[0];(p.labelDesign as any).elements={};expect(()=>deserializeOrderProjectFromJson(serializeOrderProjectToJson(p))).toThrow();});
 it('rejects nonfinite dimensions encoded as JSON exponent',()=>{expect(()=>deserializeOrderProjectFromJson('{"labelDesign":{"widthMm":1e999,"heightMm":10},"nestingConfig":{}}')).toThrow();});
});

describe('Codex input limits and real shape safety',()=>{
 it('rejects negative nesting gaps instead of overlapping',()=>{const n=computeNestingLayout(design(),{...DEFAULT_NESTING_CONFIG,requestedQuantity:25,gapXMm:-10});expect(n.errors.length).toBeGreaterThan(0);expect(n.batches).toHaveLength(0);});
 it('treats circle as a circle for unequal dimensions',()=>{const d=design();d.shape='circle';const p=compileLabelGeometry(d).outerCutContour.primitive;expect(p?.kind).toBe('circle');});
 it('treats configured safety margin violations as export errors',()=>{const d=design();d.safetyMarginMm=5;const e=logo();e.rotationDeg=0;e.contentBoundsNormalized=undefined;e.normalizedPaths=['M 0 0 L 100 0 L 100 100 L 0 100 Z'];e.xMm=3;e.yMm=10;e.widthMm=4;e.heightMm=4;d.elements=[e];expect(()=>exportProductionDxf(d,computeNestingLayout(d,DEFAULT_NESTING_CONFIG))).toThrow();});
});

it('uses visible raster content for production safety, not transparent canvas',()=>{
 const d=design();const e:any={...logo(),type:'logo_raster',rotationDeg:0,widthMm:50,heightMm:30,originalDataUrl:'data:image/png;base64,AA==',processedDataUrl:'data:image/png;base64,AA==',pixelWidth:200,pixelHeight:120,effectiveDpi:300,processing:{mode:'raster'},vectorizedPathsNormalized:[]};
 d.elements=[centerElementGeometrically(e,d)];const r=validateLabelAndBatchGeometry(d,computeNestingLayout(d,DEFAULT_NESTING_CONFIG));expect(r.engraveInvasionCount).toBe(0);
});
it('limits circular DXF chord deviation to 0.01 mm for large labels',()=>{const d=createBlankLabelDesign(200,200,'circle');d.elements=[];const pts=compileLabelGeometry(d).outerCutContour.points;let max=0;for(let k=0;k<pts.length;k++){const a=pts[k],b=pts[(k+1)%pts.length];max=Math.max(max,100-Math.hypot((a.x+b.x)/2-100,(a.y+b.y)/2-100));}expect(max).toBeLessThan(.01);});

it('escapes user names in SVG XML comments',()=>{const d=design();d.name='logo --> <oops> <!--';const svg=exportProductionSvg(d,computeNestingLayout(d,DEFAULT_NESTING_CONFIG),INITIAL_MATERIALS_CATALOG[0]).svgContent;expect(svg).not.toContain('logo --> <oops> <!--');});
it('reports local storage quota failure to the caller',()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('QuotaExceededError');};try{expect(saveOrdersToStorage(createInitialOrdersCatalog())).toBe(false);}finally{Storage.prototype.setItem=original;}});

it.each(['unknown-type','missing-processing','invalid-viewbox','invalid-holes','future-schema'])('rejects malformed project variant %s',kind=>{const p:any=createInitialOrdersCatalog()[0];if(kind==='unknown-type')p.labelDesign.elements[0].type='unknown';if(kind==='missing-processing'){p.labelDesign.elements[0].type='logo_raster';delete p.labelDesign.elements[0].processing;}if(kind==='invalid-viewbox')p.labelDesign.elements[0].originalViewBox.height=0;if(kind==='invalid-holes')p.labelDesign.holes.customHoles={};const payload=JSON.parse(serializeOrderProjectToJson(p));if(kind==='future-schema')payload.schemaVersion='999';expect(()=>deserializeOrderProjectFromJson(JSON.stringify(payload))).toThrow();});
