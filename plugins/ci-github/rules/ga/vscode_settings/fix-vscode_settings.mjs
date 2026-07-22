/**
 * T0-фікс концерну vscode_settings: приводить спільні налаштування VS Code
 * у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.vscode/settings.json` консюмер-репо — відсутні ключі додаються, канонічні
 * значення мають пріоритет, ключі поза шаблоном не чіпаються; якщо файлу
 * немає — створюється зі snippet-а.
 */
export const patterns = [
  createTemplateFixPattern({ id: 'ga-vscode_settings-template', targetPath: '.vscode/settings.json' })
]
