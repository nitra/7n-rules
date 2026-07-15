import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'rust-lint_rust_yml-template', targetPath: '.github/workflows/lint-rust.yml' })
]
