import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DecodedPointBuffer, DemGrid } from "@massefelt/geometry";
import type { Vec3 } from "@massefelt/shared";
import { elevationColors } from "./colors";

export interface ViewerSettings {
  pointSize: number;
  showGrid: boolean;
  showAxes: boolean;
}

export interface PickResult {
  /** World coordinates (project CRS), reconstructed in Float64. */
  world: Vec3;
  scanId: string;
  pointIndex: number;
}

export interface ViewerCallbacks {
  onHover?: (pick: PickResult | null) => void;
  onPick?: (pick: PickResult) => void;
}

interface CloudEntry {
  scanId: string;
  points: THREE.Points;
  origin: Vec3;
}

const MARKER_COLORS = { a: 0xf97316, b: 0x22d3ee, line: 0xfacc15 };

export interface OverlayStyle {
  color: number;
  closed?: boolean;
  /** Draw vertex markers. */
  markers?: boolean;
}

interface SurfaceEntry {
  mesh: THREE.Mesh;
  originX: number;
  originY: number;
  zOrigin: number;
}

/**
 * Framework-agnostic Three.js point-cloud viewer.
 *
 * Coordinate handling: data is Z-up (survey convention), so the camera's up
 * vector is +Z. Each cloud arrives as Float32 positions relative to its own
 * Float64 origin; the scene uses the first cloud's origin as scene origin and
 * offsets other clouds, so large projected coordinates never lose precision
 * on the GPU. Picks are converted back to world coordinates in Float64.
 *
 * Extension points (planned): orthographic top view (swap camera), clipping /
 * section planes (renderer.clippingPlanes), mesh layers, object placement.
 */
