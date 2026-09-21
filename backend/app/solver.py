"""釉料配方反推求解器。

问题定义：给定目标氧化物比例 b（重量百分数）和每种原料的氧化物组成，
求各原料用量 x，使得：

    minimize  1/2 * ||A x - b||^2
    s.t.      sum(x) = TOTAL (100)
              lb_i <= x_i <= ub_i

其中 A[o, i] = 原料 i 中氧化物 o 的含量 / 100。

使用 SciPy SLSQP（带解析梯度）求解该等式约束 + 边界约束的最小二乘问题。
在求解前先做边界可行性检查，直接指出互相矛盾的约束。
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
from scipy.optimize import minimize

from .models import MaterialIn, OxideResult, RecipeItem, SolveResponse

TOTAL = 100.0          # 配方总量
OK_TOL = 0.01          # 最大绝对偏差小于该值（百分点）视为精确达到
EPS = 1e-9


def _empty(status: str, messages: List[str]) -> SolveResponse:
    return SolveResponse(status=status, messages=messages)  # type: ignore[arg-type]


def solve_recipe(
    oxides: List[str],
    target: Dict[str, float],
    materials: List[MaterialIn],
    fixed: Optional[Dict[int, float]] = None,
) -> SolveResponse:
    """反推配方。

    fixed：可选，键为原料下标、值为强制用量（用于鲁棒性分析的扰动情景）。
    被固定的原料（无论是否禁用）用量恒等于该值，其余原料在总量=100 与
    各自上下界内重新求解最小残差配方。
    """
    fixed = fixed or {}

    # ---------- 基本校验 ----------
    if not oxides:
        return _empty("error", ["至少需要定义一种氧化物"])
    if not materials:
        return _empty("error", ["至少需要定义一种原料"])
    enabled = [m for m in materials if not m.disabled]
    if not enabled and not fixed:
        return _empty("error", ["所有原料均被禁用，无法求解"])

    for o in oxides:
        t = float(target.get(o, 0.0))
        if t < 0:
            return _empty("error", [f"氧化物 {o} 的目标值不能为负数"])
    for m in materials:
        for o, v in m.composition.items():
            if v < 0:
                return _empty("error", [f"原料「{m.name}」中 {o} 的含量不能为负数"])

    # ---------- 边界构造与冲突检测 ----------
    lbs: List[float] = []
    ubs: List[float] = []
    conflicts: List[str] = []
    for i, m in enumerate(materials):
        if i in fixed:
            val = float(fixed[i])
            if not np.isfinite(val) or val < -EPS:
                conflicts.append(f"原料「{m.name}」的固定用量 {val:g} 非法（需满足 0~100）")
                lo, hi = 0.0, 0.0
            else:
                val = min(max(val, 0.0), TOTAL)
                lo = hi = val
                if not m.disabled and (val < float(m.min) - EPS or val > float(m.max) + EPS):
                    conflicts.append(
                        f"原料「{m.name}」的固定用量 {val:g} 超出其用量边界 "
                        f"[{max(0.0, float(m.min)):g}, {min(float(m.max), TOTAL):g}]，"
                        f"边界冲突"
                    )
        elif m.disabled:
            lo = hi = 0.0
        else:
            lo = max(0.0, float(m.min))
            hi = min(float(m.max), TOTAL)
        if lo > hi + EPS:
            conflicts.append(
                f"原料「{m.name}」的最小用量 {lo:g} 大于最大用量 {hi:g}，边界自相矛盾"
            )
        lbs.append(lo)
        ubs.append(hi)

    sum_lo = float(sum(lbs))
    sum_hi = float(sum(ubs))
    if sum_lo > TOTAL + EPS:
        detail = "、".join(
            f"「{m.name}」≥{lo:g}" for m, lo in zip(materials, lbs) if lo > EPS
        )
        conflicts.append(
            f"所有原料最小用量之和为 {sum_lo:g}，超过总量 {TOTAL:g}（{detail}），边界冲突"
        )
    if sum_hi < TOTAL - EPS:
        detail = "、".join(
            f"「{m.name}」≤{hi:g}" for m, hi in zip(materials, ubs) if hi < TOTAL - EPS
        )
        conflicts.append(
            f"所有原料最大用量之和为 {sum_hi:g}，小于总量 {TOTAL:g}（{detail}），边界冲突"
        )
    if conflicts:
        return _empty("conflict", conflicts)

    # ---------- 组装最小二乘问题 ----------
    n = len(materials)
    A = np.array(
        [[float(m.composition.get(o, 0.0)) / 100.0 for m in materials] for o in oxides],
        dtype=float,
    )
    b = np.array([float(target.get(o, 0.0)) for o in oxides], dtype=float)
    lb = np.array(lbs, dtype=float)
    ub = np.array(ubs, dtype=float)

    # 构造可行的初始点：先取下界，再把剩余量按可用空间比例分配
    x0 = lb.copy()
    remaining = TOTAL - x0.sum()
    slack = ub - lb
    if remaining > 0 and slack.sum() > 0:
        x0 = lb + slack * (remaining / slack.sum())

    def objective(x: np.ndarray) -> float:
        r = A @ x - b
        return 0.5 * float(r @ r)

    def gradient(x: np.ndarray) -> np.ndarray:
        return A.T @ (A @ x - b)

    res = minimize(
        objective,
        x0,
        jac=gradient,
        method="SLSQP",
        bounds=list(zip(lb, ub)),
        constraints=[
            {
                "type": "eq",
                "fun": lambda x: float(np.sum(x) - TOTAL),
                "jac": lambda x: np.ones_like(x),
            }
        ],
        options={"maxiter": 1000, "ftol": 1e-12},
    )

    messages: List[str] = []
    x = res.x if np.all(np.isfinite(res.x)) else x0
    x = np.clip(x, lb, ub)
    x[np.abs(x) < 1e-9] = 0.0
    if not res.success:
        messages.append(f"优化器未完全收敛（{res.message}），返回当前最优解")

    achieved = A @ x
    deviation = achieved - b
    max_dev = float(np.max(np.abs(deviation))) if deviation.size else 0.0

    if max_dev <= OK_TOL:
        status = "ok"
    else:
        status = "approximate"
        messages.append(
            "目标氧化物比例在当前边界条件下无法精确达到，以下为满足全部边界的最小残差配方，"
            "并给出逐项偏差"
        )

    return SolveResponse(
        status=status,  # type: ignore[arg-type]
        messages=messages,
        recipe=[
            RecipeItem(material=m.name, amount=round(float(xi), 6))
            for m, xi in zip(materials, x)
        ],
        oxides=[
            OxideResult(
                oxide=o,
                target=round(float(t), 6),
                achieved=round(float(a), 6),
                deviation=round(float(d), 6),
            )
            for o, t, a, d in zip(oxides, b, achieved, deviation)
        ],
        total_amount=round(float(x.sum()), 6),
        residual_norm=round(float(np.linalg.norm(deviation)), 6),
    )
