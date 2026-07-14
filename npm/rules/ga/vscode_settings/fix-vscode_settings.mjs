import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [createTemplateFixPattern({ id: 'ga-vscode_settings-template', targetPath: '.vscode/settings.json' })]
