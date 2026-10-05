import {
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  Intersection,
  Material,
  Mesh,
  MeshBasicMaterial,
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
import { ActivationEngine, ActivationResult, NWAVE, UNREACHED } from '../engine/activation';
import { CONDUCTION, MYOCARDIUM, PaletteId, applyActivation, paletteTexture, shared } from '../engine/material';

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
  conduction: boolean;
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
  mode: 'centre' | 'nearest' | 'always';
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
    conduction: false,
    labels: false,
  };
  readonly cut: CutState = { mode: 'off', offset: 0 };

  onSelect: (mesh: string | null) => void = () => {};
  onHover: (mesh: string | null, x: number, y: number) => void = () => {};
  onLabels: (labels: PlacedLabel[]) => void = () => {};
  onViewChange: (id: string | null) => void = () => {};
  onTime: (t: number) => void = () => {};
  onPlayState: (playing: boolean) => void = () => {};

  /** Playhead for the activation animation. Times are in milliseconds of heart time. */
  readonly playback = { t: 0, playing: false, speed: 0.05, loop: true, duration: 1000, guided: true };
  /** Guided playback: the sequence events, each with the real time (ms) to hold on it so it can be read. */
  private guide: { t: number; dwell: number }[] = [];
  private hold = 0;
  private heldIdx = -1;
  style: 'live' | 'map' = 'live';
  private engine: ActivationEngine | null = null;
  private ghosts = new Map<string, Mesh>();
  private pathMid = new Map<string, Vector3>();
  private lastFrame = 0;
  private substrates = new Set<string>();
  private focusLabels = new Set<string>();
  private paletteTex = shared.uMapTex.value;

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
    // Shift + wheel pans (a trackpad has no right button, and its two-finger scroll zooms).
    this.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.panBy(e.deltaX * 0.0015, -(e.deltaY || e.deltaX) * 0.0015);
      },
      { capture: true, passive: false },
    );
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
      if (info.group === 'epicardium' || info.group === 'endocardium') {
        const atrial = info.chamber === 'RA' || info.chamber === 'LA';
        applyActivation(front, { apd: atrial ? 190 : 280, width: 20, tail: 70, front: '', act: '', refr: '', palette: MYOCARDIUM });
        this.initTimeAttributes(mesh.geometry);
      }
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

  private setupConductionLabels() {
    for (const st of STRUCTURES) {
      if ((st.group !== 'conduction' && st.group !== 'substrate') || !st.label || !st.pathKey) continue;
      const p = this.pathMid.get(st.pathKey);
      if (p) this.labelItems.push({ text: st.label, point: p, meshes: [st.mesh], mode: 'always', samples: [] });
    }
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


  // ---------------------------------------------------------------- activation

  private initTimeAttributes(g: BufferGeometry) {
    const n = g.getAttribute('position').count;
    for (let k = 0; k < NWAVE / 4; k++) g.setAttribute(`aT${k}`, new BufferAttribute(new Float32Array(n * 4).fill(UNREACHED), 4));
    g.setAttribute('aHL', new BufferAttribute(new Float32Array(n), 1));
  }

  /** Conduction system tubes (cs_* meshes), each with a faint see-through twin so the structures
   *  stay readable through the wall. */
  async loadConduction(url: string, engine: ActivationEngine): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.engine = engine;
    const meta = engine.graph.meta;
    for (const [k, p] of Object.entries(meta.paths)) this.pathMid.set(k, new Vector3(...p.mid).multiplyScalar(0.01));
    for (const [k, p] of Object.entries(meta.purkinje)) this.pathMid.set(k, new Vector3(...p.centre).multiplyScalar(0.01));
    this.pathMid.set('scar', new Vector3(...(meta as any).scar.centre).multiplyScalar(0.01));
    const parent = new Object3D();
    gltf.scene.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const info = BY_MESH[mesh.name];
      if (!info) return;
      (mesh.geometry as any).computeBoundsTree();
      this.initTimeAttributes(mesh.geometry);
      const base = new Color(info.color);
      this.baseColor.set(mesh.name, base);
      const fine = mesh.name.startsWith('cs_Purkinje');
      if (mesh.name === 'sub_scar') {
        // Scar: desaturated slate with a subtle hatch, drawn on the endocardium and, faintly, through the wall.
        const m = new MeshPhysicalMaterial({ color: base.clone(), roughness: 0.9, metalness: 0, side: DoubleSide });
        m.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.86, step(0.5, fract((vObj.x + vObj.y + vObj.z) * 70.0)));');
        };
        m.customProgramCacheKey = () => 'scar-hatch';
        mesh.material = m;
        mesh.renderOrder = 3;
        const sg = new Mesh(mesh.geometry, new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: DoubleSide }));
        sg.raycast = () => {};
        sg.renderOrder = 6;
        this.meshes.set(mesh.name, mesh);
        this.ghosts.set(mesh.name, sg);
        parent.add(sg);
        return;
      }
      const mk = (ghost: boolean) => {
        // The see-through twin is unlit so the yellow reads as a clean overlay on the pink wall.
        const m = ghost
          ? new MeshBasicMaterial({ color: base.clone(), side: DoubleSide, transparent: true, opacity: fine ? 0.16 : 0.34, depthTest: false, depthWrite: false })
          : new MeshPhysicalMaterial({ color: base.clone(), roughness: 0.5, metalness: 0, side: DoubleSide });
        applyActivation(m, { apd: meta.constants.apd_conduction, width: 16, tail: 50, front: '', act: '', refr: '', palette: CONDUCTION });
        return m;
      };
      mesh.material = mk(false);
      mesh.renderOrder = 3;
      const ghost = new Mesh(mesh.geometry, mk(true));
      ghost.name = `${mesh.name}__ghost`;
      ghost.raycast = () => {};
      ghost.renderOrder = 6;
      this.meshes.set(mesh.name, mesh);
      this.ghosts.set(mesh.name, ghost);
      parent.add(ghost);
    });
    this.scene.add(gltf.scene, parent);
    this.setupConductionLabels();
    this.applyLayers();
  }

  /** Push solver output to the GPU: per-vertex activation times for every mapped mesh. */
  setActivation(result: ActivationResult, constants?: Record<string, number>) {
    const engine = this.engine;
    if (!engine) return;
    const c = constants ?? engine.constants;
    for (const [name, mesh] of this.meshes) {
      const times = engine.vertexTimes(name, result);
      const info = BY_MESH[name];
      const own = (mesh.material as MeshPhysicalMaterial).userData.activation;
      if (own) {
        own.uAPD.value = info.group === 'conduction' || info.group === 'substrate' ? c.apd_conduction : info.chamber === 'RA' || info.chamber === 'LA' ? c.apd_atrial : c.apd_ventricular;
      }
      if (!times) continue;
      const n = times.length / NWAVE;
      for (let k = 0; k < NWAVE / 4; k++) {
        const a = mesh.geometry.getAttribute(`aT${k}`) as BufferAttribute;
        const arr = a.array as Float32Array;
        for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) arr[i * 4 + j] = times[i * NWAVE + 4 * k + j];
        a.needsUpdate = true;
      }
    }
    for (const ghost of this.ghosts.values()) {
      const own = (ghost.material as Material).userData.activation;
      if (own) own.uAPD.value = c.apd_conduction;
    }
    this.invalidate();
  }

  /** Which substrate meshes (sub_*) a scenario shows. */
  setSubstrates(names: string[]) {
    this.substrates = new Set(names);
    this.applyLayers();
  }

  /** Tint the surface where the named regions (masks in the activation graph) lie. */
  setHighlight(masks: string[]) {
    const engine = this.engine;
    if (!engine) return;
    const g = engine.graph;
    const member = new Set<number>();
    for (const m of masks) for (const id of g.masks[m] ?? []) member.add(id);
    for (const [name, mesh] of this.meshes) {
      const map = g.maps[name];
      const attr = mesh.geometry.getAttribute('aHL') as BufferAttribute | undefined;
      if (!map || !attr || map.k !== 3 || !map.w) continue;
      const n = map.idx.length / 3;
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let j = 0; j < 3; j++) if (member.has(map.idx[3 * i + j])) v += map.w[3 * i + j];
        attr.setX(i, masks.length ? v : 0);
      }
      attr.needsUpdate = true;
    }
    shared.uHLAmt.value = masks.length ? 0.55 : 0;
    this.invalidate();
  }

  setStyle(style: 'live' | 'map') {
    this.style = style;
    shared.uMode.value = style === 'map' ? 1 : 0;
    this.invalidate();
  }

  setPalette(id: PaletteId) {
    this.paletteTex?.dispose();
    this.paletteTex = paletteTexture(id);
    shared.uMapTex.value = this.paletteTex;
    this.invalidate();
  }

  setMapRange(min: number, max: number) {
    shared.uMapMin.value = min;
    shared.uMapMax.value = max;
    this.invalidate();
  }

  setGuide(events: { t: number; dwell: number }[]) {
    this.guide = [...events].sort((a, b) => a.t - b.t);
    this.hold = 0;
    this.heldIdx = this.lastEventAt(this.playback.t - 1);
  }

  setGuided(on: boolean) {
    this.playback.guided = on;
    this.hold = 0;
  }

  private lastEventAt(t: number) {
    let k = -1;
    for (let i = 0; i < this.guide.length; i++) if (this.guide[i].t <= t + 0.5) k = i;
    return k;
  }

  setTime(ms: number) {
    const p = this.playback;
    p.t = Math.max(0, Math.min(p.duration, ms));
    this.hold = 0; // a jump (scrub, step, start) cancels any hold
    this.heldIdx = this.lastEventAt(p.t - 1); // events strictly before the playhead count as already read
    shared.uTime.value = p.t;
    this.onTime(p.t);
    this.invalidate();
  }

  /** Called just before playback starts; the UI uses it to return to a scenario's intended starting state. */
  onBeforePlay: () => void = () => {};

  play() {
    this.onBeforePlay();
    if (this.playback.t >= this.playback.duration - 1) this.setTime(0);
    this.playback.playing = true;
    this.lastFrame = performance.now();
    // starting on an event (usually t = 0): read it before moving on
    if (this.playback.guided && this.hold <= 0) {
      const i = this.guide.findIndex((e) => Math.abs(e.t - this.playback.t) < 0.5);
      if (i >= 0 && i !== this.heldIdx) {
        this.hold = this.guide[i].dwell;
        this.heldIdx = i;
      }
    }
    this.onPlayState(true);
    this.invalidate();
  }

  pause() {
    this.playback.playing = false;
    this.onPlayState(false);
  }

  togglePlay() {
    if (this.playback.playing) this.pause();
    else this.play();
  }

  /** Fly the camera to look at a conduction structure (or any scene-unit point). */
  focusOn(point: Vector3, distance = 1.7) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(dir, distance, point.clone());
    this.currentView = null;
    this.onViewChange(null);
  }

  focusStructure(mesh: string) {
    const key = BY_MESH[mesh]?.pathKey;
    const p = key ? this.pathMid.get(key) : null;
    if (p) this.focusOn(p);
  }

  /** Free camera placement for the guided tour: direction towards the camera, distance and target. */
  /** Slide the view across the heart; amounts are fractions of the viewing distance. */
  panBy(right: number, up: number) {
    this.tween = null;
    const d = this.camera.position.distanceTo(this.controls.target);
    const r = new Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const u = new Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const off = r.multiplyScalar(right * d).addScaledVector(u, up * d);
    this.controls.target.add(off);
    this.camera.position.add(off);
    this.camera.updateMatrixWorld();
  }

  setCamera(dir: Vector3, distance: number, target: Vector3 | null = null, animate = true) {
    this.flyTo(dir, distance, target ?? this.center.clone(), animate);
    this.currentView = null;
    this.onViewChange(null);
  }

  get heartCentre() {
    return this.center.clone();
  }

  pathPoint(key: string) {
    return this.pathMid.get(key)?.clone() ?? null;
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
      else if (s.group === 'conduction') vis = L.conduction;
      else if (s.group === 'substrate') vis = this.substrates.has(name);
      mesh.visible = vis;
      const gh = this.ghosts.get(name);
      if (gh) gh.visible = vis;
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

  /** `silent` highlights without notifying the UI (used by the guided tour). */
  select(mesh: string | null, silent = false) {
    this.selected = mesh;
    this.refreshTint();
    this.invalidate();
    if (!silent) this.onSelect(mesh);
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
    if (s?.family) return STRUCTURES.filter((x) => x.family === s.family).map((x) => x.mesh);
    return [mesh];
  }

  private refreshTint() {
    const sel = this.related(this.selected);
    const hov = this.related(this.hovered);
    const sage = new Color(COLORS.highlight);
    for (const [name, mesh] of this.meshes) {
      const t = sel.includes(name) ? 0.8 : hov.includes(name) ? 0.42 : 0;
      (mesh.material as MeshPhysicalMaterial).color.copy(this.baseColor.get(name)!).lerp(sage, t);
      const gh = this.ghosts.get(name);
      if (gh) (gh.material as MeshBasicMaterial).color.copy(this.baseColor.get(name)!).lerp(sage, t);
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

  /** Playback. In guided mode it pauses on every sequence event long enough to read its caption, and
   *  crosses the quiet stretches between events quickly: a stretch never takes more than 2.5 s of real
   *  time, however slow the base speed. Close events (a few ms apart) therefore each get their own pause,
   *  and a long pause in the rhythm does not take a minute to play. */
  private stepPlayback(now: number) {
    const p = this.playback;
    if (!p.playing) return;
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold > 0) return;
    }
    let speed = p.speed;
    let nextEvent = Infinity;
    if (p.guided && this.guide.length) {
      let prev = 0;
      for (const e of this.guide) {
        if (e.t <= p.t + 0.01) prev = e.t;
        else {
          nextEvent = e.t;
          break;
        }
      }
      const end = nextEvent === Infinity ? p.duration : nextEvent;
      speed = Math.max(p.speed, (end - prev) / 2500);
    }
    let t = p.t + dt * speed;
    if (p.guided && t >= nextEvent) {
      t = nextEvent; // stop exactly on the event and hold
      const idx = this.guide.findIndex((e) => e.t === nextEvent);
      this.hold = this.guide[idx].dwell;
      this.heldIdx = idx;
    } else if (t >= p.duration) {
      if (p.loop) {
        t -= p.duration;
        this.heldIdx = -1;
        // an event at the very start is held on the way round as well
        if (p.guided && this.guide.length && this.guide[0].t <= t) {
          t = this.guide[0].t;
          this.hold = this.guide[0].dwell;
          this.heldIdx = 0;
        }
      } else {
        t = p.duration;
        p.playing = false;
        this.onPlayState(false);
      }
    }
    p.t = t;
    shared.uTime.value = t;
    this.onTime(t);
    this.dirty = true;
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
    // Cap the pixel count so a 4K projector does not make the heart heavy to draw.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2, Math.sqrt(3.6e6 / (w * h))));
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
    this.stepPlayback(now);
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
    if ((!this.layers.labels && !this.focusLabels.size) || !this.labelItems.length) {
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
    const centreDepth = this.center.clone().sub(cam).dot(this.camera.getWorldDirection(new Vector3()));
    for (const it of this.labelItems) {
      // With the Labels layer off, only the structures a scenario singles out are labelled.
      if (!this.layers.labels && !this.focusLabels.has(it.meshes[0])) continue;
      if (it.mode === 'always') {
        // Conduction structures sit inside the wall, so occlusion by the surface is ignored; hide
        // those on the far side of the heart instead.
        const grp = BY_MESH[it.meshes[0]]?.group;
        if (grp === 'substrate' ? !this.substrates.has(it.meshes[0]) : !this.layers.conduction) continue;
        const depth = it.point.clone().sub(cam).dot(this.camera.getWorldDirection(new Vector3()));
        // With a cutaway the inside is open, so only the clipped-away ones are dropped.
        if (this.clipped(it.point) || (this.cut.mode === 'off' && !this.focusLabels.has(it.meshes[0]) && depth > centreDepth + 0.1)) continue;
        const pp = it.point.clone().project(this.camera);
        const ax2 = ((pp.x + 1) / 2) * w;
        const ay2 = ((1 - pp.y) / 2) * h;
        const side2 = ax2 < (minX + maxX) / 2 ? 'left' : 'right';
        placed.push({ text: it.text, anchor: new Vector2(ax2, ay2), side: side2, y: ay2, x: side2 === 'left' ? minX - 28 : maxX + 28 });
        continue;
      }
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
      // Keep the text on screen when the heart is zoomed past the edges of the stage.
      col.forEach((l) => {
        l.x = side === 'left' ? Math.min(Math.max(l.x, 190), w - 40) : Math.max(Math.min(l.x, w - 190), 40);
      });
    }
    this.onLabels(placed);
  }

  /** Meshes that are always labelled (a scenario's key structures), whatever the Labels layer says. */
  setFocusLabels(names: string[]) {
    this.focusLabels = new Set(names);
    this.invalidate(true);
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
      time: this.playback.t,
      playing: this.playback.playing,
      style: this.style,
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
