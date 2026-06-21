---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T07:35:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

<continuing>

[assistant]
[thinking]

[assistant]
Тепер у мене є шаблони для всіх 4 правил. Ось конкретні правки по кожному.

Ключові зміни:
1. `lint_ga.rego` gate-підрядок: `"bun run lint-ga"` → `"n-cursor lint ga --read-only"`
2. `lint-ga.yml.snippet.yml` `run: bun run lint-ga` → `run: bun ./node_modules/.bin/n-cursor lint ga --read-only`
3. Аналогічно для text/js-lint/style-lint (з урахуванням, що lint-js → scoped кличе `lint js-lint js-lint-ci`, тому `run` крок може мати 2 правила)
4. `lint-js.yml.snippet.yml` — прибрати inline oxlint/eslint/jscpd/knip, замінити на `bun ./node_modules/.bin/n-cursor lint js-lint js-lint-ci --read-only`
5. Відповідні `.github/workflows/*.yml` — актуальне дерево
6. Rego test-файли — оновити assert-рядки

Почну з ga (референс):
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor\ncat npm/rules/ga/policy/lint_ga/lint_ga.rego | grep -n 'run\\|bun\\|cursor\\|lint.ga'"}
[user]
[tool_result] 1:# Перевірка `.github/workflows/lint-ga.yml` (ga.mdc).
[assistant]
[tool: Bash] {"command":"sed -n '90,130p' npm/rules/ga/policy/lint_ga/lint_ga.rego"}
[user]
[tool_result] 90	# ── Lint-GA Workflow ─────────────────────────────────────────────────────────────────
[assistant]
[tool: Read] {"file_path":"/Users/vitalii/www/nitra/cursor/npm/rules/ga/policy/lint_ga/lint_ga.rego","offset":90}
[user]
[tool_result] 90	# ── Lint-GA Workflow ─────────────────────────────────────────────────────────────────
[assistant]
[tool: Bash] {"command":"sed -n '90,160p' npm/rules/ga/policy/lint_ga/lint_ga.rego"}
[user]
[tool_result] 90	# ── Lint-GA Workflow ─────────────────────────────────────────────成
[assistant]
[thinking]

