/**
 * T0-фікс концерну clean_merged_branch: приводить workflow автоматичного
 * видалення злитих гілок у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/clean-merged-branch.yml` консюмер-репо — відсутні ключі
 * додаються, канонічні значення мають пріоритет, коментарі й ключі поза
 * шаблоном не чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({
    id: 'ga-clean_merged_branch-template',
    targetPath: '.github/workflows/clean-merged-branch.yml'
  })
]
