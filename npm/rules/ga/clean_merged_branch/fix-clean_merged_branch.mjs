import { createTemplateFixPattern } from '../../../scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [createTemplateFixPattern({ id: 'ga-clean_merged_branch-template', targetPath: '.github/workflows/clean-merged-branch.yml' })]
