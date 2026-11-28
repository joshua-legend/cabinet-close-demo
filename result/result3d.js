// 결과 페이지 시안의 3D — 닿는 모서리 · 맞는 면 · 그 사이 틈만 짚는다
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as play from './play.js';

const data = await (await fetch('./data.json')).json();
const { focus, range, plays, scene } = data;
const hinge = scene.hinge;
const SHOWN_MM = 0.005;
const COLOR = { still: 0xe9e9e9, moving: 0xbdbdbd, partner: 0xd6d6d6, touch: 0xee0000, edge: 0x8a8a8a, hinge: 0x171717, back: 0xffffff };

const box = document.getElementById('gl');
const tagsBox = document.getElementById('tags');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
box.append(renderer.domElement);

const world = new THREE.Scene();
world.background = new THREE.Color(COLOR.back);
world.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-1, -2, 3);
world.add(sun);

const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const axis = vec(hinge.direction).normalize();
const pivot = new THREE.Group();
pivot.position.copy(vec(hinge.point));
world.add(pivot);
const pairNames = new Set(focus.pair);
const meshes = new Map();
for (const p of scene.parts) {
  const geo = new THREE.BoxGeometry(...p.size);
  const base = p.moving ? COLOR.moving : pairNames.has(p.name) ? COLOR.partner : COLOR.still;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: base, roughness: 0.9, transparent: p.moving, opacity: p.moving ? 0.85 : 1 }));
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.6 })));
  mesh.position.copy(vec(p.center));
  if (p.moving) { mesh.position.sub(pivot.position); pivot.add(mesh); } else world.add(mesh);
  meshes.set(p.name, [mesh, base, p]);
}
const pose = (deg) => pivot.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));

// ── 문제 지점 — 부품 전체를 칠하지 않고, 닿는 모서리 · 맞는 면 · 그 사이 틈만 짚는다 ──
const RED = 0xee0000;
const moverName = focus.pair.find((n) => meshes.get(n)[2].moving);
const partnerName = focus.pair.find((n) => !meshes.get(n)[2].moving);
const [moverMesh, , mover] = meshes.get(moverName);
const [, , partner] = meshes.get(partnerName);
// 닿는 모서리 — 움직이는 부품의 경첩 방향 모서리 넷 가운데 보여 줄 자리(focus.deg)에서 그 점에 가장 가까운 것
pose(focus.deg);
world.updateMatrixWorld(true);
let edgeLocal = null, best = Infinity;
for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) {
  const local = new THREE.Vector3(sx * mover.size[0], sy * mover.size[1], 0);
  const w = local.clone().applyMatrix4(moverMesh.matrixWorld);
  const d = Math.hypot(w.x - focus.point[0], w.y - focus.point[1]);
  if (d < best) { best = d; edgeLocal = local; }
}
const edge = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, mover.size[2], 16), new THREE.MeshBasicMaterial({ color: RED }));
edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
edge.position.copy(edgeLocal);
moverMesh.add(edge);
// 맞는 면 — 상대 부품에서 그 점이 놓인 면에, 모서리가 닿는 줄을 띠로
const half = partner.size.map((s) => s / 2);
const r = [0, 1].map((i) => (focus.point[i] - partner.center[i]) / half[i]);
const faceAxis = Math.abs(r[0]) > Math.abs(r[1]) ? 0 : 1;
const faceSign = Math.sign(r[faceAxis]);
const stripSize = [0, 0, mover.size[2]];
stripSize[faceAxis] = 0.8;
stripSize[1 - faceAxis] = 40;
const strip = new THREE.Mesh(new THREE.BoxGeometry(...stripSize), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.35 }));
const stripAt = [...focus.point];
stripAt[faceAxis] = partner.center[faceAxis] + faceSign * (half[faceAxis] + 0.4);
stripAt[2] = mover.center[2];
strip.position.copy(vec(stripAt));
world.add(strip);
// 틈 자 — 지금 각에서 모서리와 면 사이를 잇는 선
const gapRod = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 8), new THREE.MeshBasicMaterial({ color: 0x171717 }));
world.add(gapRod);
const edgeWorld = new THREE.Vector3(), onFace = new THREE.Vector3();
function placeGap() {
  world.updateMatrixWorld(true);
  edgeWorld.copy(edgeLocal).setZ(mover.size[2] / 2 - 1).applyMatrix4(moverMesh.matrixWorld);   // 틈 자는 문 윗면 높이에 — 위에서 내려다보면 도면처럼 보인다
  onFace.set(
    THREE.MathUtils.clamp(edgeWorld.x, partner.center[0] - half[0], partner.center[0] + half[0]),
    THREE.MathUtils.clamp(edgeWorld.y, partner.center[1] - half[1], partner.center[1] + half[1]),
    edgeWorld.z);
  const len = edgeWorld.distanceTo(onFace);
  gapRod.visible = len > 0.05;
  if (!gapRod.visible) return;
  gapRod.scale.set(1, len, 1);
  gapRod.position.copy(edgeWorld).add(onFace).multiplyScalar(0.5);
  gapRod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), onFace.clone().sub(edgeWorld).normalize());
}

