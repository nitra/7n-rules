/**
 * T0-autofix концерну `npm-module/emit_types_config`: деклараційний template-deep-merge —
 * scaffold відсутнього `npm/tsconfig.emit-types.json` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `npm/tsconfig.emit-types.json`. */
export const patterns = [
  createTemplateFixPattern({ id: 'npm-module-emit_types_config-template', targetPath: 'npm/tsconfig.emit-types.json' })
]
