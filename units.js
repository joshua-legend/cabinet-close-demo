// 단위 바꾸기 — 화면에서만 mm · cm · m 를 바꾼다.
// 서버와 제품 파일은 항상 mm 로만 안다. 이 파일은 그림과 입력 칸에서만 쓴다.

export const UNITS = ['mm', 'cm', 'm'];

// 한 단위가 mm 의 몇 배인지
const MM_PER_UNIT = { mm: 1, cm: 10, m: 1000 };

// 곱하고 나눌 때 생기는 끝자리 찌꺼기(예: 0.56 * 1000 = 560.0000000000001)를 지운다
function clean(x) {
  return Number(x.toPrecision(12));
}

function factorOf(unit) {
  if (!Object.hasOwn(MM_PER_UNIT, unit)) {
    throw new Error(`모르는 단위다 (${unit})`);
  }
  return MM_PER_UNIT[unit];
}

// mm 값을 그 단위의 수로 (화면에 보일 때)
export function toDisplay(mm, unit) {
  return clean(mm / factorOf(unit));
}

// 그 단위의 수를 mm 로 (입력을 받을 때)
export function toMm(value, unit) {
  return clean(value * factorOf(unit));
}

// 입력 칸의 글을 수로. 못 읽으면 null.
// 십진수 글만 받는다. Number() 는 0x10 · 0b1 · 1e3 을 다른 수로 읽으니 쓰지 않는다.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseNumber(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null; // 1e999 같은 넘침
  return n === 0 ? 0 : n; // '-0' 은 0 으로
}
