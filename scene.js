// 3D — 부품 상자 · 경첩 선 · 끌기 · 열림 막대. z 가 위, 길이는 mm 그대로.
// 움직이는 부품은 경첩 점에 둔 묶음(pivot) 안에 있고, 열림 × 다 열린 각만큼 경첩 방향 둘레로 돈다
// (오른손 법칙 — 판정의 sim/geometry.py 와 같은 쪽). 화면은 물리를 돌리지 않는다 — 서버의 tick 을 그릴 뿐이다.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toDisplay } from './units.js';

const COLOR = {
  still: 0xeadfc8,    // 안 움직이는 부품 (나무 빛)
  moving: 0xc9d6e8,   // 같이 움직이는 부품 (문)
  touch: 0xd0402b,    // 닿은 부품
  edge: 0x5d584e,
  hinge: 0x2f5d87,
  back: 0xf6f7f9,
};
const HINGE_RADIUS_MM = 3;     // 경첩 선의 굵기 (보기용)
const HINGE_PAD_MM = 60;       // 경첩 선을 부품보다 이만큼 길게
const GRID_STEP_MM = 100;
const MOVING_OPACITY = 0.78;

function vec(a) {
  return new THREE.Vector3(a[0], a[1], a[2]);
}

function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}

// grab: false 면 문을 잡지 않는다 (보기 전용 시연판 — tools/demo/). 끌면 어디서든 돌려 본다.
export function createScene(el, { onGrab, onDrag, onRelease, onSeek, grab = true,
  helpText = '문을 잡아 끈다 · 빈 곳을 끌면 돌려 본다 · 휠로 당긴다' }) {
  // ── 자리 ──
  const holder = document.createElement('div');
  holder.className = 'canvas';
  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'size';
  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = helpText;
  holder.append(sizeLabel, help);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const openLabel = document.createElement('label');
  openLabel.className = 'open';
  openLabel.append('열림 ');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '0.5';
  slider.value = '0';
  slider.setAttribute('aria-label', '열림');
  const percent = document.createElement('output');
  percent.textContent = '0%';
  openLabel.append(slider, percent);
  bar.append(openLabel);
  el.append(holder, bar);

  // ── three.js ──
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  holder.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.back);
  const camera = new THREE.PerspectiveCamera(35, 1, 5, 200000);
  camera.up.set(0, 0, 1);
  camera.position.set(-800, -2400, 1200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b8476, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1, -2, 3);
  scene.add(sun);

  // 끌기 리스너를 OrbitControls 보다 먼저 단다 — 부품을 누르면 controls 를 꺼서 돌지 않게
  const canvas = renderer.domElement;
  if (grab) {
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('lostpointercapture', pointerUp);
  }
  const controls = new OrbitControls(camera, canvas);

  let content = null;           // 지금 제품의 모든 것
  let pivot = null;             // 경첩 점에 둔 묶음
  let axis = new THREE.Vector3(0, 0, 1);
  let openRad = 0;
  let meshes = new Map();       // 부품 이름 → 상자
  let movingMeshes = [];
  let fraction = 0;
  let touchKey = '';
  let unit = 'mm';
  let sizeMm = null;
  let fitted = false;

  // ── 제품 ──
  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  function setScene(s) {
    if (content) {
      scene.remove(content);
      dispose(content);
    }
    content = new THREE.Group();
    meshes = new Map();
    movingMeshes = [];
    touchKey = '';
    const point = vec(s.hinge.point);
    axis = vec(s.hinge.direction).normalize();
    openRad = THREE.MathUtils.degToRad(s.hinge.open_deg);
    pivot = new THREE.Group();
    pivot.position.copy(point);
    content.add(pivot);

    const bounds = new THREE.Box3();
    for (const p of s.parts) {
      const geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
      const base = p.moving ? COLOR.moving : COLOR.still;
      // 움직이는 부품은 조금 비치게 — 문 뒤에서 닿은 부품(빨강)이 보이게
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: base, roughness: 0.85,
        transparent: p.moving, opacity: p.moving ? MOVING_OPACITY : 1 }));
      mesh.userData = { name: p.name, moving: p.moving, base };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.55 }));
      mesh.add(edges);
      const center = vec(p.center);
      if (p.moving) {
        mesh.position.copy(center).sub(point);
        pivot.add(mesh);
        movingMeshes.push(mesh);
      } else {
        mesh.position.copy(center);
        content.add(mesh);
      }
      meshes.set(p.name, mesh);
      const half = vec(p.size).multiplyScalar(0.5);
      bounds.expandByPoint(center.clone().sub(half)).expandByPoint(center.clone().add(half));
    }

    // 경첩 선 — 부품을 옮겨도 따라가지 않으니, 엉뚱한 자리면 눈에 보이게 그린다
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of corners(bounds)) {
      const t = c.sub(point).dot(axis);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    lo -= HINGE_PAD_MM;
    hi += HINGE_PAD_MM;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(HINGE_RADIUS_MM, HINGE_RADIUS_MM, hi - lo, 12),
      new THREE.MeshBasicMaterial({ color: COLOR.hinge }));
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    rod.position.copy(point).addScaledVector(axis, (lo + hi) / 2);
    content.add(rod);

    // 바닥 눈금 (z = 0)
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.ceil((Math.max(size.x, size.y) * 2.4) / GRID_STEP_MM / 2) * 2 * GRID_STEP_MM;
    const grid = new THREE.GridHelper(span, span / GRID_STEP_MM, 0xc9ced6, 0xe2e5ea);
    grid.rotation.x = Math.PI / 2;
    const mid = bounds.getCenter(new THREE.Vector3());
    grid.position.set(Math.round(mid.x / GRID_STEP_MM) * GRID_STEP_MM, Math.round(mid.y / GRID_STEP_MM) * GRID_STEP_MM, 0);
    content.add(grid);

    scene.add(content);
    sizeMm = size;
    showSize();
    pose();
    if (!fitted) {
      fit(bounds);
      fitted = true;
    }
  }

  function corners(box) {
    const out = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
      }
    }
    return out;
  }

  function fit(bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    // 세로 · 가로 시야 가운데 좁은 쪽에 맞춘다 — 세로로 긴 화면(전화)에서 옆이 잘리지 않게
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.05;
    const from = new THREE.Vector3(-0.55, -1.6, 0.8).normalize();
    camera.position.copy(center).addScaledVector(from, dist);
    controls.target.copy(center);
    controls.update();
  }

  function showSize() {
    if (!sizeMm) return;
    const f = (mm) => toDisplay(mm, unit);
    sizeLabel.textContent = `크기 ${f(sizeMm.x)} × ${f(sizeMm.y)} × ${f(sizeMm.z)} ${unit}`;
  }

  function setUnit(u) {
    unit = u;
    showSize();
  }

  // ── 열림 · 닿음 ──
  function pose() {
    if (pivot) pivot.quaternion.setFromAxisAngle(axis, fraction * openRad);
  }

  function setTick(t) {
    fraction = t.fraction;
    pose();
    const touched = new Set(t.touching.flat());
    const key = [...touched].sort().join('\n');
    if (key !== touchKey) {
      touchKey = key;
      for (const [name, mesh] of meshes) {
        mesh.material.color.setHex(touched.has(name) ? COLOR.touch : mesh.userData.base);
      }
    }
    if (!sliding) slider.value = String(clamp01(fraction) * 100);
    percent.textContent = `${Math.round(clamp01(fraction) * 100)}%`;
  }

  // ── 끌기 ──
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let dragging = null;          // { plane, pointerId }
  let pendingDrag = null;       // 이 장에 보낼 목표 (mm)

  function aim(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }

  function pointerDown(e) {
    if (e.button !== 0 || !movingMeshes.length) return;
    aim(e);
    const hit = ray.intersectObjects(movingMeshes, false)[0];
    if (!hit) return;               // 빈 곳 — OrbitControls 가 돌린다
    controls.enabled = false;
    const p = hit.point;
    // 잡은 점을 지나고 경첩 방향에 수직인 면 — 문이 돌아도 잡은 점은 이 면 위에 있다
    dragging = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axis, p), pointerId: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    onGrab(hit.object.userData.name, [p.x, p.y, p.z]);
  }

  function pointerMove(e) {
    aim(e);
    if (!dragging) {
      canvas.style.cursor = movingMeshes.length && ray.intersectObjects(movingMeshes, false).length ? 'grab' : '';
      return;
    }
    const target = ray.ray.intersectPlane(dragging.plane, new THREE.Vector3());
    if (target) pendingDrag = [target.x, target.y, target.z];
  }

  function pointerUp(e) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    if (pendingDrag) {
      onDrag(pendingDrag);
      pendingDrag = null;
    }
    dragging = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    onRelease();
  }

  // ── 열림 막대 ──
  let sliding = false;
  let pendingSeek = null;
  slider.addEventListener('pointerdown', () => { sliding = true; });
  slider.addEventListener('input', () => { pendingSeek = Number(slider.value) / 100; });
  for (const end of ['pointerup', 'pointercancel', 'change', 'blur']) {
    slider.addEventListener(end, () => { sliding = false; });
  }

  // ── 그리기 — 끌기 · 막대는 화면 한 장마다 한 번만 보낸다 ──
  function resize() {
    const w = holder.clientWidth;
    const h = holder.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(holder);
  resize();

  function frame() {
    if (dragging && pendingDrag) {
      onDrag(pendingDrag);
      pendingDrag = null;
    }
    if (pendingSeek !== null) {
      onSeek(pendingSeek);
      pendingSeek = null;
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { setScene, setTick, setUnit };
}
