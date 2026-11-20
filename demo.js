// 시연판 — 서버가 없다. 두 가지로 보인다.
// 본보기 그대로: data/<제품>.json 에 미리 담은 판정 글(물리까지) · 막대 · [닫아 보기] 물리를 보인다.
// 치수를 고치면: calc-worker.js(브라우저 속 Python)가 sim.quick 으로 겹침만 다시 잰다. 물리는 없고 판정은 늘 "모름" 이다.
// 이 페이지가 스스로 판정을 만들지 않는다 — 글은 data 의 report 이거나 sim.quick 의 lines 그대로다.

import { createScene } from './scene.js';
import { parseNumber, toMm } from './units.js';

const $ = (id) => document.getElementById(id);
const names = [...$('product').options].map((o) => o.value);
const AXES = ['x', 'y', 'z'];
const SIZE_NAMES = ['너비', '깊이', '높이'];
const POS_NAMES = ['왼 x', '앞 y', '아래 z'];
const WAIT_MS = 400;          // 치기를 멈추고 이만큼 지나면 다시 잰다
const CLOSE_PER_S = 0.6;      // 계산판 [닫아 보기] — 1 초에 열림 60% 씩 고르게

let data = null;              // 미리 담은 것 (본보기 그대로일 때 보인다)
let draft = null;             // 고치는 중인 제품 파일 내용 (data.product 를 베낀 것)
let quick = null;             // 고친 치수로 잰 sim.quick 의 답 — 지금 draft 의 것이거나 그 앞의 것
let edited = false;           // draft 가 원본과 다른가
let playing = null;           // 닫아 보기를 트는 중
let fraction = 1;             // 지금 막대 자리
let loadSeq = 0;
let gen = 0;                  // 고칠 때마다 하나씩 — 늦게 온 옛 답은 버린다
let waitTimer = null;
const fieldErrors = new Map(); // 칸 → 글 (수로 못 읽었다)
let pyError = null;            // sim.quick 이 못 읽었다 { part, message }
const expanded = new Set();    // 자리를 펼친 부품 번호
window.calcTimes = { readyMs: null, runs: [] };   // 확인용 — 잰 시간

const view = createScene($('stage'), {
  grab: false,
  helpText: '끌면 돌려 본다 · 휠로 당긴다',
  onGrab() {}, onDrag() {}, onRelease() {},
  onSeek: (f) => seek(f),
});
$('stage').querySelector('.bar').append($('closeTest'));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function para(text, cls) {
  return el('p', { class: cls, text });
}