export class PointCloudViewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly clouds = new Map<string, CloudEntry>();
  private sceneOrigin: Vec3 | null = null;
  private grid: THREE.GridHelper | null = null;
  private axes: THREE.AxesHelper | null = null;
  private readonly overlay = new THREE.Group();
  private readonly overlays = new Map<string, THREE.Group>();
  private readonly surfaces = new Map<string, SurfaceEntry>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private settings: ViewerSettings = { pointSize: 2, showGrid: true, showAxes: true };
  private pickingEnabled = false;
  private hoverPending = false;
  private lastPointer: { x: number; y: number } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private frame = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ViewerCallbacks = {},
  ) {
    this.scene.background = new THREE.Color(0x0b1220);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 100_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-30, -30, 25);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    // Full 360° azimuth and the full 0–180° polar range.
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.zoomToCursor = true;

    this.scene.add(this.overlay);
    this.scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1, -1.5, 2);
    this.scene.add(sun);
    this.rebuildHelpers(50, 0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handlePointerMove);
    el.addEventListener("pointerdown", this.handlePointerDown);
    el.addEventListener("pointerup", this.handlePointerUp);
    el.addEventListener("pointerleave", this.handlePointerLeave);

    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  // ───────────── data ─────────────

  addPointCloud(scanId: string, data: DecodedPointBuffer): void {
    this.removePointCloud(scanId);
    if (!this.sceneOrigin) this.sceneOrigin = { ...data.origin };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    let colors: Float32Array;
    if (data.colors) {
      colors = new Float32Array(data.count * 3);
      for (let i = 0; i < data.count * 3; i++) colors[i] = data.colors[i]! / 255;
    } else {
      colors = elevationColors(data.positions, data.count);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const material = new THREE.PointsMaterial({
      size: this.settings.pointSize,
      sizeAttenuation: false,
      vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = `scan:${scanId}`;
    points.position.set(
      data.origin.x - this.sceneOrigin.x,
      data.origin.y - this.sceneOrigin.y,
      data.origin.z - this.sceneOrigin.z,
    );
    this.scene.add(points);
    this.clouds.set(scanId, { scanId, points, origin: data.origin });
    this.fitHelpersToContent();
  }

  removePointCloud(scanId: string): void {
    const entry = this.clouds.get(scanId);
    if (!entry) return;
    this.scene.remove(entry.points);
    entry.points.geometry.dispose();
    (entry.points.material as THREE.Material).dispose();
    this.clouds.delete(scanId);
    if (this.clouds.size === 0 && this.surfaces.size === 0) this.sceneOrigin = null;
  }

  hasPointCloud(scanId: string): boolean {
    return this.clouds.has(scanId);
  }

  setCloudVisible(scanId: string, visible: boolean): void {
    const entry = this.clouds.get(scanId);
    if (entry) entry.points.visible = visible;
  }

  // ───────────── settings ─────────────

  applySettings(settings: ViewerSettings): void {
    this.settings = settings;
    for (const { points } of this.clouds.values()) {
      (points.material as THREE.PointsMaterial).size = settings.pointSize;
    }
    if (this.grid) this.grid.visible = settings.showGrid;
    if (this.axes) this.axes.visible = settings.showAxes;
  }

  setPickingEnabled(enabled: boolean): void {
    this.pickingEnabled = enabled;
    this.renderer.domElement.style.cursor = enabled ? "crosshair" : "default";
  }

  /** Fit the camera to all visible clouds (perspective, oblique view from south-west). */
  resetView(): void {
    const box = new THREE.Box3();
    for (const { points } of this.clouds.values()) {
      if (points.visible) box.expandByObject(points);
    }
    for (const { mesh } of this.surfaces.values()) {
      if (mesh.visible) box.expandByObject(mesh);
    }
    if (box.isEmpty()) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(-30, -30, 25);
    } else {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.5);
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
      const dir = new THREE.Vector3(-1, -1.2, 0.9).normalize();
      this.controls.target.copy(sphere.center);
      this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
      this.camera.near = Math.max(dist / 10_000, 0.01);
      this.camera.far = dist * 100;
      this.camera.updateProjectionMatrix();
    }
    this.camera.up.set(0, 0, 1);
    this.controls.update();
  }

  // ───────────── overlays ─────────────

  /** Draw a measurement (markers + segment) from world coordinates. */
  showMeasurement(points: Vec3[]): void {
    this.clearMeasurement();
    if (!this.sceneOrigin || points.length === 0) return;
    const local = points.map((p) => this.worldToScene(p));
    const markerColors = [MARKER_COLORS.a, MARKER_COLORS.b];
    local.forEach((p, i) => {
      const g = new THREE.BufferGeometry().setFromPoints([p]);
      const m = new THREE.PointsMaterial({
        size: 12,
        sizeAttenuation: false,
        color: markerColors[i % 2],
        depthTest: false,
      });
      const marker = new THREE.Points(g, m);
      marker.renderOrder = 10;
      this.overlay.add(marker);
    });
    if (local.length >= 2) {
      const g = new THREE.BufferGeometry().setFromPoints(local);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: MARKER_COLORS.line, depthTest: false }));
      line.renderOrder = 9;
      this.overlay.add(line);
    }
  }

  clearMeasurement(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      const obj = child as THREE.Points | THREE.Line;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  /** Draw a named polyline/polygon overlay from world coordinates (replaces an existing one with the same key). */
  showOverlay(key: string, points: Vec3[], style: OverlayStyle): void {
    this.clearOverlay(key);
    if (points.length === 0) return;
    this.ensureOrigin(points[0]!);
    const local = points.map((p) => this.worldToScene(p));
    const group = new THREE.Group();
    group.renderOrder = 8;
    if (local.length >= 2) {
      const g = new THREE.BufferGeometry().setFromPoints(local);
      const material = new THREE.LineBasicMaterial({ color: style.color, depthTest: false });
      const line = style.closed && local.length >= 3 ? new THREE.LineLoop(g, material) : new THREE.Line(g, material);
      line.renderOrder = 9;
      group.add(line);
    }
    if (style.markers !== false) {
      const g = new THREE.BufferGeometry().setFromPoints(local);
      const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, color: style.color, depthTest: false }));
      m.renderOrder = 10;
      group.add(m);
    }
    this.scene.add(group);
    this.overlays.set(key, group);
  }

  clearOverlay(key: string): void {
    const group = this.overlays.get(key);
    if (!group) return;
    this.scene.remove(group);
    group.traverse((o) => {
      const obj = o as THREE.Mesh;
      obj.geometry?.dispose();
      (obj.material as THREE.Material | undefined)?.dispose();
    });
    this.overlays.delete(key);
  }

  /** Add a DEM grid as a shaded, semi-transparent terrain mesh (vertices at cell centres). */
  addSurface(id: string, grid: DemGrid): void {
    this.removeSurface(id);
    let zOrigin = Infinity;
    for (const v of grid.z) if (!Number.isNaN(v) && v < zOrigin) zOrigin = v;
    if (!Number.isFinite(zOrigin)) return;
    this.ensureOrigin({ x: grid.originX, y: grid.originY, z: zOrigin });
    const { cols, rows, cellSize } = grid;
    const positions = new Float32Array(cols * rows * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        positions[k * 3] = (c + 0.5) * cellSize;
        positions[k * 3 + 1] = (r + 0.5) * cellSize;
        positions[k * 3 + 2] = Number.isNaN(grid.z[k]!) ? 0 : grid.z[k]! - zOrigin;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        if ([a, b, d, e].some((k) => Number.isNaN(grid.z[k]!))) continue;
        index.push(a, b, e, a, e, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(elevationColors(positions, cols * rows), 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    mesh.name = `surface:${id}`;
    const o = this.sceneOrigin!;
    mesh.position.set(grid.originX - o.x, grid.originY - o.y, zOrigin - o.z);
    this.scene.add(mesh);
    this.surfaces.set(id, { mesh, originX: grid.originX, originY: grid.originY, zOrigin });
    this.fitHelpersToContent();
  }

  removeSurface(id: string): void {
    const s = this.surfaces.get(id);
    if (!s) return;
    this.scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    (s.mesh.material as THREE.Material).dispose();
    this.surfaces.delete(id);
  }

  hasSurface(id: string): boolean {
    return this.surfaces.has(id);
  }

  setSurfaceVisible(id: string, visible: boolean): void {
    const s = this.surfaces.get(id);
    if (s) s.mesh.visible = visible;
  }

  /** PNG snapshot of the current view (used later by renderView / reports). */
  snapshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.handlePointerMove);
    el.removeEventListener("pointerdown", this.handlePointerDown);
    el.removeEventListener("pointerup", this.handlePointerUp);
    el.removeEventListener("pointerleave", this.handlePointerLeave);
    for (const id of [...this.clouds.keys()]) this.removePointCloud(id);
    for (const id of [...this.surfaces.keys()]) this.removeSurface(id);
    for (const key of [...this.overlays.keys()]) this.clearOverlay(key);
    this.clearMeasurement();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ───────────── internals ─────────────

  private ensureOrigin(p: Vec3): void {
    if (!this.sceneOrigin) this.sceneOrigin = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  }

  private worldToScene(p: Vec3): THREE.Vector3 {
    const o = this.sceneOrigin ?? { x: 0, y: 0, z: 0 };
    return new THREE.Vector3(p.x - o.x, p.y - o.y, p.z - o.z);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private fitHelpersToContent(): void {
    const box = new THREE.Box3();
    for (const { points } of this.clouds.values()) box.expandByObject(points);
    for (const { mesh } of this.surfaces.values()) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, 1);
    // Round grid size up to a "nice" number so cells are 1/2/5 × 10^n metres.
    const target = extent * 1.2;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= target) ?? target;
    this.rebuildHelpers(nice, box.min.z, new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z));
  }

  private rebuildHelpers(size: number, z: number, center = new THREE.Vector3(0, 0, z)): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    if (this.axes) {
      this.scene.remove(this.axes);
      this.axes.dispose();
    }
    this.grid = new THREE.GridHelper(size, 20, 0x475569, 0x1e293b);
    this.grid.rotation.x = Math.PI / 2; // XZ → XY plane (Z-up)
    this.grid.position.copy(center);
    this.grid.visible = this.settings.showGrid;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(size / 8);
    this.axes.position.copy(center);
    this.axes.visible = this.settings.showAxes;
    this.scene.add(this.axes);
  }

  private pick(clientX: number, clientY: number): PickResult | null {
    if (!this.sceneOrigin || this.clouds.size === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Threshold ≈ 6 px at the orbit target distance.
    const dist = this.camera.position.distanceTo(this.controls.target);
    const worldPerPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / rect.height;
    this.raycaster.params.Points = { threshold: Math.max(worldPerPixel * 6, 1e-4) };
    const objects = [...this.clouds.values()].filter((c) => c.points.visible).map((c) => c.points);
    const hits = this.raycaster.intersectObjects(objects, false);
    const hit = hits[0];
    if (!hit || hit.index === undefined) return null;
    const entry = [...this.clouds.values()].find((c) => c.points === hit.object);
    if (!entry) return null;
    // Snap to the actual scanned point, not the ray's closest approach.
    const attr = entry.points.geometry.getAttribute("position");
    return {
      scanId: entry.scanId,
      pointIndex: hit.index,
      world: {
        x: entry.origin.x + attr.getX(hit.index),
        y: entry.origin.y + attr.getY(hit.index),
        z: entry.origin.z + attr.getZ(hit.index),
      },
    };
  }

  private handlePointerMove = (e: PointerEvent) => {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (!this.callbacks.onHover || this.hoverPending) return;
    this.hoverPending = true;
    // Throttle hover picking to ~10 Hz; raycasting is O(n) over points.
    setTimeout(() => {
      this.hoverPending = false;
      if (this.disposed || !this.lastPointer) return;
      this.callbacks.onHover?.(this.pick(this.lastPointer.x, this.lastPointer.y));
    }, 100);
  };

  private handlePointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent) => {
    const down = this.downAt;
    this.downAt = null;
    if (!this.pickingEnabled || e.button !== 0 || !down) return;
    // Treat as a click only if the pointer barely moved (otherwise it was an orbit drag).
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const result = this.pick(e.clientX, e.clientY);
    if (result) this.callbacks.onPick?.(result);
  };

  private handlePointerLeave = () => {
    this.lastPointer = null;
    this.callbacks.onHover?.(null);
  };
}
