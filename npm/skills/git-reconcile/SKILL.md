---
name: n-git-reconcile
description: >-
  Покрокова інструкція узгодження git-графа відносно policy base branch:
  ти сам (агент) детермінуєш inventory за Git-фактами, робиш semantic
  triage й розв'язання конфліктів, а незворотні кроки (archive/cleanup/gc
  локальних branch/worktree/stash) виконуєш через native `n-rules
  git-reconcile <verb>`. Використовуй, коли просять розібрати,
  консолідувати, підготувати PR або безпечно почистити старі Git refs і
  stash.
---

# n-git-reconcile — узгодження Git-графа

Ніякого JS-оркестратора тут більше немає. Ти сам, крок за кроком, читаєш
цей файл і виконуєш перелічені команди — так само, як для будь-якого
іншого скіла. Єдине, що лишається окремою нативною командою зі своїм
станом — **archive/cleanup/gc** (крок 5 нижче): незворотні Git-мутації
(видалення branch/worktree/stash), для яких потрібна resumability після
переривання процесу. Усе інше (inventory, triage, конфлікти, gates, PR) —
твоя звичайна робота цим самим ходом, без вкладеного LLM-виклику.

## Native CLI

Команди `git-reconcile` живуть у `rules-cli` (той самий бінар, що і
`n-rules lint`/`n-rules tools`). У консюмерському пакеті — `n-rules
git-reconcile <verb>` (бінар на `PATH` після встановлення `@7n/rules`). У
ЦЬОМУ монорепо (розробка самого `@7n/rules`) бінар потрібно спершу
зібрати, якщо ще не зібраний:

```bash
cargo build --release -p rules-cli
```

і кликати як `./target/release/rules-cli git-reconcile <verb>` (шлях —
від кореня репозиторію; у скороченнях нижче він записаний як `n-rules
git-reconcile` — підстав фактичний бінар залежно від того, де ти
працюєш).

Verb-и:

- `archive --kind <branch|worktree|stash> --ref <name> [--worktree-path
  <path>] --reason "<text>"` — архівує джерело в
  `origin/tempo/git-reconcile/<date>/<kind>-<slug>-<sha12>` окремим
  metadata-комітом (`.git-reconcile/archive.json` + `ARCHIVE.md`) ПЕРЕД
  будь-яким локальним видаленням. Ідемпотентно (повторний виклик з тим
  самим ref і вже перевіреним архівом — no-op).
- `cleanup --kind <branch|worktree|stash> --ref <name> [--worktree-path
  <path>]` — видаляє локальний артефакт. Відмовляє, якщо для `ref` немає
  перевіреного архіву (`ls-remote` заново, не з кешу), і відмовляє
  видаляти поточну гілку/worktree поточного процесу.
- `gc [--apply] [--max-age-days 45]` — прибирає прострочені
  `origin/tempo/git-reconcile/*`. Dry-run за замовчуванням — друкує
  кандидатів, нічого не видаляє, поки не додаси `--apply`.
- `restore --archive-branch <tempo/git-reconcile/...> [--as <name>]` —
  відновлює локальну гілку з архіву (для 45-денного вікна ДО `gc`).
- `status [--json]` — поточний стан (які джерела заархівовані, чи
  прибрані локально).

**Чому саме ці кроки лишились кодом, а не текстом.** Якщо твоя сесія
обірветься МІЖ "заархівовано в origin" і "видалено локально" — без
персистентного стану (`<git-common-dir>/n-rules/git-reconcile/state.json`)
наступний запуск не може безпечно вирішити, чи архів справді дійшов до
`origin`, чи локальний артефакт ще єдина копія. Текстова інструкція в
цьому файлі не несе стан між твоїми ходами: ти читаєш `SKILL.md` наново
щоразу, а файл стану на диску — ні. Тому `archive`/`cleanup`/`gc`
лишаються native-verb-ами (`crates/rules-cli/src/git_reconcile_cmd.rs`,
доккомент модуля пояснює межу докладно), а НЕ покроковим текстом тут.

## Інваріанти (читай перед стартом)

- База — тільки свіжий `origin/<baseBranch>` (`git fetch origin`
  першим кроком; policy — `.n-rules.json`/`.n-cursor.json`
  `git.baseBranch`, дефолт `main`).
