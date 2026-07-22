/**
 * T0-autofix концерну `js/package_json`: деклараційний template-deep-merge —
 * scaffold відсутнього `package.json` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `package.json`. */
export const patterns = [createTemplateFixPattern({ id: 'js-package_json-template', targetPath: 'package.json' })]
