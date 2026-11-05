import {LabelElement} from '../types';
import {getElementVisibleBoundingBoxMm} from './geometryEngine';
/** Rotate around the visible artwork center, including transparent image padding. */
export function rotateArtworkExactly(element:LabelElement, degrees:number):LabelElement {
 if(!Number.isFinite(degrees)) return element;
 const before=getElementVisibleBoundingBoxMm(element);
 const rotated={...element,rotationDeg:Math.round(((degrees%360+360)%360)*1000)/1000};
 const after=getElementVisibleBoundingBoxMm(rotated);
 return {...rotated,xMm:rotated.xMm+(before.minX+before.maxX-after.minX-after.maxX)/2,
 yMm:rotated.yMm+(before.minY+before.maxY-after.minY-after.maxY)/2};
}
