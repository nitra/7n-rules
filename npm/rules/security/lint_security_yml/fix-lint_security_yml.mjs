import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [createTemplateFixPattern({ id: 'security-lint_security_yml-template', targetPath: '.github/workflows/lint-security.yml' })]
