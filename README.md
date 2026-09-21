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

## 项目结构

```
├── docker-compose.yml      # 单条命令构建运行
├── backend/
│   ├── Dockerfile          # python:3.12-slim，镜像内 pip install
│   ├── requirements.txt
│   └── app/
│       ├── main.py         # FastAPI 入口（/api/health、/api/solve）
│       ├── models.py       # Pydantic 请求/响应模型
│       └── solver.py       # SciPy SLSQP 约束最小二乘求解 + 冲突检测
└── frontend/
    ├── Dockerfile          # node:20 构建 + nginx 托管
    ├── nginx.conf          # 静态托管 + /api 反向代理
    └── src/
        ├── App.tsx         # 主界面（氧化物表、原料表、结果表）
        ├── api.ts          # 后端调用
        ├── types.ts        # 类型定义
        └── sample.ts       # 示例数据
```
