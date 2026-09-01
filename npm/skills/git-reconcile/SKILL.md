---
name: n-git-reconcile
description: >-
  Аналіз git-гілок, worktree та stash відносно актуальної policy base branch:
  детерміновано відсіює merged і patch-equivalent refs (native `n-rules
  git-reconcile inventory`), передає ТОБІ semantic triage та conflict
  resolution, а корисні зміни переносить у перевірені PR. Безпечне видалення
  (`n-rules git-reconcile cleanup`) архівує branch/stash у
  `origin/tempo/git-reconcile/*` ПЕРЕД локальним видаленням (ADR #334) —
  ніколи не видаляй їх вручну (`git branch -D`/`git stash drop`) в обхід цієї
  команди. Використовуй, коли просять розібрати, консолідувати, підготувати
  PR або безпечно почистити старі Git refs і stash.
---

# n-git-reconcile — узгодження Git-графа

## Виконання — ти сам, крок за кроком (§2.136)

Немає окремого JS-оркестратора: `npx @7n/rules skill pi|cursor|codex
git-reconcile` передає цей файл ОДНИМ промптом у ОДИН агентський хід — так
само, як будь-який інший скіл. Кроки 0-6 нижче виконуєш **ти сам**,
послідовно, ОДИН candidate за раз (не паралельно — це свідома відмінність від
старого JS, який матеріалізував незалежні PR-групи з bounded concurrency `3`;
ти вже і є той единий "воркер", вкладений паралелізм тут не потрібен і не
безпечний без окремого нагляду).

Три кроки лишаються **native-командами** `n-rules git-reconcile <verb>`, а не
текстом — не через обсяг, а тому що кожен із них або (a) мусить давати
БАЙТОВО ІДЕНТИЧНУ класифікацію щоразу, або (b) є atomic-critical переходом,
де ручне виконання крок-за-кроком залишає вікно небезпечної проміжної дії:

- **`n-rules git-reconcile inventory [--base <гілка>]`** — детермінована
  класифікація Git-фактів (branch/stash/worktree/open-PR відносно
  `origin/<base>`, дефолт `main`) у JSON: `merged` / `patch-equivalent` /
  `protected` / `review`. Ручне повторення цієї класифікації (`git
  merge-base`, `git diff --quiet`, парсинг `git worktree list`) щоразу
  вручну — ненадійне і саме та причина, з якої `taze diff` теж лишився
  окремою командою (§2.125).
- **`n-rules git-reconcile cleanup <джерело> --kind branch|stash [--reason
  <text>] [--base <гілка>] [--no-archive] [--dry-run]`** — БЕЗПЕЧНЕ
  видалення: archive у `origin/tempo/git-reconcile/<дата>/<kind>-<slug>-<sha12>`
  (manifest `.git-reconcile/archive.json` + `ARCHIVE.md`, ADR #334) → push →
  верифікація remote ref І byte-точного tree → **лише тоді** локальне
  видалення (`git branch -D` / `git stash drop`). Будь-яка помилка
  верифікації — джерело лишається `kept`, exit ≠ 0, нічого локально НЕ
  видаляється. Це саме той крок, який НЕ можна звести до тексту SKILL.md:
  агент, що виконує послідовність команд сам, має вікно між "push здався
  успішним" і "verify підтвердив" — і під тиском "далі по кроках" може
  передчасно видалити локальний стан. Атомарність цього переходу — точна
  причина, чому це verb, а не інструкція. `--no-archive` дозволено лише коли
  `inventory` уже класифікував джерело як `merged`/`patch-equivalent` — сама
  команда fail-closed перевіряє це ще раз перед видаленням.
- **`n-rules git-reconcile gc [--apply]`** — 45-денний sweep
  `origin/tempo/git-reconcile/*` (ADR #334). Dry-run за замовчуванням;
  `--apply` реально видаляє прострочені архіви лише якщо manifest валідний,
  `deleteAfter` минув, і джерело не має open PR (недоступність GitHub-
  перевірки — причина ПРОПУСТИТИ ref, не видаляти, той самий fail-closed
  принцип). GC — окрема дія, не частина кожного прогону reconcile: клич
  `gc` (без `--apply`) щоб побачити, що назріло, і `--apply` лише коли
  користувач явно просить прибрати прострочені архіви.

Решта — семантичні рішення (triage, conflict resolution, PR-опис) і звичайний
git/gh workflow, який ти й так виконуєш у роботі. Не обгортка над ними —
жодного вкладеного ACP-виклику на кожен candidate, ти вже читаєш повний
контекст задачі в цьому ж ході.

### Крок 0 — inventory

```
n-rules git-reconcile inventory --base main
```

Прочитай JSON: `branches[]`, `stashes[]`, `worktrees[]`, `openPrsChecked`.
Кожен запис має `state`:

- `merged` / `patch-equivalent` — уже повністю в `origin/<base>` (byte-точно
  чи ancestor). Кандидат для `cleanup --no-archive` одразу (крок 4), triage
  не потрібен.
- `protected` — live worktree, open PR або поточна гілка. НЕ чіпай.
- `review` — потребує semantic triage (крок 1).

### Крок 1 — semantic triage (для кожного `review`-джерела)

Подивись на diff джерела відносно `origin/<base>` (`git log`/`git diff`,
`git stash show -p` для stash) і виріши:

- **`pr`** — завершена корисна зміна → крок 2-3.
- **`keep`** — незавершено або сумнівно → нічого не роби, лиши як є, згадай у
  фінальному звіті (крок 6).
- **`drop`** — застаріле, неактуальне, або повністю замінене іншою роботою
  → одразу крок 4 (`cleanup`, з archive — це НЕ merged/patch-equivalent,
  тож `--no-archive` тут не підходить).

Сам факт конфлікту при подальшому cherry-pick (крок 2) НЕ дозволяє
downgrade вже ухваленого `pr` до `keep` — conflict resolution є наступним
кроком, не приводом відкласти рішення.

### Крок 2 — підготовка worktree і перенесення

```
mt worktree create git-reconcile-<slug> --base origin/<base> --description "git-reconcile: <джерело>"
```

(`mt` — уже наявний CLI worktree-lifecycle, той самий, що бере
`n-rules:worktree:start` для `worktree: true` скілів; тут викликаєш його сам,
бо candidate-и багато і кожному потрібен СВІЙ ізольований worktree, а не
worktree сесії.)

Перенеси зміну у щойно створений worktree:

- **branch** — по одному коміту: `git -C .worktrees/git-reconcile-<slug>
  cherry-pick <oid>`. Конфлікт → розв'яжи ЗМІСТОВО (не `ours`/`theirs`
  механічно: порівняй поточний `main` і намір перенесеної зміни, збережи
  актуальну поведінку `main`, перенеси лише відсутню корисну частину),
  `git add -A`, `git cherry-pick --continue`. Semantic no-op (порожній
  staged diff, немає unresolved) → `git cherry-pick --skip`.
- **stash** — `git -C .worktrees/git-reconcile-<slug> stash apply
  <stash-ref>` (або `git apply --3way` на патчі `git stash show -p
  --binary`, якщо `apply` не підходить). Конфлікт — та сама дисципліна, що
  й для branch.

Перш ніж продовжити — переконайся, що весь corpus вже є в `main`, а не
повертає застарілу архітектуру: якщо перенесена зміна не додає нічого, чого
`origin/<base>` вже не має, це `obsolete`, не `pr` — поверни до кроку 1,
познач `drop`, і йди в крок 4 з archive.

### Крок 3 — scoped gates, push, PR

У `.worktrees/git-reconcile-<slug>`, для змінених директорій:

1. **Doc-files** — регенеруй файлову доку для змінених файлів (обов'язковий
   крок задачі, той самий що для будь-якої іншої правки — `.cursor/skills/
   n-doc-files/SKILL.md`), скоуп лише на змінений код.
2. **Lint** — `npx @7n/rules lint --no-fix <змінена-директорія>` для кожної
   унікальної директорії зміненого коду (не repo-wide baseline).
3. **Тести** — найвужчий релевантний regression test (test file/selector,
   не `bun run test`/`bun test` repo-wide). Порівняй з baseline
   `origin/<base>` — якщо там та сама помилка вже червона (розпізнаний
   Vitest failure), прийми red baseline; НОВА помилка — виправ або поверни
   до triage.
4. **Changelog** — стандартний `.cursor/rules/n-changelog.mdc` гейт, як для
   будь-якої іншої зміни.

Після зелених gates:

```
git -C .worktrees/git-reconcile-<slug> push -u origin git-reconcile/<slug>
gh pr create --base <base> --head git-reconcile/<slug> --title "<заголовок>" --body-file <файл>
```

PR body — секції «Навіщо», «Бізнес-результат», «Архітектура», «Поведінка»,
«Ризики та сумісність» (контракт нижче в «Результат»); source/evidence paths
— у collapsed technical details, не в основному тексті.

Дочекайся checks: `gh pr checks <url>` з паузами (кілька спроб, до ~15 хв
сумарно — той самий бюджет, що раніше тримав JS). Порівняй failed checks із
base commit: check regression лише якщо той самий check був green на
`origin/<base>`; відсутній/pending базовий check → `unverified`, не
вигаданий regression. PR, який GitHub уже позначив merged під час
очікування — теж успішний термінальний стан.

### Крок 4 — cleanup (archive → verify → delete)

- Джерело `merged`/`patch-equivalent` із кроку 0:
  `n-rules git-reconcile cleanup <джерело> --kind branch|stash --no-archive --base <base>`
- Джерело `pr-created` (checks зелені/merged) або `drop`:
  `n-rules git-reconcile cleanup <джерело> --kind branch|stash --reason "<причина>" --base <base>`
  (без `--no-archive` — команда сама архівує в `origin/tempo/git-reconcile/*`
  і верифікує ПЕРЕД видаленням).
- Regression/baseline-red/timeout/pending/unreadable checks, `keep` із кроку
  1 — **не** cleanup-кандидат: залиш branch, URL і worktree, зафіксуй у
  звіті.

Прибери тимчасовий worktree кроку 2 для кожного завершеного (перенесеного
або dropped) джерела: `mt worktree remove git-reconcile-<slug>`.

### Крок 5 — GC (за потреби, не щоразу)

`n-rules git-reconcile gc` без `--apply` показує, які архіви `tempo/
git-reconcile/*` прострочені (45 днів). Реальне видалення (`--apply`) — лише
коли користувач явно просить прибрати архіви, не автоматична частина
кожного reconcile-прогону.

### Крок 6 — фінальний звіт

Формат — контракт «Результат» нижче: один verdict на джерело, точний count
кожного outcome, forensic-деталі для збережених worktree/PR.

## Інваріанти

- База — тільки свіжий `origin/<baseBranch>` (`inventory`/`cleanup` самі
  роблять `git fetch origin <base>` перед класифікацією).
- Pre-analysis не виконує `merge --ff-only`, `pull` або `update-ref`:
  tracking relation визначається read-only через `merge-base
  --is-ancestor`.
- Живі worktree, включно з detached HEAD за commit OID, та гілки відкритих
  PR — protected (`inventory` це класифікує).
- Стара дата або великий divergence не означають, що зміна непотрібна.
- `ours`/`theirs` не застосовуються механічно: конфлікт розв'язується за
  поведінкою (крок 2).
- Empty cherry-pick пропускається лише за активного `CHERRY_PICK_HEAD`,
  відсутніх conflicts і порожнього staged diff.
- За невизначеності джерело лишається `kept`; misleading ready PR не
  створюється.
- Перед push обов'язково проходять фінальний tree-diff guard, scoped
  lint/doc-files/тести й changelog (крок 3).
- Raw поведінкові подробиці не потрапляють у PR body напряму — рендер за
  контрактом «Результат» нижче, з evidence paths у collapsed details.
- **Локальне видалення НІКОЛИ не виконується вручну** (`git branch -D`,
  `git stash drop`) — виключно через `n-rules git-reconcile cleanup`, чия
  archive→verify→delete послідовність і є точка, де інваріант "remote копія
  підтверджена ПЕРЕД видаленням" (ADR #334) фактично гарантується.
- `git stash clear` заборонено взагалі — stash видаляється лише по одному,
  через `cleanup`.
- 45-денний GC (`n-rules git-reconcile gc`) fail-closed: відсутній/невалідний
  manifest, недоступність open-PR перевірки чи будь-яка git-помилка —
  причина ПРОПУСТИТИ ref, не видаляти.

## Результат

Один verdict на джерело: `merged`, `patch-equivalent`, `open-pr`,
`protected`, `pr-created`, `kept`, `drop-recommended`,
`pr-checks-regressed`, `pr-checks-baseline-red`, `pr-checks-unverified` або
`failed`. `pr-created` означає, що checks завершились успішно; для
непідтвердженого PR звіт зберігає URL, branch, worktree і точну причину.
Summary містить точний count кожного outcome, фактичний залишок
branches/worktrees/stashes після cleanup та агреговані причини retention.
Для кожного збереженого forensic worktree — окремо source, status, branch і
path, reason, URL PR (за наявності), commits ahead, unresolved/staged/
unstaged paths та конкретну next action. Для cleanup — точний OID і archive
ref (`tempo/git-reconcile/...`) кожного видаленого джерела.

## Свідомо втрачено проти старого JS-оркестратора (§2.136)

Документується прямо, не мовчки — той самий принцип, що вже застосований до
`taze` (§2.125):

- **Bounded concurrency `3` для незалежних PR-груп.** Старий JS матеріалізував
  до трьох candidate-ів одночасно (`N_GIT_RECONCILE_CONCURRENCY`). Ти
  працюєш серійно, один candidate за раз — той самий компроміс, що вже
  прийнятий для `taze` (кроки 4-6 там теж серійні, не паралельні). Довше на
  великій кількості кандидатів, безпечніше без окремого нагляду за
  паралельними worktree.
- **Живий ANSI-free progress-бар з heartbeat.** Мав сенс лише для
  довготривалого одного процесу; ти вже показуєш прогрес природно, крок за
  кроком, самим фактом виконання команд.
- **Кеш test-baseline між PR-групами в одному процесі
  (`baselineCache`).** Ти читаєш `origin/<base>` тести один раз на прогін і
  тримаєш результат у контексті цього ж ходу — тій самій причині, що
  `taze` не переносив міжпроцесний `migration-cache.mjs` (§2.125 п.5):
  ізольованих підвикликів раннера на кожен candidate більше немає, кешу
  нема кому наповнювати чи читати між ними.
