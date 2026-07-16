import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'python-lint_python_yml-template', targetPath: '.github/workflows/lint-python.yml' })
]
