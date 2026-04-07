import { getConfig } from '@nitra/eslint-config'

export default [
  { ignores: ['**/auto-imports.d.ts', 'docs/**'] },
  ...getConfig({
    node: ['npm']
  })
]
