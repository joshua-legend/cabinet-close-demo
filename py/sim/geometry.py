"""겹침 계산의 바탕 — 상자와, 두 상자 사이의 틈/겹침. 단위는 mm.

물리 엔진의 답을 믿지 않으려고 두는 심판이라 mujoco 를 쓰지 않는다.
"""
import math
from dataclasses import dataclass

import numpy as np

EPS_MM = 1e-6  # 이보다 얕은 겹침은 맞닿은 것으로 본다
TOUCH_MM = 0.05  # 이보다 좁으면 닿았다 (화면이 빨갛게 칠한다)


def _rotation(direction, degrees: float) -> np.ndarray:
    """방향을 축으로 오른손 법칙에 따라 도는 3×3 행렬."""
    k = np.asarray(direction, dtype=float)
    k = k / np.linalg.norm(k)
    a = math.radians(degrees)
    K = np.array([[0.0, -k[2], k[1]], [k[2], 0.0, -k[0]], [-k[1], k[0], 0.0]])
    return np.eye(3) + math.sin(a) * K + (1.0 - math.cos(a)) * (K @ K)


@dataclass(frozen=True, eq=False)
class Box:
    """기울어질 수 있는 상자. rot 의 세로줄이 상자의 세 축이다."""

    center: np.ndarray
    half: np.ndarray
    rot: np.ndarray

    @staticmethod
    def from_ranges(x, y, z) -> 'Box':
        """축에 맞춘 상자 — 축마다 (작은 값, 큰 값)."""
        lo = np.array([x[0], y[0], z[0]], dtype=float)
        hi = np.array([x[1], y[1], z[1]], dtype=float)
        return Box((lo + hi) / 2.0, (hi - lo) / 2.0, np.eye(3))

    def rotated(self, point, direction, degrees: float) -> 'Box':
        """선(점 + 방향)을 따라 돌린 상자."""
        p = np.asarray(point, dtype=float)
        r = _rotation(direction, degrees)
        return Box(p + r @ (self.center - p), self.half, r @ self.rot)

    def moved(self, offset) -> 'Box':
        return Box(self.center + np.asarray(offset, dtype=float), self.half, self.rot)

    def corners(self) -> np.ndarray:
        """꼭짓점 8개 (8×3)."""
        signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], dtype=float)
        return self.center + (signs * self.half) @ self.rot.T

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        """축에 맞춘 최소 · 최대."""
        extent = np.abs(self.rot) @ self.half
        return self.center - extent, self.center + extent

    @property
    def thickness(self) -> float:
        """가장 얇은 쪽의 온 두께."""
        return float(2.0 * self.half.min())


def signed_gap(a: Box, b: Box) -> float:
    """두 상자 사이 — 양수는 떨어진 틈, 음수는 −겹친 깊이, 0 은 맞닿음.

    분리축 15개(두 상자의 면 방향 6 + 모서리끼리의 외적 9)에서 잰 값 가운데 가장 큰 것이다.
    겹친 깊이는 정확하다. 틈은 실제보다 크게 잡는 일이 없다 (모서리끼리 마주 볼 때는 조금 작게 나온다).
    """
    ea, eb = a.rot.T, b.rot.T  # 가로줄이 상자의 세 축
    cross = np.cross(ea[:, None, :], eb[None, :, :]).reshape(9, 3)
    length = np.linalg.norm(cross, axis=1)
    keep = length > 1e-9  # 나란한 모서리의 외적은 방향이 없다
    L = np.vstack((ea, eb, cross[keep] / length[keep, None]))
    reach_a = np.abs(L @ a.rot) @ a.half
    reach_b = np.abs(L @ b.rot) @ b.half
    return float(np.max(np.abs(L @ (b.center - a.center)) - reach_a - reach_b))
