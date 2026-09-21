"""鲁棒性分析端到端冒烟测试（不依赖 pytest，直接断言）。"""
import sys

sys.path.insert(0, ".")

from fastapi.testclient import TestClient

from app.main import app
from app.solver import solve_recipe
from app.models import MaterialIn

client = TestClient(app)

PROBLEM = {
    "oxides": ["SiO2", "Al2O3", "CaO", "MgO", "K2O", "Na2O", "ZnO"],
    "target": {
        "SiO2": 55.46, "Al2O3": 11.55, "CaO": 10.4, "MgO": 1.76,
        "K2O": 4.01, "Na2O": 1.23, "ZnO": 2.97,
    },
    "materials": [
        {"name": "钾长石", "disabled": False, "min": 0, "max": 100,
         "composition": {"SiO2": 68.5, "Al2O3": 17.0, "CaO": 0.3, "K2O": 10.0, "Na2O": 3.0}},
        {"name": "石英", "disabled": False, "min": 0, "max": 100,
         "composition": {"SiO2": 99.5}},
        {"name": "方解石", "disabled": False, "min": 0, "max": 100,
         "composition": {"CaO": 56.0}},
        {"name": "高岭土", "disabled": False, "min": 0, "max": 100,
         "composition": {"SiO2": 46.5, "Al2O3": 38.0}},
        {"name": "白云石", "disabled": False, "min": 0, "max": 100,
         "composition": {"CaO": 30.4, "MgO": 21.7}},
        {"name": "氧化锌", "disabled": False, "min": 0, "max": 100,
         "composition": {"ZnO": 99.0}},
        {"name": "膨润土", "disabled": False, "min": 0, "max": 100,
         "composition": {"SiO2": 59.0, "Al2O3": 19.0, "CaO": 1.0, "MgO": 2.5, "K2O": 1.0, "Na2O": 2.5}},
    ],
}

# 1) 旧接口兼容
r = client.post("/api/solve", json=PROBLEM).json()
assert r["status"] in ("ok", "approximate"), r
assert abs(r["total_amount"] - 100) < 1e-4
print("solve ok: residual =", r["residual_norm"])

# 2) 单原料 ±10%
r = client.post("/api/robustness", json={**PROBLEM, "perturbation": 10, "material": "钾长石"}).json()
assert r["status"] in ("ok", "approximate"), r
assert r["analyzed_count"] == 1
res0 = r["results"][0]
assert res0["is_most_sensitive"] is True
for s in res0["scenarios"]:
    assert s["status"] in ("ok", "approximate"), s["messages"]
    total = sum(x["scenario_amount"] for x in s["recipe"])
    assert abs(total - 100) < 1e-3, total
    # 被扰动原料用量必须精确等于 forced_amount
    forced = next(x for x in s["recipe"] if x["material"] == "钾长石")
    assert abs(forced["scenario_amount"] - s["forced_amount"]) < 1e-4
    # 氧化物结果键齐全
    assert len(s["oxides"]) == len(PROBLEM["oxides"])
up = next(s for s in res0["scenarios"] if s["direction"] == "up")
assert abs(up["forced_amount"] - res0["baseline_amount"] * 1.1) < 1e-4
print("single material ok: up incr =", up["residual_increase"], "max =", res0["max_residual_increase"])

# 3) 全量分析：按残差增量降序，最敏感排第一
r = client.post("/api/robustness", json={**PROBLEM, "perturbation": 10, "material": None}).json()
assert r["analyzed_count"] == 7
incr = [x["max_residual_increase"] for x in r["results"]]
assert incr == sorted(incr, reverse=True), incr
assert r["most_sensitive_material"] == r["results"][0]["material"]
assert r["results"][0]["is_most_sensitive"] is True
print("ranking:", [(x["material"], x["max_residual_increase"]) for x in r["results"]])

# 4) 边界冲突：把氧化锌 min 设为 3.5，扰动其 +50% 后强制用量 ≈ 4.5 超过 max=4
p4 = {**PROBLEM, "materials": [dict(m) for m in PROBLEM["materials"]]}
for m in p4["materials"]:
    if m["name"] == "氧化锌":
        m["max"] = 4.0
r = client.post("/api/robustness", json={**p4, "perturbation": 50, "material": "氧化锌"}).json()
s_up = next(s for s in r["results"][0]["scenarios"] if s["direction"] == "up")
assert s_up["status"] == "conflict", s_up
assert "边界" in s_up["messages"][0]
s_down = next(s for s in r["results"][0]["scenarios"] if s["direction"] == "down")
assert s_down["status"] in ("ok", "approximate"), s_down
print("bounds conflict up ok:", s_up["messages"][0])

# 5) 其余原料无法补足：所有其他原料 max=5，扰动钾长石 -50%（需其余原料补 ~80）
p5 = {**PROBLEM, "materials": [
    dict(m, max=5) if m["name"] != "钾长石" else dict(m) for m in PROBLEM["materials"]
]}
r = client.post("/api/robustness", json={**p5, "perturbation": 50, "material": "钾长石"}).json()
s_down = next(s for s in r["results"][0]["scenarios"] if s["direction"] == "down")
assert s_down["status"] == "conflict", s_down
print("infeasible complement ok:", s_down["messages"][0])

# 6) 错误输入
r = client.post("/api/robustness", json={**PROBLEM, "perturbation": 0, "material": "石英"}).json()
assert r["status"] == "error", r
r = client.post("/api/robustness", json={**PROBLEM, "perturbation": 10, "material": "不存在"}).json()
assert r["status"] == "error", r
r = client.post("/api/robustness", json={**PROBLEM, "perturbation": 150, "material": "石英"}).json()
# pydantic 422 由 FastAPI 拦截
print("input guards ok")

# 7) 基准用量为 0 的原料：氧化锌被下限过量供给后，新增的纯 ZnO 原料不会被采用
p7 = {**PROBLEM, "materials": [
    *[dict(m, min=3.5, max=3.5) if m["name"] == "氧化锌" else dict(m)
      for m in PROBLEM["materials"]],
    {"name": "多余锌", "disabled": False, "min": 0, "max": 100,
     "composition": {"ZnO": 99.0}},
]}
r = client.post("/api/robustness", json={**p7, "perturbation": 10, "material": "多余锌"}).json()
assert r["results"][0]["baseline_amount"] == 0, r["results"][0]
for s in r["results"][0]["scenarios"]:
    assert s["status"] == "error" and "用量为 0" in s["messages"][0], s
print("zero baseline guard ok")

# 8) 禁用原料不可分析
p8 = {**PROBLEM, "materials": [
    dict(m, disabled=True) if m["name"] == "石英" else dict(m) for m in PROBLEM["materials"]
]}
r = client.post("/api/robustness", json={**p8, "perturbation": 10, "material": "石英"}).json()
assert r["status"] == "error" and "禁用" in r["messages"][0], r
print("disabled guard ok")

# 9) 固定用量求解器直接调用
mats = [MaterialIn(**m) for m in PROBLEM["materials"]]
sol = solve_recipe(PROBLEM["oxides"], PROBLEM["target"], mats, fixed={0: 30.0})
assert sol.status in ("ok", "approximate")
x0 = sol.recipe[0].amount
assert abs(x0 - 30.0) < 1e-6
assert abs(sum(i.amount for i in sol.recipe) - 100) < 1e-4
print("solver fixed ok, recipe[0] =", x0)

# HTTP 422 for perturbation out of schema range
resp = client.post("/api/robustness", json={**PROBLEM, "perturbation": 150, "material": "石英"})
assert resp.status_code == 422, resp.status_code

print("\nALL TESTS PASSED")
