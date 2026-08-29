/**
 * §2.89 — ТАБЛИЧНИЙ гейт «фікс native-концерну живе рівно в одному місці».
 *
 * Знімаючи JS-канон `fix-<concern>.mjs`, ми прибираємо не тест, а ПОВЕРХНЮ:
 * `loadT0Patterns` (`run-fix.mjs`) резолвить фіксери в порядку
 * native → wasm (`guestFix`) → `fix-<concern>.mjs`, і третій шар був
 * глушником випадку «native не резолвиться» (аддон не зібрано, розбіжність
 * контракту, хост без napi). Глушника більше немає — тож потрібен гейт, який
 * ловить ОБИДВІ регресії, і саме на проді, а не на фікстурі.
 *
 * Дві половини, бо в ЯДРІ вони ловляться різними перевірками (на відміну від
 * wasm-плагінів §2.88, де досить складу резолву):
 *
 * 1. **Склад резолву** — тим самим `loadT0Patterns`, яким ходить прод: для
 *    кожного ключа `NATIVE_FIXES` рівно ОДИН патерн, і той `native-fix:<key>`
 *    з `guestFix`. НУЛЬ патернів = `--fix` МОВЧКИ перестав фіксити концерн;
 *    патерн з чужим `id` = резолв провалився на JS-канон. `existsSync` цього
 *    класу не ловить взагалі.
 * 2. **Відсутність канону на диску** — бо `loadT0Patterns` для native-ключа
 *    повертається РАНО (`return [nativeFixPattern(...)]`, `run-fix.mjs`), тож
 *    повернутий `fix-<concern>.mjs` складу резолву НЕ змінює: він просто стає
 *    мертвим дублікатом, який дрейфує від native-реалізації і воскресає в ту
 *    саму мить, коли аддон не завантажиться. Ця половина — рівно те, чого
 *    склад резолву в ядрі побачити не може.
 *
 * Гейт табличний (`test.each` по всьому реєстру), а не 31 окремий: реєстр
 * росте кожною хвилею порту, і новий ключ має підпадати під гейт автоматично,
 * без правки тесту.
 *
 * `tauri/release` під гейт НЕ підпадає й підпадати не має: його ключа немає в
 * `NATIVE_FIXES` (format-preserving YAML — свідомо НЕ портований, доккомент
 * `crates/rules-core/src/concerns/fix.rs`), тож його JS-канон лишається
 * чинним виконавцем.
 */
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadNative } from '../../native.mjs'
import { loadT0Patterns } from '../run-fix.mjs'

/** Корінь `npm/rules` — тека концернів ядра (`<rule>/<concern>`). */
const RULES_DIR = fileURLToPath(new URL('../../../../rules', import.meta.url))

const KEYS = loadNative().listNativeFixes()

describe('§2.89 — native-fix концерни: фікс живе рівно в одному місці', () => {
  test('реєстр NATIVE_FIXES непорожній (порожній зробив би таблицю нижче беззмістовною)', () => {
    expect(KEYS.length).toBeGreaterThan(0)
  })

  test.each(KEYS)('%s: тека концерну існує', key => {
    const [ruleId, concernId] = key.split('/')
    expect(existsSync(join(RULES_DIR, ruleId, concernId))).toBe(true)
  })

  test.each(KEYS)('%s: loadT0Patterns віддає РІВНО ОДИН патерн, і той native', async key => {
    const [ruleId, concernId] = key.split('/')
    const concernDir = join(RULES_DIR, ruleId, concernId)
    const patterns = await loadT0Patterns(concernDir, concernId, ruleId, process.cwd())
    // Нуль = `--fix` мовчки перестав фіксити концерн; більше одного або чужий
    // id = резолв дійшов до JS-канону замість native.
    expect(patterns.map(p => p.id)).toEqual([`native-fix:${key}`])
    expect(patterns[0].guestFix).toBe(true)
  })

  test.each(KEYS)('%s: JS-канон fix-<concern>.mjs НЕ повернувся на диск', key => {
    const [ruleId, concernId] = key.split('/')
    expect(existsSync(join(RULES_DIR, ruleId, concernId, `fix-${concernId}.mjs`))).toBe(false)
  })
})
