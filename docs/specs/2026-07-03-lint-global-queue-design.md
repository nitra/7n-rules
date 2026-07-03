# Глобальна черга запусків `n-cursor lint --full` з видимим прогресом

- Дата: 2026-07-03 (ревізія того ж дня: скоуп звужено до `--full`, додано видимість черги)
- Статус: реалізовано
- Контекст: кілька агентів (сесій) запускають `npx @nitra/cursor lint` одночасно і конфліктують

## Проблема

«Один інстанс за раз» існував лише як текст у CLAUDE.md / SKILL.md — технічного примусу не було.
Одночасні whole-tree прогони конфліктують реально:

- обидва пишуть у ті самі файли проєкту (T0-автофікси `eslint --fix`/`oxfmt`/`cspell --fix`,
  потім LLM-worker);
- snapshot/rollback живе в пам'яті кожного процесу: якщо запуск A відкочує файл, який щойно
  пофіксив запуск B, — B цього не бачить і репортить успіх;
- навіть диз'юнктні прогони конкурують за CPU/диск/локальну LLM.

Додатково: запуск у черзі нічого не бачив — незрозуміло, черга це чи зависання, і скільки
попереду роботи.

## Рішення (зафіксовані в brainstorm; фінальна ревізія)

| Вісь | Рішення |
| --- | --- |
| Скоуп лока | **Лише `lint --full`**; дельта/scoped/`--no-fix` — без лока, паралельно |
| Гранулярність | Один глобальний лок на машину (per-user tmpdir), без прив'язки до дерева/репо |
| Поведінка при зайнятому локу | **Черга**: poll до дедлайну **45 хв**, далі **fail-closed** (Error, exit 1) |
| Видимість черги | Процес у черзі рендерить: позицію `#i/n`, власника лока (pid + тека), **живий прогрес-бар** активного прогону і список решти черги |
| Лок мертвого процесу | Перехоплюється **одразу** (PID-перевірка), без очікування |
| `hook --post-tool-use` | Лок **не** бере: read-only, per-file, має відповідати миттєво |

## Реалізація

Перевикористано наявний `withLock` (`npm/scripts/utils/with-lock.mjs`: mkdir-лок, PID-живість,
poll-черга, TTL-дедуплікація за fingerprint) через обгортку
`npm/scripts/lib/lint-surface/lint-lock.mjs` (`withGlobalLintLock`), підключену в диспатч
`case 'lint'` у `npm/bin/n-cursor.js`. Не-full варіанти повертаються в `runFn()` одразу.

**Спільний стан** у `os.tmpdir()/n-cursor/lint-full/`:

- `lock/owner.json` — власник (pid/host/startedAt/cwd; пише `withLock`);
- `queue/<enqueuedAt>-<pid>.json` — реєстрація процесів у черзі (записи мертвих PID прибираються при
  читанні списку);
- `progress.json` — знімок прогресу активного прогону: `createProgressPublisher()` (throttle
  500 мс) отримує знімки від `createProgressReporter({ onUpdate })` і пише файл; процеси в черзі
  читають його і рендерять тим самим форматом бара (`renderProgressLine` із `progress.mjs`).

**Хуки очікування** додано у `withLock`: `onWaitStart` (реєстрація в черзі), `onWaitTick`
(рендер рядка черги; TTY — перемальовування одного рядка `\r[2K…` на stderr, не-TTY —
append раз на 10 с), `onWaitEnd` (зняття реєстрації, очистка рядка). Без хуків поведінка
`withLock` незмінна (per-rule використання `run-standard-lint.mjs` не зачеплено).

**Проводка прогресу**: `runFixPipeline`/`detectAll` приймають `opts.onProgress` →
`createProgressReporter({ onUpdate })`. У `detectAll` (не-TTY) reporter створюється
«мовчазним» (`appendInNonTTY: false`) — публікація без ⏱-шуму в hooks/CI.

**Інші параметри**: fingerprint дедуплікації домішує варіант виклику (rules/`--no-fix`/cwd) до
знімка дерева; `staleThreshold` 6 год (дефолтні 30 хв «перехоплювали» б живий лок довгого
прогону); `onWaitTimeout: 'fail'`.

Формат рядка процесу в черзі:

```
⏳ lint --full у черзі #2/3 · працює pid 82326 (cursor) · [████████░░░░░░░░░░░░] 5/12 концернів · знайдено 47 · виправлено 32 · js/eslint (haiku) · чекають: pid 91001 (other)
```

## Верифікація

- Юніт-тести: `npm/scripts/lib/lint-surface/tests/lint-lock.test.mjs` (full-гейтинг: не-full без
  лока і без очікування; fingerprint-осі; fail-closed таймаут з рядком черги; перехоплення лока
  мертвого PID; publisher throttle/stop; `renderWaitLine`), `progress.test.mjs`
  (`onUpdate`, `appendInNonTTY:false`), наявні `with-lock.test.mjs`.
- Живі прогони: (1) `--full` за штучно утриманим локом показав рядок черги з позицією, власником
  і живим баром, після звільнення взяв лок і завершився exit 0; (2) дельта-запуск при
  зайнятому full-локу пройшов одразу, без черги.

## Оновлені доки

- `buildClaudeLintParallelismSectionLines` у `npm/bin/n-cursor.js` (джерело секції CLAUDE.md),
  CLAUDE.md приведено до нового тексту вручну (ідентично майбутньому sync);
- `npm/skills/lint/SKILL.md` і локальний `.cursor/skills/n-lint/SKILL.md` — секція «Паралелізм».
