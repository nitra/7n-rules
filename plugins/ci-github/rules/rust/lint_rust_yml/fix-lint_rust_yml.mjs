/**
 * T0-autofix концерну `rust/lint_rust_yml`: деклараційний template-deep-merge —
 * scaffold відсутнього `.github/workflows/lint-rust.yml` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.github/workflows/lint-rust.yml`. */
export const patterns = [
  createTemplateFixPattern({ id: 'rust-lint_rust_yml-template', targetPath: '.github/workflows/lint-rust.yml' })
]
