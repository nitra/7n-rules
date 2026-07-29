import { describe, expect, test } from 'vitest'

import { parseCloverPerFile, parseCloverTotals } from '../clover.mjs'

// Скорочений, але структурно повний фрагмент `phpunit --coverage-clover` /
// `pest --coverage-clover` (обидва пишуть той самий clover діалект):
// class-рівня `<metrics>` йде першим, file-рівня — останнім елементом блоку.
const CLOVER_FIXTURE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<coverage generated="1700000000">',
  '  <project timestamp="1700000000">',
  '    <file name="/repo/src/Foo.php">',
  '      <class name="Foo" namespace="global">',
  '        <metrics methods="2" coveredmethods="1" statements="10" coveredstatements="7"/>',
  '      </class>',
  '      <line num="5" type="method" name="bar" crap="1" count="1"/>',
  '      <line num="10" type="stmt" count="0"/>',
  '      <metrics loc="20" ncloc="18" classes="1" methods="2" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="10" coveredstatements="7" elements="12" coveredelements="8"/>',
  '    </file>',
  '    <file name="/repo/src/Bar.php">',
  '      <class name="Bar" namespace="global">',
  '        <metrics methods="1" coveredmethods="1" statements="4" coveredstatements="4"/>',
  '      </class>',
  '      <metrics loc="8" ncloc="7" classes="1" methods="1" coveredmethods="1" conditionals="0" coveredconditionals="0" statements="4" coveredstatements="4" elements="5" coveredelements="5"/>',
  '    </file>',
  '    <metrics files="2" loc="28" ncloc="25" classes="2" methods="3" coveredmethods="2" conditionals="0" coveredconditionals="0" statements="14" coveredstatements="11" elements="17" coveredelements="13"/>',
  '  </project>',
  '</coverage>'
].join('\n')

describe('parseCloverTotals', () => {
  test('агрегує lines/functions по всіх файлах (сума file-рівня metrics)', () => {
    expect(parseCloverTotals(CLOVER_FIXTURE)).toEqual({
      lines: { covered: 11, total: 14 },
      functions: { covered: 2, total: 3 }
    })
  })

  test('порожній звіт → нулі', () => {
    expect(parseCloverTotals('<coverage><project></project></coverage>')).toEqual({
      lines: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 }
    })
  })
})

describe('parseCloverPerFile', () => {
  test('per-file рядки з pct, беруть file-рівня (останній) <metrics>, не class-рівня', () => {
    const rows = parseCloverPerFile(CLOVER_FIXTURE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ file: '/repo/src/Foo.php', pct: 70, linesFound: 10, linesCovered: 7 })
    expect(rows[1]).toEqual({ file: '/repo/src/Bar.php', pct: 100, linesFound: 4, linesCovered: 4 })
  })

  test('файл без statements (0 рядків) → pct 100', () => {
    const xml =
      '<file name="/repo/src/Empty.php"><metrics methods="0" coveredmethods="0" statements="0" coveredstatements="0"/></file>'
    expect(parseCloverPerFile(xml)).toEqual([{ file: '/repo/src/Empty.php', pct: 100, linesFound: 0, linesCovered: 0 }])
  })
})
