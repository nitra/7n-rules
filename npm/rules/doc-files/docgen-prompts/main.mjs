/** @see ./docs/docgen-prompts.md */

import { anchorsToPrompt } from '../docgen-extract-anchors/main.mjs'

export const STYLE = [
  'Ти технічний письменник. Пишеш лаконічну ПОВЕДІНКОВУ документацію до коду українською, чистим Markdown.',
  'Пиши ЩО і НАВІЩО, не ЯК. Без вступів і висновків. Не обгортай у ```-блок.',
  'Заборонено: сигнатури, типи, параметри функцій; перелік stdlib-модулів; опис regex чи внутрішніх приватних імен.'
].join(' ')

/**
 * Окремий блок інструкцій з анкорами — підставляється коли вони є.
 * @param {object|null} anchors анкори файлу (або null)
 * @returns {string} текстовий блок для system-промпта або порожній рядок
 */
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
  // «Фабрикація > мовчання»: лише ПОЗИТИВНІ high-confidence сигнали; жодних дефолтних
  // негативів (read-only «ні», «мережа: немає») — модель echo-їть їх як хибну гарантію.
  if (m.readOnly) lines.push('Read-only: не пише (ФС/БД)')
  if (m.network) lines.push('Звертається до мережі')
  if (m.catchesErrors) lines.push('Перехоплює помилки (fail-safe), не кидає винятків назовні')
  if (m.returnsFalsyOnFail) lines.push('За певних помилок повертає порожнє значення (напр. null) замість винятку')
  lines.push(m.caches ? 'Кешування: так, у межах прогону' : 'Кешування: НЕМАЄ — не згадуй кеш у гарантіях')
  return lines.join('\n')
}

/**
 * Пара system+user messages для одного виклику.
 * @param {string} system system-промпт
 * @param {string} user user-промпт
 * @returns {Array<{role:string, content:string}>} messages-масив
 */
const msgs = (system, user) => [
  { role: 'system', content: system },
  { role: 'user', content: user }
]

/**
 * Блок read-only авторитетного контексту із захищеної секції «Призначення»
 * (Варіант B): машинні секції мають узгоджуватися з ним і НЕ дублювати його.
 * @param {string|null} intent тіло секції «Призначення» або null
 * @returns {string} текстовий блок для system-промпта або порожній рядок
 */
function intentContext(intent) {
  if (!intent) return ''
  return `\n\nАВТОРИТЕТНИЙ КОНТЕКСТ (секція «Призначення», написана людиною — НЕ повторюй дослівно, узгоджуйся й доповнюй):\n${intent}`
}

/**
 * Секційні набори messages з МІНІМАЛЬНИМ контекстом під кожну секцію.
 * Код потрапляє лише в `behavior`; «Огляд» генерується окремо ОСТАННІМ
 * (`overviewMessages`) з уже написаної Поведінки — тут його немає.
 * @param {object} facts факт-лист про файл
 * @param {string} src вміст файлу
 * @param {object|null} [anchors] анкори файлу для обовʼязкового включення
 * @param {string|null} [intent] захищена секція «Призначення» як read-only контекст
 * @returns {Array<{key:string, messages:object[], numPredict:number}>} набір секційних промптів (behavior[, api])
 */
export function sectionMessages(facts, src, anchors = null, intent = null) {
  const factsTxt = factsSummary(facts)
  const anch = anchorsBlock(anchors)
  const intentCtx = intentContext(intent)
  const multi = (facts.exports?.length || 0) > 1

  // R6: Поведінка описує РІВНО експортовані імена, не службові помічники
  const exportNames = (facts.exports ?? []).map(e => e.name)
  const behaviorTask = multi
    ? 'для кожної публічної функції — один короткий пункт «що вона робить»'
    : 'нумерований алгоритм у бізнес-термінах'
  const onlyExports = exportNames.length
    ? ` Описуй РІВНО ці публічні імена і жодних інших: ${exportNames.join(', ')}.`
    : ''
  const noInternal = facts.internalSymbols?.length
    ? ` НЕ згадуй за іменами службові функції: ${facts.internalSymbols.join(', ')}.`
    : ''
  const behavior = {
    key: 'behavior',
    numPredict: 500,
    messages: msgs(
      `${STYLE}\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\`\n\nВІДОМІ ФАКТИ:\n${factsTxt}${anch}${intentCtx}`,
      `Напиши вміст секції «Поведінка»: ${behaviorTask}.${onlyExports} Якщо у фактах є свідомі пропуски шляхів — згадай їх там, де доречно (не вигадуй інших «не перевіряє»). НЕ пиши аргументи функцій у дужках, без regex.${noInternal} Без заголовка, без додаткових ## чи # підзаголовків усередині секції.`
    )
  }

  // API — лише список експортів (без коду)
  if (!multi && !facts.exports?.some(e => e.desc)) return [behavior]
  const list = facts.exports.map(e => `- ${e.name}: ${e.desc || '(сформулюй стисло з наміру файлу)'}`).join('\n')
  const api = {
    key: 'api',
    numPredict: 320,
    messages: msgs(
      `${STYLE}${anch}`,
      `Перепиши цей список як стислі маркери «назва — що робить», СВОЇМИ словами (не копіюй дослівно), без типів і сигнатур. Використовуй РІВНО ці назви, не додавай і не прибирай:\n${list}\nБез заголовка. Без generic-фраз «застосовує логіку», «перевіряє коректність» — пиши конкретно ЩО саме застосовує/перевіряє.`
    )
  }
  return [behavior, api]
}

