import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'ga-git_ai-template', targetPath: '.github/workflows/git-ai.yml' })
]
