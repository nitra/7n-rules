import { getConfig } from '@nitra/eslint-config'

export default [
  { ignores: ['docs/**'] },
  ...getConfig({
    node: ['npm']
  })
]
