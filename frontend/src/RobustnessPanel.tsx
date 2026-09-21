import { useState } from 'react';
import { analyzeRobustness } from './api';
import type {
  OxideResult,
  ProblemData,
  RecipeItem,
  RobustnessItem,
  RobustnessResponse,
  ScenarioResult,
} from './types';

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(v: number, digits = 4): string {
  return v.toFixed(digits);
}

function deltaClass(v: number): string {
  return Math.abs(v) <= 0.01 ? 'dev-ok' : 'dev-bad';
}

/** 情景配方表：展示调整后各原料用量相对基准的变化 */
function RecipeDeltaTable({
  scenario,
  baselineRecipe,
}: {
  scenario: ScenarioResult;
  baselineRecipe: RecipeItem[];
}) {
  const baseMap = new Map(baselineRecipe.map((r) => [r.material, r.amount]));
  const rows = scenario.recipe
    .map((r) => ({ ...r, delta: r.amount - (baseMap.get(r.material) ?? 0) }))
    .sort((a, b) => b.amount - a.amount);
  return (
    <table>
      <thead>
        <tr>
          <th>原料</th>
          <th>基准用量</th>
          <th>调整后用量</th>
          <th>用量变化</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.material}>
            <td>{r.material}</td>
            <td>{fmt(baseMap.get(r.material) ?? 0)}</td>
            <td className={r.amount === 0 ? 'zero' : ''}>{fmt(r.amount)}</td>
            <td className={deltaClass(r.delta)}>
              {r.delta >= 0 ? '+' : ''}
              {fmt(r.delta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 情景氧化物表：展示调整后各氧化物实际值、相对基准与相对目标的偏差 */
function OxideDeltaTable({
  scenario,
  baselineOxides,
}: {
  scenario: ScenarioResult;
  baselineOxides: OxideResult[];
}) {
  const baseMap = new Map(baselineOxides.map((o) => [o.oxide, o.achieved]));
  return (
    <table>
      <thead>
        <tr>
          <th>氧化物</th>
          <th>目标 %</th>
          <th>基准实际 %</th>
          <th>调整后实际 %</th>
          <th>相对基准偏差</th>
          <th>相对目标偏差</th>
        </tr>
      </thead>
      <tbody>
        {scenario.oxides.map((o) => {
          const baseAchieved = baseMap.get(o.oxide) ?? o.target;
          const vsBase = o.achieved - baseAchieved;
          return (
            <tr key={o.oxide}>
              <td>{o.oxide}</td>
              <td>{fmt(o.target)}</td>
              <td>{fmt(baseAchieved)}</td>
              <td>{fmt(o.achieved)}</td>
              <td className={deltaClass(vsBase)}>
                {vsBase >= 0 ? '+' : ''}
                {fmt(vsBase)}
              </td>
              <td className={deltaClass(o.deviation)}>
                {o.deviation >= 0 ? '+' : ''}
                {fmt(o.deviation)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ScenarioCard({
  title,
  scenario,
  baseline,
}: {
  title: string;
  scenario: ScenarioResult;
  baseline: NonNullable<RobustnessResponse['baseline']>;
}) {
  return (
    <div className="scenario-card">
      <h5>{title}</h5>
      {!scenario.feasible ? (
        <div className="banner conflict">
          <strong>不可行情景</strong>
          {scenario.messages.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      ) : (
        <>
          <p className="scenario-meta">
            调整后用量 <strong>{fmt(scenario.perturbed_amount)}</strong>
            　残差范数 {fmt(scenario.residual_norm, 6)}（基准 {fmt(baseline.residual_norm, 6)}）
            　<span className="resid-up">残差增量 +{fmt(scenario.residual_increase, 6)}</span>
          </p>
          <RecipeDeltaTable scenario={scenario} baselineRecipe={baseline.recipe} />
          <OxideDeltaTable scenario={scenario} baselineOxides={baseline.oxides} />
        </>
      )}
    </div>
  );
}

function RobustnessDetail({
  item,
  baseline,
}: {
  item: RobustnessItem;
  baseline: NonNullable<RobustnessResponse['baseline']>;
}) {
  return (
    <div className="robust-detail">
      {item.note && <p className="hint">{item.note}</p>}
      <div className="scenario-grid">
        <ScenarioCard title={`上调 +：用量 → ${fmt(item.up.perturbed_amount)}`} scenario={item.up} baseline={baseline} />
        <ScenarioCard title={`下调 −：用量 → ${fmt(item.down.perturbed_amount)}`} scenario={item.down} baseline={baseline} />
      </div>
    </div>
  );
}

export default function RobustnessPanel({ problem }: { problem: ProblemData }) {
  const [perturbation, setPerturbation] = useState(5);
  const [material, setMaterial] = useState('');
  const [result, setResult] = useState<RobustnessResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);

  const enabledMaterials = problem.materials.filter((m) => !m.disabled);

  const run = async (mat: string | null | undefined) => {
    const p = Number(perturbation);
    if (!Number.isFinite(p) || p <= 0) {
      setNetError('请输入大于 0 的扰动百分比（例如 5 表示 ±5%）');
      return;
    }
    if (enabledMaterials.length === 0) {
      setNetError('当前没有启用的原料，无法分析');
      return;
    }
    if (mat === undefined) {
      setNetError('请选择一种启用的原料，或改用「一键分析全部启用原料」');
      return;
    }
    if (mat !== null && !enabledMaterials.some((m) => m.name === mat)) {
      setNetError('所选原料不存在或已被禁用');
      return;
    }
    setBusy(true);
    setNetError(null);
    try {
      const r = await analyzeRobustness({
        oxides: problem.oxides,
        target: problem.target,
        materials: problem.materials,
        perturbation: p,
        material: mat,
      });
      setResult(r);
      setExpanded(mat ?? r.results[0]?.material ?? null);
      if (r.status === 'conflict' || r.status === 'error') {
        setExpanded(null);
      }
    } catch (e) {
      setNetError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>配方鲁棒性分析</h2>
      <p className="hint">
        先在上方求解基准配方（分析接口会自行计算基准解）。输入单次扰动百分比并选择原料后，
        系统将该原料用量分别按 ±扰动% 强制调整，并在总量=100 与全部上下界约束下重新求解，
        按残差增量排序标出最敏感原料。
      </p>
      <div className="robust-controls">
        <label>
          单次扰动 %：
          <input
            type="number"
            step="any"
            min="0"
            value={Number.isFinite(perturbation) ? perturbation : 0}
            onChange={(e) => setPerturbation(e.target.value === '' ? NaN : Number(e.target.value))}
          />
        </label>
        <label>
          原料：
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">— 请选择原料 —</option>
            {enabledMaterials.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => void run(material || undefined)}>
          {busy ? '分析中…' : '分析所选原料'}
        </button>
        <button disabled={busy || enabledMaterials.length === 0} onClick={() => void run(null)}>
          一键分析全部启用原料（{enabledMaterials.length}）
        </button>
        {result && (
          <button onClick={() => downloadJson(result, 'glaze-robustness.json')}>
            导出分析结果 JSON
          </button>
        )}
      </div>

      {netError && <div className="banner error">{netError}</div>}

      {result && (
        <>
          <div className={`banner ${result.status}`}>
            {result.status === 'conflict' || result.status === 'error' ? (
              <strong>基准配方无法求解，鲁棒性分析终止</strong>
            ) : (
              <strong>
                基准解：{result.status === 'ok' ? '精确解' : '近似解'}，残差范数{' '}
                {fmt(result.baseline?.residual_norm ?? 0, 6)}
              </strong>
            )}
            {result.messages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>

          {result.results.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>敏感度排名</th>
                    <th>原料</th>
                    <th>基准用量</th>
                    <th>上调后用量</th>
                    <th>上调可行</th>
                    <th>上调残差增量</th>
                    <th>下调后用量</th>
                    <th>下调可行</th>
                    <th>下调残差增量</th>
                    <th>最大残差增量</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item, rank) => (
                    <RobustnessRow
                      key={item.material}
                      item={item}
                      rank={rank}
                      expanded={expanded === item.material}
                      onToggle={() =>
                        setExpanded(expanded === item.material ? null : item.material)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {expanded && result.baseline &&
            (() => {
              const item = result.results.find((r) => r.material === expanded);
              return item ? <RobustnessDetail item={item} baseline={result.baseline!} /> : null;
            })()}
        </>
      )}
    </section>
  );
}

function RobustnessRow({
  item,
  rank,
  expanded,
  onToggle,
}: {
  item: RobustnessItem;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cell = (s: ScenarioResult) =>
    s.feasible ? (
      <td className="resid-up">+{fmt(s.residual_increase, 6)}</td>
    ) : (
      <td className="infeasible">冲突</td>
    );
  return (
    <>
      <tr className={item.most_sensitive ? 'sensitive-row' : ''}>
        <td>
          {rank + 1}
          {item.most_sensitive && <span className="sensitive-badge"> 最敏感</span>}
        </td>
        <td>
          {item.material}
          {item.note && <span className="zero">（基准用量 0）</span>}
        </td>
        <td>{fmt(item.baseline_amount)}</td>
        <td>{fmt(item.up.perturbed_amount)}</td>
        <td>{item.up.feasible ? '是' : '否'}</td>
        {cell(item.up)}
        <td>{fmt(item.down.perturbed_amount)}</td>
        <td>{item.down.feasible ? '是' : '否'}</td>
        {cell(item.down)}
        <td className={item.max_residual_increase > 0 ? 'resid-up' : ''}>
          {item.up.feasible || item.down.feasible
            ? `+${fmt(item.max_residual_increase, 6)}`
            : '—'}
        </td>
        <td>
          <button className="small" onClick={onToggle}>
            {expanded ? '收起' : '详情'}
          </button>
        </td>
      </tr>
    </>
  );
}
