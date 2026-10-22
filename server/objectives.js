// Bombsite bounds extracted from the original Clutcher multiplayer map definitions.
// A small tolerance accommodates foot-position differences near site boundaries.
export const SITES = Object.freeze({
  oasis: {
    A: [[-59.1312,-4.572,-15.6464,-50.0888,-3.9624,-6.7056]],
    B: [[1.8288,-4.0386,-56.2864,11.176,-3.6322,-47.752]]
  },
  dusker: {
    A: [[62.1792,2.4384,24.7904,66.6496,3.4544,27.2288],
        [59.3344,2.4384,27.2288,66.6496,4.8768,31.6992]],
    B: [[63.3984,0,-43.8912,72.7456,2.4384,-34.1376]]
  }
});

export function siteForPosition(map, state) {
  if (!state || ![state.x,state.y,state.z].every(Number.isFinite)) return null;
  for (const [site, areas] of Object.entries(SITES[map] || {})) {
    for (const [x1,y1,z1,x2,y2,z2] of areas) {
      if (state.x >= x1 - .5 && state.x <= x2 + .5 &&
          state.z >= z1 - .5 && state.z <= z2 + .5 &&
          state.y >= y1 - 1.1 && state.y <= y2 + 1.7) return site;
    }
  }
  return null;
}