- Ти НІКОЛИ не видаляєш branch/worktree/stash напряму (`git branch -D`,
  `git worktree remove`, `git stash drop`) — лише через `git-reconcile
  cleanup`, яка сама вимагає перевіреного архіву. Пряме видалення в обхід
  цієї команди втрачає ADR-гарантію "відновлюване 45 днів".
- Живі worktree (включно з detached HEAD за commit OID) і гілки відкритих
  PR — protected: НЕ кандидати на archive/cleanup. Перевір `gh pr list
  --head <branch> --state open` ПЕРЕД тим, як архівувати чи чистити
  branch/worktree — `git-reconcile cleanup` цю мережеву перевірку сама НЕ
  робить (свідоме звуження, доккомент модуля).
- `ours`/`theirs` не застосовуються механічно при конфліктах — розв'язуй
  за поведінкою й підтверджуй тестом.
- Стара дата чи великий divergence самі по собі не означають, що зміна
  непотрібна — дивись на факт "чи це вже є в `origin/<base>`" (`git
  merge-base --is-ancestor` / patch-id порівняння), не на давність.
- `git stash clear` заборонено завжди — лише `git-reconcile cleanup --kind
  stash` по одному, після архіву.
- Перед `git push` нового PR-branch: `git diff --check` (conflict markers),
  scoped `doc-files` і `n-rules lint --no-fix` для змінених директорій,
  repository test script відносно baseline чистого `origin/<base>`
  (не свій власний worktree).
- Reason у `--reason` для `archive` — коротке людське пояснення (`"merged
  into origin/main"`, `"stale, no open PR, superseded by #123"`) — воно
  потрапляє в `archive.json`/`ARCHIVE.md`, читай його собі ж, коли
  повертатимешся до звіту.

## Крок 1 — inventory (Git-факти, без LLM-судження)

```bash
git fetch origin --prune
git for-each-ref refs/heads --format='%(refname:short) %(objectname) %(upstream:short) %(upstream:track)'
git worktree list --porcelain
git stash list --format='%H %gd %s'
gh pr list --state open --json number,headRefName,url
```

Для кожної локальної гілки визнач:

- **merged** — `git merge-base --is-ancestor <branch> origin/<base>`
  успішний;
- **patch-equivalent** — не ancestor, але `git patch-id` diff-а гілки
  проти її merge-base збігається з patch-id якогось коміту вже в
  `origin/<base>` (типово squash-merge);
- **protected** — є `worktree`, що на ній стоїть (включно з detached
  HEAD за тим самим OID), АБО є `open PR` з `headRefName` цієї гілки;
- **synced/behind-only/ahead/diverged** — порівняй local tip і
  upstream/`origin/<base>` tip через `--is-ancestor` в обидва боки;
- інакше — **candidate** (потребує твого semantic triage, крок 2).

Для кожного stash — set of змінених paths (`git stash show --name-only`)
і чи вони повністю "absorbed" (усі paths і вміст уже ідентичні
`origin/<base>` — тоді merged-еквівалент для stash).

## Крок 2 — semantic triage (це твоя LLM-робота, без вкладеного виклику)

Для кожного `candidate` (не merged/patch-equivalent/protected) вирішуєш
сам, читаючи diff і контекст:

- **complete-useful** → готуй PR (крок 3);
- **incomplete/uncertain** → `kept` (не чіпай, залиш у звіті з причиною);
- **obsolete** (та сама поведінка вже є в `origin/<base>` іншим шляхом,
  або вочевидь непотрібна) → `drop-recommended` → archive+cleanup (крок 5)
  з `--reason` "obsolete: <чому>".

Факт конфлікту НЕ downgrade-ить `complete-useful` до `kept` сам собою —
конфлікт розв'язується в кроці 3, а рішення про корисність зміни вже
ухвалене тут.

## Крок 3 — підготовка й перенесення (worktree, cherry-pick/apply, конфлікти)

Для кожного `complete-useful` джерела:

```bash
git worktree add ../.worktrees/reconcile-<slug> origin/<base>
cd ../.worktrees/reconcile-<slug>
git cherry-pick <commit-range>   # або: git stash apply <stash-ref> для stash-джерел
```

