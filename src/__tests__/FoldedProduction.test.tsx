import React from 'react';
import {render,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {ProductionBedPreview} from '../components/ProductionBedPreview';
import {createBlankLabelDesign} from '../core/projects/projectManager';
import {arrangeFoldedLabel} from '../core/geometry/foldedLabel';
import {computeNestingLayout,DEFAULT_NESTING_CONFIG} from '../core/nesting/nestingEngine';
import {compileLabelGeometry,validateLabelAndBatchGeometry} from '../core/geometry/geometryEngine';
import {exportProductionSvg} from '../core/exporters/svgExporter';
import {INITIAL_MATERIALS_CATALOG} from '../core/materials/materialsCatalog';
import {DEFAULT_IMAGE_PROCESSING} from '../core/image/imageProcessor';
afterEach(cleanup);
it.each(['horizontal','vertical'] as const)('preserves both raster face rotations from editor to production and SVG (%s)',axis=>{
 const base=createBlankLabelDesign(40,30);
 base.elements=[{id:'test-raster',name:'Logo',type:'logo_raster',visible:true,locked:false,xMm:20,yMm:15,widthMm:10,heightMm:6,rotationDeg:90,lockAspectRatio:true,originalDataUrl:'data:image/png;base64,test',processedDataUrl:'data:image/png;base64,test',pixelWidth:100,pixelHeight:60,effectiveDpi:254,processing:DEFAULT_IMAGE_PROCESSING,vectorizedPathsNormalized:[]} as any];
 const d=arrangeFoldedLabel(base,{axis,faces:'both'});
 for(const sharedCutLines of [false,true]){
 const n=computeNestingLayout(d,{...DEFAULT_NESTING_CONFIG,rotationMode:'auto_optimize',sharedCutLines,requestedQuantity:2});
 expect(n.appliedRotationDeg).toBe(0);
 const validation=validateLabelAndBatchGeometry(d,n);expect(validation.isValid).toBe(true);
 const material=INITIAL_MATERIALS_CATALOG[0];
 const {container,unmount}=render(<ProductionBedPreview design={d} material={material} nesting={n} validation={validation} activeBatchIndex={0} onSelectBatchIndex={()=>{}}/>);
 const imgs=container.querySelectorAll('image');expect(imgs).toHaveLength(2);
 const master=compileLabelGeometry(d).engravingItems;
 master.forEach((e,i)=>expect(imgs[i].getAttribute('transform')).toContain(`rotate(${e.rotationDeg} `));
 const svg=exportProductionSvg(d,n,material,{mode:'engrave_only'}).svgContent;
 master.forEach(e=>expect(svg).toContain(`rotate(${e.rotationDeg} `));
 expect(exportProductionSvg(d,n,material,{mode:'cut_only'}).pieceCount).toBe(2);
 unmount();
 }
});