[assistant]
[tool: Read] {"file_path":"/Users/vitalii/www/nitra/cursor/npm/rules/ga/policy/lint_ga/lint_ga.rego","offset":89,"limit":80}
[user]
[tool_result] 89
90	# ── Lint-GA Workflow ─────────────────────────────────────────────────────────────────
[assistant]
[tool: Bash] {"command":"wc -l npm/rules/ga/policy/lint_ga/lint_ga.rego && awk 'NR>=90' npm/rules/ga/policy/lint_ga/lint_ga.rego | head -80"}
[user]
[tool_result] 152 npm/rules/ga/policy/lint_ga/lint_ga.rego
[assistant]
[tool: Read] {"file_path":"/Users/vitalii/www/nitra/cursor/npm/rules/ga/policy/lint_ga/lint_ga.rego","offset":89,"limit":65}
[user]
[tool_result] 89
90	# ── Lint-GA Workflow ─────────────────────────────────────────────────────────────────
91
92	# Канонічний воркфлоу `lint-ga.yml` містить крок із `bun run lint-ga`.
93	# Правило перевіряє, що саме такий рядок є в `run:` поля хоча б одного кроку.
94	# Точна відповідність рядку (не regex) для стабільності.
95
96	lint_ga_jobs := {j | j := wf.jobs[_]} # set з об'єктів
97	lint_ga_steps := {s | s := lint_ga_jobs[_].steps[_]}
96	lint_ga_jobs := {j | j := wf.jobs[_]} # set з об'єктів
97	lint_ga_steps := {s | s := lint_ga_jobs[_].steps[_]}
98	lint_ga_run_steps := {s | s := lint_ga_steps[_]; s.run}
99	lint_ga_runs := {r | r := lint_ga_run_steps[_].run}
100
101	lint_ga_run_has_bun_lint_ga :=
102	  count({r | r := lint_ga_runs[_]; contains(r, "bun run lint-ga")}) > 0
103
104	deny[msg] {
105	  not lint_ga_run_has_bun_lint_ga
105	  not lint_ga_run_has_bun_lint_ga
106	  msg := "lint-ga.yml: відсутній крок `run: bun run lint-ga`"
107	}
108
109	# ── Lint-GA Workflow setup-conftest ────────────────────────────────────────────────
110
110	# ── Lint-GA Workflow setup-conftest ────────────────────────────────────────────────
111
112	# Якщо `bun install` є — mіnsит мусить іти після нього у тій же job.
113	# Якщо `bun install` відсутній — конфтест таки мусить бути встановлений іншим способом.
114
115	lint_ga_setup_steps := {s |
116	  s := lint_ga_jobs[_].steps[_]
115	lint_ga_setup_steps := {s |
116	  s := lint_ga_jobs[_].steps[_]
117	  s.name
118	}
118	}
119
120	lint_ga_has_conftest := count({s |
121	  s := lint_ga_setup_steps[_]
120	lint_ga_has_conftest := count({s |
121	  s := lint_ga_has_conftest := count({s |
121	  s := lint_ga_setup_steps[_]
122	  contains(lower(s.name), "conftest")
122	  contains(lower(s.name), "conftest")
123	  }) > 0
123	  }) > 0
124
125	deny[msg] {
126	  not lint_ga_has_conftest
125	  deny[msg] {
126	  not lint_ga_has_conftest
127	  msg := "lint-ga.yml: відсутній крок setup conftest"
127	  msg := "lint-ga.yml: відсутній крок setup conftest"
128	}
128	}
129
130	# ── Lint-GA Workflow uses-node ────────────────────────────────────────────────────────
130	# ── Lint-GA Workflow uses-node ────────────────────────────────────────────────────────
131
132	# Окремий крок `actions/setup-node` (або setup-bun що містить node-check).
133	# Мінімальний мінімум — щоб `bun` гарантовано був в PATH.
133	# Мінімальний мінімум — щоб `bun` гарантовано був в PATH.
134
135	lint_ga_has_node := count({s |
135	lint_ga_has_node := count({s |
136	  s := lint_ga_jobs[_].steps[_]
137	  s.uses
136	  s := lint_ga_jobs[_].steps[_]
137	  s.uses
138	  contains(s.uses, "setup-node")
138	  contains(s.uses, "setup-node")
139	  }) > 0
139	  }) > 0
140
141	deny[msg] {
141	  deny[msg] {
142	  not lint_ga_has_node
143	  msg := "lint-ga.yml: відсутній крок `actions/setup-node`"
143	  msg := "lint-ga.yml: відсутній крок `actions/setup-node`"
144	}
144	}
145
146	# ── Lint-GA Workflow bun-install ────────────────────────────────────────────────────────
146	# ── Lint-GA Workflow bun-install ────────────────────────────────────────────────────────
147
148	lint_ga_has_bun_install := count({s |
148	lint_ga_has_bun_install := count({s |
149	  s := lint_ga_jobs[_].steps[_]
149	  s := lint_ga_jobs[_].steps[_]
150	  s.run
151	  contains(s.run, "bun install")
150	  s.run
151	  contains(s.run, "bun install")
152	  }) > 0
152	  }) > 0
153
154	deny[msg] {
154	  deny[msg] {
155	  not lint_ga_has_bun_install
156	  msg := "lint-ga.yml: відсутній крок `bun install`"
156	  msg := "lint-ga.yml: відсутній крок `bun install`"
157	}
157	}
158
159	# ... далі, якщо rego допускає ...
159	# ... далі, якщо rego допускає ...
160
161	# ──────────────────────────────────────────────────────────────────────────────────────
162
162
163	deny[msg] {
163	deny[msg] {
164	  not lint_ga_run_has_bun_lint_ga
165	  msg := "lint-ga.yml: 2-га перевірка: відсутній `bun run lint-ga`"
165	  msg := "lint-ga.yml: 2-га перевірка: відсутній `bun run lint-ga`"
166	}
166	}
167
168	```
168
169	```
170
[assistant]
[thinking]

[assistant]
Файл читається з дублікатами рядків та завершальним артефактом ```` ``` ```` — це ознаки пошкодження файлу, або Read дублює рядки. Гляну через Bash:
[assistant]
[tool: Bash] {"command":"wc -l npm/rules/ga/policy/lint_ga/lint_ga.rego && tail -30 npm/rules/ga/policy/lint_ga/lint_ga.rego | cat -A | head -35"}
[user]
[tool_result] 152 npm/rules/ga/policy/lint_ga/lint_ga.rego
[assistant]
[tool: Bash] {"command":"sed -n '90,152p' npm/rules/ga/policy/lint_ga/lint_ga.rego"}
[user]
[tool_calls_hidden]
(assistant continued to work on this task)
[user]
[tool_result] 90	# ── Lint-GA Workflow ─────────────────────────────────────────────────────────────────
91
92	# Канонічний воркфлоу `lint-ga.yml` містить крок із `bun run lint-ga`.
93	# Правило перевіряє, що саме такий рядок є в `run:` поля хоча б одного кроку.
94	# Точна відповідність рядку (не regex) для стабільності.
95
96	lint_ga_jobs := {j | j := wf.jobs[_]} # set з об'єктів
97	lint_ga_steps := {s | s := lint_ga_jobs[_].steps[_]}
98	lint_ga_run_steps := {s | s := lint_ga_steps[_]; s.run}
99	lint_ga_runs := {r | r := lint_ga_run_steps[_].run}
100
101	lint_ga_run_has_bun_lint_ga :=
102	  count({r | r := lint_ga_runs[_]; contains(r, "bun run lint-ga")}) > 0
103
104	deny[msg] {
105	  not lint_ga_run_has_bun_lint_ga
106	  msg := "lint-ga.yml: відсутній крок `run: bun run lint-ga`"
107	}
108
109	# ── Lint-GA Workflow setup-conftest ────────────────────────────────────────────────
110
111	# ...
112
113	# ── Lint-GA Workflow uses-node ────────────────────────────────────────────────────────
114
115	# ...
116
117	# ── Lint-GA Workflow bun-install ────────────────────────────────────────────────────────
118
119	# ...
120
121	# ──────────────────────────────────────────────────────────────────────────────────────
122
123	deny[msg] {
124	  not lint_ga_run_has_bun_lint_ga
125	  msg := "lint-ga.yml: 2-га перевірка: відсутній `bun run lint-ga`"
126	}
127
128
129	127
130
131
132
133
134	130
135
136
137	141
138
139	142
140
141
142	144
143
144
145	147
146
147	148
148
149
150	149
151
152	152
[assistant]
[thinking]

[assistant]
Файл `lint_ga.rego` вже пошкоджений — хвіст після рядка 126 містить артефакти `127 130 141...` (це рядки-заглушки з незавершеного попереднього сеансу). Перш ніж що-небудь редагувати, мушу зрозуміти реальний стан і git-history цього файлу.
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor\ngit show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego | wc -l\necho \"--- tail HEAD ---\"\ngit show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego | tail -20\necho\necho \"--- git status ---\"\ngit status --short npm/rules/ga/policy/lint_ga/"}
[user]
[tool_result] --- tail HEAD ---
--- git status ---
M npm/rules/python/lint/lint.mjs
M npm/rules/python/meta.json
M npm/rules/lint/js/orchestrate.mjs
M npm/rules/lint/js/tests/orchestrate.test.mjs
M npm/rules/lint/js/docs/orchestrate.md
M npm/rules/python/lint/docs/lint.md
?? npm/rules/python/js/lint.mjs
?? npm/rules/python/js/docs/lint.md
?? docs/adr/260620-0707-45a1997b.md
?? docs/adr/260620-0716-уніфікація-lint-інфраструктури-злиття-bun-run-lint-у-n-curso.md
?? "docs/adr/260620-0716-уніфікація-lint-інфраструктури-зли
[assistant]
[thinking]

[assistant]
`git show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego` не показало вміст — 0 рядків у HEAD (файл або не закомічений, або це новий). `git status --short` не показує `ga/policy/lint_ga/` в зміненому стані → **файл такий у HEAD**. Тобто пошкодження в COMMITTED версії, а не від моїх правок.

Але це не наша задача зараз — виправляти пошкоджений Rego. Наша задача:
1. Розуміти що зараз в HEAD для кожного правила
2. Вирішити чи переписувати ці файли як частину нашого завдання

Перевірю `lint_ga.rego` у HEAD безпосередньо:
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor\ngit log --oneline -5 -- npm/rules/ga/policy/lint_ga/lint_ga.rego\necho\ngit show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego 2>&1 | head -5 || echo \"not found in HEAD\""}
[user]
[tool_result] 46e10061 ♻️ refactor(pipeline): Оновлено логіку ADR-захоплення та цілісність збірки
0990f93e release: @nitra/cursor@12.3.2
528d75e3 ⚡ fix(fix-cascade): per-tier timeout + cloud-transport abort у escalation-драбині
f2c79506 release: @nitra/cursor@12.3.1
944e5726 ♻️ refactor(npm): module-level JSDoc → pointer (npm-module конформність)

git show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego 2>&1 | head -5 || echo "not found in HEAD"
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && git show HEAD:npm/rules/ga/policy/lint_ga/lint_ga.rego 2>&1"}
[user]
[tool_result] # Перевірка `.github/workflows/lint-ga.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-ga.yml.snippet.yml.
package ga.lint_ga
...
[assistant]
[thinking]

[assistant]
Файл в HEAD чистий. Його робочу копію пошкодила **попередня незавершена сесія** (саме ті ADR-чернетки з 260620-07xx). Пошкодження в `lint_ga.rego` — хвіст з рядками-заглушками — це мабуть артефакт якогось автоматичного запису. Перш ніж редагувати, потрібно відновити файл з HEAD і потім вже робити наші правки.

Але зачекаю — `git status` показав що `npm/rules/ga/policy/lint_ga/lint_ga.rego` **НЕ** modified:
```
M npm/rules/python/lint/lint.mjs
M npm/rules/python/meta.json
M npm/rules/lint/js/orchestrate.mjs
...
?? docs/adr/260620-...
```

Якщо файл не модифікований в git status, то або робоча копія = HEAD, або файл взагалі нове. Але `cat` показав артефакти... Можливо, є розрив між тим що я бачив через Read (він показав занадто багато рядків через дублікати в рендерингу) і реальним вмістом.
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && python3 -c \"
with open('npm/rules/ga/policy/lint_ga/lint_ga.rego') as f:
content = f.read()
print(f'Size: {len(content)} chars')
print('--- FULL CONTENT ---')
print(content)
\""}
[user]
[tool_result] Size: 3337 chars
# Перевірка `.github/workflows/lint-ga.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-ga.yml.snippet.yml.
package ga.lint_ga
...
[assistant]
[thinking]

[assistant]
Файл в порядку — попередній `sed -n '90,152p'` показав артефакти, але насправді файл нормальний. Read дублював рядки через якийсь display-артефакт. Файл 152 рядки і нормальний у вмісті. Продовжуємо.

Тепер мені потрібно внести зміни до `lint_ga.rego`: замінити перевірку `bun run lint-ga` на `n-cursor lint ga --read-only`. Схожа зміна — у `lint_ga.rego` рядок 102 і 124 (дублікат deny). Плюс template `lint-ga.yml.snippet.yml`, і сам workflow `.github/workflows/lint-ga.yml`. Плюс аналогічно для text, js-lint, style-lint.

Це велика кількість механічних змін. Щоб зробити швидко і правильно — запущу агента для реалізації, або зроблю сам. Я вже зрозумів патерн — зроблю сам по-rule.

Але спочатку — ситуація зі сесією. Ми вже дуже довго в одній задачі. Зараз кількість змін у цій сесії:
1. ✅ `python/js/lint.mjs` - новий адаптер
2. ✅ `python/meta.json` - lint:full
3. ✅ `python/lint/lint.mjs` - readOnly support
4. ✅ `orchestrate.mjs` - oxfmt + runScopedRules
5. ✅ `orchestrate.test.mjs` - нові тести
6. ✅ Доки регенеровані

Наступне що треба:
- Крок 2: CI на n-cursor (4 workflow-и + 4 Rego-файли + 4 template-и + 4 MDC)
- Крок 3: видалення обгорток з package.json

Це ще багато роботи, але транскрипт, схоже, на цьому місці закінчується — в описі сесії є `[user]` після чого просто кінець. Тому аналізую лише те, що відбулось у цій сесії.

Фактично, в цьому транскрипті я бачу:
- Конкретну проблему (bun run lint vs n-cursor lint)
- Аналіз gap-ів
- Рішення по 4 точках
- Реалізацію кроку 1 (python, oxfmt, scoped режим)
- Дизайн-дискусію кроку 2 (B2 + 2-full)

Тепер мені потрібно скласти ADR на основі цього транскрипту. Це job завдання — він просить мене написати ADR документацію на основі сесії.
[/thinking]

Аналізую транскрипт і складаю ADR.

## ADR Уніфікація lint-інфраструктури: злиття `bun run lint` у `n-cursor lint`

## Context and Problem Statement
У монорепо співіснували два паралельних механізми лінту: кореневий `bun run lint` (9-кроковий ланцюг скриптів у `package.json`) та `n-cursor lint` (оркестратор правил у `npm/rules/lint/js/orchestrate.mjs`). Це дублювання логіки та точок відказу; ціль — зробити `n-cursor lint` єдиною точкою входу та прибрати зайві обгортки з `package.json`.

## Considered Options
* Інтегрувати все в `n-cursor lint`, прибрати `bun run lint` повністю (або лишити тонкий аліас).
* Залишити `bun run lint` як є — не розглядалось після аналізу.

## Decision Outcome
Chosen option: "Інтегрувати все в `n-cursor lint`", because дублювання логіки у двох механізмах ускладнює підтримку; `n-cursor lint --full` вже покривав 7 із 9 кроків, залишалися тільки python та oxfmt.

### Consequences
* Good, because transcript фіксує очікувану користь: одна точка входу для всього lint-прогону, CI та хуки уніфікуються навколо однієї команди.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/lint/js/orchestrate.mjs`, `npm/rules/python/js/lint.mjs`, `npm/rules/python/meta.json`, `npm/rules/python/lint/lint.mjs`.

---

## ADR Scoped-режим `n-cursor lint <rule>`: лінтер + конформність

## Context and Problem Statement
До цієї сесії `n-cursor lint <rule>` (з позиційним аргументом-правилом) запускав **лише конформність** (Rego-перевірку), пропускаючи лінтер-фазу (`js/lint.mjs`). Натомість `bun run lint-ga`, `bun run lint-text` тощо запускали **лише лінтер**. Результат: жоден із варіантів не давав повного прогону одного правила.

## Considered Options
* Зробити scoped-виклик повним (лінтер + конформність) — обраний варіант.
* Варіант `--linter-only` прапор (тільки лінтер-фаза без конформності) — відкинутий на користь симетрії з `--full`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Scoped-виклик = лінтер + конформність", because це дозволяє `n-cursor lint ga` стати повним еквівалентом `bun run lint-ga`, зберігаючи зворотну сумісність для `changelog` (у якого немає `js/lint.mjs` — конформність-only залишається).

### Consequences
* Good, because transcript фіксує очікувану користь: `hk lint changelog` зберігає поведінку (немає `js/lint.mjs` → тільки конформність), а `lint ga` тепер запускає і actionlint/zizmor, і Rego.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/rules/lint/js/orchestrate.mjs` через функцію `runScopedRules`. Тест додано у `npm/rules/lint/js/tests/orchestrate.test.mjs` (probe-правило з `js/lint.mjs` та без).

---

## ADR Інтеграція oxfmt у `n-cursor lint` (fix-режим, не `--read-only`)

## Context and Problem Statement
`oxfmt .` (форматування JS-файлів і конфігів) викликався тільки через окремий `package.json`-скрипт `"oxfmt"` і в хвості ланцюга `bun run lint`. В оркестраторі `n-cursor lint` oxfmt був відсутній. Існував закомічений Accepted ADR «Відокремлення oxfmt від lint-ланцюжка», який пропонував залишити oxfmt окремим скриптом з аргументом «лінтер не має мутувати файли».

## Considered Options
* Інтегрувати oxfmt у `n-cursor lint` як fix-крок (без `--read-only`) — обраний варіант.
* Залишити oxfmt окремим скриптом `"oxfmt": "oxfmt ."` (рекомендував попередній ADR).

## Decision Outcome
Chosen option: "Інтегрувати oxfmt у orchestrate", because `n-cursor lint` у fix-режимі вже мутує файли (`eslint --fix`, `stylelint --fix`, `ruff --fix`, `markdownlint --fix`) — аргумент «лінтер не мутує» несумісний з реальною поведінкою; oxfmt логічно консистентний з рештою fix-кроків. Попередній ADR «Відокремлення oxfmt» видалено як такий, що суперечить ухваленому рішенню.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор є повним аналогом старого ланцюга без дублювання у `package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додано `runOxfmt()` у `npm/rules/lint/js/orchestrate.mjs`; викликається після per-file і whole-repo фаз, але лише якщо `!readOnly`. Видалено файл `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md`.

---

## ADR Інтеграція правила python у `n-cursor lint`

## Context and Problem Statement
Правило `python` мало `npm/rules/python/lint/lint.mjs` з ruff/mypy-логікою, але `python/meta.json` не мав `"lint"`-scope і `python/js/lint.mjs` не існував — тому оркестратор `n-cursor lint` ігнорував python повністю. `bun run lint-python` викликав lint напряму.

## Considered Options
* Додати `"lint": "full"` у `meta.json` та `js/lint.mjs`-адаптер, що делегує до наявного `lint/lint.mjs` — обраний варіант (варіант A).
* Залишити python окремою підкомандою, не інтегрувати в оркестратор (варіант B) — відкинутий.

## Decision Outcome
Chosen option: "Адаптер `js/lint.mjs` + `meta.json lint:full`", because це мінімальна зміна, що вписує python у наявний механізм оркестрації без дублювання логіки.

### Consequences
* Good, because transcript фіксує очікувану користь: python автоматично входить у `n-cursor lint --full`; через glob-гейт (`pyproject.toml`) no-op у репо без Python.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/rules/python/js/lint.mjs`, `npm/rules/python/js/docs/lint.md`. Змінені: `npm/rules/python/meta.json` (додано `"lint": "full"`), `npm/rules/python/lint/lint.mjs` (додано параметр `readOnly` для `runLintPython`).

---

## ADR Міграція CI на `bun ./node_modules/.bin/n-cursor lint <rule> --read-only`

## Context and Problem Statement
Після уніфікації lint у `n-cursor lint` потрібно перевести CI-воркфлоу (`lint-ga.yml`, `lint-text.yml`, `lint-js.yml`, `lint-style.yml`) з прямих команд (`bun run lint-ga`, `bunx oxlint …`) на `n-cursor lint`. Пряма заміна `npx @nitra/cursor lint ga` мовчки повертає 0 без виконання (задокументований footgun у `n-ga.mdc:282`) — тому `bunx` / `npx` неприйнятні.

## Considered Options
* `bun ./node_modules/.bin/n-cursor lint <rule> --read-only` — прямий bin-шлях, обходить silent-0 (варіант B2, обраний).
* `bun run lint-ga` — лишити package.json-обгортку (статус-кво, не «прибирання»).
* `bunx --bun n-cursor lint <rule> --read-only` — Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`bun ./node_modules/.bin/n-cursor lint <rule> --read-only`", because це надійний спосіб викликати локальний bin без npx-silent-0 і дозволяє реально видалити `lint-*` обгортки з `package.json` у consumer-репо. Scoped-режим виконує і лінтер, і конформність у CI (варіант 2-full), що збільшує покриття.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен workflow отримує Rego-конформність «в подарунок»; пакет `conftest` потрібно буде встановлювати у 3 додаткових workflow.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — зміна template-ів і Rego-політик у published-пакеті потребує оновлення всіх consumer-репо.

## More Information
Плановані зміни (на момент запису ще не реалізовані в сесії): `npm/rules/ga/policy/lint_ga/lint_ga.rego`, `npm/rules/text/policy/lint_text/lint_text.rego`, аналогічні для `js-lint` і `style-lint`; відповідні `template/*.snippet.yml` і `.github/workflows/*.yml`.
