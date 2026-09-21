# 釉料配方反推（Glaze Recipe Solver）

根据目标氧化物比例，反推各原料用量的 Web 应用。

- **前端**：React + TypeScript（Vite 构建，nginx 托管）
- **后端**：FastAPI + SciPy（SLSQP 约束最小二乘）

## 功能

- 录入目标氧化物比例（%）与各原料的氧化物组成
- 每种原料可设置 **禁用**、**最小用量**、**最大用量**
- 求解满足以下约束的最小残差配方：
  - 各原料用量之和 = 100
  - 用量非负，且落在各自 [min, max] 边界内
  - 最小化各氧化物「实际值 − 目标值」的平方和
- **边界冲突检测**：如「最小用量之和 > 100」「最大用量之和 < 100」「某原料 min > max」，
  直接指出冲突的约束与涉及原料
- **目标不可精确达到**时，仍返回满足全部边界的最小残差配方，并给出逐项偏差
- **配方鲁棒性分析**：输入单次扰动百分比并选择原料，系统分别将该原料用量按
  ±扰动% 强制调整，并在总量=100 及全部上下界约束下重新求解；展示两种情景的
  配方变化、各氧化物偏差与残差增量；支持一键分析全部启用原料，按残差增量排序
  标出最敏感原料；扰动与边界冲突时逐情景给出中文提示
- 内置示例数据（中温透明釉），一键加载
- 配方 JSON **导入 / 导出**，求解结果 JSON 导出
- 结果表：各原料用量、各氧化物目标 / 实际 / 偏差、残差范数

## 运行（Docker Compose，单条命令）

```bash
docker compose up --build
```

依赖安装全部在镜像构建内完成，无需本地环境。

| 服务 | 地址 | 说明 |
| ---- | ---- | ---- |
| 前端 | <http://localhost:8080> | 应用入口（nginx，端口 8080 → 容器 80） |
| 后端 API | <http://localhost:8000> | FastAPI（端口 8000） |
| API 文档 | <http://localhost:8000/docs> | Swagger UI |

前端通过 nginx 将 `/api/*` 反向代理到后端容器。

## 本地开发（可选）

```bash
# 后端（http://localhost:8000）
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# 前端（http://localhost:5173，/api 自动代理到 8000）
cd frontend
npm install
npm run dev
```

## API

### `POST /api/solve`

请求体：

```json
{
  "oxides": ["SiO2", "Al2O3"],
  "target": { "SiO2": 55.46, "Al2O3": 11.55 },
  "materials": [
    {
      "name": "钾长石",
      "disabled": false,
      "min": 0,
      "max": 100,
      "composition": { "SiO2": 68.5, "Al2O3": 17.0 }
    }
  ]
}
```

响应：

```json
{
  "status": "ok | approximate | conflict | error",
  "messages": ["..."],
  "recipe": [{ "material": "钾长石", "amount": 39.98 }],
  "oxides": [
    { "oxide": "SiO2", "target": 55.46, "achieved": 55.4596, "deviation": -0.0004 }
  ],
  "total_amount": 100.0,
  "residual_norm": 0.0019
}
```

- `ok`：最大绝对偏差 ≤ 0.01 个百分点，视为精确达到
- `approximate`：目标不可精确达到，返回最小残差配方及逐项偏差
- `conflict`：边界互相矛盾，`messages` 列出冲突详情
- `error`：输入不足以求解（如无可用原料）

### `POST /api/robustness`

配方鲁棒性分析。请求体在 `solve` 基础上增加：

```json
{
  "...": "oxides / target / materials 与 /api/solve 完全一致",
  "perturbation": 10,
  "material": "钾长石"
}
```

- `perturbation`：单次扰动百分数（0 < p ≤ 100）
- `material`：原料名称；传 `null` 或省略时分析全部启用原料

后端先按原始约束求**基准配方**，再对每个目标原料构造 `+p%` / `−p%` 两个情景：
把该原料用量固定为 `基准用量 × (1±p/100)`，其余原料在总量=100 与各自
[min, max] 内重新求最小残差解。若强制用量超出该原料边界，或其余原料的
边界无法补足总量，对应情景返回 `conflict` 并说明冲突来源（不做钳位）。

响应摘要：

```json
{
  "status": "ok | approximate | conflict | error",
  "messages": ["…最敏感原料 / 冲突计数提示…"],
  "perturbation": 10.0,
  "baseline_residual_norm": 0.001954,
  "analyzed_count": 7,
  "feasible_count": 7,
  "most_sensitive_material": "方解石",
  "results": [
    {
      "material": "方解石",
      "baseline_amount": 14.007,
      "max_residual_increase": 0.442373,
      "is_most_sensitive": true,
      "scenarios": [
        {
          "direction": "up",
          "label": "+10%",
          "forced_amount": 15.4082,
          "status": "approximate",
          "residual_norm": 0.381665,
          "residual_increase": 0.381664,
          "recipe": [{ "material": "钾长石", "baseline_amount": 39.98, "scenario_amount": 38.52, "delta": -1.46 }],
          "oxides": [{ "oxide": "CaO", "target": 10.4, "achieved": 10.55, "deviation": 0.15, "baseline_deviation": 0.0, "delta_deviation": 0.15 }]
        },
        { "direction": "down", "label": "−10%", "...": "结构同上" }
      ]
    }
  ]
}
```

`results` 已按两情景中较大的残差增量（`max_residual_increase`）降序排列，
首位即最敏感原料；两情景均冲突的原料排末尾，增量为 `null`。

导入 / 导出的配方 JSON 与请求体结构一致（`oxides` / `target` / `materials`）。

## 项目结构

```
├── docker-compose.yml      # 单条命令构建运行
├── backend/
│   ├── Dockerfile          # python:3.12-slim，镜像内 pip install
│   ├── requirements.txt
│   └── app/
│       ├── main.py         # FastAPI 入口（/api/health、/api/solve、/api/robustness）
│       ├── models.py       # Pydantic 请求/响应模型
│       ├── solver.py       # SciPy SLSQP 约束最小二乘求解 + 冲突检测（支持 fixed 固定用量）
│       └── robustness.py   # 鲁棒性分析：±扰动情景重解、冲突检测、敏感性排序
└── frontend/
    ├── Dockerfile          # node:20 构建 + nginx 托管
    ├── nginx.conf          # 静态托管 + /api 反向代理
    └── src/
        ├── App.tsx         # 主界面（氧化物表、原料表、结果表）
        ├── Robustness.tsx  # 鲁棒性分析面板（单原料/一键全部、情景明细、排序）
        ├── api.ts          # 后端调用
        ├── types.ts        # 类型定义
        └── sample.ts       # 示例数据
```
