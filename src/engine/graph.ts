// Loads the activation graph (conduction.json + graph.bin) produced by tools/build_conduction.py.

export interface GraphMeta {
  nodes: number;
  tissueNodes: number;
  edges: number;
  kinds: string[];
  constants: Record<string, number>;
  named: Record<string, number>;
  ranges: Record<string, [number, number]>;
  stimulus: { site: string; node: number; time_ms: number };
  paths: Record<string, { kind: string; schematic: boolean; length_mm: number; mid: [number, number, number] }>;
  purkinje: Record<string, { centre: [number, number, number]; terminals: number }>;
  reference: { atrial_ms: [number, number]; ventricular_ms: [number, number] };
  masks: string[];
  edgesets: string[];
  apSites: Record<string, { atrial: number[]; ventricular: number[] }>;
  loops: { flutter: { period_ms: number; cti_scale: number }; vt: { period_ms: number; channel_scale: number } };
  arrays: Record<string, { offset: number; dtype: string; shape: number[] }>;
}

export interface VertexMap {
  idx: Uint32Array;
  /** Weights, k per vertex; absent when k = 1. */
  w?: Float32Array;
  k: number;
}

export interface Graph {
  meta: GraphMeta;
  pos: Float32Array;
  cls: Uint8Array;
  region: Uint8Array;
  edges: Uint32Array;
  elen: Float32Array;
  ekind: Uint8Array;
  edelay: Float32Array;
  /** 0 both ways, 1 first to second node only, 2 second to first only. */
  edir: Uint8Array;
  /** Edges that are off unless a scenario enables them (accessory pathways). */
  optional: Uint32Array;
  masks: Record<string, Uint16Array>;
  edgesets: Record<string, Uint32Array>;
  maps: Record<string, VertexMap>;
}

const CTORS: Record<string, any> = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };

export async function loadGraph(jsonUrl: string, binUrl: string): Promise<Graph> {
  const [meta, buf] = await Promise.all([
    fetch(jsonUrl).then((r) => r.json() as Promise<GraphMeta>),
    fetch(binUrl).then((r) => r.arrayBuffer()),
  ]);
  return parseGraph(meta, buf);
}

/** Build the typed arrays from the metadata and the binary blob (also used by the Node tooling). */
export function parseGraph(meta: GraphMeta, buf: ArrayBuffer): Graph {
  const get = (key: string) => {
    const a = meta.arrays[key];
    const n = a.shape.reduce((x, y) => x * y, 1);
    return new CTORS[a.dtype](buf, a.offset, n);
  };
  const maps: Record<string, VertexMap> = {};
  for (const key of Object.keys(meta.arrays)) {
    const m = key.match(/^map_(.+)_idx$/);
    if (!m) continue;
    const name = m[1];
    const idx = get(key) as Uint32Array;
    const wKey = `map_${name}_w`;
    const k = meta.arrays[key].shape.length > 1 ? meta.arrays[key].shape[1] : 1;
    maps[name] = { idx, k, w: meta.arrays[wKey] ? (get(wKey) as Float32Array) : undefined };
  }
  const pos = get('pos') as Float32Array;
  const e16 = get('edges') as Uint16Array;
  const m = e16.length / 2;
  // Edge lengths come from node positions; delays are stored sparsely.
  const edges = Uint32Array.from(e16);
  const elen = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const a = 3 * edges[2 * i];
    const b = 3 * edges[2 * i + 1];
    elen[i] = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
  }
  const edelay = new Float32Array(m);
  const di = get('delay_idx') as Uint32Array;
  const dv = get('delay_val') as Float32Array;
  for (let i = 0; i < di.length; i++) edelay[di[i]] = dv[i];
  const edir = new Uint8Array(m);
  const ri = get('dir_idx') as Uint32Array;
  const rv = get('dir_val') as Uint8Array;
  for (let i = 0; i < ri.length; i++) edir[ri[i]] = rv[i];
  const masks: Record<string, Uint16Array> = {};
  for (const n of meta.masks) masks[n] = get(`mask_${n}`) as Uint16Array;
  const edgesets: Record<string, Uint32Array> = {};
  for (const n of meta.edgesets) edgesets[n] = get(`es_${n}`) as Uint32Array;
  return {
    meta, pos, cls: get('cls'), region: get('region'), edges, elen, ekind: get('ekind'), edelay, edir,
    optional: get('opt_idx') as Uint32Array, masks, edgesets, maps,
  };
}
