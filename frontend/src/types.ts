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
