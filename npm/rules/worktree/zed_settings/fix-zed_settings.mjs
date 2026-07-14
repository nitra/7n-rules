import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [createTemplateFixPattern({ id: 'worktree-zed_settings-template', targetPath: '.zed/settings.json' })]
