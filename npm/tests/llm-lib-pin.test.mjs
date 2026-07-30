/**
 * Регресійний тест pin-а внутрішнього LLM runtime: published `@7n/rules` не має
 * лишатися на старішому `@7n/llm-lib` із несумісними native package metadata.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { realRepoRoot } from '../scripts/utils/test-helpers.mjs'

// realRepoRoot, не відносний шлях від тестового файлу: sandbox-копія Stryker
// містить лише npm/, а пін звіряється з файлами реального дерева.
const REPOSITORY_ROOT = realRepoRoot()

/**
 * @param {string} path шлях від кореня репозиторію
 * @returns {{dependencies: Record<string, string>, version: string}} прочитаний package manifest
 */
function readPackage(path) {
  return JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'))
}

describe('@7n/rules LLM runtime pin', () => {
  test('збігається з актуальним workspace @7n/llm-lib', () => {
    const rulesPackage = readPackage('npm/package.json')
    const llmPackage = readPackage('llm-lib/package.json')
    expect(rulesPackage.dependencies['@7n/llm-lib']).toBe(llmPackage.version)
  })
})
