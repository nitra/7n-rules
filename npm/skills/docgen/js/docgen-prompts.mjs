/**
 * Stage 1 docgen-конвеєра: факт-лист + код → точкові промпти на кожну секцію.
 *
 * v2 — СЕКЦІЙНО-МІНІМАЛЬНИЙ контекст: код іде ЛИШЕ у `Поведінку`. `Огляд` бере тільки
 * header, `API` — лише список експортів, `Гарантії` — лише markers. Так інгест коду
 * оплачується один раз (а не на кожну секцію), і оркестрація перестає програвати в часі.
 */

export const STYLE = [
  'Ти технічний письменник. Пишеш лаконічну ПОВЕДІНКОВУ документацію до коду українською, чистим Markdown.',
  'Пиши ЩО і НАВІЩО, не ЯК. Без вступів і висновків. Не обгортай у ```-блок.',
  'Заборонено: сигнатури, типи, параметри функцій; перелік stdlib-модулів; опис regex чи внутрішніх приватних імен.'
].join(' ')

/** Короткий людиночитний витяг фактів (без коду). */
function factsSummary(facts) {
  const m = facts.markers || {}
  const lines = []
  if (facts.header) lines.push(`Намір файлу: ${facts.header.replace(/\n/g, ' ')}`)
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
 * @returns {Array<{key:string, messages:object[], numPredict:number}>}
 */
export function sectionMessages(facts, src) {
  const factsTxt = factsSummary(facts)
  const multi = (facts.exports?.length || 0) > 1
  const out = []

  // Огляд — лише факти (без коду)
  out.push({
    key: 'overview',
    numPredict: 220,
    messages: msgs(
      `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsTxt}`,
      'Напиши вміст секції «Огляд»: 1-3 речення — що файл робить і навіщо існує (роль у системі). Без заголовка, без переліку функцій.'
    )
  })

  // Поведінка — ЄДИНА секція, якій потрібен код
  out.push({
    key: 'behavior',
    numPredict: 500,
    messages: msgs(
      `${STYLE}\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\`\n\nВІДОМІ ФАКТИ:\n${factsTxt}`,
      `Напиши вміст секції «Поведінка»: ${multi ? 'для кожної публічної функції — один короткий пункт «що вона робить»' : 'нумерований алгоритм у бізнес-термінах'}. Якщо у фактах є свідомі пропуски шляхів — згадай їх там, де доречно (не вигадуй інших «не перевіряє»). НЕ пиши аргументи функцій у дужках, без regex.${facts.internalSymbols?.length ? ` НЕ згадуй за іменами службові функції: ${facts.internalSymbols.join(', ')}.` : ''} Без заголовка.`
    )
  })

  // API — лише список експортів (без коду)
  if (multi || facts.exports?.some(e => e.desc)) {
    const list = facts.exports.map(e => `- ${e.name}: ${e.desc || '(сформулюй стисло з наміру файлу)'}`).join('\n')
    out.push({
      key: 'api',
      numPredict: 320,
      messages: msgs(
        STYLE,
        `Перепиши цей список як стислі маркери «назва — що робить», СВОЇМИ словами (не копіюй дослівно), без типів і сигнатур. Використовуй РІВНО ці назви, не додавай і не прибирай:\n${list}\nБез заголовка.`
      )
    })
  }

  // Гарантії — лише markers (без коду)
  out.push({
    key: 'guarantees',
    numPredict: 300,
    messages: msgs(
      `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsTxt}`,
      'Напиши вміст секції «Гарантії поведінки» як маркери-інваріанти СУВОРО на основі ВІДОМИХ ФАКТІВ (read-only, fail-safe, пропуски). Згадуй кеш ЛИШЕ якщо у фактах прямо є «Кешує». Без сигнатур у дужках і без імен внутрішніх структур/Map-ів/кешів. Не вигадуй гарантій, яких немає у фактах. Без заголовка.'
    )
  })

  return out
}

/** One-shot messages (база для порівняння). */
export function oneShotMessages(facts, src) {
  const multi = (facts.exports?.length || 0) > 1
  return msgs(
    STYLE,
    `Напиши документацію для файлу. Секції: ## Огляд (1-3 речення), ## Поведінка (нумерований/маркований алгоритм), ${multi ? '## Публічний API (назва + що робить), ' : ''}## Гарантії поведінки.\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\``
  )
}

/** Лише текст user-промпту для one-shot (для хмарного fallback через Anthropic SDK). */
export function oneShotPromptText(facts, src) {
  const multi = (facts.exports?.length || 0) > 1
  return `Напиши документацію для файлу. Секції: ## Огляд (1-3 речення), ## Поведінка (нумерований/маркований алгоритм), ${multi ? '## Публічний API (назва + що робить), ' : ''}## Гарантії поведінки.\n\nФАЙЛ ${facts.relPath}:\n\`\`\`\n${src}\n\`\`\``
}