/**
 * R3 — «Огляд» ОСТАННІМ: узагальнення вже написаної Поведінки, а не здогад із
 * голого факт-листа. Лікує generic/хибний Огляд на складних файлах.
 * @param {object} facts факт-лист про файл
 * @param {string} behaviorText готовий текст секції «Поведінка»
 * @param {object|null} [anchors] анкори файлу
 * @param {string|null} [intent] захищена секція «Призначення» як read-only контекст
 * @returns {Array<{role:string,content:string}>} messages-масив для Огляду
 */
export function overviewMessages(facts, behaviorText, anchors = null, intent = null) {
  const factsTxt = factsSummary(facts)
  const anch = anchorsBlock(anchors)
  const dedup = intent ? ' Не дублюй секцію «Призначення».' : ''
  return msgs(
    `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsTxt}${anch}${intentContext(intent)}`,
    `На основі вже написаної секції «Поведінка» (нижче) напиши «Огляд»: 1-3 речення — що файл робить і навіщо існує (роль у системі). Узагальнюй САМЕ описану поведінку, не додавай нових фактів. Без заголовка, без переліку функцій. Заборонені абстрактні формули без конкретики («перевірка/валідація/обробка даних», «відповідність контракту», «застосовує логіку») — пиши, ЩО саме і за яким контрактом.${dedup}\n\nПОВЕДІНКА:\n${behaviorText}`
  )
}

/**
 * E2-step 1 — критик. Перевіряє чорнетку секції на конкретні дефекти.
 * Повертає messages для LLM-запиту: вихід має бути СПИСКОМ issues або словом NONE.
 * @param {'overview'|'behavior'|'api'} sectionKey ключ секції
 * @param {string} draft вже згенерована чорнетка секції
 * @param {object} facts факт-лист
 * @param {ReturnType<import('./docgen-extract-anchors.mjs').extractAnchors>} anchors анкори файлу
 * @returns {Array<{role:string,content:string}>} messages-масив для критика
 */
export function criticMessages(sectionKey, draft, facts, anchors) {
  const anch = anchorsBlock(anchors)
  const criteria = [
    'generic-фрази без конкретики («забезпечує перевірку», «виконує валідацію», «застосовує логіку»)',
    "пропущені обов'язкові АНКОРИ з контексту (URLs, magic-string constants, error-маркери, конфіги, code-приклади)",
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
 * @param {'overview'|'behavior'|'api'} sectionKey ключ секції
 * @param {string} draft чорнетка секції
 * @param {string} issues список issues від critic
 * @param {object} facts факт-лист
 * @param {ReturnType<import('./docgen-extract-anchors.mjs').extractAnchors>} anchors анкори файлу
 * @returns {Array<{role:string,content:string}>} messages-масив для переписування
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
 * @param {object} facts факт-лист
 * @returns {string} текст секції (без `## Гарантії` — це додає assemble())
 */
export function guaranteesFromMarkers(facts) {
  const m = facts.markers || {}
  const lines = []
  // «Фабрикація > мовчання»: лише ПОЗИТИВНІ high-confidence гарантії. Жодних
  // негативів/дефолтів (no-network, determinism) — їх не довести file-local аналізом.
  if (m.readOnly) lines.push('- Read-only: не виконує операцій запису (ФС/БД).')
  if (m.catchesErrors) lines.push('- Перехоплює помилки і не пропускає винятків назовні (fail-safe).')
  if (m.returnsFalsyOnFail) lines.push('- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.')
  if (m.caches) lines.push('- Кешує результати в межах одного прогону.')
  if (m.skips?.length) {
    lines.push(`- Свідомо пропускає шляхи: ${m.skips.map(s => '`' + s + '`').join(', ')}.`)
  }
  if (!lines.length) return '- (специфічних машинно-виведених гарантій немає)'
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
