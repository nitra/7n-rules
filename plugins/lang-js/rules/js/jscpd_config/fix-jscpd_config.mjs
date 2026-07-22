/**
 * T0-autofix концерну `js/jscpd_config`: деклараційний template-deep-merge —
 * scaffold відсутнього `.jscpd.json` з канонічного шаблону правила або
 * дописування в наявний файл лише канонічних полів (локальні — зберігаються).
 */
import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

/** Фікс-патерни концерну: один template-deep-merge запис для `.jscpd.json`. */
export const patterns = [createTemplateFixPattern({ id: 'js-jscpd_config-template', targetPath: '.jscpd.json' })]
