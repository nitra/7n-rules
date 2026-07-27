import { describe, expect, test } from 'vitest'

import phpDocFilesExtractor, { extractFactsPhp } from '../extractors.mjs'

const phpPath = 'src/HealthService.php'

describe('extractFactsPhp', () => {
  test('file-level і class/method docblock-и стають дослівними facts', () => {
    const facts = extractFactsPhp(
      `<?php

namespace App\\Service;

/**
 * Керує статусом сервісу.
 */
class HealthService
{
    /**
     * Повертає готовність сервісу.
     *
     * @return bool
     */
    public function check(): bool
    {
        return true;
    }

    private function helper(): void
    {
    }
}
`,
      phpPath
    )
    expect(facts.header).toBe('Керує статусом сервісу.')
    expect(facts.exports).toEqual([
      { name: 'HealthService', kind: 'class', desc: 'Керує статусом сервісу.' },
      { name: 'check', kind: 'method', desc: 'Повертає готовність сервісу.' }
    ])
  })

  test('підтримує багаторядкові docblock-и й обриває опис на першому тезі', () => {
    const facts = extractFactsPhp(
      `<?php

namespace App;

/**
 * Керує чергою задач.
 *
 * Повертає стан черги.
 */
interface QueueInterface
{
    /**
     * Додає задачу.
     *
     * @param mixed $task
     */
    public function push($task): void;
}
`,
      'src/QueueInterface.php'
    )
    expect(facts.header).toBe('Керує чергою задач.\n\nПовертає стан черги.')
    expect(facts.exports).toEqual([
      { name: 'QueueInterface', kind: 'interface', desc: 'Керує чергою задач.\n\nПовертає стан черги.' },
      { name: 'push', kind: 'method', desc: 'Додає задачу.' }
    ])
  })

  test('не вважає непокритий public API повною документацією', () => {
    const facts = extractFactsPhp(
      `<?php

namespace App;

class Plain
{
    public function run(): void
    {
    }
}
`,
      'src/Plain.php'
    )
    expect(facts.header).toBe('')
    expect(facts.exports).toEqual([
      { name: 'Plain', kind: 'class', desc: '' },
      { name: 'run', kind: 'method', desc: '' }
    ])
  })

  test('top-level function отримує docblock, private/protected методи пропускаються', () => {
    const facts = extractFactsPhp(
      `<?php

/**
 * Обчислює суму.
 */
function sum(int $a, int $b): int
{
    return $a + $b;
}

trait LoggerAware
{
    protected function log(string $msg): void
    {
    }
}
`,
      'src/functions.php'
    )
    expect(facts.exports).toEqual([
      { name: 'sum', kind: 'function', desc: 'Обчислює суму.' },
      { name: 'LoggerAware', kind: 'trait', desc: '' }
    ])
  })

  test('розпізнає trait/enum як top-level декларації', () => {
    const facts = extractFactsPhp(
      `<?php

enum Status
{
    case Active;
    case Inactive;
}
`,
      'src/Status.php'
    )
    expect(facts.exports).toEqual([{ name: 'Status', kind: 'enum', desc: '' }])
  })

  test('use-імпорти потрапляють у imports.external', () => {
    const facts = extractFactsPhp(
      `<?php

namespace App;

use Psr\\Log\\LoggerInterface;
use function App\\Support\\helper;

class Client
{
}
`,
      'src/Client.php'
    )
    expect(facts.imports).toEqual({
      stdlib: [],
      external: [String.raw`Psr\Log\LoggerInterface`, String.raw`App\Support\helper`],
      internal: []
    })
  })

  test('маркери детектують запис у файл, мережу, catch і falsy-повернення', () => {
    const facts = extractFactsPhp(
      `<?php

namespace App;

class Client
{
    public function fetch(): void
    {
        try {
            $ch = curl_init('https://example.com');
            file_put_contents('/tmp/x', 'y');
        } catch (\\Throwable $e) {
            return false;
        }
    }
}
`,
      'src/Client.php'
    )
    expect(facts.markers).toEqual({
      readOnly: false,
      catchesErrors: true,
      returnsFalsyOnFail: true,
      network: true,
      caches: false,
      skips: []
    })
  })

  test('read-only файл без catch/мережі/кешу', () => {
    const facts = extractFactsPhp('<?php\n\nfunction noop(): void\n{\n}\n', 'src/noop.php')
    expect(facts.markers).toEqual({
      readOnly: true,
      catchesErrors: false,
      returnsFalsyOnFail: false,
      network: false,
      caches: false,
      skips: []
    })
  })

  test('порожній файл не крашиться і повертає порожній факт-лист', () => {
    const facts = extractFactsPhp('', 'src/empty.php')
    expect(facts.header).toBe('')
    expect(facts.exports).toEqual([])
  })

  test('незакритий docblock і незакриті дужки (некоректний синтаксис) не крашиться', () => {
    expect(() =>
      extractFactsPhp(
        `<?php
/**
 * Незакритий docblock
class Broken {
  public function x() {
`,
        'src/Broken.php'
      )
    ).not.toThrow()
    const facts = extractFactsPhp(
      `<?php
/**
 * Незакритий docblock
class Broken {
  public function x() {
`,
      'src/Broken.php'
    )
    expect(facts.exports.map(e => e.name)).toEqual(['Broken', 'x'])
    expect(facts.exports.every(e => e.desc === '')).toBe(true)
  })

  test('handler декларує PHP extension', () => {
    expect(phpDocFilesExtractor.extensions).toEqual(['.php'])
    expect(phpDocFilesExtractor.id).toBe('php')
    expect(phpDocFilesExtractor.extractFacts).toBe(extractFactsPhp)
  })
})
