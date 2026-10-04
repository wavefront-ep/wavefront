import { expect, test } from '@playwright/test';
import { buildAdjacency, edgeTimes, solveWave, solveWaves } from '../src/engine/solver';

// A chain of 6 nodes, 10 mm apart, conducting at 1 m/s (10 ms per step).
function chain() {
  const n = 6;
  const edges = new Uint32Array(2 * (n - 1));
  for (let i = 0; i < n - 1; i++) edges.set([i, i + 1], 2 * i);
  const g = {
    nodes: n,
    edges,
    elen: new Float32Array(n - 1).fill(10),
    ekind: new Uint8Array(n - 1),
    edelay: new Float32Array(n - 1),
    cls: new Uint8Array(n),
    edir: new Uint8Array(n - 1),
  };
  return { g, adj: buildAdjacency(g), et: edgeTimes(g, [1]) };
}

test('wave times follow length over velocity', () => {
  const { g, adj, et } = chain();
  const T = solveWave(adj, et, g.nodes, [{ node: 0, time: 5 }]);
  expect(Array.from(T)).toEqual([5, 15, 25, 35, 45, 55]);
});

test('edge delays and velocity scaling add up', () => {
  const { g, adj } = chain();
  g.edelay[2] = 7;
  const T = solveWave(adj, edgeTimes(g, [0.5]), g.nodes, [{ node: 0, time: 0 }]);
  expect(T[3]).toBeCloseTo(20 + 20 + 27, 4);
});

test('two stimuli: each node takes the earlier arrival', () => {
  const { g, adj, et } = chain();
  const T = solveWave(adj, et, g.nodes, [{ node: 0, time: 0 }, { node: 5, time: 0 }]);
  expect(Array.from(T)).toEqual([0, 10, 20, 20, 10, 0]);
});

test('a wave that arrives in refractory tissue is blocked, a later one passes', () => {
  const { g, adj, et } = chain();
  const refractory = new Float32Array(g.nodes).fill(100);
  // second wave 60 ms after the first: nodes 0..4 were excited at 0..40 and recover at 100..140
  const blocked = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 0, time: 60 }]], refractory);
  expect(blocked[1][0]).toBe(Infinity); // the stimulus itself falls in the refractory period
  const ok = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 0, time: 150 }]], refractory);
  expect(ok[1][5]).toBe(200);
  // a front entering from the far end meets tissue that recovers later at the near end
  const partial = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 5, time: 105 }]], refractory);
  // node 5 recovered at 150 (excited at 50 + 100): the stimulus at 105 is blocked
  expect(partial[1][5]).toBe(Infinity);
  const entry = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 5, time: 155 }]], refractory);
  expect(entry[1][0]).toBe(205);
});

test('conduction block: a front cannot pass a node that has not recovered', () => {
  const { g, adj, et } = chain();
  const refractory = new Float32Array(g.nodes).fill(0);
  refractory[3] = 200; // node 3 is slow to recover
  const T = solveWaves(adj, et, g.nodes, [[{ node: 3, time: 0 }], [{ node: 0, time: 50 }]], refractory);
  // wave 2 reaches node 2 at 70 but cannot enter node 3 (recovers at 200)
  expect(T[1][2]).toBe(70);
  expect(T[1][3]).toBe(Infinity);
  expect(T[1][4]).toBe(Infinity);
});

test('directed edges conduct one way only', () => {
  const { g } = chain();
  g.edir[2] = 1; // edge 2-3 conducts 2 to 3 only
  const adj = buildAdjacency(g);
  const et = edgeTimes(g, [1]);
  const fwd = solveWave(adj, et, g.nodes, [{ node: 0, time: 0 }]);
  expect(fwd[5]).toBe(50);
  const back = solveWave(adj, et, g.nodes, [{ node: 5, time: 0 }]);
  expect(back[3]).toBe(20);
  expect(back[2]).toBe(Infinity); // cannot cross backwards
});

test('per-kind direction: a one-way block set by the scenario', () => {
  const { g, adj, et } = chain();
  const opts = { ekind: g.ekind, kindDir: [1] }; // kind 0: first-to-second only
  const T = solveWave(adj, et, g.nodes, [{ node: 3, time: 0 }], undefined, opts);
  expect(T[4]).toBe(10);
  expect(T[2]).toBe(Infinity);
});

test('decremental conduction: arriving soon after recovery adds delay', () => {
  const { g, adj, et } = chain();
  const refractory = new Float32Array(g.nodes).fill(100);
  const opts = { ekind: g.ekind, decrement: [{ kind: 0, max: 20, tau: 50 }] };
  // second wave at 130: node 1 recovered at 110, so it arrives 30 after recovery... at node 1 (arrival 140)
  const waves = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 0, time: 105 }]], refractory, opts);
  // node 1 was excited at 10, recovers at 110; arrival would be 115, i.e. 5 ms after recovery: extra = 20 * exp(-5/50)
  expect(waves[1][1]).toBeCloseTo(115 + 20 * Math.exp(-5 / 50), 3);
  // a much later wave adds almost nothing
  const late = solveWaves(adj, et, g.nodes, [[{ node: 0, time: 0 }], [{ node: 0, time: 1000 }]], refractory, opts);
  expect(late[1][1]).toBeCloseTo(1010, 1);
});
