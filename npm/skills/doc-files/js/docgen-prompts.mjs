/** @see ./docs/docgen-prompts.md */

import { anchorsToPrompt } from './docgen-extract-anchors.mjs'

export const STYLE = [
  'Ти технічний письменник. Пишеш лаконічну ПОВЕДІНКОВУ документацію до коду українською, чистим Markdown.',
  'Пиши ЩО і НАВІЩО, не ЯК. Без вступів і висновків. Не обгортай у ```-блок.',
  'Заборонено: сигнатури, типи, параметри функцій; перелік stdlib-модулів; опис regex чи внутрішніх приватних імен.'
].join(' ')

/** Окремий блок інструкцій з анкорами — підставляється коли вони є. */
function anchorsBlock(anchors) {
  if (!anchors) return ''
  const txt = anchorsToPrompt(anchors)
  return txt ? `\n\n${txt}` : ''
}

/**
 * Короткий людиночитний витяг фактів (без коду).
 * @param {object} facts факт-лист про файл
 * @returns {string} текстовий блок «factsTxt» для system-prompt
 */
function factsSummary(facts) {
  const m = facts.markers || {}
  const lines = []
  if (facts.header) lines.push(`Намір файлу: ${facts.header.replaceAll('\n', ' ')}`)
  if (facts.exports?.length) lines.push(`Публічні функції: ${facts.exports.map(e => e.name).join(', ')}`)
  if (m.skips?.length) lines.push(`Свідомо пропускає шляхи: ${m.skips.join(', ')}`)
  lines.push(`Read-only: ${m.readOnly ? 'так' : 'ні'}`)
  if (m.catchesErrors) lines.push('Перехоплює помилки (fail-safe), не кидає винятків назовні')
  if (m.returnsFalsyOnFail) lines.push('За невдачі повертає false/null замість винятку')
  lines.push(m.caches ? 'Кешування: так, у межах прогону' : 'Кешування: НЕМАЄ — не згадуй кеш у гарантіях')
  if (m.network) lines.push('Звертається до мережі')
  else lines.push('Робота з мережею: немає')
  return lines.join('\n')
}

const msgs = (system, user) => [
  { role: 'system', content: system },
  { role: 'user', content: user }
]

/**
 * Секційні набори messages з МІНІМАЛЬНИМ контекстом під кожну секцію.
 * Код потрапляє лише в `behavior`; решта секцій — на факт-листі.
 * @param {object} facts факт-лист про файл
 * @param {string} src вміст файлу
 * @returns {Array<{key:string, messages:object[], numPredict:number}>} набір секційних промптів
 */
export function sectionMessages(facts, src, anchors = null) {
  const factsTxt = factsSummary(facts)
  const anch = anchorsBlock(anchors)
  const multi = (facts.exports?.length || 0) > 1
  const out = []

  // Огляд — лише факти (без коду)
  out.push({
    key: 'overview',
    numPredict: 220,
    messages: msgs(
      `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsTxt}${anch}`,
      'Напиши вміст секції «Огляд»: 1-3 речення — що файл робить і навіщо існує (роль у системі). Без заголовка, без переліку функцій. Заборонені generic-фрази типу «забезпечує перевірку», «виконує валідацію» — пиши КОНКРЕТНО що саме і за яким контрактом.'
    )
  })

  // Поведінка — ЄДИНА секція, якій потрібен код
  out.push({
    key: 'behavior',
    numPredict: 500,
    messages: msgs(
      `${STYLE}\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\`\n\nВІДОМІ ФАКТИ:\n${factsTxt}${anch}`,
      `Напиши вміст секції «Поведінка»: ${multi ? 'для кожної публічної функції — один короткий пункт «що вона робить»' : 'нумерований алгоритм у бізнес-термінах'}. Якщо у фактах є свідомі пропуски шляхів — згадай їх там, де доречно (не вигадуй інших «не перевіряє»). НЕ пиши аргументи функцій у дужках, без regex.${facts.internalSymbols?.length ? ` НЕ згадуй за іменами службові функції: ${facts.internalSymbols.join(', ')}.` : ''} Без заголовка, без додаткових ## чи # підзаголовків усередині секції.`
    )
  })

  // API — лише список експортів (без коду)
  if (multi || facts.exports?.some(e => e.desc)) {
    const list = facts.exports.map(e => `- ${e.name}: ${e.desc || '(сформулюй стисло з наміру файлу)'}`).join('\n')
    out.push({
      key: 'api',
      numPredict: 320,
      messages: msgs(
        `${STYLE}${anch}`,
        `Перепиши цей список як стислі маркери «назва — що робить», СВОЇМИ словами (не копіюй дослівно), без типів і сигнатур. Використовуй РІВНО ці назви, не додавай і не прибирай:\n${list}\nБез заголовка. Без generic-фраз «застосовує логіку», «перевіряє коректність» — пиши конкретно ЩО саме застосовує/перевіряє.`
      )
    })
  }

  return out
}

