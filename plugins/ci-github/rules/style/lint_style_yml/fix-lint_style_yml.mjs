/**
 * T0-autofix концерну `style/lint_style_yml`: деклараційний template-deep-merge —
 * scaffold відсутнього `.github/workflows/lint-style.yml` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-style.yml`. */
export const patterns = [
  createTemplateFixPattern({ id: 'style-lint_style_yml-template', targetPath: '.github/workflows/lint-style.yml' })
]
