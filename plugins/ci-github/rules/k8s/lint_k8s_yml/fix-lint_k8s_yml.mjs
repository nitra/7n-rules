import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'k8s-lint_k8s_yml-template', targetPath: '.github/workflows/lint-k8s.yml' })
]
