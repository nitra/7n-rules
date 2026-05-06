import { getConfig } from '@nitra/eslint-config'
import globals from 'globals'

// getConfig({ node: ['npm'] }) у @nitra/eslint-config задає Node globals лише для glob `npm/**/*.js` (не .mjs/.cjs).
// Для npm/**/*.mjs і npm/**/*.cjs додаємо globals.node окремо, інакше no-undef на process і console.
export default [
  { ignores: ['**/auto-imports.d.ts', 'docs/**'] },
  ...getConfig({
    node: ['npm'],
    vue: ['demo']
  }),
  {
    files: ['npm/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
]
