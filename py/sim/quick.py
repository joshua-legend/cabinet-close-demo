"""계산만 — 물리 없이 훑기(sim.sweep)만 돌려 글 · 3D · 열림 막대 자료를 낸다.

시연판(tools/demo/)이 브라우저의 Pyodide 에서 돌린다. 그래서 mujoco 도 sim.verdict · sim.physics 도 쓰지 않는다
— 여기서 쓰는 것은 sim.product · sim.geometry · sim.sweep · sim.fmt 뿐이다 (build.py 가 이 파일들만 옮긴다).

물리와 맞춰 보지 않았으니 판정은 언제나 "모름" 이다. "닫힘" 이라고 내지 않는다.
"""
from sim.fmt import NOT_CHECKED, mm, more, pct
from sim.geometry import EPS_MM, TOUCH_MM, signed_gap
from sim.product import Product, ProductError, product_from_dict
from sim.sweep import SweepResult, poses, sweep

SLIDER_STEP = 0.005  # 막대 한 칸 (0.5%) — 살아 있는 화면의 막대와 같다
HEAD = '판정: 모름 — 물리로 맞춰 보지 않았다 (시연판은 계산만 한다)'


def scene_dict(product: Product) -> dict:
    """3D 를 짓는 데 드는 것 — 부품 상자(닫힌 자리)와 경첩. 화면 · 결과 JSON · 시연판이 같이 쓴다."""
    h = product.hinge
    return {
        'parts': [
            {
                'name': p.name,
                'moving': p.group == h.group,
                'center': [float(v) for v in p.box.center],
                'size': [float(v) * 2.0 for v in p.box.half],
            }
            for p in product.parts
        ],
        'hinge': {
            'point': [float(v) for v in h.point],
            'direction': [float(v) for v in h.direction],
            'open_deg': h.open_deg,
        },
    }


def _pairs(product: Product, fraction: float):
    """그 열림에서 (닿은 짝, 겹친 짝과 깊이) — 움직이는 × 안 움직이는, 파일 순서."""
    boxes = poses(product, fraction)
    touching, overlaps = [], []
    for m in product.moving_parts():
        for s in product.static_parts():
            gap = signed_gap(boxes[m.name], boxes[s.name])
            if gap < TOUCH_MM:
                touching.append([m.name, s.name])
            if gap < -EPS_MM:
                overlaps.append({'pair': [m.name, s.name], 'depth_mm': round(-gap, 2)})
    overlaps.sort(key=lambda o: -o['depth_mm'])
    return touching, overlaps


def slider_frames(product: Product) -> list:
    """열림 0 → 1 의 0.5% 마다 닿음과 겹침 (201 장). 막대는 문을 선반 속에도 넣을 수 있어 겹침을 따로 적는다."""
    count = round(1 / SLIDER_STEP)
    frames = []
    for i in range(count + 1):
        fraction = i / count
        touching, overlaps = _pairs(product, fraction)
        frames.append({
            'fraction': round(fraction, 4),
            'touching': touching,
            'overlaps': overlaps,
            'max_overlap_mm': overlaps[0]['depth_mm'] if overlaps else 0,
        })
    return frames


def answer(product: Product, sw: SweepResult) -> str:
    """훑기의 답 한 줄 — 판정 글(sim.verdict._answer)의 계산 쪽과 같은 말이다."""
    if sw.start_overlaps:
        first = sw.start_overlaps[0]
        return f'{first.a} ↔ {first.b} · 열린 자리에서 이미 {mm(first.depth_mm)} mm 겹침{more(len(sw.start_overlaps) - 1)}'
    if sw.first_contact_fraction is not None:
        a, b = sw.first_contact_pair
        head = f'{a} ↔ {b} · 열림 {pct(sw.first_contact_fraction)} 에서 걸림'
        same = [c for c in sw.closed_overlaps if (c.a, c.b) == (a, b)]
        others = len(sw.closed_overlaps) - len(same)
        if same:
            return f'{head} · 닫힌 자리에서 {mm(same[0].depth_mm)} mm 겹침{more(others)}'
        return f'{head} · 지나는 길에 걸린다 (닫힌 자리에서는 안 겹친다){more(others)}'
    a, b = sw.min_gap_pair
    text = f'겹침 없음 — 가장 좁은 틈 {mm(sw.min_gap_mm)} mm ({a} ↔ {b})'
    margin = product.margin_mm
    surely = sw.min_gap_mm if sw.min_gap_floor_mm is None else sw.min_gap_floor_mm  # sim.verdict.decide 와 같은 규칙
    if surely < margin - EPS_MM:
        how = '보다 적다' if sw.min_gap_mm < margin - EPS_MM else '와 거의 같다'
        text += f' · 여유값 {mm(margin)} mm {how}'
    return text


def quick_check(d: dict) -> dict:
    """제품 파일 내용(dict) 하나를 계산만으로 본다. 못 읽으면 {'ok': False, 'message': …}."""
    try:
        product = product_from_dict(d)
        sw = sweep(product)
    except (ProductError, ArithmeticError) as e:
        return {'ok': False, 'message': str(e)}
    if sw.start_overlaps:
        first, pair = 1.0, [sw.start_overlaps[0].a, sw.start_overlaps[0].b]  # 다 열린 자리에서 이미 걸려 있다
    elif sw.first_contact_fraction is not None:
        first, pair = float(sw.first_contact_fraction), list(sw.first_contact_pair)
    else:
        first, pair = None, None
    lines = [
        HEAD,
        f'계산만: {answer(product, sw)}',
        f'넣은 것: 화면에서 고친 치수 · 여유값 {mm(product.margin_mm)} mm',
        f'{NOT_CHECKED} · 물리',
    ]
    return {
        'ok': True,
        'lines': lines,
        'scene': scene_dict(product),
        'slider': slider_frames(product),
        'first_contact_fraction': first,
        'first_contact_pair': pair,
        # [닫아 보기] 가 끝난 뒤 한 줄 — 물리가 아니라 계산이 처음 걸리는 자리다
        'close_line': '계산: 끝까지 안 걸린다' if first is None else f'계산: 열림 {pct(first)} 에서 처음 걸린다',
    }
