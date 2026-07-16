import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({
    id: 'ga-clean_ga_workflows-template',
    targetPath: '.github/workflows/clean-ga-workflows.yml'
  })
]
