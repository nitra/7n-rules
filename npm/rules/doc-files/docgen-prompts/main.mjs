/** @see ./docs/docgen-prompts.md */

import { env } from 'node:process'

import { anchorsToPrompt } from '../docgen-extract-anchors/main.mjs'

export const STYLE = [
  'Ти технічний письменник. Пишеш лаконічну ПОВЕДІНКОВУ документацію до коду українською, чистим Markdown.',
  'Пиши ЩО і НАВІЩО, не ЯК. Без вступів і висновків. Не обгортай у ```-блок.',
  'Заборонено: сигнатури, типи, параметри функцій; перелік stdlib-модулів; опис regex чи внутрішніх приватних імен.',
  // R9-профілактика: gemma-подібні малі моделі «озвучують завдання» перед відповіддю;
  // явна заборона з прикладами різко знижує частоту (дет-зрізання у stripSection — страховка).
  'Виведи ЛИШЕ текст секції. ЗАБОРОНЕНО починати з мета-фраз на кшталт «Ось оновлена чорнетка…», «Оновлений текст секції:», «Як технічний письменник, я створю…» — одразу перший змістовний рядок.'
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
  // Scoped-формулювання readOnly (як у guaranteesFromMarkers): маркер file-local,
  // безумовне «не пише» модель розганяє до хибного «гарантує безпечність» в Огляді.
  if (m.readOnly) lines.push('Власних операцій запису (ФС/БД) у файлі немає (імпортовані модулі не аналізувались)')
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
 * (`overviewMessages`) з уже написаної Поведінки — тут його немає. «Публічний
 * API» сюди більше не входить (Stage 1/3, гібрид doc-files ADR 260719-2155):
 * покриті JSDoc-описом експорти рендеряться дослівно без LLM (`renderApiLine`),
 * LLM викликається лише на прогалини (`apiGapMessages`) — див. `isApiGap`.
 * @param {object} facts факт-лист про файл
 * @param {string} src вміст файлу
 * @param {object|null} [anchors] анкори файлу для обовʼязкового включення
 * @param {string|null} [intent] захищена секція «Призначення» як read-only контекст
 * @returns {Array<{key:string, messages:object[], numPredict:number}>} набір секційних промптів (лише behavior)
 */
export function sectionMessages(facts, src, anchors = null, intent = null) {
  const factsTxt = factsSummary(facts)
  const anch = anchorsBlock(anchors)
  const intentCtx = intentContext(intent)
  const multi = (facts.exports?.length || 0) > 1

  // R6: Поведінка описує РІВНО експортовані імена, не службові помічники.
  // Мульти-експорт: «Публічний API» вже містить одно-рядкові описи кожної функції
  // (Stage 1 — дослівно з JSDoc), тож пер-функційні пункти в Поведінці дублювали б
  // його іншими словами. Натомість — крос-функціональний наратив: те, чого
  // немає в жодному окремому JSDoc за визначенням.
  const exportNames = (facts.exports ?? []).map(e => e.name)
  const behaviorTask = multi
    ? 'крос-функціональний потік: у якому порядку і як функції взаємодіють між собою, звідки приходять дані і куди йдуть результати, спільні правила чи стан. НЕ переказуй кожну функцію окремим пунктом — одно-рядкові описи вже є в секції «Публічний API»'
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
  return [behavior]
}

// «опис.» — та сама JSDoc-заглушка без сенсу, яку lang-екстрактори (extractors.mjs)
// вже відкидають при парсингу; тут — другий, незалежний gate на рівні facts.exports
// (захист від прогалин, що прийшли з інших джерел фактів, напр. майбутніх мов).
const STUB_DESC_RE = /^опис\.?$/i

/**
 * Stage 2 (gap-детект, 0 токенів): чи є опис експорту прогалиною — відсутній
 * або JSDoc-заглушка без сенсу.
 * @param {{desc?:string}} exp запис експорту з факт-листа
 * @returns {boolean} true — опис потрібно синтезувати LLM (Stage 3)
 */
export function isApiGap(exp) {
  const desc = (exp.desc ?? '').trim()
  return !desc || STUB_DESC_RE.test(desc)
}

/**
 * Stage 1 (скриптовий рендер, 0 токенів, 0 галюцинацій): дослівний рядок
 * «Публічного API» з покритого JSDoc-описом експорту — без перефразування LLM.
 * @param {{name:string, desc:string}} exp запис експорту з непорожнім desc
 * @returns {string} рядок маркованого списку
 */
export function renderApiLine(exp) {
  return `- ${exp.name} — ${exp.desc.trim()}`
}

/**
 * Stage 3: messages ЛИШЕ для експортів-прогалин (без desc) — вужчий промпт,
 * ніж попередній «переписати весь список своїми словами» (жодного контакту з
 * уже покритими JSDoc експортами, 0 ризику спотворити авторський текст).
 * @param {Array<{name:string}>} gapExports експорти без опису (isApiGap === true)
 * @param {object|null} [anchors] анкори файлу
 * @returns {Array<{role:string,content:string}>} messages-масив для LLM
 */
export function apiGapMessages(gapExports, anchors = null) {
  const anch = anchorsBlock(anchors)
  const list = gapExports.map(e => `- ${e.name}`).join('\n')
  return msgs(
    `${STYLE}${anch}`,
    `Для кожної названої публічної функції напиши один рядок маркованого списку «назва — що робить», СВОЇМИ словами, без типів і сигнатур, РІВНО у цьому порядку й з РІВНО цими назвами:\n${list}\nБез заголовка. Без generic-фраз «застосовує логіку», «перевіряє коректність» — пиши конкретно ЩО саме застосовує/перевіряє.`
  )
}

/**
 * R3 — «Огляд» ОСТАННІМ: узагальнення вже написаної Поведінки, а не здогад із
 * голого факт-листа. Лікує generic/хибний Огляд на складних файлах.
 * Анкор-блок сюди НЕ підставляється (№8, бенч gemma-4): секції — окремі
 * LLM-виклики, і коли анкори бачили обидва, кожен чесно вставляв «рівно один
 * раз» → у документі виходило двічі (незграбні «посилаючись на…» в Огляді).
 * Анкори живуть лише в Behavior-промпті; скорер R5 перевіряє документ цілком.
 * @param {object} facts факт-лист про файл
 * @param {string} behaviorText готовий текст секції «Поведінка»
 * @param {string|null} [intent] захищена секція «Призначення» як read-only контекст
 * @returns {Array<{role:string,content:string}>} messages-масив для Огляду
 */
export function overviewMessages(facts, behaviorText, intent = null) {
  const factsTxt = factsSummary(facts)
  const dedup = intent ? ' Не дублюй секцію «Призначення».' : ''
  return msgs(
    `${STYLE}\n\nВІДОМІ ФАКТИ:\n${factsTxt}${intentContext(intent)}`,
    `На основі вже написаної секції «Поведінка» (нижче) напиши «Огляд»: 1-3 речення — що файл робить і навіщо існує (роль у системі). Узагальнюй САМЕ описану поведінку, не додавай нових фактів. Без заголовка, без переліку функцій. Заборонені абстрактні формули без конкретики («перевірка/валідація/обробка даних», «відповідність контракту», «застосовує логіку») — пиши, ЩО саме і за яким контрактом.${dedup}\n\nПОВЕДІНКА:\n${behaviorText}`
  )
}

/**
 * E2-step 1 — критик. Перевіряє чорнетку секції на конкретні дефекти.
 * Повертає messages для LLM-запиту: вихід має бути СПИСКОМ issues або словом NONE.
 * @param {'overview'|'behavior'|'api'} sectionKey ключ секції
 * @param {string} draft вже згенерована чорнетка секції
 * @param {object} facts факт-лист
 * @param {ReturnType<import('../docgen-extract-anchors/main.mjs').extractAnchors>} anchors анкори файлу
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
 * @param {ReturnType<import('../docgen-extract-anchors/main.mjs').extractAnchors>} anchors анкори файлу
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
  // readOnly — SCOPED-формулювання: маркер file-local (немає write-патернів у ЦЬОМУ
  // файлі), але файл може викликати імпортовані модулі, які пишуть. Безумовне
  // «Read-only: не виконує операцій запису» LLM-суддя (cloud-min) стабільно валив
  // як inaccurate на всіх бенч-файлах efes 2026-07-21 — і мав рацію: це over-claim,
  // який file-local аналіз не може підтвердити. Обмежене твердження — може.
  if (m.readOnly)
    lines.push('- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.')
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

/** Поріг (у токенах, ~4 байти/токен), після якого сирий src замінюється юніт-дайджестом. */
export const UNIT_DIGEST_TOKENS = Number(env.N_CURSOR_DOCGEN_DIGEST_TOKENS ?? 2000) || 2000

/** Скільки перших рядків тіла юніта потрапляє в дайджест, коли JSDoc порожній. */
const DIGEST_BODY_LINES = 12

/**
 * №5 (бенч gemma-4): стислий юніт-дайджест великого файлу замість сирого src у
 * Behavior-промпті. На ~6k токенів сирцю мала модель втрачає фокус (водянисті
 * формулювання); дайджест подає структуру — імʼя, JSDoc, call-graph, тіло лише
 * для непокритих JSDoc юнітів (перші рядки) — і тримає промпт компактним.
 * @param {Array<{name:string, kind:string, exported:boolean, doc:string, calls:string[], body:string}>} units юніти файлу (extractUnits)
 * @returns {string} текстовий дайджест для вставки замість повного src
 */
export function buildUnitDigest(units) {
  const parts = [
    'СТИСЛИЙ ДАЙДЖЕСТ ФАЙЛУ (повний код не подано — файл завеликий; описуй ЛИШЕ те, що видно з дайджесту):'
  ]
  for (const u of units) {
    const head = `### ${u.name} (${u.exported ? 'export ' : ''}${u.kind})`
    const lines = [head]
    if (u.doc) lines.push(`JSDoc: ${u.doc}`)
    if (u.calls?.length) lines.push(`викликає: ${u.calls.join(', ')}`)
    if (!u.doc && u.body) {
      const bodyLines = u.body.split('\n')
      const trimmed = bodyLines.slice(0, DIGEST_BODY_LINES).join('\n')
      lines.push('```', trimmed + (bodyLines.length > DIGEST_BODY_LINES ? '\n…' : ''), '```')
    }
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
}

/**
 * №6 — judge-refine: один локальний refine-прохід за конкретними зауваженнями
 * LLM-судді (замість лише маркування degraded). Суддя вже сформулював, ЩО саме
 * хибне (`reason`) — мала модель добре виправляє точкові твердження, коли їй
 * сказано, які саме.
 * @param {string} doc машинні секції доки (без захищеного «Призначення»)
 * @param {string} reason зауваження судді (verdict.reason)
 * @returns {Array<{role:string,content:string}>} messages-масив для LLM
 */
export function judgeRefineMessages(doc, reason) {
  return msgs(
    STYLE,
    `Рецензент знайшов у документації неточності:\n${reason}\n\nВиправ ЛИШЕ хибні твердження — прибери або переформулюй їх так, щоб вони відповідали дійсності. Збережи структуру (усі ## заголовки), мову й решту тексту без змін. Поверни ПОВНИЙ виправлений markdown-документ, без преамбул.\n\nДОКУМЕНТ:\n${doc}`
  )
}
