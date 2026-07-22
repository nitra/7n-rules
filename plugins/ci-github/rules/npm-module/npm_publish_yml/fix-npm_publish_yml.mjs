/**
 * T0-фікс концерну npm_publish_yml: приводить workflow публікації npm-пакета
 * у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/workflows/npm-publish.yml` консюмер-репо — відсутні ключі додаються,
 * канонічні значення мають пріоритет, коментарі й ключі поза шаблоном не
 * чіпаються; якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({
    id: 'npm-module-npm_publish_yml-template',
    targetPath: '.github/workflows/npm-publish.yml'
  })
]
