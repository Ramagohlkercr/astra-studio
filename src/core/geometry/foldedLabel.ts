import {LabelDesign} from '../types';
import {fitAllElementsToAvailableSpace} from './geometryEngine';
export type FoldOptions = {axis:'horizontal'|'vertical'; faces:'one'|'both'};
const BACK=':fold-back';
export function arrangeFoldedLabel(design:LabelDesign, fold:FoldOptions):LabelDesign {
 const width=fold.axis==='vertical'?design.widthMm/2:design.widthMm;
 const height=fold.axis==='horizontal'?design.heightMm/2:design.heightMm;
 if (Math.min(width,height) <= design.safetyMarginMm*2+0.1) throw new Error('Aumentá las medidas de la etiqueta o reducí el margen: no queda espacio en cada cara.');
 const source=design.elements.filter(e=>!e.id.endsWith(BACK));
 const face:LabelDesign={...design,fold:undefined,shape:'rectangle',widthMm:width,heightMm:height,holes:{...design.holes,preset:'none',customHoles:[]}};
 const front=fitAllElementsToAvailableSpace(source,face,0.9999,'safe_zone_center');
 const back=fold.faces==='both'?front.map(e=>({...e,id:e.id+BACK,name:e.name+' · reverso',
   xMm:fold.axis==='horizontal'?width-e.xMm:e.xMm+width,
   yMm:fold.axis==='horizontal'?height*2-e.yMm:e.yMm,
   rotationDeg:fold.axis==='horizontal'?(e.rotationDeg+180)%360:e.rotationDeg})):[];
 return {...design,fold,shape:'rectangle',cornerRadiusMm:0,holes:face.holes,elements:[...front,...back]};
}
export function unfoldLabel(design:LabelDesign):LabelDesign {
 const plain={...design,fold:undefined};
 return {...plain,elements:fitAllElementsToAvailableSpace(design.elements.filter(e=>!e.id.endsWith(BACK)),plain,0.9999,'safe_zone_center')};
}
