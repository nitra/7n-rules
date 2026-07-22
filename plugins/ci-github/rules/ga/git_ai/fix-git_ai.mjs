/**
 * T0-фікс концерну git_ai: приводить workflow інтеграції git-ai у
 * консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/git-ai.yml` консюмер-репо — відсутні ключі додаються,
 * канонічні значення мають пріоритет, коментарі й ключі поза шаблоном не
 * чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({ id: 'ga-git_ai-template', targetPath: '.github/workflows/git-ai.yml' })
]
