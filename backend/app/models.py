"""Pydantic 数据模型：请求与响应。"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class MaterialIn(BaseModel):
    """一种原料的输入定义。"""

    name: str = Field(..., min_length=1, description="原料名称")
    composition: Dict[str, float] = Field(
        default_factory=dict, description="氧化物组成，键为氧化物名，值为重量百分数"
    )
    min: float = Field(0.0, ge=0.0, description="最小用量")
    max: float = Field(100.0, ge=0.0, description="最大用量")
    disabled: bool = Field(False, description="是否禁用（禁用即用量固定为 0）")


class SolveRequest(BaseModel):
    oxides: List[str] = Field(..., description="参与计算的氧化物列表")
    target: Dict[str, float] = Field(..., description="目标氧化物比例（重量百分数）")
    materials: List[MaterialIn] = Field(..., description="原料列表")


class RecipeItem(BaseModel):
    material: str
    amount: float


class OxideResult(BaseModel):
    oxide: str
    target: float
    achieved: float
    deviation: float


class SolveResponse(BaseModel):
    status: Literal["ok", "approximate", "conflict", "error"]
    messages: List[str] = Field(default_factory=list)
    recipe: List[RecipeItem] = Field(default_factory=list)
    oxides: List[OxideResult] = Field(default_factory=list)
    total_amount: float = 0.0
    residual_norm: float = 0.0


# ---------- 配方鲁棒性分析 ----------


class RobustnessRequest(BaseModel):
    oxides: List[str] = Field(..., description="参与计算的氧化物列表")
    target: Dict[str, float] = Field(..., description="目标氧化物比例（重量百分数）")
    materials: List[MaterialIn] = Field(..., description="原料列表")
    perturbation: float = Field(
        ..., gt=0.0, description="单次扰动百分比（相对基准用量），如 5 表示 ±5%"
    )
    material: Optional[str] = Field(
        None, description="只分析指定原料；为空时分析全部启用原料"
    )


class ScenarioResult(BaseModel):
    """单个扰动情景（上调 / 下调）的重新求解结果。"""

    direction: Literal["up", "down"]
    perturbed_amount: float = Field(..., description="该原料被调整到的用量")
    feasible: bool = Field(..., description="调整后是否仍满足全部约束并成功求解")
    status: Literal["ok", "approximate", "conflict", "error"]
    messages: List[str] = Field(default_factory=list)
    recipe: List[RecipeItem] = Field(default_factory=list)
    oxides: List[OxideResult] = Field(default_factory=list)
    residual_norm: float = 0.0
    residual_increase: float = Field(
        0.0, description="相对基准解的残差增量（不可行时为 null 的兜底 0）"
    )


class RobustnessItem(BaseModel):
    """单种原料的鲁棒性分析结果（含上下调两个情景）。"""

    material: str
    baseline_amount: float = Field(..., description="基准配方中的用量")
    note: Optional[str] = Field(None, description="边界用量为 0 等提示")
    up: ScenarioResult
    down: ScenarioResult
    max_residual_increase: float = Field(
        ..., description="两个情景中较大的残差增量，用于敏感度排序"
    )
    most_sensitive: bool = Field(False, description="是否为残差增量最大的原料")


class RobustnessResponse(BaseModel):
    status: Literal["ok", "approximate", "conflict", "error"]
    messages: List[str] = Field(default_factory=list)
    perturbation: float
    baseline: Optional[SolveResponse] = None
    results: List[RobustnessItem] = Field(default_factory=list)
