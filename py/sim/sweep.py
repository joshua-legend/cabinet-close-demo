"""훑기 — 열림 100% 에서 0% 까지 이음을 움직이며 부품끼리의 겹침과 틈을 잰다.

판정의 계산 쪽이다. 물리 없이 도형만 본다 (mujoco 를 쓰지 않는다).

걸음 자리에서만 재면 걸음과 걸음 사이를 놓친다 (모서리가 스치고 지나가는 짧은 겹침, 가장 좁은 틈).
그래서 걸음 사이도 따진다: 부품이 한 구간에서 가는 길이가 T 이고 양 끝의 틈이 g1 · g2 이면,
그 구간 안의 틈은 (g1 + g2 − T) / 2 보다 작을 수 없다. 이 값으로 안심할 수 없는 구간은 반으로 쪼개 다시 잰다.
"""
import math
from dataclasses import dataclass

import numpy as np

from sim.geometry import EPS_MM, signed_gap
from sim.product import Product

REFINE = 1e-4          # 처음 걸리는 자리를 좁히는 끝 (열림 0–1)
MIN_TRAVEL_MM = 0.02   # 구간을 이보다 잘게 쪼개지 않는다 — 그래도 남는 모름은 그 절반(0.01 mm)이다
REPORT_TOL_MM = 0.02   # 적어 내는 "가장 좁은 틈" 이 실제보다 클 수 있는 한도 (틈이 넓으면 그 10% 까지)


@dataclass(frozen=True)
class Contact:
    """겹친 짝. 움직이는 부품이 a 다 — 둘 다 안 움직이면 파일에 먼저 적힌 것이 a."""

    a: str
    b: str
    depth_mm: float


@dataclass(frozen=True)
class SweepResult:
    start_overlaps: tuple = ()                  # 열림 100% 에서 이미 겹친 모든 짝, 깊은 것부터
    first_contact_fraction: float | None = None  # 열린 쪽에서 닫아 오다 처음 걸리는 열림 (0–1)
    first_contact_pair: tuple | None = None
    closed_overlaps: tuple = ()                 # 닫힌 자리에서 겹친 짝, 깊은 것부터
    min_gap_mm: float | None = None             # 겹침이 없을 때 — 서로 움직이는 짝에서 잰 가장 좁은 틈
    min_gap_floor_mm: float | None = None       # 틈이 이보다 작을 수는 없다 (걸음 사이까지 따진 값). 판정은 이것으로 한다
    min_gap_pair: tuple | None = None
    steps: int = 0


def poses(product: Product, fraction: float) -> dict:
    """열림(0 = 닫힘, 1 = 다 열림)에서 부품마다의 상자."""
    h = product.hinge
    degrees = fraction * h.open_deg
    return {
        p.name: p.box.rotated(h.point, h.direction, degrees) if p.group == h.group else p.box
        for p in product.parts
    }


def _moving_pairs(product: Product) -> list:
    return [(m.name, s.name) for m in product.moving_parts() for s in product.static_parts()]


def _same_side_pairs(product: Product) -> list:
    """서로 안 움직이는 짝 — 열림과 상관없이 늘 같은 자리다."""
    pairs = []
    for side in (product.static_parts(), product.moving_parts()):
        pairs += [(side[i].name, side[j].name) for i in range(len(side)) for j in range(i + 1, len(side))]
    return pairs


def _contacts(boxes: dict, pairs: list) -> tuple:
    found = []
    for a, b in pairs:
        gap = signed_gap(boxes[a], boxes[b])
        if gap < -EPS_MM:
            found.append(Contact(a, b, -gap))
    return tuple(sorted(found, key=lambda c: -c.depth_mm))


def overlaps_at(product: Product, fraction: float) -> tuple:
    """그 열림에서 겹친 모든 짝 (깊이가 EPS_MM 을 넘는 것), 깊은 것부터."""
    return _contacts(poses(product, fraction), _moving_pairs(product) + _same_side_pairs(product))


def _reach_mm(product: Product, part) -> float:
    """경첩 선에서 그 부품의 가장 먼 꼭짓점까지."""
    h = product.hinge
    v = part.box.corners() - h.point
    across = v - np.outer(v @ h.direction, h.direction)  # 경첩 선에 수직인 쪽만
    return float(np.linalg.norm(across, axis=1).max())


def _arc_mm(product: Product) -> float:
    """다 열림에서 닫힘까지, 경첩 선에서 가장 먼 꼭짓점이 가는 길이."""
    reach = max(_reach_mm(product, p) for p in product.moving_parts())
    return reach * math.radians(product.hinge.open_deg)


def _intervals(product: Product) -> int:
    """훑는 걸음 사이의 수 — 한 걸음에 가장 멀리 가는 점이 가장 얇은 부품 두께의 절반보다 덜 가게."""
    thinnest = min(p.box.thickness for p in product.parts)
    return math.ceil(_arc_mm(product) / (thinnest / 2.0)) + 1


