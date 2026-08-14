const mapCache = new Map();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smootherstep = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const mix = (a, b, t) => a * (1 - t) + b * t;

export const LIQUID_GLASS_PROFILES = {
  panel: { width: 384, height: 240, bezelWidth: 34, glassThickness: 24, refractiveIndex: 1.5, surface: 'convex-squircle', lightAngle: -60, specularSaturation: 2.1, specularOpacity: 0.12, blurLevel: 1.1 },
  button: { width: 220, height: 60, bezelWidth: 18, glassThickness: 15, refractiveIndex: 1.5, surface: 'convex-squircle', lightAngle: -60, specularSaturation: 2.2, specularOpacity: 0.11, blurLevel: 0.8 },
  input: { width: 320, height: 56, bezelWidth: 16, glassThickness: 13, refractiveIndex: 1.5, surface: 'convex-squircle', lightAngle: -60, specularSaturation: 1.5, specularOpacity: 0.08, blurLevel: 1.2 },
  slider: { width: 320, height: 52, bezelWidth: 16, glassThickness: 14, refractiveIndex: 1.5, surface: 'convex-squircle', lightAngle: -60, specularSaturation: 1.6, specularOpacity: 0.08, blurLevel: 0.8 },
  switch: { width: 68, height: 38, bezelWidth: 14, glassThickness: 13, refractiveIndex: 1.5, surface: 'lip', lightAngle: -60, specularSaturation: 1.7, specularOpacity: 0.09, blurLevel: 0.8 },
};

export function surfaceHeight(x, surface = 'convex-squircle') {
  const n = clamp(x, 0, 1);
  const convexCircle = Math.sqrt(Math.max(0, 1 - (1 - n) ** 2));
  const convexSquircle = (Math.max(0, 1 - (1 - n) ** 4)) ** 0.25;
  if (surface === 'convex') return convexCircle;
  if (surface === 'concave') return 1 - convexSquircle;
  if (surface === 'lip') return mix(convexSquircle, 1 - convexSquircle, smootherstep(n));
  return convexSquircle;
}

function normalize2d(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function normalAt(distance, surface) {
  const delta = 0.001;
  const previous = surfaceHeight(distance - delta, surface);
  const next = surfaceHeight(distance + delta, surface);
  const derivative = (next - previous) / (2 * delta);
  return normalize2d({ x: -derivative, y: 1 });
}

function refract(incoming, normal, refractiveIndex = 1.5) {
  const eta = 1 / refractiveIndex;
  const cosi = -(incoming.x * normal.x + incoming.y * normal.y);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return { x: incoming.x, y: incoming.y };
  return normalize2d({
    x: eta * incoming.x + (eta * cosi - Math.sqrt(k)) * normal.x,
    y: eta * incoming.y + (eta * cosi - Math.sqrt(k)) * normal.y,
  });
}

function roundedRectSignedDistance(x, y, width, height, radius) {
  const px = Math.abs(x - width / 2) - (width / 2 - radius);
  const py = Math.abs(y - height / 2) - (height / 2 - radius);
  return Math.min(Math.max(px, py), 0) + Math.hypot(Math.max(px, 0), Math.max(py, 0));
}

function edgeAxis(x, y, width, height, radius) {
  const px = Math.abs(x - width / 2) - (width / 2 - radius);
  const py = Math.abs(y - height / 2) - (height / 2 - radius);
  const sx = Math.sign(x - width / 2) || 1;
  const sy = Math.sign(y - height / 2) || 1;
  if (px > 0 && py > 0) return normalize2d({ x: px * sx, y: py * sy });
  if (px > py) return { x: sx, y: 0 };
  return { x: 0, y: sy };
}

function canvasToDataUrl(width, height, paintPixel) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    const rgba = paintPixel(i);
    data[p] = rgba.r;
    data[p + 1] = rgba.g;
    data[p + 2] = rgba.b;
    data[p + 3] = rgba.a;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createLiquidGlassMap(profile = {}) {
  const config = { ...LIQUID_GLASS_PROFILES.panel, ...profile };
  const { width, height, bezelWidth, glassThickness, refractiveIndex, surface, lightAngle, specularSaturation, specularOpacity } = config;
  const key = JSON.stringify(config);
  if (mapCache.has(key)) return mapCache.get(key);

  const radius = Math.min(Math.min(width, height) / 2, Math.max(14, bezelWidth * 1.72));
  const bezel = Math.max(1, Math.min(bezelWidth, radius));
  const light = normalize2d({ x: Math.cos((lightAngle * Math.PI) / 180), y: Math.sin((lightAngle * Math.PI) / 180) });
  const vectors = [];
  let maxDisplacement = 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = roundedRectSignedDistance(x + 0.5, y + 0.5, width, height, radius);
      const distanceFromEdge = clamp(radius - distance, 0, bezel);
      const progressToFlatCenter = clamp(distanceFromEdge / bezel, 0, 1);
      const axis = edgeAxis(x + 0.5, y + 0.5, width, height, radius);
      const normal = normalAt(progressToFlatCenter, surface);
      const surfaceNormal = normalize2d({ x: axis.x * Math.abs(normal.x), y: axis.y * Math.abs(normal.x) });
      const ray = refract({ x: 0, y: 1 }, { x: surfaceNormal.x, y: normal.y }, refractiveIndex);
      const bezelFalloff = surface === 'lip' ? Math.sin(progressToFlatCenter * Math.PI) : 1 - smootherstep(progressToFlatCenter);
      const edgeCompression = surface === 'concave' ? -1 : 1;
      const magnitude = (Math.abs(ray.x) * glassThickness + (1 - progressToFlatCenter) * glassThickness * 0.22) * bezelFalloff;
      const dx = -axis.x * magnitude * edgeCompression;
      const dy = -axis.y * magnitude * edgeCompression;
      const facingLight = clamp(surfaceNormal.x * light.x + surfaceNormal.y * light.y, 0, 1);
      const rim = clamp(1 - progressToFlatCenter, 0, 1);
      const specular = clamp((facingLight ** 2.2) * specularSaturation * rim * specularOpacity, 0, 1);
      maxDisplacement = Math.max(maxDisplacement, Math.abs(dx), Math.abs(dy));
      vectors.push({ dx, dy, specular });
    }
  }

  const displacementHref = canvasToDataUrl(width, height, (i) => {
    const vector = vectors[i];
    return {
      r: clamp(Math.round(128 + (vector.dx / maxDisplacement) * 127), 0, 255),
      g: clamp(Math.round(128 + (vector.dy / maxDisplacement) * 127), 0, 255),
      b: 128,
      a: 255,
    };
  });
  const specularHref = canvasToDataUrl(width, height, (i) => {
    const alpha = clamp(Math.round(vectors[i].specular * 255), 0, 255);
    return { r: 255, g: 255, b: 255, a: alpha };
  });

  const result = { displacementHref, specularHref, scale: Math.round(maxDisplacement * 10) / 10, width, height, blurLevel: config.blurLevel };
  mapCache.set(key, result);
  return result;
}
