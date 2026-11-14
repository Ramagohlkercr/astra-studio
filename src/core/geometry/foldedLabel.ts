import {LabelDesign, LabelElement} from '../types';
import {
  computeGroupVisibleBoundingBox,
  computeSafeEngravingZone,
  fitAllElementsToAvailableSpace,
  fitElementToAvailableSpace,
  getElementVisibleBoundingBoxMm,
  roundMm,
} from './geometryEngine';
export type FoldOptions = {axis:'horizontal'|'vertical'; faces:'one'|'both'};
export type FoldPlacement = 'top'|'bottom'|'left'|'right'|'center';
const BACK=':fold-back';
const isBack=(e:LabelElement)=>e.id.endsWith(BACK);

function faceDesign(design:LabelDesign, fold:FoldOptions):LabelDesign {
 const width=fold.axis==='vertical'?design.widthMm/2:design.widthMm;
 const height=fold.axis==='horizontal'?design.heightMm/2:design.heightMm;
 return {...design,fold:undefined,shape:'rectangle',widthMm:width,heightMm:height,holes:{...design.holes,preset:'none',customHoles:[]}};
}

/**
 * Maps an element to its counterpart on the other face of the open piece.
 * Horizontal fold: the piece is rotated 180° (back reads upright after folding).
 * Vertical fold: the face is translated by half the piece width.
 */
function mapToOtherFace(el:LabelElement, fold:FoldOptions, design:LabelDesign, toBack:boolean, target:LabelElement):LabelElement {
 if(fold.axis==='horizontal') {
  return {...el,id:target.id,name:target.name,xMm:roundMm(design.widthMm-el.xMm,3),yMm:roundMm(design.heightMm-el.yMm,3),rotationDeg:(el.rotationDeg+180)%360};
 }
 const half=design.widthMm/2;
 return {...el,id:target.id,name:target.name,xMm:roundMm(el.xMm+(toBack?half:-half),3),yMm:el.yMm};
}

function deriveBack(front:LabelElement[], fold:FoldOptions, design:LabelDesign):LabelElement[] {
 return front.map(e=>{
  const target={...e,id:e.id+BACK,name:e.name+' · reverso'};
  return mapToOtherFace(e,fold,design,true,target);
 });
}

/** Moves an element fully inside the face's safe zone; shrinks it only if it cannot fit. */
function keepInsideFace(el:LabelElement, face:LabelDesign):LabelElement {
 const safe=computeSafeEngravingZone(face);
 const box=getElementVisibleBoundingBoxMm(el);
 if(box.width>safe.width+1e-6||box.height>safe.height+1e-6) return fitElementToAvailableSpace(el,face,0.9999,'safe_zone_center');
 let dx=0,dy=0;
 if(box.minX<safe.minX) dx=safe.minX-box.minX; else if(box.maxX>safe.maxX) dx=safe.maxX-box.maxX;
 if(box.minY<safe.minY) dy=safe.minY-box.minY; else if(box.maxY>safe.maxY) dy=safe.maxY-box.maxY;
 return dx||dy?{...el,xMm:roundMm(el.xMm+dx,3),yMm:roundMm(el.yMm+dy,3)}:el;
}

/**
 * Builds the folded layout.
 * - 'refit' (default): scales and centers all artwork in the face (automatic layout).
 * - 'preserve': keeps each front element where the user put it, only nudging it back inside the face if needed.
 */
export function arrangeFoldedLabel(design:LabelDesign, fold:FoldOptions, mode:'refit'|'preserve'='refit'):LabelDesign {
 const width=fold.axis==='vertical'?design.widthMm/2:design.widthMm;
 const height=fold.axis==='horizontal'?design.heightMm/2:design.heightMm;
 if (Math.min(width,height) <= design.safetyMarginMm*2+0.1) throw new Error('Aumentá las medidas de la etiqueta o reducí el margen: no queda espacio en cada cara.');
 const source=design.elements.filter(e=>!isBack(e));
 const face=faceDesign(design,fold);
 const front=mode==='preserve'?source.map(e=>e.visible?keepInsideFace(e,face):e):fitAllElementsToAvailableSpace(source,face,0.9999,'safe_zone_center');
 const back=fold.faces==='both'?deriveBack(front,fold,design):[];
 return {...design,fold,shape:'rectangle',cornerRadiusMm:0,holes:face.holes,elements:[...front,...back]};
}
export function unfoldLabel(design:LabelDesign):LabelDesign {
 const plain={...design,fold:undefined};
 return {...plain,elements:fitAllElementsToAvailableSpace(design.elements.filter(e=>!isBack(e)),plain,0.9999,'safe_zone_center')};
}

/**
 * Moves the front artwork as a group to a side of the face (keeping its internal layout) and
 * regenerates the other face so both line up after folding.
 */
