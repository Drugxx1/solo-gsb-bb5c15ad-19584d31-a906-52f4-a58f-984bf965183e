import type { ProblemData, RobustnessResponse, SolveResponse } from './types';

export async function solveProblem(problem: ProblemData): Promise<SolveResponse> {
  const resp = await fetch('/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(problem),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`服务器错误 ${resp.status}：${text}`);
  }
  return (await resp.json()) as SolveResponse;
}

export async function analyzeRobustness(
  problem: ProblemData,
  perturbation: number,
  material: string | null,
): Promise<RobustnessResponse> {
  const resp = await fetch('/api/robustness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...problem, perturbation, material }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`服务器错误 ${resp.status}：${text}`);
  }
  return (await resp.json()) as RobustnessResponse;
}
