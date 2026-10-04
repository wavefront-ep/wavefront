// Activation shading. A standard physical material is patched so that colour comes from the
// playhead and the per-vertex activation times (two vec4 attributes, eight waves):
//   live wave:      rest -> amber front -> coral-orange plateau -> refractory tint -> rest
//   activation map: isochrone colours from the first wave, with a line every `uIso` ms
import { Color, DataTexture, LinearFilter, Material, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';

export interface ActivationCfg {
  apd: number;
  width: number;
  tail: number;
  front: string;
  act: string;
  refr: string;
}

/** Uniforms shared by every activation material, so one write updates the whole heart. */
export const shared = {
  uTime: { value: 0 },
  uMode: { value: 0 },
  uMapMin: { value: 0 },
  uMapMax: { value: 260 },
  uIso: { value: 10 },
  uMapTex: { value: null as DataTexture | null },
};

export const MYOCARDIUM = { front: '#F2B24A', act: '#E2704C', refr: '#BDA6C2' };
export const CONDUCTION = { front: '#F8D46A', act: '#E58A2E', refr: '#CDBF98' };

const VERT_DECL = /* glsl */ `
attribute vec4 aT0;
attribute vec4 aT1;
varying vec4 vT0;
varying vec4 vT1;
`;

const FRAG_DECL = /* glsl */ `
uniform float uTime;
uniform int uMode;
uniform float uAPD;
uniform float uWidth;
uniform float uTail;
uniform vec3 uFront;
uniform vec3 uAct;
uniform vec3 uRefr;
uniform float uMapMin;
uniform float uMapMax;
uniform float uIso;
uniform sampler2D uMapTex;
varying vec4 vT0;
varying vec4 vT1;
float actGlow = 0.0;
`;

const FRAG_COLOR = /* glsl */ `
if (uMode == 1) {
  float tt = vT0.x;
  if (tt >= uMapMin && tt <= uMapMax) {
    float k = clamp((tt - uMapMin) / (uMapMax - uMapMin), 0.0, 1.0);
    vec3 c = texture2D(uMapTex, vec2(k, 0.5)).rgb;
    float f = tt / uIso;
    float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1.0e-4);
    float line = 1.0 - clamp(d, 0.0, 1.0);
    diffuseColor.rgb = mix(c, vec3(0.02), line * 0.5);
  }
} else {
  float bestT = -1.0e9;
  for (int i = 0; i < 4; i++) {
    float a = vT0[i];
    if (a <= uTime && a > bestT && a < 1.0e8) bestT = a;
    float b = vT1[i];
    if (b <= uTime && b > bestT && b < 1.0e8) bestT = b;
  }
  if (bestT > -1.0e8) {
    float dt = uTime - bestT;
    float fr = 1.0 - smoothstep(0.0, uWidth, dt);
    vec3 depol = mix(uAct, uFront, fr);
    float onset = smoothstep(0.0, 4.0, dt);
    float repol = smoothstep(uAPD - 25.0, uAPD + 10.0, dt);
    float tailK = smoothstep(uAPD + 10.0, uAPD + 10.0 + uTail, dt);
    vec3 after = mix(uRefr, diffuseColor.rgb, tailK);
    vec3 c = mix(depol, after, repol);
    diffuseColor.rgb = mix(diffuseColor.rgb, c, onset);
    actGlow = (1.0 - repol) * (0.12 + 0.45 * fr) * onset;
  }
}
`;

export function applyActivation(material: Material, cfg: ActivationCfg & { palette: { front: string; act: string; refr: string } }) {
  const own = {
    uAPD: { value: cfg.apd },
    uWidth: { value: cfg.width },
    uTail: { value: cfg.tail },
    uFront: { value: new Color(cfg.palette.front) },
    uAct: { value: new Color(cfg.palette.act) },
    uRefr: { value: new Color(cfg.palette.refr) },
  };
  material.userData.activation = own;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvT0 = aT0;\nvT1 = aT1;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * actGlow;');
  };
  material.customProgramCacheKey = () => 'activation-v1';
}

// ---------------------------------------------------------------- colour maps

export type PaletteId = 'safe' | 'carto';

// Viridis control points, reversed so that early activation is bright and late activation is dark
// purple. Perceptually ordered and safe for the common forms of colour-blindness.
const VIRIDIS = ['#fde725', '#b5de2b', '#6ece58', '#35b779', '#1f9e89', '#26828e', '#31688e', '#3e4989', '#482878', '#440154'];
// CARTO-style: red (early) through yellow, green and blue to purple (late), as in clinical mapping.
const CARTO = ['#e31a1c', '#f26b21', '#f5c518', '#8fce3b', '#2fb86a', '#22b5c9', '#2a7fd1', '#3f51c4', '#7b3fb3', '#8e2c9e'];

function ramp(stops: string[], n = 256): Uint8Array {
  const cols = stops.map((s) => new Color(s)); // linear working space
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (cols.length - 1);
    const a = Math.floor(x);
    const b = Math.min(cols.length - 1, a + 1);
    const c = cols[a].clone().lerp(cols[b], x - a).convertLinearToSRGB(); // bytes are sRGB
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
  }
  return data;
}

export const PALETTES: Record<PaletteId, { name: string; stops: string[] }> = {
  safe: { name: 'Colour-blind safe', stops: VIRIDIS },
  carto: { name: 'CARTO-style', stops: CARTO },
};

export function paletteTexture(id: PaletteId): DataTexture {
  const tex = new DataTexture(ramp(PALETTES[id].stops), 256, 1, RGBAFormat, UnsignedByteType);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

shared.uMapTex.value = paletteTexture('safe');
