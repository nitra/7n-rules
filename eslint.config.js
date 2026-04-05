import { getConfig } from '@nitra/eslint-config'

export default [
  ...getConfig({
    node: ['npm']
  })
]
