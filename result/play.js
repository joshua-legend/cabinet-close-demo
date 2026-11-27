// 결과 페이지의 작은 계산 — 화면(DOM · three) 없이 숫자만 다룬다. 단위는 mm · 도 · 초.

// [[t, 각], …] 을 곧게 이어 t 초의 각. 범위 밖은 양 끝 값
export function degAt(frames, t) {
  if (t <= frames[0][0]) return frames[0][1];
  const last = frames[frames.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (frames[i][0] < t) i++;
  const [t0, d0] = frames[i - 1], [t1, d1] = frames[i];
  return d0 + (d1 - d0) * (t - t0) / (t1 - t0);
}

// 마지막 t
export function duration(frames) { return frames[frames.length - 1][0]; }

// endDeg 와 withinDeg° 안(절댓값 차)인 길은 어느 쪽으로 움직이든 factor 배 느리게 편 새 frames.
// 경계를 넘는 마디는 넘는 자리에서 쪼갠다. 각은 그대로, 시간만 늘린다
export function slowed(frames, endDeg, withinDeg = 5, factor = 4) {
  const near = (d) => Math.abs(d - endDeg) <= withinDeg;
  const out = [[frames[0][0], frames[0][1]]];
  let clock = frames[0][0];
  for (let i = 1; i < frames.length; i++) {
    const [t0, d0] = frames[i - 1], [t1, d1] = frames[i];
    const dt = t1 - t0;
    const cuts = [0, 1];
    if (d0 !== d1) {
      for (const edge of [endDeg - withinDeg, endDeg + withinDeg]) {
        const f = (edge - d0) / (d1 - d0);
        if (f > 0 && f < 1) cuts.push(f);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const f0 = cuts[j - 1], f1 = cuts[j];
      const mid = d0 + (d1 - d0) * (f0 + f1) / 2;
      clock += dt * (f1 - f0) * (near(mid) ? factor : 1);
      out.push([clock, d1 === d0 ? d0 : d0 + (d1 - d0) * f1]);
    }
  }
  return out;
}

const EXACT_DEG = 1e-4;   // gaps.exact 의 각과 이만큼 안이면 그 각이다

// 그 각의 틈 — gaps.exact(도구가 그 각에서 바로 잰 [각, 틈])에 있는 각이면 그 값, 아니면 표 사이를 곧게. 범위 밖은 null
export function gapAt(gaps, deg) {
  let exact = null;
  for (const [at, mm] of gaps.exact || []) {
    const off = Math.abs(at - deg);
    if (off <= EXACT_DEG && (exact == null || off < exact[0])) exact = [off, mm];
  }
  if (exact) return exact[1];
  const n = gaps.mm.length;
  const x = (deg - gaps.from_deg) / gaps.step_deg;
  if (!(x >= -1e-9 && x <= n - 1 + 1e-9)) return null;
  const i = Math.min(Math.max(Math.floor(x), 0), n - 2);
  if (n === 1) return gaps.mm[0];
  const f = Math.min(Math.max(x - i, 0), 1);
  return gaps.mm[i] + (gaps.mm[i + 1] - gaps.mm[i]) * f;
}

// 가장 가까운 장 — {touching, overlap_mm}
export function markAt(marks, deg) {
  const i = Math.round(deg / marks.step_deg);
  return marks.frames[Math.min(Math.max(i, 0), marks.frames.length - 1)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / n); };

// 경첩 방향 k 에 수직인 두 축 [u, v], u × v = k (오른손)
export function basis(direction) {
  const k = unit(direction);
  const a = Math.abs(k[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = dot(a, k);
  const u = unit([a[0] - d * k[0], a[1] - d * k[1], a[2] - d * k[2]]);
  const v = cross(k, u);
  return [u.map((x) => x + 0), v.map((x) => x + 0)];
}

// 로드리게스 돌리기 — sim/geometry.py 의 _rotation 과 같은 쪽(오른손)
function rotate(p, point, k, deg) {
  const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const r = [p[0] - point[0], p[1] - point[1], p[2] - point[2]];
  const kr = cross(k, r), kd = dot(k, r);
  return [0, 1, 2].map((i) => point[i] + r[i] * c + kr[i] * s + k[i] * kd * (1 - c));
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const eps = 1e-9;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], q) <= eps) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

// 부품 상자(움직이면 deg 만큼 돌려)를 축에 수직인 면에 눕힌 볼록 다각형 [[a, b], …] (반시계)
export function footprint(part, hinge, deg, uv) {
  const k = unit(hinge.direction);
  const pts = [];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    let c = [part.center[0] + sx * part.size[0], part.center[1] + sy * part.size[1], part.center[2] + sz * part.size[2]];
    if (part.moving) c = rotate(c, hinge.point, k, deg);
    pts.push([dot(c, uv[0]), dot(c, uv[1])]);
  }
  return hull(pts);
}

// 그 점의 축 높이가 부품의 축 구간 안인가
export function inSlice(part, hinge, point) {
  const k = unit(hinge.direction);
  const mid = dot(part.center, k);
  const half = 0.5 * (Math.abs(k[0]) * part.size[0] + Math.abs(k[1]) * part.size[1] + Math.abs(k[2]) * part.size[2]);
  const h = dot(point, k);
  return h >= mid - half && h <= mid + half;
}

// 종이 장 수 — 0.1 mm 한 장, 적어도 1
export function sheets(mm) { return Math.max(1, Math.round(mm / 0.1)); }
