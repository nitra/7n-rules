import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'style-vscode_settings-template', targetPath: '.vscode/settings.json' })
]
