/**
 * T0-autofix концерну `security/lint_security_yml`: деклараційний template-deep-merge —
 * scaffold відсутнього `.github/workflows/lint-security.yml` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-security.yml`. */
export const patterns = [
  createTemplateFixPattern({
    id: 'security-lint_security_yml-template',
    targetPath: '.github/workflows/lint-security.yml'
  })
]
