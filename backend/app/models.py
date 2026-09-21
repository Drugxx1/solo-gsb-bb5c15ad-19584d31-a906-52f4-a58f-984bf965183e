"""Pydantic 数据模型：请求与响应。"""
from __future__ import annotations

from typing import Dict, List, Literal

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