// mm 를 소수 둘째 자리까지, 끝의 0 은 뗀다 (sim/fmt.py 의 mm 과 같은 모양)
function mm(v) {
  if (v > 0 && v < 0.005) return '0.01 미만';
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// 칸에 보이는 수 — 끝자리 찌꺼기만 지운다 (toMm(…, 'mm'))
function num(v) {
  return String(toMm(v, 'mm'));
}

function setLine(id, text) {
  const line = $(id);
  if (line.textContent !== text) line.textContent = text;
  line.classList.toggle('off', !text);   // 자리는 남겨 3D 가 들썩이지 않게
}

// ── 계산 일꾼 ──
const calc = { worker: null, ready: false, failed: false, busy: false, queued: null };

function startCalc() {
  try {
    calc.worker = new Worker('calc-worker.js', { type: 'module' });
  } catch {
    calcFailed();
    return;
  }
  calc.worker.onmessage = (e) => onCalc(e.data);
  calc.worker.onerror = (e) => {
    e.preventDefault();
    if (!calc.ready) calcFailed();
  };
}

function calcFailed() {
  calc.failed = true;
  calc.queued = null;
  $('calcState').textContent = '계산을 못 불러왔다 — 인터넷이 필요하다 (본보기는 그대로 보인다)';
  $('calcState').className = 'calc fail';
  if (data) {
    resetDraft();
    renderAll();
  }
}

function onCalc(m) {
  if (m.type === 'ready') {
    calc.ready = true;
    window.calcTimes.readyMs = m.ms;
    $('calcState').textContent = '칸을 고치면 겹침을 다시 잰다 — 계산만, 물리는 PC 판';
    $('calcState').className = 'calc';
    pump();
    return;
  }
  if (m.type === 'fail') {
    calcFailed();
    return;
  }
  calc.busy = false;
  if (m.type === 'result') window.calcTimes.runs.push(m.ms);
  if (m.gen === gen && edited) {
    if (m.type === 'result' && m.result.ok) applyQuick(m.result);
    else showPyError(m.type === 'result' ? m.result.message : `계산이 멈췄다 (${m.message})`);
  }
  pump();
}

// 일꾼이 놀 때 가장 새 것 하나만 보낸다 — 치는 동안 쌓인 옛것은 보내지 않는다
function pump() {
  if (!calc.ready || calc.busy || !calc.queued) return;
  calc.busy = true;
  calc.worker.postMessage(calc.queued);
  calc.queued = null;
}

// ── 고치기 ──
function resetDraft() {
  draft = structuredClone(data.product);
  quick = null;
  edited = false;
  pyError = null;
  fieldErrors.clear();
  gen += 1;
  calc.queued = null;
  clearTimeout(waitTimer);
}

function hingeOf(d) {
  return d.joints.find((j) => j.type === 'hinge');
}

function onField(input) {
  const key = input.dataset.key;
  const value = parseNumber(input.value);
  if (value === null) {
    fieldErrors.set(key, `수로 적는다 (${input.value.trim() || '빈 칸'})`);
    input.setAttribute('aria-invalid', 'true');
    renderErrors();
    return;     // 원본도 답도 그대로 — 못 읽은 칸은 넘기지 않는다
  }
  fieldErrors.delete(key);
  input.removeAttribute('aria-invalid');
  const m = key.match(/^p(\d+)\.(size|pos)(\d)$/);
  if (m) {
    const part = draft.parts[Number(m[1])];
    const axis = AXES[Number(m[3])];
    const [lo, hi] = part[axis];
    // 크기를 고치면 왼 · 앞 · 아래 모서리는 그대로, 자리를 고치면 크기는 그대로 (PC 판과 같다)
    part[axis] = m[2] === 'size' ? [lo, toMm(lo + value, 'mm')] : [value, toMm(value + (hi - lo), 'mm')];
  } else if (key === 'open_deg') {
    hingeOf(draft).open_deg = value;
  } else if (key === 'margin_mm') {
    draft.margin_mm = value;
  }
  changed();
}

function changed() {
  if (calc.failed) return;   // 칸이 꺼져 있다 — 계산을 못 불러왔다
  gen += 1;
  edited = JSON.stringify(draft) !== JSON.stringify(data.product);
  $('reset').hidden = !edited;
  clearTimeout(waitTimer);
  calc.queued = null;
  if (!edited) {
    showOriginal();
    return;
  }
  $('verdict').classList.add('stale');
  setLine('redo', calc.ready ? '다시 재는 중…' : '계산 준비 중… (처음 한 번 10초쯤)');
  const myGen = gen;
  waitTimer = setTimeout(() => {
    if (myGen !== gen) return;
    calc.queued = { gen, text: JSON.stringify(draft) };
    pump();
  }, WAIT_MS);
}

function showPyError(message) {
  const name = message.match(/^부품 "(.+?)"/)?.[1];
  const index = name === undefined ? -1 : draft.parts.findIndex((p) => p.name === name);
  pyError = { part: index, message };
  setLine('redo', '');
  $('verdict').classList.remove('stale');   // 옛 답은 그대로 둔다
  renderErrors();
}

function applyQuick(r) {
  quick = r;
  pyError = null;
  renderErrors();
  setLine('redo', '');
  $('verdict').classList.remove('stale');
  view.setScene(r.scene);
  renderVerdict();
  playing = null;
  setLine('physics', '');
  seek(fraction);
}

function showOriginal() {
  quick = null;
  pyError = null;
  renderErrors();
  setLine('redo', '');
  $('verdict').classList.remove('stale');
  view.setScene(data);
  renderVerdict();
  playing = null;
  setLine('physics', '');
  seek(fraction);
}

// ── 막대 · 닫아 보기 ──
function show(f, touching, overlaps) {
  view.setTick({ fraction: f, touching });
  setLine('touching', touching.length ? `지금: ${touching.map((p) => p.join(' ↔ ')).join(' · ')} 에 닿았다` : '');
  let text = '';
  if (overlaps && overlaps.length) {
    const [deep, ...rest] = overlaps;   // 깊은 것부터 담겨 있다
    text = `계산: 이 열림에서는 ${deep.pair.join(' ↔ ')} 이 ${mm(deep.depth_mm)} mm 겹친다 — 실제로는 여기서 걸려 선다`;
    if (rest.length) text += ` · 그 밖에 ${rest.length}짝`;
  }
  setLine('overlap', text);
}

function sliderFrames() {
  return quick ? quick.slider : data.slider;
}

function seek(f) {
  if (!data) return;
  playing = null;
  setLine('physics', '');
  const frames = sliderFrames();
  const i = Math.min(Math.max(Math.round(f * (frames.length - 1)), 0), frames.length - 1);
  const frame = frames[i];
  fraction = frame.fraction;
  let touching = frame.touching;
  const stuck = quick && quick.first_contact_fraction === 1 ? quick.first_contact_pair : null;
  // 다 열린 자리에서 이미 겹친 짝(안 움직이는 것끼리일 수도 있다)은 막대 어디서나 빨갛게 — 막대 자료는 문 쪽 짝만 담는다
  if (stuck && !touching.some((t) => t.join() === stuck.join())) touching = [...touching, stuck];
  show(frame.fraction, touching, frame.overlaps);
}

function play() {
  if (!data) return;
  setLine('physics', '');
  if (quick) {
    // 계산판 — 물리가 아니다. 다 열린 자리에서 처음 걸리는 자리(없으면 닫힘)까지 고르게 닫는다
    const to = quick.first_contact_fraction ?? 0;
    playing = { t0: performance.now(), quick, to };
  } else {
    playing = { t0: performance.now(), frames: data.close.frames, frameS: data.close.frame_s, data };
  }
  requestAnimationFrame(tick);
}

function tick(now) {
  const p = playing;
  if (!p) return;
  // rAF 의 시각은 그 장이 시작된 때라 누른 때(t0)보다 앞설 수 있다 — 음수가 되지 않게
  const s = Math.max(0, (now - p.t0) / 1000);
  if (p.quick) {
    if (p.quick !== quick) return;
    const f = Math.max(p.to, 1 - s * CLOSE_PER_S);
    const last = f <= p.to;
    show(f, last && p.quick.first_contact_pair ? [p.quick.first_contact_pair] : [], null);
    fraction = f;
    if (last) {
      playing = null;
      setLine('physics', p.quick.close_line);
      return;
    }
  } else {
    if (p.data !== data || quick) return;
    const i = Math.floor(s / p.frameS);
    const last = i >= p.frames.length - 1;
    const f = p.frames[Math.min(i, p.frames.length - 1)];
    show(f.fraction, f.touching, null);
    fraction = f.fraction;
    if (last) {
      playing = null;
      setLine('physics', data.close.end_line);
      return;
    }
  }
  requestAnimationFrame(tick);
}

// ── 그리기 ──
function field(key, value, label, cls = '') {
  const input = el('input', { type: 'text', inputmode: 'decimal', class: `num ${cls}`.trim(), 'aria-label': label });
  input.dataset.key = key;
  input.value = value;
  if (calc.failed) input.disabled = true;
  input.addEventListener('input', () => onField(input));
  return input;
}

function renderParts() {
  const rows = [];
  draft.parts.forEach((part, i) => {
    const moving = part.group === hingeOf(draft).group;
    const sizes = AXES.map((a, k) => el('td', {},
      field(`p${i}.size${k}`, num(part[a][1] - part[a][0]), `${part.name} ${SIZE_NAMES[k]}`)));
    const open = expanded.has(i);
    const toggle = el('button', { type: 'button', class: 'more', 'aria-expanded': String(open),
      'aria-label': `${part.name} 자리 ${open ? '접기' : '펼치기'}`, text: open ? '▾' : '▸' });
    toggle.addEventListener('click', () => {
      if (expanded.has(i)) expanded.delete(i);
      else expanded.add(i);
      renderParts();
    });
    rows.push(el('tr', { class: moving ? 'moving' : '' },
      el('td', { class: 'c-name', text: part.name }), ...sizes, el('td', { class: 'c-pos' }, toggle)));
    if (open) {
      const cells = AXES.map((a, k) => el('label', { class: 'pos-field' },
        el('span', { class: 'k', text: POS_NAMES[k] }),
        field(`p${i}.pos${k}`, num(part[a][0]), `${part.name} 자리 ${POS_NAMES[k]}`)));
      rows.push(el('tr', { class: 'pos' }, el('td', { colspan: '5' }, el('div', { class: 'pos-row' }, ...cells))));
    }
    rows.push(el('tr', { class: 'err', 'data-part': String(i), hidden: '' }, el('td', { colspan: '5' })));
  });
  $('parts').replaceChildren(...rows);
  renderErrors();
}

function directionName(dir) {
  const nonzero = dir.map((v, i) => [v, i]).filter(([v]) => v !== 0);
  if (nonzero.length !== 1) return `[${dir.join(', ')}]`;
  const [v, i] = nonzero[0];
  return `${v > 0 ? '+' : '−'}${'xyz'[i]}`;
}

function renderHinge() {
  const f = data.facts;
  const line = (k, ...v) => el('div', { class: 'line' }, el('span', { class: 'k', text: k }), ...v);
  $('hinge').replaceChildren(
    line('선의 점', `x ${mm(f.hinge_point_mm[0])} · y ${mm(f.hinge_point_mm[1])} · z ${mm(f.hinge_point_mm[2])} mm`),
    line('방향', directionName(f.hinge_direction)),
    line('다 열린 각', field('open_deg', num(hingeOf(draft).open_deg), '다 열린 각', 'short'), '°'),
    line('미는 힘', `${f.push_torque_nm} N·m`),
    line('여유값', field('margin_mm', num(draft.margin_mm), '여유값', 'short'), 'mm'),
    para('전부 추정 — 확인받은 값이 없다', 'hint'),
  );
  renderErrors();
}

function renderErrors() {
  // 칸에서 못 읽은 것은 그 줄에, sim.quick 이 못 읽은 것은 그 부품 줄(모르면 표 위)에
  const byPart = new Map();
  const others = [];
  for (const [key, message] of fieldErrors) {
    const m = key.match(/^p(\d+)\./);
    if (m) byPart.set(Number(m[1]), message);
    else others.push(`${key === 'open_deg' ? '다 열린 각' : '여유값'}: ${message}`);
  }
  if (pyError && pyError.part >= 0 && !byPart.has(pyError.part)) byPart.set(pyError.part, pyError.message);
  if (pyError && pyError.part < 0) others.push(pyError.message);
  for (const tr of document.querySelectorAll('#parts tr.err')) {
    const message = byPart.get(Number(tr.dataset.part));
    tr.hidden = !message;
    tr.firstChild.textContent = message || '';
  }
  const top = others.join(' · ');
  $('formError').hidden = !top;
  $('formError').textContent = top;
}

function renderVerdict() {
  const lines = quick ? quick.lines : data.report;
  const out = lines.map((text, i) => para(text, i === 0 ? 'line head' : 'line'));
  if (quick) out.unshift(para('고친 치수 — 물리는 PC 판에서만 본다', 'edited'));
  $('verdict').replaceChildren(...out);
}

function renderAll() {
  $('reset').hidden = !edited;
  renderParts();
  renderHinge();
  showOriginal();
}

async function load(name) {
  const seq = ++loadSeq;
  data = null;
  playing = null;
  gen += 1;
  calc.queued = null;
  clearTimeout(waitTimer);
  for (const id of ['overlap', 'touching', 'physics', 'redo']) setLine(id, '');
  $('verdict').classList.remove('stale');
  $('verdict').replaceChildren(para('판정을 불러오는 중…', 'wait'));
  let d;
  try {
    const res = await fetch(`data/${name}.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    d = await res.json();
  } catch (e) {
    if (seq === loadSeq) $('verdict').replaceChildren(para(`자료를 못 불러왔다 (${e.message}) — 새로 고쳐 보세요`, 'fail'));
    return;
  }
  if (seq !== loadSeq) return;   // 그 사이 다른 제품을 골랐다
  data = d;
  expanded.clear();
  resetDraft();
  fraction = 1;                   // 다 열린 자리에서 시작한다 (PC 판과 같다)
  renderAll();
}

function pick(name) {
  $('product').value = name;
  history.replaceState(null, '', `#${name}`);
  load(name);
}

$('product').addEventListener('change', (e) => pick(e.target.value));
$('closeTest').addEventListener('click', play);
$('reset').addEventListener('click', () => {
  if (!data) return;
  resetDraft();
  renderAll();
});
window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1);
  if (names.includes(name) && name !== data?.stem) pick(name);
});

window.demoStarted = true;   // index.html 의 "못 불러왔다" 를 끈다 — 모듈이 다 떴다
startCalc();
const first = location.hash.slice(1);
pick(names.includes(first) ? first : names[0]);
