import { getElementNormalizedContentBounds, roundMm } from './geometryEngine';
import { LabelElement, Point2D } from '../types';

/** Resize visible artwork around the opposite corner, in the element's rotated axes. */
export function resizeArtwork(el: LabelElement, corner: 'nw'|'ne'|'se'|'sw', delta: Point2D) {
  const n = getElementNormalizedContentBounds(el);
  const angle = el.rotationDeg * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = delta.x*c + delta.y*s, dy = -delta.x*s + delta.y*c;
  const sx = corner.includes('e') ? 1 : -1, sy = corner.includes('s') ? 1 : -1;
  const w = el.widthMm*n.width, h = el.heightMm*n.height;
  let nw: number, nh: number;
  if (el.lockAspectRatio) {
    const scale = Math.max(0.1/Math.min(w,h), 1+(dx*sx*w+dy*sy*h)/(w*w+h*h));
    nw=w*scale; nh=h*scale;
  } else { nw=Math.max(.1,w+sx*dx); nh=Math.max(.1,h+sy*dy); }
  const widthMm=nw/n.width, heightMm=nh/n.height;
  const localX=sx*(nw-w)/2-(n.centerNormX-.5)*(widthMm-el.widthMm);
  const localY=sy*(nh-h)/2-(n.centerNormY-.5)*(heightMm-el.heightMm);
  return {widthMm:roundMm(widthMm),heightMm:roundMm(heightMm),
    xMm:roundMm(el.xMm+localX*c-localY*s),yMm:roundMm(el.yMm+localX*s+localY*c)};
}
