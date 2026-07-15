import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'php-lint_php_yml-template', targetPath: '.github/workflows/lint-php.yml' })
]
