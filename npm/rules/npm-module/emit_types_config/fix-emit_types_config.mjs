import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'npm-module-emit_types_config-template', targetPath: 'npm/tsconfig.emit-types.json' })
]
