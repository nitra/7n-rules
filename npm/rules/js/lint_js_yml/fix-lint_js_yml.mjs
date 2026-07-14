import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'js-lint_js_yml-template', targetPath: '.github/workflows/lint-js.yml' })
]
