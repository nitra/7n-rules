import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [createTemplateFixPattern({ id: 'js-package_json-template', targetPath: 'package.json' })]
