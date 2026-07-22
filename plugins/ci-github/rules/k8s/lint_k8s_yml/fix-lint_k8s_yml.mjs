/**
 * T0-фікс концерну lint_k8s_yml: приводить CI-workflow лінту k8s-домену
 * у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/lint-k8s.yml` консюмер-репо — відсутні ключі додаються,
 * канонічні значення мають пріоритет, коментарі й ключі поза шаблоном не
 * чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({ id: 'k8s-lint_k8s_yml-template', targetPath: '.github/workflows/lint-k8s.yml' })
]
