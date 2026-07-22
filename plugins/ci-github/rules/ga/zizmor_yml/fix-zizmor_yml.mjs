/**
 * T0-фікс концерну zizmor_yml: приводить конфіг сканера безпеки zizmor
 * у консюмер-репо до канонічного шаблону концерну.
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/**
 * Один детермінований патерн: deep-merge канонічного snippet-а концерну в
 * `.github/zizmor.yml` консюмер-репо — відсутні ключі додаються, канонічні
 * значення мають пріоритет, коментарі й ключі поза шаблоном не чіпаються;
 * якщо файлу немає — створюється зі snippet-а.
 */
export const patterns = [createTemplateFixPattern({ id: 'ga-zizmor_yml-template', targetPath: '.github/zizmor.yml' })]
