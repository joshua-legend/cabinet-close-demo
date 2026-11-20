// 보기 전용 시연판 — data/<제품>.json 에 미리 담은 것을 보인다. 서버도 물리도 없다.
// 열림 막대: 그 열림에서 잰 닿음(빨강)과 겹침. 막대는 문을 선반 속에도 넣을 수 있어, 겹치면 한 줄로 알린다.
// [닫아 보기]: 미리 돌려 담은 물리를 제 빠르기로 다시 튼다. 판정 글은 data 의 report 그대로다 — 여기서 판정을 만들지 않는다.

import { createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const names = [...$('product').options].map((o) => o.value);

let data = null;
let playing = null;            // { t0, frames, frameS } — 닫아 보기를 트는 중
let loadSeq = 0;

const view = createScene($('stage'), {
  grab: false,
  helpText: '끌면 돌려 본다 · 휠로 당긴다',
  onGrab() {}, onDrag() {}, onRelease() {},
  onSeek: (fraction) => seek(fraction),
});
$('stage').querySelector('.bar').append($('closeTest'));

function para(text, cls) {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

// mm 를 소수 둘째 자리까지, 끝의 0 은 뗀다 (판정 글의 sim/verdict.py _mm 과 같은 모양)
function mm(v) {
  if (v > 0 && v < 0.005) return '0.01 미만';
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function setLine(id, text) {
  const line = $(id);
  if (line.textContent !== text) line.textContent = text;
  line.classList.toggle('off', !text);   // 자리는 남겨 3D 가 들썩이지 않게
}

function show(fraction, touching, overlaps) {
  view.setTick({ fraction, touching });
  setLine('touching', touching.length ? `지금: ${touching.map((p) => p.join(' ↔ ')).join(' · ')} 에 닿았다` : '');
  let text = '';
  if (overlaps && overlaps.length) {
    const [deep, ...rest] = overlaps;   // 깊은 것부터 담겨 있다
    text = `계산: 이 열림에서는 ${deep.pair.join(' ↔ ')} 이 ${mm(deep.depth_mm)} mm 겹친다 — 실제로는 여기서 걸려 선다`;
    if (rest.length) text += ` · 그 밖에 ${rest.length}짝`;
  }
  setLine('overlap', text);
}

function seek(fraction) {
  if (!data) return;
  playing = null;
  setLine('physics', '');
  const frames = data.slider;
  const i = Math.min(Math.max(Math.round(fraction * (frames.length - 1)), 0), frames.length - 1);
  const f = frames[i];
  show(f.fraction, f.touching, f.overlaps);
}

function play() {
  if (!data) return;
  playing = { t0: performance.now(), frames: data.close.frames, frameS: data.close.frame_s, data };
  setLine('physics', '');
  requestAnimationFrame(tick);
}

function tick(now) {
  const p = playing;
  if (!p || p.data !== data) return;
  // rAF 의 시각은 그 장이 시작된 때라 누른 때(t0)보다 앞설 수 있다 — 음수가 되지 않게
  const i = Math.max(0, Math.floor((now - p.t0) / 1000 / p.frameS));
  const last = i >= p.frames.length - 1;
  const f = p.frames[Math.min(i, p.frames.length - 1)];
  show(f.fraction, f.touching, null);
  if (last) {
    playing = null;
    setLine('physics', data.close.end_line);
    return;
  }
  requestAnimationFrame(tick);
}

function renderParts(d) {
  const rows = d.parts.map((p) => {
    const tr = document.createElement('tr');
    if (p.moving) tr.className = 'moving';
    const name = document.createElement('td');
    name.className = 'c-name';
    name.textContent = p.name;
    tr.append(name, ...p.size.map((v) => {
      const td = document.createElement('td');
      td.textContent = mm(v);
      return td;
    }));
    return tr;
  });
  $('parts').replaceChildren(...rows);
}

function directionName(dir) {
  const nonzero = dir.map((v, i) => [v, i]).filter(([v]) => v !== 0);
  if (nonzero.length !== 1) return `[${dir.join(', ')}]`;
  const [v, i] = nonzero[0];
  return `${v > 0 ? '+' : '−'}${'xyz'[i]}`;
}

function renderHinge(d) {
  const f = d.facts;
  const line = (k, v) => {
    const div = document.createElement('div');
    div.className = 'line';
    const key = document.createElement('span');
    key.className = 'k';
    key.textContent = k;
    div.append(key, v);
    return div;
  };
  $('hinge').replaceChildren(
    line('선의 점', `x ${mm(f.hinge_point_mm[0])} · y ${mm(f.hinge_point_mm[1])} · z ${mm(f.hinge_point_mm[2])} mm`),
    line('방향', directionName(f.hinge_direction)),
    line('다 열린 각', `${f.open_deg}°`),
    line('미는 힘', `${f.push_torque_nm} N·m`),
    line('여유값', `${mm(f.margin_mm)} mm`),
    para('전부 추정 — 확인받은 값이 없다', 'hint'),
  );
}

function renderVerdict(d) {
  $('verdict').replaceChildren(...d.report.map((text, i) => para(text, i === 0 ? 'line head' : 'line')));
}

async function load(name) {
  const seq = ++loadSeq;
  data = null;
  playing = null;
  for (const id of ['overlap', 'touching', 'physics']) setLine(id, '');
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
  view.setScene(d);
  renderParts(d);
  renderHinge(d);
  renderVerdict(d);
  seek(1);                        // 다 열린 자리에서 시작한다 (PC 판과 같다)
}

function pick(name) {
  $('product').value = name;
  history.replaceState(null, '', `#${name}`);
  load(name);
}

$('product').addEventListener('change', (e) => pick(e.target.value));
$('closeTest').addEventListener('click', play);
window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1);
  if (names.includes(name) && name !== data?.stem) pick(name);
});

window.demoStarted = true;   // index.html 의 "못 불러왔다" 를 끈다 — 모듈이 다 떴다
const first = location.hash.slice(1);
pick(names.includes(first) ? first : names[0]);
