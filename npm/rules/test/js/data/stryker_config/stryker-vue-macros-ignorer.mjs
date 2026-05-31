/**
 * Stryker `Ignore`-plugin: пропускає мутації виклику Vue `<script setup>`-макросів
 * (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`,
 * `defineOptions`). Без цього Stryker обгортає аргументи макроса у тернарний
 * coverage-вираз (`stryMutAct_9fa48(...) ? {} : (stryCov_9fa48(...), {...})`),
 * а `@vue/compiler-sfc` падає з помилкою:
 *
 *   defineProps() in <script setup> cannot reference locally declared variables
 *
 * бо макроси повинні бути статично-аналізованими на етапі compile-sfc.
 *
 * Стандартний Stryker plugin-loader (див. `@stryker-mutator/core/.../plugin-loader.js`)
 * чекає експорт `strykerPlugins: Plugin[]`. У `stryker.config.mjs` файл цього
 * плагіна додається у `plugins: ['./stryker-vue-macros-ignorer.mjs']`, а в
 * `ignorers: ['vue-macros']` активується конкретно цей ignorer по імені.
 */

const VUE_SETUP_MACROS = new Set([
  'defineProps',
  'defineEmits',
  'defineModel',
  'defineSlots',
  'defineExpose',
  'defineOptions'
])

const IGNORE_MESSAGE =
  'Vue <script setup> macro call cannot be mutated (defineProps/defineEmits/etc. must be statically analyzable for @vue/compiler-sfc).'

/**
 * @param {{isCallExpression: () => boolean, node: {callee: {type: string, name?: string}}}} path babel NodePath, переданий Stryker-instrumenter
 * @returns {string | undefined} non-empty message — пропустити мутацію піддерева; undefined — продовжити
 */
export function shouldIgnore(path) {
  if (!path.isCallExpression()) return
  const callee = path.node.callee
  if (callee.type !== 'Identifier') return
  if (!VUE_SETUP_MACROS.has(callee.name)) return
  return IGNORE_MESSAGE
}

export const strykerPlugins = [
  {
    kind: 'Ignore',
    name: 'vue-macros',
    value: { shouldIgnore }
  }
]
