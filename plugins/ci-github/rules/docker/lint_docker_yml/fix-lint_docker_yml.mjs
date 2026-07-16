import { createTemplateFixPattern } from '@7n/rules/scripts/lib/fix/template-deep-merge.mjs'

export const patterns = [
  createTemplateFixPattern({ id: 'docker-lint_docker_yml-template', targetPath: '.github/workflows/lint-docker.yml' })
]
