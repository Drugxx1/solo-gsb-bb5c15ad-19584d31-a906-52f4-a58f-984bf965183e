import type { ProblemData } from './types';

/**
 * 示例数据：中温透明釉。
 * 目标比例由经典配方（钾长石 40 / 石英 22 / 方解石 14 / 高岭土 12 /
 * 白云石 8 / 氧化锌 3 / 膨润土 1）的氧化物分析推算而来，可精确求解。
 */
export const SAMPLE_PROBLEM: ProblemData = {
  oxides: ['SiO2', 'Al2O3', 'CaO', 'MgO', 'K2O', 'Na2O', 'ZnO'],
  target: {
    SiO2: 55.46,
    Al2O3: 11.55,
    CaO: 10.4,
    MgO: 1.76,
    K2O: 4.01,
    Na2O: 1.23,
    ZnO: 2.97,
  },
  materials: [
    {
      name: '钾长石',
      disabled: false,
      min: 0,
      max: 100,
      composition: { SiO2: 68.5, Al2O3: 17.0, CaO: 0.3, K2O: 10.0, Na2O: 3.0 },
    },
    {
      name: '石英',
      disabled: false,
      min: 0,
      max: 100,
      composition: { SiO2: 99.5 },
    },
    {
      name: '方解石',
      disabled: false,
      min: 0,
      max: 100,
      composition: { CaO: 56.0 },
    },
    {
      name: '高岭土',
      disabled: false,
      min: 0,
      max: 100,
      composition: { SiO2: 46.5, Al2O3: 38.0 },
    },
    {
      name: '白云石',
      disabled: false,
      min: 0,
      max: 100,
      composition: { CaO: 30.4, MgO: 21.7 },
    },
    {
      name: '氧化锌',
      disabled: false,
      min: 0,
      max: 100,
      composition: { ZnO: 99.0 },
    },
    {
      name: '膨润土',
      disabled: false,
      min: 0,
      max: 100,
      composition: { SiO2: 59.0, Al2O3: 19.0, CaO: 1.0, MgO: 2.5, K2O: 1.0, Na2O: 2.5 },
    },
  ],
};