// 처음 카메라 — 닫힘부터 닿는 각까지 부품이 다 들게
const bounds = new THREE.Box3();
for (let deg = 0; deg <= range.max_deg + 1e-9; deg += 15) {
  pose(Math.min(deg, range.max_deg));
  world.updateMatrixWorld(true);
  for (const [mesh] of meshes.values()) bounds.expandByObject(mesh);
}
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3()).length();

const rod = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.002, size * 0.002, bounds.max.z - bounds.min.z, 12), new THREE.MeshBasicMaterial({ color: COLOR.hinge }));
rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
rod.position.set(hinge.point[0], hinge.point[1], (bounds.min.z + bounds.max.z) / 2);
world.add(rod);

const mark = new THREE.Group();
mark.position.copy(vec(focus.point));
[[size * 0.011, 0xffffff], [size * 0.007, 0x171717]].forEach(([r, c], i) => {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: c, transparent: true, depthTest: false, depthWrite: false }));
  ball.renderOrder = 10 + i;
  mark.add(ball);
});
world.add(mark);

const camera = new THREE.PerspectiveCamera(35, 4 / 3, size / 500, size * 50);
camera.up.set(0, 0, 1);
// 세로로 긴 화면(휴대폰)이면 더 물러선다 — 장 전체가 좁은 폭에 들게
const fitAspect = box.clientWidth / Math.max(box.clientHeight, 1);
camera.position.copy(center).add(new THREE.Vector3(-0.35, -1, 0.75).normalize().multiplyScalar(size * 1.35 * Math.max(1, 1.3 / fitAspect)));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(center);
controls.zoomToCursor = true;
controls.update();

