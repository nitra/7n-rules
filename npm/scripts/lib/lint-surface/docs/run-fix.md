---
type: JS Module
title: run-fix.mjs
resource: npm/scripts/lib/lint-surface/run-fix.mjs
docgen:
  crc: 45965f7d
  model: manual
---

## Огляд

Цей файл реалізує уніфіковану поверхню для фіксації порушень лінтування (unified lint surface) відповідно до специфікації `2026-06-29 §Fix Role / §Tier Ladder`. Він керує послідовним процесом виявлення та усунення проблем, який складається з етапів: виявлення → (очищення/збереження) → Т0 (перманентне виправлення) → знімок S1 → повторне виявлення → (очищення/збереження) → цикл `ladder[відновлення S1 → worker → виявлення]*` (до вичерпання) → (вичерпання/відкат S1). Публічна функція `fixConcern` відповідає за індивідуальне виправлення певного компонента, а `runFixPipeline` ініціює весь комплексне виконання пайплайну. Ролі є чітко розподілені: `detector` лише виявляє, тоді як `T0` та `worker` здійснюють зміни. Успішне завершення визначається виключно канонічним повторним виявленням.

## Поведінка

Поведінка:
fixConcern застосовує детерміновані патерни (T0), а потім, якщо це можливо, послідовно виконує ланцюжок фікс-операцій (ladder) для виявлення та усунення порушень певного concern-а.
runFixPipeline керує повним циклом виправлення: він детектирує всі порушення, застосовує виправлення для кожного знайденого concern-а через `fixConcern`, і виводить фінальний звіт про нездоланні порушення.
Per-tier timeout (ADR 260620-0556): кожен rung передає worker-у свій `timeoutMs` через `FixContext` (шлях до `runAgentFix opts.timeoutMs`, який abort-ить LLM-сесію), а сам виклик worker-а додатково огорнутий backstop-гонкою ×1.25 від `rung.timeoutMs` — worker, що ігнорує таймаут (зокрема зависла cloud-SSE), фейлить rung помилкою `fix timeout …` замість блокувати lint назавжди; така помилка класифікується як quality і ladder ескалює далі.
Semantic-collateral veto (spec pi-fix-engine-migration §12, addendum 2026-07-05): clean-вердикт rung-а не приймається, якщо rung змінив наявні файли поза target-set порушення (`violations[].file ∪ item.files`, звірка через `collateral-veto.mjs` за `snapshot.modifiedExisting()`); наслідок — rollback S1, `🚫`-лог, feedback наступному rung-у й телеметрія `kind:"collateral-veto"` у глобальний llm-trace. Нові файли дозволені; порожній target-set → veto незастосовний (fail-open).
Evidence-гейт рунга (Фаза A1 run-harness, спека 2026-07-11): кожен rung отримує у `FixContext` `verify` — item-scoped canonical re-detect (той самий детектор, що й фінальний вердикт), і `verifyMax` per tier (local — 1, cloud — 2); worker прокидає їх у `runAgentFix`, де провал verify інʼєктиться фідбеком у ту саму pi-сесію. Зовнішній canonical re-detect після worker-а лишається єдиним вердиктом рунга; помилка детектора всередині verify ковтається у `{ok:false}` — зовнішній detect кине її штатно.
Durable-write-и (issue nitra/cursor#16): worker отримує у `FixContext` поруч із `recordWrite` опційний `recordDurableWrite` — для записів, кожен з яких є самодостатнім кінцевим станом (doc-files: дока зі свіжим CRC). Такі файли переживають rollback провального rung-а і не входять у collateral-veto: частковий прогрес великого батчу не стирається, canonical re-detect наступного rung-а/прогону рахує лише те, що реально лишилось.
MT-tail (Фаза B, спека 2026-07-11): коли лишився невиправлений хвіст (worst=1), `renderRemaining` повертає зібрані порушення, і вони матеріалізуються у вузли MT-графа через `materializeTail` (mt-tail.mjs). Єдиний гейт — onboarded-репо (наявність `.mt.json`); fail-open: MT недоступний або будь-яка помилка → лог, lint не падає.
Distillation-телеметрія (Фаза C, §13 pi-migration): успішний agentic-рунг (canonical clean, без veto, з реальними правками у worker telemetry) пише запис `oldText→newText` у глобальний стор (`recordFixTelemetry`, `~/.n-rules/telemetry/<rule>/open/`) — корпус для маховика дистиляції T0. Best-effort; T0/ручні фікси не пишуться.
Rollback на провалі re-detect-а: якщо canonical re-detect усередині rung-а сам кидає виняток (worker/LLM лишив файл синтаксично невалідним — детектор/conftest не може його розпарсити), `runRung` спершу відкочує `snapshot` до S1, і лише потім перекидає виняток далі — без цього зіпсований проміжний стан worker-а лишався б на диску назавжди (виняток абортує весь прогін до звичайного rollback-коду).
skipLocalTier (concern-meta.mjs): `selectLadder` перед циклом ladder-а фільтрує з нього local-min/local-min-retry rung-и, якщо `item.entry.concern.skipLocalTier === true` — перша спроба одразу йде на cloud-min. Для concern-ів, де local-tier емпірично майже завжди лише витрачає бюджет rung-а без результату (виявлено на реальному прогоні 2026-07-18: 0/12 успіхів local-tier для `js/eslint`).

## Публічний API

fixConcern — Виконує один етап перевірки у конвеєрі (T0 → S1 → ladder) та повідомляє про результат закриття цієї перевірки.
runFixPipeline — Запускає повний цикл виправлення: ідентифікує всі проблеми, виправляє кожну, що не пройшла перевірку, і завершує роботу.

## Гарантії поведінки

- Сам не редагує кодові файли (мутації роблять T0/worker); пише лише телеметрію collateral-veto у глобальний llm-trace (best-effort, ніколи не валить прогін).
