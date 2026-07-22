/**
 * T0-fix концерну rego/vscode_settings: доводить `.vscode/settings.json` до канону
 * deep-merge-ом шаблону правила, не зачіпаючи локальні налаштування користувача.
 */
import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

/** Fix-патерни концерну: один шаблонний deep-merge у `.vscode/settings.json`. */
export const patterns = [
  createTemplateFixPattern({ id: 'rego-vscode_settings-template', targetPath: '.vscode/settings.json' })
]
