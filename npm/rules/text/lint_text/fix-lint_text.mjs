import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'text-lint_text-template', targetPath: '.github/workflows/lint-text.yml' })
]
