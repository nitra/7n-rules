---
type: JS Module
title: escalation-log.mjs
resource: npm/scripts/lib/fix/escalation-log.mjs
docgen:
  crc: 91898427
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Файл створює append-only JSONL-лог ескалації конформність-фіксу (спека 2026-06-19-fix-escalation-cascade-design). Він фіксує кожен запис на рунг драбини, що включає деталі використаної моделі (`model`), подання зворотного зв'язку (`withFeedback`), результат виклику (`callOk`/`callError`), оцінку, чи допомогло це усунути порушення (`recheckOk`), залишковий `violation` та самоаналіз моделі (`diagnosis`). Цей лог доповнює always-on wire-trace (`lib/pi-trace.mjs`) і формує логіку для join за полем `caller` (`fix:<rule>:<rung>`). Запис відбувається за певним шільною: або через kill-switch `N_CURSOR_FIX_ESCALATION_LOG`, або за явним шляхом, дефолтно у `<cwd>/.n-cursor/fix-escalation.jsonl`.

## Поведінка

Поведінка:
escalationLogPath визначає шлях до файлу журналу ескалації конформності. Якщо встановлено змінну середовища N_CURSOR_FIX_ESCALATION_LOG, використовується цей шлях; інакше, за замовчуванням, це .n-cursor/fix-escalation.jsonl у поточній робочій директорії.
logEscalation записує один запис про рунг у JSONL-лог, якщо шлях до логу визначено. Запис містить метадані про спробу фіксування, результати виклику та аналіз. Помилки під час запису логу ігноруються.

## Публічний API

escalationLogPath — вказує на місце зберігання логу ескалацій, якщо функція не вимкнена.
logEscalation — записує один подію виконання в спеціальний лог у форматі JSONL, ігноруючи внутрішні помилки запису.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
