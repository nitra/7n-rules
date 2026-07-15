import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'style-lint_style_yml-template', targetPath: '.github/workflows/lint-style.yml' })
]
