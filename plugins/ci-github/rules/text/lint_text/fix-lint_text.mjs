/**
 * T0-autofix концерну `text/lint_text`: деклараційний template-deep-merge —
 * scaffold відсутнього `.github/workflows/lint-text.yml` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-text.yml`. */
export const patterns = [
  createTemplateFixPattern({ id: 'text-lint_text-template', targetPath: '.github/workflows/lint-text.yml' })
]
