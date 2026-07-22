/**
 * T0-фікс концерну lint_js_yml: приводить CI-workflow лінту js-домену
 * у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/lint-js.yml` консюмер-репо — відсутні ключі додаються,
 * канонічні значення мають пріоритет, коментарі й ключі поза шаблоном не
 * чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({ id: 'js-lint_js_yml-template', targetPath: '.github/workflows/lint-js.yml' })
]
