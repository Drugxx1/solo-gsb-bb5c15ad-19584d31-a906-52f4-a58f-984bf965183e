import { useState } from 'react';
import { analyzeRobustness } from './api';
import type { ProblemData, RobustnessResponse, RobustnessScenario } from './types';

const SCENARIO_STATUS_LABEL: Record<RobustnessScenario['status'], string> = {
  ok: '精确解',
  approximate: '近似解',
  conflict: '边界冲突',
  error: '不可分析',
};

function fmt(v: number, digits = 4): string {
  return v.toFixed(digits);
}

function signed(v: number, digits = 4): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function deltaClass(v: number): string {
  if (v > 1e-6) return 'delta-pos';
  if (v < -1e-6) return 'delta-neg';
  return 'delta-zero';
}

export default function RobustnessPanel({ problem }: { problem: ProblemData }) {
  const enabledMaterials = problem.materials.filter((m) => !m.disabled);
  const [perturbation, setPerturbation] = useState('10');
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const [resp, setResp] = useState<RobustnessResponse | null>(null);

  const p = Number(perturbation);
  const perturbationValid =
    perturbation.trim() !== '' && Number.isFinite(p) && p > 0 && p <= 100;
  const selectedValid = enabledMaterials.some((m) => m.name === selected);

  const run = async (material: string | null) => {
    if (!perturbationValid) {
      setNetError('请输入 0~100 之间（不含 0）的扰动百分比');
      return;
    }
    setRunning(true);
    setNetError(null);
    try {
      setResp(await analyzeRobustness(problem, p, material));
    } catch (e) {
      setNetError(e instanceof Error ? e.message : String(e));
      setResp(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section>
      <h2>配方鲁棒性分析</h2>
      <p className="hint">
        选定一种原料，将其基准用量分别按 +扰动% / −扰动% 强制调整，其余原料在总量=100
        及全部上下界约束下重新求解；比较两种情景的配方变化、氧化物偏差与残差增量。
        残差增量越大表示该原料越敏感；扰动与边界冲突时对应情景会单独标注。
      </p>

      <div className="robust-controls">
        <label>
          单次扰动
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={perturbation}
            onChange={(e) => setPerturbation(e.target.value)}
          />
          %
        </label>
        <label>
          原料
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">请选择原料…</option>
            {enabledMaterials.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={running || !selectedValid}
          onClick={() => void run(selected)}
        >
          {running ? '分析中…' : '分析选中原料'}
        </button>
        <button
          disabled={running || enabledMaterials.length === 0}
          onClick={() => void run(null)}
          title="对全部启用原料分别做 ±扰动分析，并按残差增量排序"
        >
          一键分析全部启用原料（{enabledMaterials.length}）
        </button>
      </div>

      {netError && <div className="banner error">请求失败：{netError}</div>}

      {resp && (resp.status === 'error' || resp.status === 'conflict') && (
        <div className={`banner ${resp.status}`}>
          <strong>{resp.status === 'conflict' ? '边界冲突' : '错误'}</strong>
          {resp.messages.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}

      {resp && resp.status !== 'error' && resp.status !== 'conflict' && (
        <>
          <div className={`banner ${resp.status}`}>
            {resp.messages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>

          <p className="hint">
            基准配方残差范数 {fmt(resp.baseline_residual_norm, 6)}；共分析{' '}
            {resp.analyzed_count} 种原料，其中 {resp.feasible_count} 种可在扰动后重新求解。
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>排序</th>
                  <th>原料</th>
                  <th>基准用量</th>
                  <th>+{resp.perturbation}% 残差增量</th>
                  <th>−{resp.perturbation}% 残差增量</th>
                  <th>最大残差增量</th>
                  <th>敏感性</th>
                </tr>
              </thead>
              <tbody>
                {resp.results.map((r, i) => {
                  const up = r.scenarios.find((s) => s.direction === 'up');
                  const down = r.scenarios.find((s) => s.direction === 'down');
                  const cell = (s: RobustnessScenario | undefined) =>
                    !s || s.status === 'conflict' || s.status === 'error' ? (
                      <span className="conflict-text">
                        {s?.status === 'conflict' ? '冲突' : '不可分析'}
                      </span>
                    ) : (
                      <span className={deltaClass(s.residual_increase)}>
                        {signed(s.residual_increase, 6)}
                      </span>
                    );
                  return (
                    <tr key={r.material} className={r.is_most_sensitive ? 'most-sensitive-row' : ''}>
                      <td>{r.max_residual_increase !== null ? i + 1 : '—'}</td>
                      <td>
                        {r.material}
                        {r.is_most_sensitive && <span className="sens-badge">最敏感</span>}
                      </td>
                      <td>{fmt(r.baseline_amount)}</td>
                      <td>{cell(up)}</td>
                      <td>{cell(down)}</td>
                      <td>
                        {r.max_residual_increase !== null ? (
                          <strong className={deltaClass(r.max_residual_increase)}>
                            {fmt(r.max_residual_increase, 6)}
                          </strong>
                        ) : (
                          <span className="conflict-text">—</span>
                        )}
                      </td>
                      <td>{r.is_most_sensitive ? '★ 最高' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {resp.results.map((r) => (
            <details
              key={r.material}
              open={resp.analyzed_count === 1 || r.is_most_sensitive}
              className="material-details"
            >
              <summary>
                {r.material}（基准用量 {fmt(r.baseline_amount)}）
                {r.is_most_sensitive && <span className="sens-badge">最敏感原料</span>}
              </summary>

              <div className="scenario-grid">
                {r.scenarios.map((s) => (
                  <div key={s.direction} className={`scenario-card scenario-${s.direction}`}>
                    <h4>
                      <span className={`dir-badge dir-${s.direction}`}>{s.label}</span>
                      情景
                      <span className={`status-tag status-${s.status}`}>
                        {SCENARIO_STATUS_LABEL[s.status]}
                      </span>
                    </h4>
                    {s.forced_amount !== null && (
                      <p className="hint">
                        「{r.material}」用量强制为 {fmt(s.forced_amount)}
                      </p>
                    )}
                    {s.messages.map((msg, i) => (
                      <div key={i} className="banner conflict scenario-msg">
                        {msg}
                      </div>
                    ))}

                    {s.status !== 'conflict' && s.status !== 'error' && (
                      <>
                        <p className="hint">
                          残差范数 {fmt(s.residual_norm, 6)}，相对基准增量{' '}
                          <strong className={deltaClass(s.residual_increase)}>
                            {signed(s.residual_increase, 6)}
                          </strong>
                        </p>

                        <table>
                          <thead>
                            <tr>
                              <th>原料</th>
                              <th>基准用量</th>
                              <th>情景用量</th>
                              <th>变化</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...s.recipe]
                              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                              .map((row) => (
                                <tr key={row.material}>
                                  <td>{row.material}</td>
                                  <td>{fmt(row.baseline_amount)}</td>
                                  <td>{fmt(row.scenario_amount)}</td>
                                  <td className={deltaClass(row.delta)}>{signed(row.delta)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>

                        <table>
                          <thead>
                            <tr>
                              <th>氧化物</th>
                              <th>目标 %</th>
                              <th>实际 %</th>
                              <th>偏差</th>
                              <th>基准偏差</th>
                              <th>偏差变化</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.oxides.map((o) => (
                              <tr key={o.oxide}>
                                <td>{o.oxide}</td>
                                <td>{fmt(o.target)}</td>
                                <td>{fmt(o.achieved)}</td>
                                <td className={Math.abs(o.deviation) <= 0.01 ? 'dev-ok' : 'dev-bad'}>
                                  {signed(o.deviation)}
                                </td>
                                <td>{signed(o.baseline_deviation)}</td>
                                <td className={deltaClass(o.delta_deviation)}>
                                  {signed(o.delta_deviation)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
