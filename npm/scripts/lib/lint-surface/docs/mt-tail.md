---
type: JS Module
title: mt-tail.mjs
resource: npm/scripts/lib/lint-surface/mt-tail.mjs
docgen:
  crc: df14bc2e
  model: openai-codex/gpt-5.4-mini
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл матеріалізує lint-хвіст у пласкі root-level MT-вузли `mt/<node>/task.md` і `a.md` без composite-плану й `spawn-approve`, щоб окремі fix-правки далі виконував orchestrator MT за контрактом `graph.md` з `Task`, `Done when` і `Check`. Ядро модулю охоплює кластеризацію, сигнатуру вузла та формування `buildTaskMd`, `buildCheckCommand` і `buildAgentFlag`, а конфіг, на який він спирається, — `.mt.json`. Єдиний гейт — onboarded-репо (наявність `.mt.json`, перевіряє `mtPreflight`); якщо MT недоступний, він працює fail-open і повертає `{ materialized: false }`, не валячи lint. Широкі фікси (кількість target-файлів від порога `N_LINT_MT_AUDIT_FILES`, дефолт 4, або whole-repo) отримують `audit: required` — collateral-контроль штатним MT-аудитом (Фаза C); вузькі — `optional`. Вузли виконує вбудований шлях MT — підписочні CLI (`claude`|`codex`|`cursor`|`pi`) з user-level ENV-конфігом (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP`); власний `node_executor` (mt-run-node) видалено за mt ADR `260713-2110`.

## Поведінка

- `clusterTail` — групує порушення в окремі fix-одиниці за правилом і concern та збирає список пов’язаних файлів.
- `fixNodeSignature` — будує стабільну коротку сигнатуру кластера для відтворюваного імені вузла.
- `fixNodeName` — формує канонічну назву root-level MT-вузла для fix-роботи.
- `buildCheckCommand` — описує команду перевірки, яка підтверджує, що порушення правила зникли.
- `buildTaskMd` — створює вміст `task.md` для fix-вузла з описом задачі, умовою готовності, командою перевірки та списком target-файлів.
- `buildAgentFlag` — створює вміст `a.md`, який позначає вузол як виконуваний агентом і задає `model_tier`.
- `mtPreflight` — перевіряє, чи репо має `.mt.json` і чи доступний MT CLI.
- `materializeTail` — перетворює lint-хвіст на MT-вузли; якщо MT недоступний, лише логує причину й повертає `materialized: false`, не валячи lint.

## Публічний API

- clusterTail — зводить хвостові порушення в fix-одиниці за парою `rule × concern`.
- fixNodeSignature — дає стабільний підпис кластера, щоб той самий хвіст завжди мапився на той самий вузол.
- fixNodeName — формує root-level імʼя fix-вузла в `mt/` у kebab-safe форматі.
- buildCheckCommand — створює `## Check` для вузла: повторно знаходить правило, а `exit 0` означає, що порушення вже зникло.
- buildTaskMd — генерує канонічний `task.md` для fix-вузла за контрактом `graph.md`; час не вставляє, `budgetSec` може бути заданий окремо.
- buildAgentFlag — пише прапор `a.md`, який позначає агента-виконавця; tier перетворює на `model_tier`.
- mtPreflight — перевіряє, чи є MT CLI+addon і чи репо вже onboarded через `.mt.json`.
- materializeTail — перетворює хвіст порушень на MT fix-вузли; якщо MT недоступний, не валить lint і повертає `{ materialized: false }`.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
