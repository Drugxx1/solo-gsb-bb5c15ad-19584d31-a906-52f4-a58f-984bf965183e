import { useRef, useState } from 'react';
import { solveProblem } from './api';
import { SAMPLE_PROBLEM } from './sample';
import RobustnessPanel from './Robustness';
import type { MaterialState, ProblemData, SolveResponse } from './types';

const TOTAL = 100;

function newMaterial(oxides: string[], index: number): MaterialState {
  const composition: Record<string, number> = {};
  oxides.forEach((o) => (composition[o] = 0));
  return { name: `原料${index}`, disabled: false, min: 0, max: TOTAL, composition };
}

/** 校验并规整导入的 JSON，非法时抛出中文错误信息 */
function parseProblem(data: unknown): ProblemData {
  if (typeof data !== 'object' || data === null) throw new Error('JSON 顶层必须是对象');
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.oxides) || obj.oxides.length === 0)
    throw new Error('缺少非空的 oxides 数组');
  const oxides = obj.oxides.map((o) => {
    if (typeof o !== 'string' || o.trim() === '') throw new Error('oxides 中必须是非空字符串');
    return o.trim();
  });
  if (new Set(oxides).size !== oxides.length) throw new Error('oxides 中存在重复名称');

  if (typeof obj.target !== 'object' || obj.target === null)
    throw new Error('缺少 target 对象');
  const target: Record<string, number> = {};
  for (const o of oxides) {
    const v = (obj.target as Record<string, unknown>)[o];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
      throw new Error(`target.${o} 必须是非负数字`);
    target[o] = typeof v === 'number' ? v : 0;
  }

  if (!Array.isArray(obj.materials) || obj.materials.length === 0)
    throw new Error('缺少非空的 materials 数组');
  const materials: MaterialState[] = obj.materials.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`materials[${i}] 必须是对象`);
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== 'string' || m.name.trim() === '')
      throw new Error(`materials[${i}].name 必须是非空字符串`);
    const num = (key: string, def: number): number => {
      const v = m[key];
      if (v === undefined || v === null) return def;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
        throw new Error(`materials[${i}].${key} 必须是非负数字`);
      return v;
    };
    const composition: Record<string, number> = {};
    const rawComp = (m.composition ?? {}) as Record<string, unknown>;
    if (typeof rawComp !== 'object' || rawComp === null)
      throw new Error(`materials[${i}].composition 必须是对象`);
    for (const o of oxides) {
      const v = rawComp[o];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
        throw new Error(`materials[${i}].composition.${o} 必须是非负数字`);
      composition[o] = typeof v === 'number' ? v : 0;
    }
    return {
      name: m.name.trim(),
      disabled: m.disabled === true,
      min: num('min', 0),
      max: num('max', TOTAL),
      composition,
    };
  });

  return { oxides, target, materials };
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function NumInput({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      step="any"
      min="0"
      disabled={disabled}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}

const STATUS_LABEL: Record<SolveResponse['status'], string> = {
  ok: '精确解',
  approximate: '近似解',
  conflict: '边界冲突',
  error: '错误',
};

export default function App() {
  const [oxides, setOxides] = useState<string[]>(SAMPLE_PROBLEM.oxides);
  const [target, setTarget] = useState<Record<string, number>>(SAMPLE_PROBLEM.target);
  const [materials, setMaterials] = useState<MaterialState[]>(SAMPLE_PROBLEM.materials);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [solving, setSolving] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentProblem = (): ProblemData => ({ oxides, target, materials });

  // ---------- 氧化物操作 ----------
  const addOxide = () => {
    let i = oxides.length + 1;
    let name = `氧化物${i}`;
    while (oxides.includes(name)) name = `氧化物${++i}`;
    setOxides([...oxides, name]);
    setTarget({ ...target, [name]: 0 });
    setMaterials(
      materials.map((m) => ({ ...m, composition: { ...m.composition, [name]: 0 } })),
    );
  };

  const removeOxide = (name: string) => {
    setOxides(oxides.filter((o) => o !== name));
    const t = { ...target };
    delete t[name];
    setTarget(t);
    setMaterials(
      materials.map((m) => {
        const c = { ...m.composition };
        delete c[name];
        return { ...m, composition: c };
      }),
    );
  };

  const renameOxide = (oldName: string, newName: string, input: HTMLInputElement) => {
    if (newName === '' || newName === oldName) {
      input.value = oldName;
      return;
    }
    if (oxides.includes(newName)) {
      alert(`氧化物「${newName}」已存在`);
      input.value = oldName;
      return;
    }
    setOxides(oxides.map((o) => (o === oldName ? newName : o)));
    const t: Record<string, number> = {};
    for (const o of oxides) t[o === oldName ? newName : o] = target[o] ?? 0;
    setTarget(t);
    setMaterials(
      materials.map((m) => {
        const c: Record<string, number> = {};
        for (const o of oxides) c[o === oldName ? newName : o] = m.composition[o] ?? 0;
        return { ...m, composition: c };
      }),
    );
  };

  // ---------- 原料操作 ----------
  const updateMaterial = (idx: number, patch: Partial<MaterialState>) =>
    setMaterials(materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const setComposition = (idx: number, oxide: string, value: number) =>
    setMaterials(
      materials.map((m, i) =>
        i === idx ? { ...m, composition: { ...m.composition, [oxide]: value } } : m,
      ),
    );

  // ---------- 求解 / 导入导出 ----------
  const doSolve = async () => {
    setSolving(true);
    setNetError(null);
    try {
      setResult(await solveProblem(currentProblem()));
    } catch (e) {
      setNetError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setSolving(false);
    }
  };

  const loadSample = () => {
    setOxides(SAMPLE_PROBLEM.oxides);
    setTarget(SAMPLE_PROBLEM.target);
    setMaterials(SAMPLE_PROBLEM.materials);
    setResult(null);
    setNetError(null);
  };

  const onImportFile = async (file: File) => {
    try {
      const parsed = parseProblem(JSON.parse(await file.text()));
      setOxides(parsed.oxides);
      setTarget(parsed.target);
      setMaterials(parsed.materials);
      setResult(null);
      setNetError(null);
    } catch (e) {
      alert(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="page">
      <header>
        <h1>釉料配方反推</h1>
        <div className="toolbar">
          <button onClick={loadSample}>加载示例数据</button>
          <button onClick={() => downloadJson(currentProblem(), 'glaze-problem.json')}>
            导出配方 JSON
          </button>
          <button onClick={() => fileInputRef.current?.click()}>导入配方 JSON</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
          <button className="primary" disabled={solving} onClick={() => void doSolve()}>
            {solving ? '求解中…' : '求解配方'}
          </button>
        </div>
      </header>

      <section>
        <h2>
          目标氧化物比例（%）
          <button className="small" onClick={addOxide}>
            + 添加氧化物
          </button>
        </h2>
        <table>
          <thead>
            <tr>
              <th>氧化物</th>
              <th>目标 %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {oxides.map((o) => (
              <tr key={o}>
                <td>
                  <input
                    key={o}
                    className="name"
                    defaultValue={o}
                    onBlur={(e) => renameOxide(o, e.target.value.trim(), e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </td>
                <td>
                  <NumInput
                    value={target[o] ?? 0}
                    onChange={(v) => setTarget({ ...target, [o]: v })}
                  />
                </td>
                <td>
                  <button className="small danger" onClick={() => removeOxide(o)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>
          原料组成与用量边界
          <button
            className="small"
            onClick={() => setMaterials([...materials, newMaterial(oxides, materials.length + 1)])}
          >
            + 添加原料
          </button>
        </h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>原料</th>
                <th>禁用</th>
                <th>最小</th>
                <th>最大</th>
                {oxides.map((o) => (
                  <th key={o}>{o} %</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m, idx) => (
                <tr key={idx} className={m.disabled ? 'disabled-row' : ''}>
                  <td>
                    <input
                      className="name"
                      value={m.name}
                      onChange={(e) => updateMaterial(idx, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.disabled}
                      onChange={(e) => updateMaterial(idx, { disabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <NumInput
                      value={m.min}
                      disabled={m.disabled}
                      onChange={(v) => updateMaterial(idx, { min: v })}
                    />
                  </td>
                  <td>
                    <NumInput
                      value={m.max}
                      disabled={m.disabled}
                      onChange={(v) => updateMaterial(idx, { max: v })}
                    />
                  </td>
                  {oxides.map((o) => (
                    <td key={o}>
                      <NumInput
                        value={m.composition[o] ?? 0}
                        onChange={(v) => setComposition(idx, o, v)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="small danger"
                      onClick={() => setMaterials(materials.filter((_, i) => i !== idx))}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          组成按重量百分数填写（不必凑满 100，烧失量可忽略）；禁用原料用量固定为 0；最大用量超过
          100 时按 100 处理。
        </p>
      </section>

      {netError && <div className="banner error">请求失败：{netError}</div>}

      {result && (
        <section>
          <h2>求解结果</h2>
          <div className={`banner ${result.status}`}>
            <strong>{STATUS_LABEL[result.status]}</strong>
            {result.status !== 'conflict' && result.status !== 'error' && (
              <span>
                　总量 {result.total_amount.toFixed(4)}　残差范数{' '}
                {result.residual_norm.toFixed(6)}
              </span>
            )}
            {result.messages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>

          {result.recipe.length > 0 && (
            <>
              <h3>
                配方（总量 100）
                <button
                  className="small"
                  onClick={() => downloadJson(result, 'glaze-result.json')}
                >
                  导出结果 JSON
                </button>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>原料</th>
                    <th>用量</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.recipe]
                    .sort((a, b) => b.amount - a.amount)
                    .map((r) => (
                      <tr key={r.material}>
                        <td>{r.material}</td>
                        <td className={r.amount === 0 ? 'zero' : ''}>{r.amount.toFixed(4)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>

              <h3>氧化物逐项对比</h3>
              <table>
                <thead>
                  <tr>
                    <th>氧化物</th>
                    <th>目标 %</th>
                    <th>实际 %</th>
                    <th>偏差</th>
                  </tr>
                </thead>
                <tbody>
                  {result.oxides.map((o) => (
                    <tr key={o.oxide}>
                      <td>{o.oxide}</td>
                      <td>{o.target.toFixed(4)}</td>
                      <td>{o.achieved.toFixed(4)}</td>
                      <td className={Math.abs(o.deviation) <= 0.01 ? 'dev-ok' : 'dev-bad'}>
                        {o.deviation >= 0 ? '+' : ''}
                        {o.deviation.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <RobustnessPanel problem={currentProblem()} />
    </div>
  );
}