// 이름표 — 부품 이름 대신 문제 지점 셋에만
const tagOf = new Map();
const newTag = (cls) => tagsBox.appendChild(Object.assign(document.createElement('span'), { className: `tag ${cls}` }));
const edgeTag = newTag('pin'), faceTag = newTag('pin'), gapTag = newTag('gaptag');
const focusTag = newTag('hidden');
focusTag.hidden = true;
const tmp = new THREE.Vector3();
// 앞서 놓은 이름표를 덮으면 그 밑으로 비킨다 (page.js 의 put 과 같은 생각)
function place(node, where, taken, dy = 0) {
  tmp.copy(where).project(camera);
  const on = Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1 && tmp.z <= 1;
  node.hidden = !on;
  if (!on) return;
  const w = node.offsetWidth, h = node.offsetHeight;
  const x = (tmp.x + 1) / 2 * box.clientWidth - w / 2;
  let y = (1 - tmp.y) / 2 * box.clientHeight - h / 2 + dy;
  for (let n = 0; n <= taken.length; n++) {
    const hit = taken.find((r) => x < r.x + r.w + 4 && r.x < x + w + 4 && y < r.y + r.h + 4 && r.y < y + h + 4);
    if (!hit) break;
    y = hit.y + hit.h + 4;
  }
  taken.push({ x, y, w, h });
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}
let touchedNow = new Set();
function draw() {
  renderer.render(world, camera);
  const taken = [];
  const top = edgeWorld.clone().setZ(mover.center[2] + mover.size[2] * 0.42);
  place(edgeTag, top, taken, -14);
  place(faceTag, strip.position.clone().setZ(mover.center[2] - mover.size[2] * 0.42), taken, 14);
  place(gapTag, edgeWorld.clone().add(onFace).multiplyScalar(0.5), taken, -22);
}
function resize() {
  const w = box.clientWidth, h = box.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
controls.addEventListener('change', draw);
new ResizeObserver(() => { resize(); draw(); }).observe(box);

// 지금 각 — 3D · 돋보기 글 · 막대가 같이
const seek = document.getElementById('seek');
seek.max = range.max_deg;
const pairKey = (pair) => [...pair].sort().join('\n');
const FOCUS_KEY = pairKey(data.gaps.pair);
function show(deg) {
  deg = Math.min(Math.max(deg, 0), range.max_deg);
  pose(deg);
  const gap = play.gapAt(data.gaps, deg);
  const names = new Set();
  for (const pair of play.markAt(data.marks, deg).touching) if (pairKey(pair) !== FOCUS_KEY) pair.forEach((n) => names.add(n));
  if (gap != null && gap < SHOWN_MM) data.gaps.pair.forEach((n) => names.add(n));
  touchedNow = names;
  const hit = names.has(moverName) && names.has(partnerName);
  strip.material.opacity = hit ? 0.95 : 0.35;
  edgeTag.textContent = `${moverName} 경첩 쪽 바깥 모서리`;
  faceTag.textContent = `${partnerName} 앞면 — 모서리가 와서 치는 줄`;
  gapTag.textContent = gap == null ? '' : gap < SHOWN_MM ? '닿음 · 틈 0' : `틈 ${gap.toFixed(2)} mm`;
  gapTag.classList.toggle('hit', hit);
  placeGap();
  seek.value = deg;
  document.getElementById('deg').textContent = `${deg.toFixed(2)}°`;
  document.getElementById('gap').textContent = gap == null ? '—' : gap < SHOWN_MM ? '닿음' : `틈 ${gap.toFixed(2)} mm`;
  draw();
}

// 재생 — 도구가 미리 담은 자취를 그대로 (끝 5° 는 느리게)
let raf = 0;
function run(name) {
  cancelAnimationFrame(raf);
  const p = plays[name];
  if (!p) return;
  const frames = play.slowed(p.frames, p.frames[p.frames.length - 1][1]);
  const total = play.duration(frames);
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min((now - t0) / 1000, total);
    show(play.degAt(frames, t));
    if (t < total) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
document.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => run(b.dataset.play)));
seek.addEventListener('input', () => { cancelAnimationFrame(raf); show(Number(seek.value)); });

// 카메라 — 문제 지점 크게 · 전체 보기 (0.8 초에 옮긴다)
const home = { pos: camera.position.clone(), target: controls.target.clone() };
function fly(pos, target) {
  const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
  const step = (now) => {
    const k = Math.min((now - start) / 800, 1), e = 1 - (1 - k) ** 3;
    camera.position.lerpVectors(p0, pos, e);
    controls.target.lerpVectors(t0, target, e);
    controls.update();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
document.getElementById('zoom-in').addEventListener('click', () => {
  // 위에서 내려다본다 — 도면의 단면처럼 모서리와 면 사이의 틈이 보인다
  const target = new THREE.Vector3(focus.point[0], focus.point[1], mover.center[2] + mover.size[2] / 2);
  const out = new THREE.Vector3();
  out.setComponent(faceAxis, faceSign);
  mark.visible = false;
  fly(target.clone().addScaledVector(out, 90).add(new THREE.Vector3(0, 0, 260)), target);
});
document.getElementById('zoom-out').addEventListener('click', () => { mark.visible = true; fly(home.pos, home.target); });

show(focus.deg);
