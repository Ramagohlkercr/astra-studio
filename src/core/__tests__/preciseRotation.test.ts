import {it,expect} from 'vitest';
import {rotateArtworkExactly,normalizeRotation,snapRotation} from '../geometry/preciseRotation';
import {createInitialOrdersCatalog} from '../projects/projectManager';
it('normalizes negative angles and prevents rounded 360 degrees',()=>{
 expect(normalizeRotation(359.9999)).toBe(0);expect(normalizeRotation(-90)).toBe(270);
});
it('snaps pointer movement with fine and coarse modifiers',()=>{
 expect(snapRotation(44.65)).toBe(45);expect(snapRotation(44.65,true)).toBe(45);
 expect(snapRotation(44.65,false,true)).toBe(44.7);expect(snapRotation(-0.1,false,true)).toBe(359.9);
});
it('does not rotate locked artwork',()=>{
 const el={...createInitialOrdersCatalog()[0].labelDesign.elements[0],locked:true};
 expect(rotateArtworkExactly(el,90)).toBe(el);
});