export function placeFoldedFaces(design:LabelDesign, where:FoldPlacement):LabelDesign {
 const fold=design.fold;
 if(!fold) return design;
 const face=faceDesign(design,fold);
 const safe=computeSafeEngravingZone(face);
 const front=design.elements.filter(e=>!isBack(e));
 const visible=front.filter(e=>e.visible);
 if(visible.length===0) return design;
 const box=computeGroupVisibleBoundingBox(visible);
 let dx=0,dy=0;
 if(where==='top') dy=safe.minY-box.minY;
 else if(where==='bottom') dy=safe.maxY-box.maxY;
 else if(where==='left') dx=safe.minX-box.minX;
 else if(where==='right') dx=safe.maxX-box.maxX;
 else { dx=(safe.minX+safe.maxX)/2-(box.minX+box.maxX)/2; dy=(safe.minY+safe.maxY)/2-(box.minY+box.maxY)/2; }
 if(Math.abs(dx)<0.01&&Math.abs(dy)<0.01) return design;
 const moved=front.map(e=>e.visible?{...e,xMm:roundMm(e.xMm+dx,3),yMm:roundMm(e.yMm+dy,3)}:e);
 const back=fold.faces==='both'?deriveBack(moved,fold,design):[];
 return {...design,elements:[...moved,...back]};
}

/**
 * Scales the front artwork as a group around its center (keeping its internal layout), never beyond the
 * face's safe zone, then regenerates the other face. Returns the same design if nothing can change.
 */
export function scaleFoldedFaces(design:LabelDesign, factor:number):LabelDesign {
 const fold=design.fold;
 if(!fold||!Number.isFinite(factor)||factor<=0) return design;
 const face=faceDesign(design,fold);
 const safe=computeSafeEngravingZone(face);
 const front=design.elements.filter(e=>!isBack(e));
 const visible=front.filter(e=>e.visible);
 if(visible.length===0) return design;
 const box=computeGroupVisibleBoundingBox(visible);
 let k=factor;
 if(k>1) k=Math.min(k,safe.width/Math.max(box.width,1e-6),safe.height/Math.max(box.height,1e-6));
 if(Math.abs(k-1)<0.001) return design;
 const minSize=Math.min(...visible.map(e=>Math.min(e.widthMm,e.heightMm)));
 if(k<1&&minSize*k<1) return design;
 const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
 const scaled=front.map(e=>{
  if(!e.visible) return e;
  const next:Record<string,unknown>={...e,xMm:roundMm(cx+(e.xMm-cx)*k,3),yMm:roundMm(cy+(e.yMm-cy)*k,3),
   widthMm:roundMm(e.widthMm*k,3),heightMm:roundMm(e.heightMm*k,3)};
  if(e.type==='vector_text'){next.fontSizeMm=roundMm(e.fontSizeMm*k,3);next.letterSpacingMm=roundMm(e.letterSpacingMm*k,3);next.strokeWidthMm=roundMm(e.strokeWidthMm*k,3);}
  if(e.type==='decorative_border'){next.insetMm=roundMm(e.insetMm*k,3);next.strokeWidthMm=roundMm(e.strokeWidthMm*k,3);}
  return next as unknown as LabelElement;
 });
 const back=fold.faces==='both'?deriveBack(scaled,fold,design):[];
 return {...design,elements:[...scaled,...back]};
}

const IGNORED=new Set(['id','name']);
function changed(a:LabelElement,b:LabelElement):boolean {
 const keys=new Set([...Object.keys(a),...Object.keys(b)]);
 for(const k of keys) {
  if(IGNORED.has(k)) continue;
  if((a as unknown as Record<string,unknown>)[k]!==(b as unknown as Record<string,unknown>)[k]) return true;
 }
 return false;
}

/**
 * After any edit on a folded label, makes the other face follow: whichever face's element changed
 * (position, size, rotation, content) is mapped onto its counterpart. Unfolded designs, layout
 * changes (axis/faces/size) and edits touching both faces at once are left untouched.
 */
export function syncFoldedFaces(prev:LabelDesign, next:LabelDesign):LabelDesign {
 const fold=next.fold;
 if(!fold||!prev.fold||fold.faces!=='both'||prev.fold.axis!==fold.axis||prev.fold.faces!==fold.faces||
   prev.widthMm!==next.widthMm||prev.heightMm!==next.heightMm) return next;
 const prevById=new Map(prev.elements.map(e=>[e.id,e]));
 const nextById=new Map(next.elements.map(e=>[e.id,e]));
 const replace=new Map<string,LabelElement>();
 for(const f of next.elements) {
  if(isBack(f)) continue;
  const b=nextById.get(f.id+BACK);
  const pf=prevById.get(f.id),pb=prevById.get(f.id+BACK);
  if(!b||!pf||!pb) continue;
  const fChanged=changed(pf,f),bChanged=changed(pb,b);
  if(fChanged&&!bChanged) replace.set(b.id,mapToOtherFace(f,fold,next,true,b));
  else if(bChanged&&!fChanged) replace.set(f.id,mapToOtherFace(b,fold,next,false,f));
 }
 return replace.size===0?next:{...next,elements:next.elements.map(e=>replace.get(e.id)??e)};
}
