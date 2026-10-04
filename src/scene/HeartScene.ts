import {
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  Intersection,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { BY_MESH, COLORS, Chamber, EXTRA_LABELS, STRUCTURES } from '../data/structures';
import { VIEW_BY_ID } from './views';

(BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type CutMode = 'off' | 'fourChamber' | 'shortAxis';

export interface LayerState {
  epicardium: boolean;
  epiOpacity: number;
  chambers: Record<Chamber, boolean>;
  vessels: boolean;
  valves: boolean;
  labels: boolean;
}

export interface CutState {
  mode: CutMode;
  /** Signed offset of the plane along its normal, in scene units (1 unit = 100 mm). */
  offset: number;
}

export interface LabelItem {
  text: string;
  point: Vector3;
  meshes: string[];
  /** 'centre': middle of the visible patch (whole structures); 'nearest': visible point closest to the landmark. */
  mode: 'centre' | 'nearest';
  /** Surface samples (position + normal) on the meshes the label names. */
  samples: { p: Vector3; n: Vector3 }[];
}

export interface PlacedLabel {
  text: string;
  anchor: Vector2;
  side: 'left' | 'right';
  y: number;
  x: number;
}

interface Landmarks {
  [k: string]: [number, number, number];
}

const DEFAULT_DISTANCE = 3.1;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class HeartScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.05, 40);
  readonly controls: OrbitControls;
  readonly layers: LayerState = {
    epicardium: true,
    epiOpacity: 1,
    chambers: { RA: true, LA: true, RV: true, LV: true },
    vessels: true,
    valves: true,
    labels: false,
  };
  readonly cut: CutState = { mode: 'off', offset: 0 };

  onSelect: (mesh: string | null) => void = () => {};
  onHover: (mesh: string | null, x: number, y: number) => void = () => {};
  onLabels: (labels: PlacedLabel[]) => void = () => {};
  onViewChange: (id: string | null) => void = () => {};

  private meshes = new Map<string, Mesh>();
  private backs = new Map<string, Mesh>();
  private baseColor = new Map<string, Color>();
  private landmarks: Landmarks = {};
  private center = new Vector3();
  private bounds = new Box3();
  private plane = new Plane(new Vector3(0, 0, 1), 0);
  private cutBasis: Record<Exclude<CutMode, 'off'>, { normal: Vector3; point: Vector3 }> | null = null;
  private labelItems: LabelItem[] = [];
  private selected: string | null = null;
  private hovered: string | null = null;
  private raycaster = new Raycaster();
  private dirty = true;
  private tween: { t0: number; dur: number; fromDir: Vector3; toDir: Vector3; fromDist: number; toDist: number; fromT: Vector3; toT: Vector3 } | null = null;
  private lastCam = '';
  private settleAt = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private hoverTimer = 0;
  private currentView: string | null = 'anterior';

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = false;
    container.appendChild(this.renderer.domElement);

    // Soft studio light. The key, fill and rim are fixed in camera space so every view preset is
    // lit the same way; the hemisphere term keeps a gentle top-down gradient in world space.
    this.scene.add(new HemisphereLight(0xfff8f1, 0xcfc2bb, 0.85));
    this.scene.add(this.camera);
    const rig = (color: number, intensity: number, pos: [number, number, number]) => {
      const l = new DirectionalLight(color, intensity);
      l.position.set(...pos);
      this.camera.add(l);
      this.camera.add(l.target);
      l.target.position.set(0, 0, -3);
      return l;
    };
    rig(0xfff3e6, 2.1, [-1.6, 2.2, 3]); // key: upper left, front
    rig(0xe8eef5, 0.45, [2.5, -0.5, 1.5]); // fill: right, low
    const rim = rig(0xdfe8f2, 0.5, [0.5, 1.2, -9]); // rim: behind the subject, towards the camera
    rim.target.position.set(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !reduceMotion();
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 7;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    this.controls.addEventListener('start', () => {
      this.tween = null;
      this.currentView = null;
      this.onViewChange(null);
    });

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      const p = this.pointerDown;
      this.pointerDown = null;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) this.select(this.pick(e)?.mesh ?? null);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') return;
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => {
        const hit = this.pick(e);
        const r = el.getBoundingClientRect();
        this.setHover(hit?.mesh ?? null);
        this.onHover(hit?.mesh ?? null, e.clientX - r.left, e.clientY - r.top);
      }, 30);
    });
    el.addEventListener('pointerleave', () => {
      window.clearTimeout(this.hoverTimer);
      this.setHover(null);
      this.onHover(null, 0, 0);
    });
    el.addEventListener('dblclick', () => this.recentre());

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- loading

  async load(url: string, sidecarUrl: string): Promise<void> {
    const [gltf, side] = await Promise.all([
      new GLTFLoader().loadAsync(url),
      fetch(sidecarUrl).then((r) => r.json()),
    ]);
    this.landmarks = side.landmarks;
    this.bounds.set(new Vector3(...side.bounds[0]), new Vector3(...side.bounds[1]));
    this.bounds.getCenter(this.center);

    gltf.scene.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const info = BY_MESH[mesh.name];
      if (!info) return;
      (mesh.geometry as any).computeBoundsTree();
      const base = new Color(info.color);
      this.baseColor.set(mesh.name, base);
      const front = new MeshPhysicalMaterial({
        color: base.clone(),
        roughness: 0.78,
        metalness: 0,
        sheen: 0.5,
        sheenRoughness: 0.55,
        sheenColor: new Color('#F3E3E1'),
        side: info.group === 'endocardium' ? DoubleSide : FrontSide,
      });
      mesh.material = front;
      this.meshes.set(mesh.name, mesh);
      // Cut tissue is shown as the back face of the wall seen through the clipping plane.
      if (info.group === 'epicardium' || info.group === 'vessel') {
        const back = new Mesh(
          mesh.geometry,
          new MeshPhysicalMaterial({ color: COLORS.cut, roughness: 0.9, metalness: 0, side: BackSide }),
        );
        back.name = `${mesh.name}__cut`;
        back.raycast = () => {};
        back.visible = false;
        mesh.parent!.add(back);
        this.backs.set(mesh.name, back);
      }
    });
    this.scene.add(gltf.scene);

    // Pivot about the heart centre.
    gltf.scene.position.set(0, 0, 0);
    this.controls.target.copy(this.center);
    this.setupCutBasis();
    this.setupLabels();
    this.setView('anterior', false);
    this.applyLayers();
  }

  private lm(k: string) {
    return new Vector3(...this.landmarks[k]);
  }

  private setupCutBasis() {
    const A = this.lm('apex');
    const M = this.lm('mitral');
    const T = this.lm('tricuspid');
    const B = M.clone().add(T).multiplyScalar(0.5);
    // Apical four-chamber plane: contains the apex and the centres of the mitral and tricuspid
    // valves. The posterior half is kept so the cut face looks towards an anterior camera.
    const n4 = new Vector3().crossVectors(M.clone().sub(A), T.clone().sub(A)).normalize();
    if (n4.z > 0) n4.negate();
    // Short-axis plane: perpendicular to the base-apex axis at mid-ventricle; the apical part
    // is kept and viewed from the base.
    const nS = A.clone().sub(B).normalize();
    this.cutBasis = {
      fourChamber: { normal: n4, point: A.clone() },
      shortAxis: { normal: nS, point: B.clone().lerp(A, 0.5) },
    };
  }

  private setupLabels() {
    const sample = (names: string[]) => {
      const out: { p: Vector3; n: Vector3 }[] = [];
      for (const name of names) {
        const g = this.meshes.get(name)?.geometry;
        if (!g) continue;
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const step = Math.max(1, Math.floor(pos.count / 900));
        for (let i = 0; i < pos.count; i += step) {
          out.push({ p: new Vector3().fromBufferAttribute(pos, i), n: new Vector3().fromBufferAttribute(nor, i) });
        }
      }
      return out;
    };
    const items: LabelItem[] = [];
    for (const s of STRUCTURES) {
      if (s.label && s.landmark) {
        const whole = s.group === 'epicardium' || s.mesh === 'aorta' || s.mesh === 'pulmonary_trunk';
        items.push({ text: s.label, point: this.lm(s.landmark), meshes: [s.mesh], mode: whole ? 'centre' : 'nearest', samples: sample([s.mesh]) });
      }
    }
    for (const e of EXTRA_LABELS) {
      items.push({ text: e.text, point: this.lm(e.landmark), meshes: e.meshes, mode: 'nearest', samples: sample(e.meshes) });
    }
    this.labelItems = items;
  }

  // ---------------------------------------------------------------- state

  applyLayers() {
    const L = this.layers;
    for (const [name, mesh] of this.meshes) {
      const s = BY_MESH[name];
      let vis = true;
      if (s.group === 'epicardium') vis = L.epicardium && !!L.chambers[s.chamber!];
      else if (s.group === 'endocardium') vis = !!L.chambers[s.chamber!];
      else if (s.group === 'vessel') vis = L.vessels;
      else if (s.group === 'valve') vis = L.valves;
      mesh.visible = vis;
      const m = mesh.material as MeshPhysicalMaterial;
      if (s.group === 'epicardium') {
        const o = L.epiOpacity;
        m.transparent = o < 0.999;
        m.opacity = o;
        m.depthWrite = o >= 0.999;
        m.needsUpdate = true;
      }
      const back = this.backs.get(name);
      if (back) {
        back.visible = vis && this.cut.mode !== 'off';
        const bm = back.material as MeshPhysicalMaterial;
        bm.transparent = s.group === 'epicardium' && L.epiOpacity < 0.999;
        bm.opacity = s.group === 'epicardium' ? L.epiOpacity : 1;
        bm.depthWrite = !bm.transparent;
      }
    }
    // Draw transparent epicardium after the opaque interior.
    for (const [name, mesh] of this.meshes) {
      mesh.renderOrder = BY_MESH[name].group === 'epicardium' ? 2 : 1;
    }
    this.applyCut();
    this.refreshTint();
    this.invalidate(true);
  }

  setCut(mode: CutMode, offset = this.cut.offset, moveCamera = false) {
    const changed = mode !== this.cut.mode;
    this.cut.mode = mode;
    this.cut.offset = offset;
    this.applyLayers();
    if (moveCamera && mode !== 'off' && changed) this.lookAtCut(mode);
  }

  private applyCut() {
    const on = this.cut.mode !== 'off' && this.cutBasis;
    if (!on) {
      this.renderer.clippingPlanes = [];
      return;
    }
    const b = this.cutBasis![this.cut.mode as Exclude<CutMode, 'off'>];
    this.plane.setFromNormalAndCoplanarPoint(b.normal, b.point.clone().addScaledVector(b.normal, this.cut.offset));
    this.renderer.clippingPlanes = [this.plane];
  }

  private lookAtCut(mode: Exclude<CutMode, 'off'>) {
    const b = this.cutBasis![mode];
    this.flyTo(b.normal.clone().negate(), DEFAULT_DISTANCE, this.center.clone());
    this.currentView = null;
    this.onViewChange(null);
  }

  select(mesh: string | null) {
    this.selected = mesh;
    this.refreshTint();
    this.invalidate();
    this.onSelect(mesh);
  }

  private setHover(mesh: string | null) {
    if (mesh === this.hovered) return;
    this.hovered = mesh;
    this.refreshTint();
    this.invalidate();
    this.renderer.domElement.style.cursor = mesh ? 'pointer' : '';
  }

  private related(mesh: string | null): string[] {
    if (!mesh) return [];
    const s = BY_MESH[mesh];
    if (s?.chamber) return [`epi_${s.chamber}`, `endo_${s.chamber}`];
    return [mesh];
  }

  private refreshTint() {
    const sel = this.related(this.selected);
    const hov = this.related(this.hovered);
    const sage = new Color(COLORS.highlight);
    for (const [name, mesh] of this.meshes) {
      const t = sel.includes(name) ? 0.8 : hov.includes(name) ? 0.42 : 0;
      (mesh.material as MeshPhysicalMaterial).color.copy(this.baseColor.get(name)!).lerp(sage, t);
    }
  }

  // ---------------------------------------------------------------- picking

  private visibleObjects(): Object3D[] {
    return [...this.meshes.values()].filter((m) => m.visible);
  }

  private clipped(p: Vector3) {
    return this.cut.mode !== 'off' && this.plane.distanceToPoint(p) < 0;
  }

  private firstHit(hits: Intersection[]): Intersection | undefined {
    return hits.find((h) => !this.clipped(h.point));
  }

  private pick(e: PointerEvent | MouseEvent): { mesh: string; point: Vector3 } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.firstHit(this.raycaster.intersectObjects(this.visibleObjects(), false));
    return hit ? { mesh: hit.object.name, point: hit.point } : null;
  }

  // ---------------------------------------------------------------- camera

  setView(id: string, animate = true) {
    const v = VIEW_BY_ID[id];
    if (!v) return;
    this.currentView = id;
    this.onViewChange(id);
    this.flyTo(v.dir, DEFAULT_DISTANCE, this.center.clone(), animate);
  }

  recentre() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(dir, this.camera.position.distanceTo(this.controls.target), this.center.clone());
  }

  private flyTo(dir: Vector3, dist: number, target: Vector3, animate = true) {
    const toDir = dir.clone().normalize();
    const fromDir = this.camera.position.clone().sub(this.controls.target);
    const fromDist = fromDir.length() || dist;
    fromDir.normalize();
    if (!animate || reduceMotion()) {
      this.tween = null;
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(toDir, dist);
      this.camera.lookAt(target);
      this.controls.update();
      this.invalidate(true);
      return;
    }
    this.tween = {
      t0: performance.now(),
      dur: 650,
      fromDir,
      toDir,
      fromDist,
      toDist: dist,
      fromT: this.controls.target.clone(),
      toT: target,
    };
    this.invalidate();
  }

  private stepTween(now: number) {
    const tw = this.tween;
    if (!tw) return;
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out cubic
    const q = new Quaternion().setFromUnitVectors(tw.fromDir, tw.toDir);
    // Antiparallel directions have no unique rotation: swing about a horizontal axis when the
    // path is vertical (superior <-> inferior), otherwise about the vertical axis.
    if (tw.fromDir.dot(tw.toDir) < -0.9999) {
      const axis = Math.abs(tw.fromDir.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      q.setFromAxisAngle(axis, Math.PI);
    }
    const part = new Quaternion().slerp(q, e);
    const dir = tw.fromDir.clone().applyQuaternion(part);
    const dist = tw.fromDist + (tw.toDist - tw.fromDist) * e;
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.controls.target);
    if (k >= 1) {
      // Land exactly on the target so rounding in the slerp never leaves the view slightly off.
      this.camera.position.copy(tw.toT).addScaledVector(tw.toDir, tw.toDist);
      this.camera.lookAt(tw.toT);
      this.tween = null;
    }
    this.invalidate();
  }

  // ---------------------------------------------------------------- loop

  invalidate(relabel = false) {
    this.dirty = true;
    if (relabel) this.settleAt = performance.now() + 120;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the heart fully visible in narrow (portrait) stages.
    const aspect = w / h;
    this.camera.fov = aspect < 1 ? (2 * Math.atan(Math.tan((32 / 2) * (Math.PI / 180)) / aspect) * 180) / Math.PI : 32;
    this.camera.updateProjectionMatrix();
    this.invalidate(true);
  }

  private loop(now: number) {
    requestAnimationFrame(this.loop);
    this.stepTween(now);
    const moved = this.controls.update();
    const camKey = this.camera.position.toArray().concat(this.controls.target.toArray()).map((v) => v.toFixed(4)).join();
    if (camKey !== this.lastCam) {
      this.lastCam = camKey;
      this.settleAt = now + 160;
      this.onLabels([]);
      this.dirty = true;
    }
    if (moved || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    if (this.settleAt && now >= this.settleAt && !this.tween) {
      this.settleAt = 0;
      this.updateLabels();
    }
  }

  // ---------------------------------------------------------------- labels

  /** Labels are placed after the camera settles: anchor on the first visible surface along the
   *  ray to each landmark, and only show a label if that surface is the one it names. */
  private updateLabels() {
    if (!this.layers.labels || !this.labelItems.length) {
      this.onLabels([]);
      return;
    }
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // Screen-space box of the whole heart, for placing labels outside it.
    const corners: Vector3[] = [];
    for (const x of [this.bounds.min.x, this.bounds.max.x])
      for (const y of [this.bounds.min.y, this.bounds.max.y])
        for (const z of [this.bounds.min.z, this.bounds.max.z]) corners.push(new Vector3(x, y, z));
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(this.camera);
      const sx = ((p.x + 1) / 2) * w;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
    }
    const objs = this.visibleObjects();
    const placed: PlacedLabel[] = [];
    const cam = this.camera.position;
    for (const it of this.labelItems) {
      // Anchor at the middle of the patch of the named surface that the camera can actually see:
      // take camera-facing samples, keep those with a clear line of sight, then use the one
      // closest to the mean of the kept points.
      const facing = it.samples.filter((c) => c.n.dot(cam.clone().sub(c.p)) > 0 && !this.clipped(c.p));
      const stride = Math.max(1, Math.floor(facing.length / 160));
      const seen: Vector3[] = [];
      for (let i = 0; i < facing.length; i += stride) {
        const c = facing[i];
        const dir = c.p.clone().sub(cam);
        const dist = dir.length();
        this.raycaster.set(cam, dir.normalize());
        const hit = this.firstHit(this.raycaster.intersectObjects(objs, false));
        if (hit && it.meshes.includes(hit.object.name) && hit.distance > dist - 0.03) seen.push(hit.point);
      }
      let anchor: Vector3 | null = null;
      if (seen.length >= 3) {
        const ref =
          it.mode === 'centre' ? seen.reduce((a, v) => a.add(v), new Vector3()).multiplyScalar(1 / seen.length) : it.point;
        anchor = seen.reduce((best, v) => (v.distanceToSquared(ref) < best.distanceToSquared(ref) ? v : best));
      }
      // A 'nearest' label only makes sense if the landmark itself is (almost) in view.
      if (anchor && it.mode === 'nearest' && anchor.distanceTo(it.point) > 0.14) anchor = null;
      if (!anchor) continue;
      const p = anchor.clone().project(this.camera);
      const ax = ((p.x + 1) / 2) * w;
      const ay = ((1 - p.y) / 2) * h;
      const side = ax < (minX + maxX) / 2 ? 'left' : 'right';
      placed.push({ text: it.text, anchor: new Vector2(ax, ay), side, y: ay, x: side === 'left' ? minX - 28 : maxX + 28 });
    }
    // Spread labels vertically on each side so they do not overlap.
    for (const side of ['left', 'right'] as const) {
      const col = placed.filter((l) => l.side === side).sort((a, b) => a.y - b.y);
      const gap = 24;
      for (let i = 1; i < col.length; i++) if (col[i].y - col[i - 1].y < gap) col[i].y = col[i - 1].y + gap;
      const overflow = col.length ? col[col.length - 1].y - (h - 24) : 0;
      if (overflow > 0) col.forEach((l) => (l.y -= overflow));
      col.forEach((l) => {
        l.x = Math.min(Math.max(l.x, 12), w - 12);
      });
    }
    this.onLabels(placed);
  }

  relabel() {
    this.invalidate(true);
  }

  getState() {
    return {
      layers: JSON.parse(JSON.stringify(this.layers)),
      cut: { ...this.cut },
      view: this.currentView,
      selected: this.selected,
      camera: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      visible: [...this.meshes.values()].filter((m) => m.visible).map((m) => m.name),
    };
  }

  /** For tests: material of a mesh. */
  materialOf(name: string): Material | undefined {
    return this.meshes.get(name)?.material as Material | undefined;
  }
}
