import { describe, it, expect } from 'vitest';
import { alignArtwork, artworkDpi, mergeProcessedArtwork } from '../geometry/editorActions';
import { createBlankLabelDesign } from '../projects/projectManager';
import { getElementVisibleBoundingBoxMm, computeSafeEngravingZone } from '../geometry/geometryEngine';
import { RasterLogoElement, SvgLogoElement } from '../types';
const design = createBlankLabelDesign(60, 40);
const logo: SvgLogoElement = {id:'test',name:'test',type:'logo_svg',xMm:20,yMm:10,widthMm:20,heightMm:10,rotationDeg:45,aspectRatio:2,lockAspectRatio:true,locked:false,visible:true,rawSvgContent:'',normalizedPaths:[],originalViewBox:{minX:0,minY:0,width:100,height:100},contentBoundsNormalized:{minX:.2,minY:.1,maxX:.8,maxY:.7,width:.6,height:.6,centerNormX:.5,centerNormY:.4}};
describe('Artwork actions', () => {
  for (const rotationDeg of [0,45,90,135]) {
    it(`aligns visible rotated edges at ${rotationDeg} degrees`, () => {
      const e = {...logo,rotationDeg}; const safe=computeSafeEngravingZone(design);
      expect(getElementVisibleBoundingBoxMm(alignArtwork(e,design,'safe_left')).minX).toBeCloseTo(safe.minX,2);
      expect(getElementVisibleBoundingBoxMm(alignArtwork(e,design,'safe_right')).maxX).toBeCloseTo(safe.maxX,2);
      expect(getElementVisibleBoundingBoxMm(alignArtwork(e,design,'safe_top')).minY).toBeCloseTo(safe.minY,2);
      expect(getElementVisibleBoundingBoxMm(alignArtwork(e,design,'safe_bottom')).maxY).toBeCloseTo(safe.maxY,2);
      const x=getElementVisibleBoundingBoxMm(alignArtwork(e,design,'center_x'));
      const y=getElementVisibleBoundingBoxMm(alignArtwork(e,design,'center_y'));
      expect((x.minX+x.maxX)/2).toBeCloseTo(30,2); expect((y.minY+y.maxY)/2).toBeCloseTo(20,2);
    });
  }
  it('preserves placement, nonuniform scaling and rotation when processing pixels', () => {
    const old={...logo,type:'logo_raster',processedDataUrl:'old',widthMm:31,heightMm:13,locked:true,visible:false} as unknown as RasterLogoElement;
    const processed={...old,xMm:0,yMm:0,rotationDeg:0,widthMm:20,heightMm:10,locked:false,visible:true,processedDataUrl:'new'};
    const result=mergeProcessedArtwork(old,processed);
    for (const key of ['xMm','yMm','widthMm','heightMm','rotationDeg','locked','visible'] as const) expect(result[key]).toBe(old[key]);
    expect(result.processedDataUrl).toBe('new');
  });
  it('reports actual processed resolution and decreases DPI on enlargement', () => {
    const image={...logo,type:'logo_raster',pixelWidth:4000,pixelHeight:2000,processing:{mode:'raster'},widthMm:100,heightMm:50} as unknown as RasterLogoElement;
    expect(artworkDpi(image)).toBeCloseTo(162.56);
    expect(artworkDpi({...image,widthMm:200,heightMm:100})).toBeCloseTo(81.28);
  });
});
