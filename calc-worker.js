// 계산 일꾼 — 브라우저 속 Python(Pyodide)으로 sim.quick 을 돌린다 (계산만, 물리 없음).
// 화면이 멈추지 않게 따로 돈다. 고친 치수는 이 브라우저 밖으로 나가지 않는다 — 받아 오는 것은 Pyodide · numpy · py/ 뿐이다.
//
// 받는 것: { gen, text }        — text = 제품 파일 내용(JSON 글)
// 보내는 것: { type: 'ready', ms } · { type: 'fail', message } — 처음 한 번
//           { type: 'result', gen, result, ms } · { type: 'error', gen, message }
// 모듈 일꾼이다 (new Worker(…, { type: 'module' })) — importScripts 로는 크롬이 pyodide.js 를 못 받은 일이 있어 import 로 받는다.

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';   // Python 3.14 · numpy 2.4 — 판을 못 박는다

async function start() {
  const t0 = performance.now();
  const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
  const py = await loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage('numpy', { messageCallback() {} });
  const files = await (await fetch('py/files.json')).json();
  py.FS.mkdirTree('/home/pyodide/sim');
  for (const name of files) {
    const res = await fetch(`py/sim/${name}`);
    if (!res.ok) throw new Error(`py/sim/${name} ${res.status}`);
    py.FS.writeFile(`/home/pyodide/sim/${name}`, await res.text());
  }
  const run = py.runPython(`
import json, sys
sys.path.insert(0, '/home/pyodide')
from sim.quick import quick_check
lambda text: json.dumps(quick_check(json.loads(text)), ensure_ascii=False, allow_nan=False)
`);
  return { run, ms: Math.round(performance.now() - t0) };
}

const ready = start();
ready.then(
  ({ ms }) => postMessage({ type: 'ready', ms }),
  (e) => postMessage({ type: 'fail', message: String(e && e.message || e) }),
);

onmessage = async (e) => {
  const { gen, text } = e.data;
  let run;
  try {
    ({ run } = await ready);
  } catch {
    return;   // 못 불러온 것은 이미 'fail' 로 알렸다
  }
  const t0 = performance.now();
  try {
    const result = JSON.parse(run(text));
    postMessage({ type: 'result', gen, result, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    postMessage({ type: 'error', gen, message: String(err && err.message || err).split('\n').filter(Boolean).pop() });
  }
};
