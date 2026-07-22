/**
 * T0-fix концерну worktree/zed_settings: доводить `.zed/settings.json` до канону
 * deep-merge-ом шаблону правила, не зачіпаючи локальні налаштування користувача.
 */
import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

/** Fix-патерни концерну: один шаблонний deep-merge у `.zed/settings.json`. */
export const patterns = [
  createTemplateFixPattern({ id: 'worktree-zed_settings-template', targetPath: '.zed/settings.json' })
]
