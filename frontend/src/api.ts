import type { ProblemData, RobustnessRequest, RobustnessResponse, SolveResponse } from './types';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`服务器错误 ${resp.status}：${text}`);
  }
  return (await resp.json()) as T;
}

export function solveProblem(problem: ProblemData): Promise<SolveResponse> {
  return postJson<SolveResponse>('/api/solve', problem);
}

export function analyzeRobustness(req: RobustnessRequest): Promise<RobustnessResponse> {
  return postJson<RobustnessResponse>('/api/robustness', req);
}
