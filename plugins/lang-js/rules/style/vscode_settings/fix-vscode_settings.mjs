/**
 * T0-autofix концерну `style/vscode_settings`: деклараційний template-deep-merge —
 * scaffold відсутнього `.vscode/settings.json` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.vscode/settings.json`. */
export const patterns = [
  createTemplateFixPattern({ id: 'style-vscode_settings-template', targetPath: '.vscode/settings.json' })
]
