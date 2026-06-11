/**
 * `n-cursor coverage --fix`: запускає pi-агента для написання тестів
 * по вцілілих мутантах Stryker. Агент отримує список мутантів з контекстом
 * (file, line, оригінальний код, вцілілий варіант, тип мутації) і самостійно
 * знаходить або створює відповідні test-файли.
 *
 * Модель: CLOUD_MAX (складна агентна задача) або N_CURSOR_COVERAGE_FIX_MODEL.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

import { resolveModel } from '../lib/models.mjs'

const MODEL = env.N_CURSOR_COVERAGE_FIX_MODEL ?? resolveModel('max')

/**
 * @typedef {{line:number, col:number, mutantType:string, original:string, replacement:string}} MutantDetail
 * @typedef {{file:string, mutants:MutantDetail[], exampleTest:{testFile:string,code:string|null}|null, recommendationText:string|null}} SurvivedFileGroup
 */

/**
 * Запускає pi-агента для написання тестів по вцілілих мутантах.
 * @param {SurvivedFileGroup[]} survived вцілілі мутанти, згруповані по файлах
 * @param {string} projectRoot абсолютний шлях до кореня проєкту
 * @param {{ callPi?: (prompt: string, model: string, opts: { cwd: string }) => void }} [opts] ін'єкції для тестів
 * @returns {Promise<void>}
 */
export async function fixSurvivedMutants(survived, projectRoot, opts = {}) {
  const totalMutants = survived.reduce((s, g) => s + g.mutants.length, 0)
  if (totalMutants === 0) {
    console.log('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    return
  }

  const prompt = await buildFixPrompt(survived, projectRoot)
  console.log(`\n🤖 coverage --fix: запускаю агента для ${totalMutants} вцілілих мутантів...\n`)

  const callPiFn = opts.callPi ?? callPi
  callPiFn(prompt, MODEL, { cwd: projectRoot })
}

/**
 * Викликає pi в агентному режимі з live-output до stdout.
 * @param {string} prompt текст промпта
 * @param {string} model  provider/model-id або '' для pi-дефолту
 * @param {{ cwd?: string }} [piOpts] опційні параметри (cwd)
 */
function callPi(prompt, model, { cwd } = {}) {
  const modelArgs = model ? ['--model', model] : []
  spawnSync('pi', ['-p', prompt, ...modelArgs, '--no-session'], {
    cwd,
    stdio: 'inherit',
    timeout: 900_000
  })
}

/**
 * Формує rich-промпт для агента: список вцілілих мутантів згрупований по файлах,
 * з контекстом ±3 рядки навколо кожного мутанта з source-файлу.
 * @param {SurvivedFileGroup[]} survived групи вцілілих мутантів по файлах
 * @param {string} projectRoot корінь проєкту
 * @returns {Promise<string>} текст rich-промпту
 */
export async function buildFixPrompt(survived, projectRoot) {
  const sections = []

  for (const { file, mutants, exampleTest } of survived) {
    let srcLines = []
    try {
      const src = await readFile(join(projectRoot, file), 'utf8')
      srcLines = src.split('\n')
    } catch {
      // файл може бути недоступним — пропускаємо контекст, але продовжуємо
    }

    const mutantDescriptions = mutants
      .map(m => {
        const ctxStart = Math.max(0, m.line - 4)
        const ctxEnd = Math.min(srcLines.length, m.line + 3)
        const context = srcLines
          .slice(ctxStart, ctxEnd)
          .map((l, i) => `${ctxStart + i + 1}: ${l}`)
          .join('\n')
        return [
          `  - Рядок ${m.line}, колонка ${m.col}, тип мутації \`${m.mutantType}\``,
          `    Оригінал: \`${m.original}\``,
          `    Вижив варіант: \`${m.replacement}\``,
          context ? `    Контекст:\n\`\`\`\n${context}\n\`\`\`` : ''
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n')

    const exampleSection = exampleTest?.code
      ? `\n\nПриклад тесту з \`${exampleTest.testFile}\`:\n\`\`\`js\n${exampleTest.code}\n\`\`\``
      : ''

    sections.push(`### \`${file}\`${exampleSection}\n${mutantDescriptions}`)
  }

  return [
    'Твоє завдання — написати unit-тести, що вбивають наступні вцілілі мутанти Stryker.',
    'Для кожного мутанта: знайди або створи відповідний test-файл, додай тест-кейс,',
    'що явно перевіряє цю гілку/умову і провалиться якщо код замінити на "вцілілий варіант".',
    '',
    '## Вцілілі мутанти',
    '',
    ...sections,
    '',
    '## Правила',
    '- Не змінюй source-файли — лише test-файли.',
    '- Використовуй той самий test-фреймворк, що вже в проєкті.',
    '- Запусти `bun test` (або відповідну команду) після кожного файлу — переконайся, що 0 fail.',
    '- Якщо мутант охоплений іншим новим тестом — не дублюй.'
  ].join('\n')
}
