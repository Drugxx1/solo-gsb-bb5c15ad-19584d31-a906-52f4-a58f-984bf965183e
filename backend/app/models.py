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


# ---------------- 配方鲁棒性分析 ----------------


class RobustnessRequest(BaseModel):
    oxides: List[str] = Field(..., description="参与计算的氧化物列表")
    target: Dict[str, float] = Field(..., description="目标氧化物比例（重量百分数）")
    materials: List[MaterialIn] = Field(..., description="原料列表")
    perturbation: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="单次扰动百分数，如 10 表示把选中原料用量分别按 ±10% 调整",
    )
    material: Optional[str] = Field(
        None, description="要分析的原料名；为 null 时分析全部启用原料"
    )


class ScenarioRecipeItem(BaseModel):
    material: str
    baseline_amount: float
    scenario_amount: float
    delta: float = Field(..., description="相对基准配方的用量变化")


class ScenarioOxideItem(BaseModel):
    oxide: str
    target: float
    achieved: float
    deviation: float
    baseline_deviation: float
    delta_deviation: float = Field(..., description="偏差相对基准解的变化量")


class RobustnessScenario(BaseModel):
    direction: Literal["up", "down"]
    label: str = Field(..., description="情景说明，如 +10% / −10%")
    forced_amount: Optional[float] = Field(None, description="该原料被强制调整到的用量")
    status: Literal["ok", "approximate", "conflict", "error"]
    messages: List[str] = Field(default_factory=list)
    recipe: List[ScenarioRecipeItem] = Field(default_factory=list)
    oxides: List[ScenarioOxideItem] = Field(default_factory=list)
    residual_norm: float = 0.0
    residual_increase: float = Field(0.0, description="残差范数相对基准解的增量")


class RobustnessResult(BaseModel):
    material: str
    baseline_amount: float = Field(..., description="该原料在基准配方中的用量")
    scenarios: List[RobustnessScenario]
    max_residual_increase: Optional[float] = Field(
        None, description="两种可行情景中较大的残差增量；无可行情景时为 null"
    )
    is_most_sensitive: bool = Field(False, description="是否为残差增量最大的原料")


class RobustnessResponse(BaseModel):
    status: Literal["ok", "approximate", "conflict", "error"]
    messages: List[str] = Field(default_factory=list)
    perturbation: float
    baseline_residual_norm: float = 0.0
    analyzed_count: int = 0
    feasible_count: int = 0
    most_sensitive_material: Optional[str] = Field(None, description="残差增量最大的原料")
    results: List[RobustnessResult] = Field(default_factory=list)
