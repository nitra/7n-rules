import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({
    id: 'npm-module-npm_publish_yml-template',
    targetPath: '.github/workflows/npm-publish.yml'
  })
]
