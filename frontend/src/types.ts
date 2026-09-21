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

// ---------------- 配方鲁棒性分析 ----------------

export interface ScenarioRecipeItem {
  material: string;
  baseline_amount: number;
  scenario_amount: number;
  delta: number;
}

export interface ScenarioOxideItem {
  oxide: string;
  target: number;
  achieved: number;
  deviation: number;
  baseline_deviation: number;
  delta_deviation: number;
}

export interface RobustnessScenario {
  direction: 'up' | 'down';
  label: string;
  forced_amount: number | null;
  status: SolveResponse['status'];
  messages: string[];
  recipe: ScenarioRecipeItem[];
  oxides: ScenarioOxideItem[];
  residual_norm: number;
  residual_increase: number;
}

export interface RobustnessResult {
  material: string;
  baseline_amount: number;
  scenarios: RobustnessScenario[];
  max_residual_increase: number | null;
  is_most_sensitive: boolean;
}

export interface RobustnessResponse {
  status: 'ok' | 'approximate' | 'conflict' | 'error';
  messages: string[];
  perturbation: number;
  baseline_residual_norm: number;
  analyzed_count: number;
  feasible_count: number;
  most_sensitive_material: string | null;
  results: RobustnessResult[];
}
