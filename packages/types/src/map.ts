export const TILE = 256;

// Web Mercator pixel position at zoom z, as OpenStreetMap tiles use.
export const project = (lat: number, lng: number, z: number) => {
  const size = TILE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * size, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size };
};

export const unproject = (x: number, y: number, z: number) => {
  const size = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / size) * 360 - 180 };
};
