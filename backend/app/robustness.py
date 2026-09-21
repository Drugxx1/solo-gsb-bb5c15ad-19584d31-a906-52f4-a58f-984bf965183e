"""配方鲁棒性分析。

在基准最优配方的基础上，将指定原料用量分别按 ±p% 强制调整，再在
「总量 = 100、全部上下界」约束下重新求解最小二乘问题，比较残差增量，
从而量化各原料用量波动对配方达成度的影响（敏感度）。
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .models import (
    MaterialIn,
    RobustnessItem,
    RobustnessRequest,
    RobustnessResponse,
    ScenarioResult,
    SolveResponse,
)
from .solver import EPS, TOTAL, solve_core


def _infeasible_scenario(
    direction: str, amount: float, messages: List[str]
) -> ScenarioResult:
    return ScenarioResult(
        direction=direction,  # type: ignore[arg-type]
        perturbed_amount=round(float(amount), 6),
        feasible=False,
        status="conflict",
        messages=messages,
    )


def _run_scenario(
    direction: str,
    amount: float,
    oxides: List[str],
    target: Dict[str, float],
    materials: List[MaterialIn],
    idx: int,
    baseline_norm: float,
) -> ScenarioResult:
    name = materials[idx].name
    if amount < -EPS:
        return _infeasible_scenario(
            direction,
            amount,
            [
                f"原料「{name}」调整后用量为 {amount:.4f}，为负值，"
                "无法在非负约束下重新求解"
            ],
        )
    if amount > TOTAL + EPS:
        return _infeasible_scenario(
            direction,
            amount,
            [
                f"原料「{name}」调整后用量为 {amount:.4f}，超过配方总量 "
                f"{TOTAL:g}，总量约束无法满足"
            ],
        )

    resp, _ = solve_core(oxides, target, materials, fixed={idx: float(amount)})
    if resp.status in ("conflict", "error"):
        return ScenarioResult(
            direction=direction,  # type: ignore[arg-type]
            perturbed_amount=round(float(amount), 6),
            feasible=False,
            status=resp.status,
            messages=resp.messages,
        )

    increase = max(0.0, resp.residual_norm - baseline_norm)
    return ScenarioResult(
        direction=direction,  # type: ignore[arg-type]
        perturbed_amount=round(float(amount), 6),
        feasible=True,
        status=resp.status,
        messages=resp.messages,
        recipe=resp.recipe,
        oxides=resp.oxides,
        residual_norm=resp.residual_norm,
        residual_increase=round(increase, 6),
    )


def analyze_robustness(req: RobustnessRequest) -> RobustnessResponse:
    p = float(req.perturbation)
    if not np.isfinite(p) or p <= 0:
        return RobustnessResponse(
            status="error",
            messages=["扰动百分比必须是大于 0 的数字"],
            perturbation=p,
        )

    # 指定原料时先确认其存在且启用
    target_indices: List[int]
    if req.material is not None:
        hits = [i for i, m in enumerate(req.materials) if m.name == req.material]
        if not hits:
            return RobustnessResponse(
                status="error",
                messages=[f"原料「{req.material}」不存在"],
                perturbation=p,
            )
        idx = hits[0]
        if req.materials[idx].disabled:
            return RobustnessResponse(
                status="error",
                messages=[f"原料「{req.material}」已被禁用，不参与鲁棒性分析"],
                perturbation=p,
            )
        target_indices = [idx]
    else:
        target_indices = [i for i, m in enumerate(req.materials) if not m.disabled]

    # ---------- 基准解 ----------
    baseline, x_base = solve_core(req.oxides, req.target, req.materials)
    if x_base is None:
        return RobustnessResponse(
            status=baseline.status,
            messages=baseline.messages,
            perturbation=p,
            baseline=baseline,
        )

    # ---------- 逐原料 ±p% 扰动 ----------
    items: List[RobustnessItem] = []
    infeasible_count = 0
    scenario_count = 0
    for i in target_indices:
        base = float(x_base[i])
        up_amount = base * (1.0 + p / 100.0)
        down_amount = base * (1.0 - p / 100.0)

        note: Optional[str] = None
        if base <= EPS:
            note = "基准配方中该原料用量为 0，±相对扰动后用量仍为 0，配方不变"

        up = _run_scenario(
            "up", up_amount, req.oxides, req.target, req.materials, i,
            baseline.residual_norm,
        )
        down = _run_scenario(
            "down", down_amount, req.oxides, req.target, req.materials, i,
            baseline.residual_norm,
        )
        scenario_count += 2
        infeasible_count += int(not up.feasible) + int(not down.feasible)

        increases = [
            s.residual_increase for s in (up, down) if s.feasible
        ]
        items.append(
            RobustnessItem(
                material=req.materials[i].name,
                baseline_amount=round(base, 6),
                note=note,
                up=up,
                down=down,
                max_residual_increase=round(max(increases, default=0.0), 6),
            )
        )

    # ---------- 按残差增量降序，标出最敏感原料 ----------
    items.sort(key=lambda it: (-it.max_residual_increase, it.material))
    if len(items) > 1 and items[0].max_residual_increase > EPS:
        items[0].most_sensitive = True

    messages: List[str] = []
    if items:
        top = items[0]
        if len(items) > 1:
            if top.max_residual_increase > EPS:
                messages.append(
                    f"共分析 {len(items)} 种原料，按 ±{p:g}% 扰动后的残差增量降序排序，"
                    f"最敏感原料为「{top.material}」"
                    f"（最大残差增量 {top.max_residual_increase:.6f}）"
                )
            else:
                messages.append(
                    f"共分析 {len(items)} 种原料，±{p:g}% 扰动后各情景残差均无明显增量，"
                    "配方对该幅度扰动不敏感"
                )
        else:
            messages.append(
                f"已对原料「{top.material}」完成 ±{p:g}% 扰动分析"
            )
    if infeasible_count:
        messages.append(
            f"{scenario_count} 个扰动情景中有 {infeasible_count} 个因调整后用量超出"
            "上下界或破坏总量约束而不可行，详见各原料的冲突提示"
        )

    return RobustnessResponse(
        status=baseline.status,
        messages=messages,
        perturbation=p,
        baseline=baseline,
        results=items,
    )
