---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/taze/js/orchestrate.mjs
docgen:
  crc: 41e7fabf
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Поведінка

runTazeOrchestrator ініціює процес, викликаючи loadPluginTazeProviders для збору всіх доступних EcosystemProvider-ів з проєкту, включаючи інформацію з .n-rules.json. Після збору провайдерів оркестратор ітерується по кожному, передаючи його до runEcosystem. runEcosystem керує повним життєвим циклом однієї екосистеми: від детекції до фіксації результатів за допомогою runMajorEntry. runMajorEntry викликає callRunner для кожного major-запису, використовуючи визначений раннер, і відправляє результат у контекст прогону. Результат callRunner передається до isAcpAuthFailureMessage для визначення, чи слід призупинити подальші виклики в поточному прогоні через незалогінений стан ACP-агента. Якщо runMajorEntry завершує свою роботу, її вихідні дані передаються до formatResultLine для формування рядка звіту. runEcosystem збирає ці рядки та передає їх до appendEcosystemSection, яка компілює повну секцію для цієї екосистеми. Після того як runEcosystem завершила роботу для всіх провайдерів, runTazeOrchestrator передає зібрані записи до formatReport, який складає фінальний markdown-звіт.

## Сценарії використання

- `npm/skills/taze/js/tests/orchestrate.test.mjs` (callRunner; isAcpAuthFailureMessage) — pi: перехоплює текст через deps.out, повертає ok/error з runAgentSkill; cursor/codex: успіх — return тексту напряму, тір avg паритетно pi-гілці; cursor/codex: помилка — ok:false, текст помилки; розпізнає повідомлення про незалогінений cursor-agent; розпізнає codex login case-insensitive; ще 24

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
