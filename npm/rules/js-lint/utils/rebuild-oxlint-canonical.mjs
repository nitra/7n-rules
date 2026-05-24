/**
 * Збирає `oxlint-canonical.json` з `oxlint-canonical-skeleton.json` (без поля rules) та списку
 * правил у `oxlint-rules.tsv` (колонки: ім’я правила, TAB, severity: deny | off | error).
 *
 * Після змін у TSV або скелеті запускай з каталогу пакета: `bun ./rules/js-lint/utils/rebuild-oxlint-canonical.mjs`,
 * потім скопіюй оновлений канон у корінь споживача як `.oxlintrc.json` за потреби.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'data', 'tooling')
const rules = {}
for (const line of readFileSync(join(dir, 'oxlint-rules.tsv'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t) {
    continue
  }
  const i = t.indexOf('\t')
  if (i === -1) {
    throw new Error(`oxlint-rules.tsv: очікується TAB між ключем і значенням: ${t}`)
  }
  rules[t.slice(0, i)] = t.slice(i + 1)
}
const skeleton = JSON.parse(readFileSync(join(dir, 'oxlint-canonical-skeleton.json'), 'utf8'))
skeleton.rules = rules
const out = join(dir, 'oxlint-canonical.json')
writeFileSync(out, `${JSON.stringify(skeleton, null, 2)}\n`)
console.log(`wrote ${out} (${Object.keys(rules).length} rules)`)