def max_step_travel_mm(product: Product) -> float:
    """한 걸음에 가장 멀리 가는 점이 가는 길이."""
    return _arc_mm(product) / _intervals(product)


def sweep(product: Product) -> SweepResult:
    """열림 1.0 에서 0.0 으로 내려가며 겹침과 틈을 잰다 — 걸음 사이까지."""
    n = _intervals(product)
    start = overlaps_at(product, 1.0)
    if start:
        return SweepResult(start_overlaps=start, steps=n + 1)

    h = product.hinge
    margin = product.margin_mm
    open_rad = math.radians(h.open_deg)
    pairs = [(m, s) for m in product.moving_parts() for s in product.static_parts()]
    # 열림이 1 만큼 바뀔 때 그 부품의 가장 먼 점이 가는 길이 — 두 부품 사이의 틈은 이보다 빨리 바뀔 수 없다
    arc = {m.name: _reach_mm(product, m) * open_rad for m in product.moving_parts()}
    best = {'gap': math.inf, 'pair': None, 'floor': math.inf}

    def gap_at(m, s, fraction: float) -> float:
        gap = signed_gap(m.box.rotated(h.point, h.direction, fraction * h.open_deg), s.box)
        if not math.isfinite(gap):
            raise ArithmeticError(f'틈을 계산하지 못했다 ({m.name} ↔ {s.name}, 열림 {fraction:.4f})')
        return gap

    def note(gap: float, m, s) -> None:
        if gap < best['gap'] - 1e-9:
            best['gap'], best['pair'] = gap, (m.name, s.name)

    def safe(bound: float) -> bool:
        """구간 안의 틈이 bound 보다 작을 수 없을 때, 이 구간을 더 쪼개지 않아도 되나."""
        if bound <= EPS_MM:
            return False  # 겹침이 숨어 있을 수 있다
        if bound < best['gap'] - max(REPORT_TOL_MM, 0.1 * best['gap']):
            return False  # 지금까지 본 것보다 좁은 틈이 숨어 있을 수 있다
        if best['gap'] >= margin - EPS_MM and bound < margin:
            return False  # 틈이 여유값을 넘는다면, 넘는다는 것을 끝까지 확인한다
        return True

    def onset(m, s, fa: float, ga: float, fb: float, gb: float):
        """구간 (fb, fa] 에서 겹침이 시작되는 열림(가장 열린 쪽)을 찾는다. 없으면 None.

        fa 가 더 열린 쪽이고, ga 는 겹치지 않은 값이다.
        """
        travel = arc[m.name] * (fa - fb)
        if gb >= -EPS_MM:
            bound = (ga + gb - travel) / 2.0
            if safe(bound) or travel <= MIN_TRAVEL_MM:
                best['floor'] = min(best['floor'], bound)
                return None
        elif fa - fb <= REFINE:
            return fa  # 닿는 순간 — 마지막으로 안 겹친 열림
        fm = (fa + fb) / 2.0
        gm = gap_at(m, s, fm)
        if gm < -EPS_MM:
            return onset(m, s, fa, ga, fm, gm)
        note(gm, m, s)
        hit = onset(m, s, fa, ga, fm, gm)
        if hit is not None:
            return hit
        return onset(m, s, fm, gm, fb, gb)

    open_gaps = [gap_at(m, s, 1.0) for m, s in pairs]
    for (m, s), gap in zip(pairs, open_gaps):
        note(gap, m, s)

    fine = _arc_mm(product) / n  # 가까이에서의 한 걸음 (가장 얇은 부품 두께의 절반보다 짧다)
    first = None                 # (열림, 움직이는 부품, 안 움직이는 부품) — 가장 먼저 걸리는 짝
    for (m, s), ga in zip(pairs, open_gaps):
        fa = 1.0
        stop = 0.0 if first is None else first[0]  # 이미 찾은 자리보다 더 닫힌 쪽은 볼 필요가 없다
        while fa > stop:
            stride = max(fine, 0.5 * ga)  # 멀리 떨어져 있으면 성큼성큼 — 걸음 사이는 onset 이 따진다
            fb = max(stop, fa - stride / arc[m.name])
            gb = gap_at(m, s, fb)
            if gb >= -EPS_MM:
                note(gb, m, s)
            hit = onset(m, s, fa, ga, fb, gb)
            if hit is not None:
                if first is None or hit > first[0]:
                    first = (hit, m.name, s.name)
                break
            fa, ga = fb, gb

    if first is None:
        return SweepResult(
            min_gap_mm=max(best['gap'], 0.0),
            min_gap_floor_mm=min(best['floor'], best['gap']),
            min_gap_pair=best['pair'],
            steps=n + 1,
        )
    closed = _contacts(poses(product, 0.0), _moving_pairs(product))
    return SweepResult(
        first_contact_fraction=first[0],
        first_contact_pair=(first[1], first[2]),
        closed_overlaps=closed,
        steps=n + 1,
    )
