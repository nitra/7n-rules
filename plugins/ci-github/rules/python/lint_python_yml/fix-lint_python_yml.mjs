/**
 * T0-autofix концерну `python/lint_python_yml`: деклараційний template-deep-merge —
 * scaffold відсутнього `.github/workflows/lint-python.yml` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-python.yml`. */
export const patterns = [
  createTemplateFixPattern({ id: 'python-lint_python_yml-template', targetPath: '.github/workflows/lint-python.yml' })
]
