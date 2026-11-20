"""제품 파일 — 제품 하나 = JSON 한 장이 원본이다. 단위는 mm · kg.

값마다 받은 것(given)인지 추정(assumed)인지를 달고, 안 적힌 값은 추정으로 친다.
"""
import json
import math
import pathlib
from dataclasses import dataclass

import numpy as np

from sim.geometry import Box

SOURCES = ('given', 'assumed')
UNITS = ('mm', 'cm', 'm')  # 화면에 보이는 단위 — 판정 · 계산은 mm 로 한다
_PART_FIELDS = ('x', 'y', 'z', 'mass_kg')
MAX_MM = 100_000.0   # 100 m — 이보다 큰 치수는 잘못 적은 것으로 본다
MIN_SIZE_MM = 0.1    # 이보다 얇은 부품은 받지 않는다 (0 에 가까운 두께는 잘못 적은 것이다)
MAX_KG = 10_000.0
MAX_MARGIN_MM = 100.0
MAX_TORQUE_NM = 1_000.0


class ProductError(ValueError):
    """제품 파일을 못 읽었다 — 글은 사람이 읽는 한국어다."""


@dataclass(frozen=True, eq=False)
class Part:
    name: str
    group: str
    box: Box                 # 닫힌 자리의 상자
    mass_kg: float | None
    sources: dict            # 칸(x · y · z · mass_kg) → 'given' | 'assumed'


@dataclass(frozen=True, eq=False)
class Hinge:
    group: str               # 도는 묶음
    parent: str              # 붙어 있는 묶음 (움직이지 않는다)
    point: np.ndarray        # 경첩 선 위의 한 점
    direction: np.ndarray    # 경첩 선의 방향 (길이 1). 열 때 이 방향을 따라 오른손 법칙으로 돈다
    open_deg: float          # 다 열린 각. 열림 p (0–1) 의 각 = p × open_deg
    source: str


@dataclass(frozen=True, eq=False)
class Product:
    name: str
    parts: tuple
    hinge: Hinge
    margin_mm: float
    margin_source: str
    push_torque_nm: float
    display_unit: str = 'mm'

    def moving_parts(self) -> tuple:
        return tuple(p for p in self.parts if p.group == self.hinge.group)

    def static_parts(self) -> tuple:
        return tuple(p for p in self.parts if p.group != self.hinge.group)

    def _tags(self) -> list:
        """판정에 쓰이는 값마다의 받음/추정 — 이 가운데 추정이 있으면 판정은 "모름" 이다."""
        tags = []
        for p in self.parts:
            fields = ('x', 'y', 'z', 'mass_kg') if p.group == self.hinge.group else ('x', 'y', 'z')
            tags += [p.sources[f] for f in fields]
        tags += [self.hinge.source, self.hinge.source]  # 경첩의 선, 다 열린 각
        tags.append(self.margin_source)
        return tags

    def value_counts(self) -> tuple:
        """(받은 값, 전체 값)."""
        tags = self._tags()
        return tags.count('given'), len(tags)

    def has_assumed(self) -> bool:
        given, total = self.value_counts()
        return given < total


def _source(value, where: str) -> str:
    if value not in SOURCES:
        raise ProductError(f'{where}: 받음/추정은 "given" 이나 "assumed" 로 적는다 ({value!r})')
    return value


