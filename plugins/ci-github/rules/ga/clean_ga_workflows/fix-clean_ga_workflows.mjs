/**
 * T0-фікс концерну clean_ga_workflows: приводить workflow чистки застарілих
 * GitHub Actions workflow-ів у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/clean-ga-workflows.yml` консюмер-репо — відсутні ключі
 * додаються, канонічні значення мають пріоритет, коментарі й ключі поза
 * шаблоном не чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({
    id: 'ga-clean_ga_workflows-template',
    targetPath: '.github/workflows/clean-ga-workflows.yml'
  })
]
