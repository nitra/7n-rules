import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'ga-lint_repo_yml-template', targetPath: '.github/workflows/lint-repo.yml' })
]
