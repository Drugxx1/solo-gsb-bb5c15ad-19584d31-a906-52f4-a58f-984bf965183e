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
- 内置示例数据（中温透明釉），一键加载
- 配方 JSON **导入 / 导出**，求解结果 JSON 导出
- 结果表：各原料用量、各氧化物目标 / 实际 / 偏差、残差范数
- **配方鲁棒性分析**：输入单次扰动百分比并选择原料，将该原料用量按
  ±扰动% 强制调整，在总量 = 100 与全部上下界约束下重新求解；展示两种
  情景的配方变化、各氧化物偏差与残差增量，按残差增量降序排序并标出
  **最敏感原料**；支持一键分析全部启用原料；调整后用量越界或破坏总量
  约束时给出冲突提示（基准用量为 0 的原料会特别标注），分析结果可导出 JSON

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

导入 / 导出的配方 JSON 与请求体结构一致（`oxides` / `target` / `materials`）。

### `POST /api/robustness`

在 `/api/solve` 同一问题结构上新增 `perturbation`（单次扰动百分比，>0）
与可选 `material`（原料名；省略时分析全部启用原料）：

```json
{
  "oxides": ["SiO2", "Al2O3"],
  "target": { "SiO2": 55.46, "Al2O3": 11.55 },
  "materials": [ /* 与 /api/solve 相同 */ ],
  "perturbation": 5,
  "material": "方解石"
}
```

响应：

```json
{
  "status": "ok | approximate | conflict | error",
  "messages": ["共分析 7 种原料……最敏感原料为「方解石」……"],
  "perturbation": 5.0,
  "baseline": { /* 与 /api/solve 响应相同的基准解 */ },
  "results": [
    {
      "material": "方解石",
      "baseline_amount": 14.0,
      "note": null,
      "max_residual_increase": 0.211169,
      "most_sensitive": true,
      "up":   { "direction": "up",   "perturbed_amount": 14.7, "feasible": true,
                "recipe": [ /* 调整后的完整配方 */ ],
                "oxides": [ /* 目标 / 调整后实际 / 偏差 */ ],
                "residual_norm": 0.2131, "residual_increase": 0.2111 },
      "down": { "direction": "down", "perturbed_amount": 13.3, "feasible": false,
                "status": "conflict",
                "messages": ["原料「方解石」被调整后的用量 13.3 超出其用量边界 [14, 100]"] }
    }
  ]
}
```

- 每个原料包含 `up`（+扰动%）/`down`（−扰动%）两个情景；
  不可行情景 `feasible=false` 并在 `messages` 中说明越界或总量冲突
- `results` 按 `max_residual_increase` 降序排列，
  第一名置 `most_sensitive=true`（单原料分析时不标注排名）
- 基准解本身为 `conflict` / `error` 时直接透传状态与消息，不产出 `results`

## 项目结构

```
├── docker-compose.yml      # 单条命令构建运行
├── backend/
│   ├── Dockerfile          # python:3.12-slim，镜像内 pip install
│   ├── requirements.txt
│   └── app/
│       ├── main.py         # FastAPI 入口（/api/health、/api/solve、/api/robustness）
│       ├── models.py       # Pydantic 请求/响应模型
│       ├── solver.py       # SciPy SLSQP 约束最小二乘求解 + 冲突检测
│       └── robustness.py   # ±扰动重新求解与敏感度排序
└── frontend/
    ├── Dockerfile          # node:20 构建 + nginx 托管
    ├── nginx.conf          # 静态托管 + /api 反向代理
    └── src/
        ├── App.tsx           # 主界面（氧化物表、原料表、结果表）
        ├── RobustnessPanel.tsx # 鲁棒性分析面板（扰动控制、情景对比）
        ├── api.ts            # 后端调用
        ├── types.ts          # 类型定义
        └── sample.ts         # 示例数据
```