/**
 * E2-step 1 — критик. Перевіряє чорнетку секції на конкретні дефекти.
 * Повертає messages для LLM-запиту: вихід має бути СПИСКОМ issues або словом NONE.
 * @param {'overview'|'behavior'|'api'} sectionKey
 * @param {string} draft вже згенерована чорнетка секції
 * @param {object} facts факт-лист
 * @param {ReturnType<import('./docgen-extract-anchors.mjs').extractAnchors>} anchors
 * @returns {Array<{role:string,content:string}>}
 */
export function criticMessages(sectionKey, draft, facts, anchors) {
  const anch = anchorsBlock(anchors)
  const criteria = [
    'generic-фрази без конкретики («забезпечує перевірку», «виконує валідацію», «застосовує логіку»)',
    'пропущені обов\'язкові АНКОРИ з контексту (URLs, magic-string constants, error-маркери, конфіги, code-приклади)',
    'граматичні помилки українською («перед їх застосування», «моделіне», англіцизми як «applys», «moduleline»)',
    'h1/h2/h3 підзаголовки всередині секції — їх не повинно бути',
    'дослівна копія JSDoc-сигнатури або параметрів у дужках',
    'вигадані факти, відсутні у ВІДОМИХ ФАКТАХ і АНКОРАХ'
  ].join('\n  - ')
  return [
    {
      role: 'system',
      content: `Ти жорсткий редактор технічної документації українською. Знаходиш конкретні дефекти у чорнетці. ВІДОМІ ФАКТИ:\n${factsSummary(facts)}${anch}`
    },
    {
      role: 'user',
      content: `Перевір цю чорнетку секції «${sectionKey}» за критеріями:\n  - ${criteria}\n\nЧЕРНЕТКА:\n${draft}\n\nВідповідь — короткий нумерований список знайдених issues (1-5 пунктів). Якщо дефектів немає — поверни одне слово: NONE.`
    }
  ]
}

/**
 * E2-step 2 — refine. Переписує чорнетку, виправляючи перелічені issues.
 * @param {'overview'|'behavior'|'api'} sectionKey
 * @param {string} draft
 * @param {string} issues список issues від critic
 * @param {object} facts
 * @param {ReturnType<import('./docgen-extract-anchors.mjs').extractAnchors>} anchors
 * @returns {Array<{role:string,content:string}>}
 */
export function refineMessages(sectionKey, draft, issues, facts, anchors) {
  const anch = anchorsBlock(anchors)
  return [
    {
      role: 'system',
      content: `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsSummary(facts)}${anch}`
    },
    {
      role: 'user',
      content: `Перепиши чорнетку секції «${sectionKey}», прибравши перелічені issues. Збережи мову (українська) і формат (без додаткових ## підзаголовків, без обгортки \`\`\`). Якщо issues вимагають включення АНКОРІВ — додай їх дослівно.\n\nЧЕРНЕТКА:\n${draft}\n\nISSUES ВІД РЕДАКТОРА:\n${issues}\n\nПоверни ЛИШЕ оновлений текст секції без преамбули.`
    }
  ]
}

/**
 * E3 — детермінований шаблон секції «Гарантії поведінки» з facts.markers.
 * НЕ використовує LLM: 0 запитів, 0 галюцинацій, 0 generic-фраз.
 * @param {object} facts
 * @returns {string} текст секції (без `## Гарантії` — це додає assemble())
 */
export function guaranteesFromMarkers(facts) {
  const m = facts.markers || {}
  const lines = []
  if (m.readOnly) lines.push('- Read-only: файл не виконує операцій запису у файлову систему.')
  if (m.catchesErrors) lines.push('- Перехоплює помилки і не пропускає винятків назовні (fail-safe).')
  if (m.returnsFalsyOnFail) lines.push('- За невдалої перевірки повертає `false`/`null` замість винятку.')
  if (m.caches) lines.push('- Кешує результати в межах одного прогону.')
  if (m.skips?.length) {
    lines.push(`- Свідомо пропускає шляхи: ${m.skips.map(s => '`' + s + '`').join(', ')}.`)
  }
  if (!m.network) lines.push('- Не звертається до мережі.')
  if (!lines.length) return '- Поведінка детермінована: результат залежить лише від вхідних даних.'
  return lines.join('\n')
}

/**
 * One-shot messages (база для порівняння).
 * @param {object} facts факт-лист про файл
 * @param {string} src вміст файлу
 * @returns {Array<object>} messages-масив для LLM API
 */
export function oneShotMessages(facts, src) {
  const multi = (facts.exports?.length || 0) > 1
  return msgs(
    STYLE,
    `Напиши документацію для файлу. Секції: ## Огляд (1-3 речення), ## Поведінка (нумерований/маркований алгоритм), ${multi ? '## Публічний API (назва + що робить), ' : ''}## Гарантії поведінки.\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\``
  )
}

/**
 * Лише текст user-промпту для one-shot (для хмарного fallback через Anthropic SDK).
 * @param {object} facts факт-лист про файл
 * @param {string} src вміст файлу
 * @returns {string} plain-text user-prompt
 */
export function oneShotPromptText(facts, src) {
  const multi = (facts.exports?.length || 0) > 1
  return `Напиши документацію для файлу. Секції: ## Огляд (1-3 речення), ## Поведінка (нумерований/маркований алгоритм), ${multi ? '## Публічний API (назва + що робить), ' : ''}## Гарантії поведінки.\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\``
}