def _number(value, where: str, low: float | None = None, high: float | None = None) -> float:
    """수 하나 — 글자 · 참거짓 · NaN · 끝없는 수는 받지 않는다. 읽히기는 하지만 치수가 아닌 값이 판정에 들어가면 안 된다."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProductError(f'{where}: 수로 적는다 ({value!r})')
    number = float(value)
    if not math.isfinite(number):
        raise ProductError(f'{where}: NaN 이나 끝없는 수는 못 쓴다 ({value!r})')
    if (low is not None and number < low) or (high is not None and number > high):
        raise ProductError(f'{where}: {low:g} 에서 {high:g} 사이여야 한다 ({number:g})')
    return number


def _numbers(value, count: int, where: str, low: float | None = None, high: float | None = None) -> list:
    if not isinstance(value, (list, tuple)) or len(value) != count:
        raise ProductError(f'{where}: 수 {count}개로 적는다 ({value!r})')
    return [_number(v, where, low, high) for v in value]


def _range(part: dict, axis: str, where: str) -> tuple:
    lo, hi = _numbers(part[axis], 2, f'{where} 의 {axis}', -MAX_MM, MAX_MM)
    if hi - lo < MIN_SIZE_MM:
        raise ProductError(f'{where}: {axis} 의 크기가 0 이거나 뒤집혔거나 {MIN_SIZE_MM:g} mm 보다 얇다 ({part[axis]})')
    return lo, hi


def _part(raw: dict) -> Part:
    name = str(raw['name'])
    where = f'부품 "{name}"'
    box = Box.from_ranges(*(_range(raw, axis, where) for axis in 'xyz'))
    mass = raw.get('mass_kg')
    if mass is not None:
        mass = _number(mass, f'{where} 의 무게', 0.0, MAX_KG)
        if mass <= 0:
            raise ProductError(f'{where}: 무게는 0 보다 커야 한다 ({mass})')
    default = _source(raw.get('source', 'assumed'), where)
    overrides = raw.get('sources', {})
    unknown = set(overrides) - set(_PART_FIELDS)
    if unknown:
        raise ProductError(f'{where}: 모르는 칸의 받음/추정이다 ({", ".join(sorted(unknown))})')
    sources = {f: _source(overrides.get(f, default), where) for f in _PART_FIELDS}
    return Part(name, str(raw['group']), box, mass, sources)


def _hinge(raw: dict, groups: set) -> Hinge:
    group, parent = str(raw['group']), str(raw['parent'])
    if group not in groups or parent not in groups or group == parent:
        raise ProductError(f'이음: 묶음이 틀리다 ("{group}" 가 "{parent}" 에) — 부품에 적힌 서로 다른 묶음이어야 한다')
    point = np.array(_numbers(raw['point'], 3, '이음의 점', -MAX_MM, MAX_MM))
    direction = np.array(_numbers(raw['direction'], 3, '이음의 방향', -MAX_MM, MAX_MM))
    length = float(np.linalg.norm(direction))
    if length < 1e-9:
        raise ProductError('이음: 경첩 선의 방향이 0 이다')
    open_deg = _number(raw['open_deg'], '이음의 다 열림 각')
    if not 0 < open_deg <= 180:
        raise ProductError(f'이음: 다 열림 각은 0 초과 180 이하다 — 열림 {open_deg}')
    return Hinge(group, parent, point, direction / length, open_deg, _source(raw.get('source', 'assumed'), '이음'))


def product_from_dict(d: dict) -> Product:
    """파일 내용(dict)에서 제품을 만든다. 틀린 곳이 있으면 ProductError."""
    if not isinstance(d, dict):
        raise ProductError('제품 파일은 { } 한 덩어리여야 한다')
    try:
        parts = tuple(_part(raw) for raw in d['parts'])
        if not parts:
            raise ProductError('부품이 하나도 없다')
        names = [p.name for p in parts]
        twice = sorted({n for n in names if names.count(n) > 1})
        if twice:
            raise ProductError(f'부품 이름이 겹친다 ({", ".join(twice)})')
        groups = {p.group for p in parts}

        hinges, fixed = [], []
        for raw in d['joints']:
            kind = raw.get('type')
            if kind == 'hinge':
                hinges.append(raw)
            elif kind == 'fixed':
                fixed.append(raw)
            elif kind == 'slide':
                raise ProductError('미는 움직임(slide)은 아직 안 된다')
            else:
                raise ProductError(f'모르는 이음이다 ({kind!r})')
        if not hinges:
            raise ProductError('움직이는 이음이 없다 — 도는 이음(hinge) 하나가 있어야 한다')
        if len(hinges) > 1:
            raise ProductError('움직이는 이음이 둘 이상이다 — 아직 안 된다 (어느 것부터 닫나를 정해야 한다)')
        hinge = _hinge(hinges[0], groups)
        for raw in fixed:
            if hinge.group in (raw.get('group'), raw.get('parent')):
                raise ProductError('이음: 움직이는 묶음에 붙는 부품은 같은 묶음으로 적는다')

        for p in parts:
            if p.group == hinge.group and p.mass_kg is None:
                raise ProductError(f'부품 "{p.name}": 움직이는 부품에는 무게(mass_kg)가 있어야 한다')

        margin = _number(d['margin_mm'], '여유값', 0.0, MAX_MARGIN_MM)
        push = _number(d['push']['torque_nm'], '미는 힘', 0.0, MAX_TORQUE_NM)
        unit = d.get('display_unit', 'mm')  # 칸이 없을 때만 mm — 적힌 None 은 아래에서 거른다
        if unit not in UNITS:
            raise ProductError(f'단위는 "mm" · "cm" · "m" 가운데 하나다 ({unit!r})')
        return Product(
            name=str(d.get('name', '이름 없음')),
            parts=parts,
            hinge=hinge,
            margin_mm=margin,
            margin_source=_source(d.get('margin_source', 'assumed'), '여유값'),
            push_torque_nm=push,
            display_unit=unit,
        )
    except ProductError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError) as e:
        raise ProductError(f'칸이 없거나 모양이 틀리다 ({type(e).__name__}: {e})') from e


def load_product(path) -> Product:
    """제품 파일(JSON, UTF-8)을 읽는다."""
    path = pathlib.Path(path)
    try:
        text = path.read_text('utf-8')
    except OSError as e:
        raise ProductError(f'파일을 못 열었다 ({path})') from e
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ProductError(f'JSON 이 아니다 ({e})') from e
    if isinstance(data, dict):
        data.setdefault('name', path.stem)
    return product_from_dict(data)
