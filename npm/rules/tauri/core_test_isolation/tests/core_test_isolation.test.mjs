/**
 * Тести правила core_test_isolation.mdc: агент/LLM-логіка окремо від src-tauri app-shell.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CORE_CRATE_DEPENDS_ON_TAURI, LLM_DEP_IN_APP_SHELL, MISSING_FAKE_LLM_PROVIDER, lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'tauri', concernId: 'core_test_isolation', files: undefined })

describe('check tauri.core_test_isolation', () => {
  test('без src-tauri у проєкті → без порушень', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('src-tauri без workspace-членів і без LLM-залежності → без порушень', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'src-tauri/Cargo.toml'), '[package]\nname = "app"\n\n[dependencies]\nserde = "1"\n')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('LLM-залежність напряму в app-shell src-tauri → фейл', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(
        join(dir, 'src-tauri/Cargo.toml'),
        '[package]\nname = "app"\n\n[dependencies]\nasync-openai = "0.1"\ntauri = "2"\n'
      )
      const result = await run(dir)
      expect(result.violations.map(v => v.reason)).toContain(LLM_DEP_IN_APP_SHELL)
    })
  })

  test('окремий crate з LLM-залежністю сам залежить від tauri → фейл', async () => {
    await withTmpDir(async dir => {
      // Cargo-валідний layout: [workspace] живе у product-root Cargo.toml НАД src-tauri/ і
      // agent-core/ (не всередині src-tauri/, бо `members` за межами дерева workspace root —
      // помилка Cargo: "workspace member is not hierarchically below the workspace root").
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await mkdir(join(dir, 'agent-core'), { recursive: true })
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\nresolver = "2"\nmembers = ["src-tauri", "agent-core"]\n')
      await writeFile(join(dir, 'src-tauri/Cargo.toml'), '[package]\nname = "app"\n\n[dependencies]\ntauri = "2"\n')
      await writeFile(
        join(dir, 'agent-core/Cargo.toml'),
        '[package]\nname = "agent-core"\n\n[dependencies]\nasync-openai = "0.1"\ntauri = "2"\n'
      )
      const result = await run(dir)
      expect(result.violations.map(v => v.reason)).toContain(CORE_CRATE_DEPENDS_ON_TAURI)
    })
  })

  test('окремий crate без tauri, без fake-провайдера у тестах → фейл', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await mkdir(join(dir, 'agent-core/src'), { recursive: true })
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\nresolver = "2"\nmembers = ["src-tauri", "agent-core"]\n')
      await writeFile(join(dir, 'src-tauri/Cargo.toml'), '[package]\nname = "app"\n\n[dependencies]\ntauri = "2"\n')
      await writeFile(
        join(dir, 'agent-core/Cargo.toml'),
        '[package]\nname = "agent-core"\n\n[dependencies]\nasync-openai = "0.1"\n'
      )
      await writeFile(join(dir, 'agent-core/src/lib.rs'), 'pub fn run() {}\n')
      const result = await run(dir)
      expect(result.violations.map(v => v.reason)).toContain(MISSING_FAKE_LLM_PROVIDER)
    })
  })

  test('окремий crate без tauri, з fake-провайдером у tests/ → без порушень', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await mkdir(join(dir, 'agent-core/tests'), { recursive: true })
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\nresolver = "2"\nmembers = ["src-tauri", "agent-core"]\n')
      await writeFile(join(dir, 'src-tauri/Cargo.toml'), '[package]\nname = "app"\n\n[dependencies]\ntauri = "2"\n')
      await writeFile(
        join(dir, 'agent-core/Cargo.toml'),
        '[package]\nname = "agent-core"\n\n[dependencies]\nasync-openai = "0.1"\n'
      )
      await writeFile(
        join(dir, 'agent-core/tests/fake_provider.rs'),
        'struct FakeLlmProvider;\n#[test]\nfn it_works() {}\n'
      )
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })
})
