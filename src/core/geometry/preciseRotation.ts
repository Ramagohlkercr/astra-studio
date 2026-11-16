import {LabelElement} from '../types';
import {getElementVisibleBoundingBoxMm} from './geometryEngine';
/** Rotate around the visible artwork center, including transparent image padding. */
export function rotateArtworkExactly(element:LabelElement, degrees:number):LabelElement {
 if(element.locked || !Number.isFinite(degrees)) return element;
 const before=getElementVisibleBoundingBoxMm(element);
 const rotated={...element,rotationDeg:normalizeRotation(degrees)};
 const after=getElementVisibleBoundingBoxMm(rotated);
 return {...rotated,xMm:rotated.xMm+(before.minX+before.maxX-after.minX-after.maxX)/2,
 yMm:rotated.yMm+(before.minY+before.maxY-after.minY-after.maxY)/2};
}

export function normalizeRotation(degrees:number):number {
 return (Math.round(((degrees%360+360)%360)*1000)/1000)%360;
}
export function snapRotation(degrees:number,shift=false,alt=false):number {
 const step=alt?0.1:shift?15:1;
 return normalizeRotation(Math.round(degrees/step+1e-10)*step);
}