При конфлікті — розв'яжи за поведінкою (не механічним ours/theirs),
запусти вузький тест на зачеплений код, `git add`, `git cherry-pick
--continue`. Порожній cherry-pick (increasingly likely, якщо зміна вже в
base іншим шляхом) — `git cherry-pick --skip`, і джерело стає
`obsolete` (назад до кроку 2 з відповідним `--reason`).

## Крок 4 — gates і PR

У підготовленому worktree, лише для директорій зі змінами цього перенесення:

```bash
n-rules lint --no-fix --path <dir>          # для кожної зміненої директорії
# doc-files: перевір/онови docs/<stem>.md зі свіжим CRC (skill n-doc-files)
<repo test script>                          # порівняй з baseline чистого origin/<base>
```

Red baseline приймається лише якщо ті самі тести червоні і на чистому
`origin/<base>` (порівняй, не вгадуй). Якщо gate не проходить —
джерело лишається `kept` з точною причиною, не push-иш нічого.

Після зелених gate:

```bash
git push origin HEAD:<новий-feature-branch>
gh pr create --title "<...>" --body "<Навіщо / Бізнес-результат / Архітектура / Поведінка / Ризики та сумісність>"
```

PR body пиши сам за bounded фактами фінального diff — секції "Навіщо",
"Бізнес-результат", "Архітектура", "Поведінка", "Ризики та сумісність" —
той самий формат, що вимагали інваріанти старого оркестратора, тепер без
проміжного LLM-виклику з JSON-схемою.

Після `gh pr create` дай GitHub кілька секунд і звір `gh pr checks
<url>` із тим самим набором на `origin/<base>` (`gh api
repos/:owner/:repo/commits/<base-sha>/check-runs` або `gh run list
--branch <base>`): regression — лише якщо check із тим самим іменем був
green на base. Відсутній/pending base check → `unverified`, не вигаданий
regression.

## Крок 5 — archive + cleanup (native, з persistent-станом)

Лише ПІСЛЯ підтвердженого outcome (`merged`/`patch-equivalent`/
`pr-created` з зеленими checks, або `drop-recommended` з кроку 2) і лише
для джерел БЕЗ open PR і БЕЗ живого worktree (протестуй `gh pr list
--head` заново прямо перед цим кроком — стан міг змінитись):

```bash
n-rules git-reconcile archive --kind branch --ref <branch> --reason "merged into origin/main"
n-rules git-reconcile cleanup --kind branch --ref <branch>

# worktree:
n-rules git-reconcile archive --kind worktree --ref <branch> --worktree-path <path> --reason "..."
n-rules git-reconcile cleanup --kind worktree --ref <branch> --worktree-path <path>

# stash (ref — повний sha stash-коміту, НЕ stash@{N} — індекс зсувається):
n-rules git-reconcile archive --kind stash --ref <sha> --reason "..."
n-rules git-reconcile cleanup --kind stash --ref <sha>
```

`cleanup` сама відмовляє, якщо `archive` для цього `ref` не підтверджений
на `origin` (fail-closed) — не намагайся обійти порядок.

## Крок 6 — GC (за потреби, не щоразу)

```bash
n-rules git-reconcile gc                 # dry-run: список кандидатів
n-rules git-reconcile gc --apply         # реальне видалення прострочених (>45 днів)
```

Роби `gc --apply` рідко (наприклад, раз на прогін цього скіла, не на
кожен archive) — прострочені архіви й так чекають 45 днів, спішити
нема куди, а зайвий виклик — зайвий мережевий round-trip.

## Крок 7 — фінальний звіт

Для кожного джерела назви один verdict: `merged`, `patch-equivalent`,
`open-pr`, `protected`, `pr-created`, `kept`, `drop-recommended`,
`pr-checks-regressed`, `pr-checks-baseline-red`, `pr-checks-unverified`,
`failed`. Для збережених (`kept`/незавершений transfer) — точна причина й
наступна дія. Для archived+cleaned — посилання на `origin/tempo/
git-reconcile/...` (`n-rules git-reconcile status` дає це машинно, якщо
потрібен структурований звіт).
