---
type: JS Module
title: agent-skill.mjs
resource: llm-lib/lib/agent-skill.mjs
docgen:
  crc: b7312bad
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Організовує один запуск skill і керує його виконанням у межах поточного контексту, щоб агент отримував потрібний стан для роботи. Має локальні fail-safe гілки для контрольованих збоїв; інші помилки можуть поширюватися назовні.

## Поведінка

1. Приймає готовий prompt для одного skill-запуску та фіксує контекст виконання: skill, tier, modelSpec, cwd, timeout, maxTokens, caller і chain.
2. Переходить у наступний крок chain, якщо ланцюжок передано, і готує кореляцію для подальшого обліку.
3. Обирає модель через registry; якщо модель явно задана, але не знаходиться, завершує запуск без виконання skill.
4. Створює pi-сесію з повним набором built-in tools, включно з bash, і прив’язує до неї поточний working directory та рівень thinking.
5. Для локальних моделей додає chain-кореляцію; для інших моделей цього не робить.
6. Запускає один skill-цикл і стрімить текст відповіді в stdout у міру надходження.
7. Рахує turns і tool calls; якщо turns перевищують аварійну стелю, зупиняє виконання як runaway-backstop.
8. Обмежує час виконання; при timeout перериває сесію.
9. Якщо модель або registry недоступні, повертає fail-safe результат із помилкою без продовження прогону.
10. Якщо під час prompt виникає memory-guard rejection для локального model-сервера, завершує як fail-fast і не маскує помилку.
11. Після завершення формує telemetry з фактичним model, turns, tool calls, backstop-станом і тривалістю.
12. Передає результат у chain і trace, а також зберігає capture для подальшого аналізу прогону.
13. Повертає ознаку успіху, telemetry і текст помилки; успіх можливий лише коли немає помилки й не спрацював backstop.

## Публічний API

- runAgentSkill — Виконує ОДИН скіл агентно через pi.

## Сценарії використання

- `llm-lib/tests/agent-skill.test.mjs` (runAgentSkill) — happy-path: ok, телеметрія, стрім тексту, trace kind:; createSession отримує тиру → thinkingLevel і cwd; maxTokens прокидається у createSession (0 = без стелі); з chain: step/note/chain-поля у trace; хмарна модель → chain:null у сесію; modelSpec порожній: telemetry.model — фактично резолвлена pi-модель, не echo spec; ще 5

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
