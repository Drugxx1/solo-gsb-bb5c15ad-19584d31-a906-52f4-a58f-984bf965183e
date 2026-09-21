"""配方鲁棒性分析。

对基准最优配方中的某种原料 i（用量 x0_i），分别把它的用量强制调整为

    x_i = x0_i * (1 + p/100)   （+p% 情景）
    x_i = x0_i * (1 - p/100)   （-p% 情景）

其余原料在「总量 = 100」与全部上下界约束下重新求解最小残差配方，
比较两种情景相对基准解的配方变化、氧化物偏差变化与残差增量。

若强制用量落到该原料的 [min, max] 之外，或其余原料的可行区间无法补足
总量（下界之和过大 / 上界之和过小），则对应情景判为边界冲突并给出说明，
不做钳位（钳位会掩盖「扰动不可行」这一信息）。
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .models import (
    MaterialIn,
    RobustnessResponse,
    RobustnessResult,
    RobustnessScenario,
    ScenarioOxideItem,
    ScenarioRecipeItem,
)
from .solver import EPS, TOTAL, solve_recipe


def _conflict_scenario(
    direction: str,
    label: str,
    forced: float,
    messages: List[str],
) -> RobustnessScenario:
    return RobustnessScenario(
        direction=direction,  # type: ignore[arg-type]
        label=label,
        forced_amount=round(float(forced), 6),
        status="conflict",
        messages=messages,
    )


def _check_scenario(
    materials: List[MaterialIn],
    idx: int,
    forced: float,
) -> Optional[str]:
    """检查强制某原料用量为 forced 后，整体约束是否仍可行。冲突时返回说明。"""
    m = materials[idx]

    if forced < -EPS or forced > TOTAL + EPS:
        return (
            f"扰动后用量 {forced:g} 超出 0~{TOTAL:g} 范围"
        )

    # 被扰动原料自身的上下界（启用状态下才受其 min/max 约束）
    if not m.disabled:
        lo_i = max(0.0, float(m.min))
        hi_i = min(float(m.max), TOTAL)
        if forced < lo_i - EPS or forced > hi_i + EPS:
            return (
                f"扰动后用量 {forced:g} 超出原料「{m.name}」的用量边界 "
                f"[{lo_i:g}, {hi_i:g}]，该扰动不可行"
            )

    # 其余原料需要补足的量
    rest = TOTAL - forced
    sum_lo = 0.0
    sum_hi = 0.0
    lows: List[str] = []
    highs: List[str] = []
    for j, other in enumerate(materials):
        if j == idx:
            continue
        if other.disabled:
            lo = hi = 0.0
        else:
            lo = max(0.0, float(other.min))
            hi = min(float(other.max), TOTAL)
            if lo > hi + EPS:
                return f"原料「{other.name}」的最小用量 {lo:g} 大于最大用量 {hi:g}，边界自相矛盾"
        sum_lo += lo
        sum_hi += hi
        if lo > EPS:
            lows.append(f"「{other.name}」≥{lo:g}")
        if hi < TOTAL - EPS:
            highs.append(f"「{other.name}」≤{hi:g}")

    if rest < sum_lo - EPS:
        return (
            f"原料「{m.name}」扰动至 {forced:g} 后，其余原料仅需提供 {rest:g}，"
            f"但它们的最小用量之和为 {sum_lo:g}（{'、'.join(lows)}），总量无法保持 {TOTAL:g}，边界冲突"
        )
    if rest > sum_hi + EPS:
        return (
            f"原料「{m.name}」扰动至 {forced:g} 后，其余原料需提供 {rest:g}，"
            f"但它们的最大用量之和仅为 {sum_hi:g}（{'、'.join(highs)}），总量无法保持 {TOTAL:g}，边界冲突"
        )
    return None


def _build_scenario(
    oxides: List[str],
    target: Dict[str, float],
    materials: List[MaterialIn],
    idx: int,
    baseline_x: Dict[str, float],
    baseline_dev: Dict[str, float],
    baseline_residual: float,
    forced: float,
    direction: str,
    label: str,
) -> RobustnessScenario:
    conflict = _check_scenario(materials, idx, forced)
    if conflict is not None:
        return _conflict_scenario(direction, label, forced, [conflict])

    sol = solve_recipe(oxides, target, materials, fixed={idx: forced})
    if sol.status in ("conflict", "error"):
        return _conflict_scenario(direction, label, forced, sol.messages)

    recipe = [
        ScenarioRecipeItem(
            material=r.material,
            baseline_amount=round(baseline_x.get(r.material, 0.0), 6),
            scenario_amount=r.amount,
            delta=round(r.amount - baseline_x.get(r.material, 0.0), 6),
        )
        for r in sol.recipe
    ]
    oxides_out = [
        ScenarioOxideItem(
            oxide=o.oxide,
            target=o.target,
            achieved=o.achieved,
            deviation=o.deviation,
            baseline_deviation=round(baseline_dev.get(o.oxide, 0.0), 6),
            delta_deviation=round(o.deviation - baseline_dev.get(o.oxide, 0.0), 6),
        )
        for o in sol.oxides
    ]
    return RobustnessScenario(
        direction=direction,  # type: ignore[arg-type]
        label=label,
        forced_amount=round(float(forced), 6),
        status=sol.status,
        messages=sol.messages,
        recipe=recipe,
        oxides=oxides_out,
        residual_norm=sol.residual_norm,
        residual_increase=round(sol.residual_norm - baseline_residual, 6),
    )


def analyze_robustness(
    oxides: List[str],
    target: Dict[str, float],
    materials: List[MaterialIn],
    perturbation: float,
    material: Optional[str],
) -> RobustnessResponse:
    # ---------- 输入校验 ----------
    messages: List[str] = []
    if not np.isfinite(perturbation) or perturbation < 0 or perturbation > 100:
        return RobustnessResponse(
            status="error",
            messages=["扰动百分比必须是 0~100 之间的数字"],
            perturbation=float(perturbation) if np.isfinite(perturbation) else 0.0,
        )
    if perturbation <= EPS:
        return RobustnessResponse(
            status="error", messages=["扰动百分比必须大于 0"], perturbation=perturbation
        )

    enabled_idx = [i for i, m in enumerate(materials) if not m.disabled]

    if material is not None:
        chosen = [i for i, m in enumerate(materials) if m.name == material]
        if not chosen:
            return RobustnessResponse(
                status="error",
                messages=[f"原料「{material}」不存在"],
                perturbation=perturbation,
            )
        idx = chosen[0]
        if materials[idx].disabled:
            return RobustnessResponse(
                status="error",
                messages=[f"原料「{material}」已被禁用，无法参与鲁棒性分析"],
                perturbation=perturbation,
            )
        targets = [idx]
    else:
        if not enabled_idx:
            return RobustnessResponse(
                status="error",
                messages=["所有原料均被禁用，无法进行鲁棒性分析"],
                perturbation=perturbation,
            )
        targets = enabled_idx

    # ---------- 基准解 ----------
    base = solve_recipe(oxides, target, materials)
    if base.status in ("conflict", "error"):
        return RobustnessResponse(
            status=base.status,  # type: ignore[arg-type]
            messages=(["基准配方无法求解，鲁棒性分析中止："] + base.messages),
            perturbation=perturbation,
        )

    baseline_x = {r.material: float(r.amount) for r in base.recipe}
    baseline_dev = {o.oxide: float(o.deviation) for o in base.oxides}
    baseline_residual = float(base.residual_norm)

    factor = perturbation / 100.0
    results: List[RobustnessResult] = []

    for idx in targets:
        m = materials[idx]
        x0 = baseline_x.get(m.name, 0.0)
        scenarios: List[RobustnessScenario] = []

        if x0 <= EPS:
            # 基准用量为 0：±p% 仍为 0，扰动没有定义，单独提示
            scenarios.append(
                RobustnessScenario(
                    direction="up",
                    label=f"+{perturbation:g}%",
                    forced_amount=0.0,
                    status="error",
                    messages=[
                        f"原料「{m.name}」在基准配方中用量为 0，按百分比 ±{perturbation:g}% "
                        f"扰动后仍为 0，无法分析其鲁棒性（可适当扰动百分比或调整其最小用量后重试）"
                    ],
                )
            )
            scenarios.append(
                RobustnessScenario(
                    direction="down",
                    label=f"−{perturbation:g}%",
                    forced_amount=0.0,
                    status="error",
                    messages=[
                        f"原料「{m.name}」在基准配方中用量为 0，按百分比 ±{perturbation:g}% "
                        f"扰动后仍为 0，无法分析其鲁棒性（可适当扰动百分比或调整其最小用量后重试）"
                    ],
                )
            )
            results.append(
                RobustnessResult(
                    material=m.name,
                    baseline_amount=0.0,
                    scenarios=scenarios,
                    max_residual_increase=None,
                )
            )
            continue

        forced_up = x0 * (1.0 + factor)
        forced_down = x0 * (1.0 - factor)
        scenarios.append(
            _build_scenario(
                oxides, target, materials, idx,
                baseline_x, baseline_dev, baseline_residual,
                forced_up, "up", f"+{perturbation:g}%",
            )
        )
        scenarios.append(
            _build_scenario(
                oxides, target, materials, idx,
                baseline_x, baseline_dev, baseline_residual,
                forced_down, "down", f"−{perturbation:g}%",
            )
        )

        feasible = [s.residual_increase for s in scenarios if s.status in ("ok", "approximate")]
        results.append(
            RobustnessResult(
                material=m.name,
                baseline_amount=round(x0, 6),
                scenarios=scenarios,
                max_residual_increase=round(max(feasible), 6) if feasible else None,
            )
        )

    # ---------- 排序与最敏感原料 ----------
    # 可分析（至少一个情景可行）的原料按残差增量降序，最敏感者排最前；
    # 两情景均冲突/错误的原料排最后。
    results.sort(
        key=lambda r: (
            r.max_residual_increase is None,
            -(r.max_residual_increase if r.max_residual_increase is not None else 0.0),
        )
    )
    feasible_results = [r for r in results if r.max_residual_increase is not None]
    most_sensitive = feasible_results[0].material if feasible_results else None
    if most_sensitive is not None:
        for r in results:
            r.is_most_sensitive = r.material == most_sensitive
        messages.append(
            f"在 ±{perturbation:g}% 用量扰动下，原料「{most_sensitive}」引起的残差增量最大"
            f"（{feasible_results[0].max_residual_increase:g}），为最敏感原料"
        )
    else:
        messages.append("所有原料的扰动情景均与边界冲突，无法比较敏感性")

    conflict_n = sum(
        1 for r in results for s in r.scenarios if s.status == "conflict"
    )
    if conflict_n:
        messages.append(f"共有 {conflict_n} 个扰动情景与上下界/总量约束冲突，已在对应情景中标注")

    status = base.status  # 基准解为 ok/approximate；情景状态在明细中分别给出
    return RobustnessResponse(
        status=status,  # type: ignore[arg-type]
        messages=messages,
        perturbation=perturbation,
        baseline_residual_norm=base.residual_norm,
        analyzed_count=len(results),
        feasible_count=len(feasible_results),
        most_sensitive_material=most_sensitive,
        results=results,
    )
