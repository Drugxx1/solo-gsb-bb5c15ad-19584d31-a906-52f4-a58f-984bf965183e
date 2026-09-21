export interface MaterialState {
  name: string;
  disabled: boolean;
  min: number;
  max: number;
  composition: Record<string, number>;
}

/** 完整问题定义，即导入/导出/提交求解的 JSON 结构 */
export interface ProblemData {
  oxides: string[];
  target: Record<string, number>;
  materials: MaterialState[];
}

export interface RecipeItem {
  material: string;
  amount: number;
}

export interface OxideResult {
  oxide: string;
  target: number;
  achieved: number;
  deviation: number;
}

export interface SolveResponse {
  status: 'ok' | 'approximate' | 'conflict' | 'error';
  messages: string[];
  recipe: RecipeItem[];
  oxides: OxideResult[];
  total_amount: number;
  residual_norm: number;
}

export interface RobustnessRequest {
  oxides: string[];
  target: Record<string, number>;
  materials: MaterialState[];
  perturbation: number;
  material?: string | null;
}

export interface ScenarioResult {
  direction: 'up' | 'down';
  perturbed_amount: number;
  feasible: boolean;
  status: SolveResponse['status'];
  messages: string[];
  recipe: RecipeItem[];
  oxides: OxideResult[];
  residual_norm: number;
  residual_increase: number;
}

export interface RobustnessItem {
  material: string;
  baseline_amount: number;
  note?: string | null;
  up: ScenarioResult;
  down: ScenarioResult;
  max_residual_increase: number;
  most_sensitive: boolean;
}

export interface RobustnessResponse {
  status: SolveResponse['status'];
  messages: string[];
  perturbation: number;
  baseline: SolveResponse | null;
  results: RobustnessItem[];
}
