import {BoundingBox,LabelDesign,Point2D} from '../types';
export function supportsSharedCuts(d:LabelDesign):boolean {
 return ['rectangle','square'].includes(d.shape) || (d.shape==='rounded_rect' && d.cornerRadiusMm===0);
}
/** Union of collinear rectangle edges. Each physical stretch is emitted once. */
export function sharedCutLines(boxes:BoundingBox[]):[Point2D,Point2D][] {
 const groups=new Map<string,{vertical:boolean,fixed:number,ranges:[number,number][]}>();
 const add=(vertical:boolean,fixed:number,start:number,end:number)=>{
  const key=`${vertical?'v':'h'}:${fixed.toFixed(4)}`;
  if(!groups.has(key))groups.set(key,{vertical,fixed,ranges:[]});
  groups.get(key)!.ranges.push([start,end]);
 };
 for(const b of boxes){add(false,b.minY,b.minX,b.maxX);add(false,b.maxY,b.minX,b.maxX);add(true,b.minX,b.minY,b.maxY);add(true,b.maxX,b.minY,b.maxY);}
 const lines:[Point2D,Point2D][]=[];
 for(const {vertical,fixed,ranges} of groups.values()){
  ranges.sort((a,b)=>a[0]-b[0]);let [start,end]=ranges[0];
  const emit=()=>lines.push(vertical?[{x:fixed,y:start},{x:fixed,y:end}]:[{x:start,y:fixed},{x:end,y:fixed}]);
  for(const [a,b] of ranges.slice(1)){if(a<=end+0.0001)end=Math.max(end,b);else{emit();start=a;end=b;}}
  emit();
 }
 return lines;
}
