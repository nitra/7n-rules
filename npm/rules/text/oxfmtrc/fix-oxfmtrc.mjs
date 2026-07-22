/**
 * T0-fix концерну text/oxfmtrc: доводить `.oxfmtrc.json` до канону deep-merge-ом
 * шаблону правила, зберігаючи наявні локальні ключі конфігу.
 */
import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

/** Fix-патерни концерну: один шаблонний deep-merge у `.oxfmtrc.json`. */
export const patterns = [createTemplateFixPattern({ id: 'text-oxfmtrc-template', targetPath: '.oxfmtrc.json' })]
