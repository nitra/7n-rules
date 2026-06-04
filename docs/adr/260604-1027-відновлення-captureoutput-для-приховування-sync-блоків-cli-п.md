---
session: 4fcd6586-f372-4b12-9595-ba3be85a3b64
captured: 2026-06-04T10:27:45+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4fcd6586-f372-4b12-9595-ba3be85a3b64.jsonl
---

## ADR Відновлення `captureOutput` для приховування sync-блоків CLI при відсутності помилок

## Context and Problem Statement
Після rebase/merge у гілку `main` коміт `20a0e24` (`fix(cli): ховати блоки Skills/Commands якщо немає помилок`) вийшов з досяжності будь-якої гілки — `git log -S "captureOutput" --all -- npm/bin/n-cursor.js` повернув порожній результат. Як наслідок, `npx @nitra/cursor` знову друкував усі `⬇ … ✅`-рядки і підсумок для блоків `🧩 Skills`, `⌨️ Commands` та `🥧 Pi skills` навіть за повністю успішного прогону, захаращуючи термінал некорисним виводом.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Відновити helper `captureOutput` у `npm/bin/n-cursor.js`", because втрачений підхід був задокументований у двох ADR від 2026-06-01 і його достатньо переписати за тими ж принципами: буферизувати весь `process.stdout.write` і `console.log`/`console.error` під час кроку і скидати буфер до реального stdout **лише** коли `result.fail > 0`.

### Consequences
* Good, because за успішного прогону три блоки (`🧩 Skills`, `⌨️ Commands`, `🥧 Pi skills`) більше не друкуються — вивід зводиться до `✨ Готово: N завантажено, 0 з помилками`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/bin/n-cursor.js`, функція `captureOutput` (додана після `runSyncStep`).
- Перехоплення stdout через `process.stdout.write = (...args) => { buffer.push(...); ... }` (rest-параметри, щоб уникнути `jsdoc/require-param` помилки oxlint на вбудованих стрілках).
- Removal-логи залишені поза буфером навмисно — вони є корисним сигналом і трапляються рідко.
- Change-файл: `.changes/1780490107951-96db7d.md` (patch, section: Changed).
- Попередня документація: `docs/adr/20260601-100708-…` та `docs/adr/20260601-102620-…`.

---

## ADR Поширення `captureOutput` на блок синхронізації правил

## Context and Problem Statement
Під час перевірки відновленого фіксу користувач показав реальний вивід `bun start` з `@nitra/cursor@3.20.0`, де блок правил (`⬇ adr → .cursor/rules/n-adr.mdc ... ✅`, 19 рядків) друкувався так само повністю, незважаючи на те що оригінальне завдання (`captureOutput`) вже закривало інші три блоки. Це виявило непослідовність: вивід правил був такою ж порожньою інформацією на успіху.

## Considered Options
* Обгорнути блок `syncManagedRuleFiles` у `captureOutput` — аналогічно до Skills/Commands/Pi.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Обгорнути блок `syncManagedRuleFiles` у `captureOutput`", because підхід консистентний із вже реалізованими трьома блоками; критерій той самий — рядки `⬇ … ✅` і підсумок не несуть користі за нульового `failCount`.

### Consequences
* Good, because transcript фіксує очікувану користь: smoke-прогон після зміни показав компактний вивід без рядків `⬇ rule → … ✅` за успіху.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Зміна в `npm/bin/n-cursor.js`: виклик `syncManagedRuleFiles` обгорнутий у `captureOutput`, `failCount` використовується як `result.fail`.
- `removeOrphanManagedFiles`-лог залишений поза буфером — аналогічно до removal-логів у інших блоках.
- Результат smoke-прогону: вивід після змін містить лише `📋 Правил до завантаження: N` і `✨ Готово`; рядки `⬇ rule → … ✅` відсутні.
- Change-файл оновлено: `.changes/1780490107951-96db7d.md` — формулювання розширене до «ховати блоки правил / 🧩 Skills / ⌨️ Commands / 🥧 Pi skills».
