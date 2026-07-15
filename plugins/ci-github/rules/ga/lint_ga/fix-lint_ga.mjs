import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'ga-lint_ga-template', targetPath: '.github/workflows/lint-ga.yml' })
]
