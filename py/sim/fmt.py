"""판정 글에 쓰는 글 모양 — mm · 열림 %. 판정(sim.verdict)과 계산만(sim.quick)이 같이 쓴다.

mujoco 를 쓰지 않는다 (브라우저의 Pyodide 에서도 돈다).
"""

NOT_CHECKED = '안 본 것: 떠 있는지 · 철물 한도 · 휨 · 숨은 경첩의 진짜 움직임 (한 축으로 돈다고 쳤다)'


def mm(value: float) -> str:
    """mm 를 소수 둘째 자리까지 — 끝의 0 은 뗀다. 0 이 아닌데 0 으로 찍히지 않게 한다."""
    if 0 < abs(value) < 0.005:
        return '0.01 미만'
    return f'{value:.2f}'.rstrip('0').rstrip('.')


def pct(fraction: float) -> str:
    """열림 % — 1% 아래는 소수 한 자리까지 (닫힘 바로 앞에서 걸리는 것이 0% 로 찍히지 않게)."""
    percent = fraction * 100
    return f'{percent:.1f}%' if 0 < percent < 1 else f'{round(percent)}%'


def more(count: int) -> str:
    """그 밖의 짝 수 — 없으면 빈 글."""
    return f' · 그 밖에 {count}짝' if count > 0 else ''
