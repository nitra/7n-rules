---
bump: minor
section: Removed
---

Знято сімнадцять JS-канонів T0-фікса — усі `rules/*/*/fix-<concern>.mjs`, чий фікс уже живе у wasm-гості `crates/plugin-ci-github`: `abie/clean_merged_ignore_branches`, `docker/lint_docker_yml`, `ga/clean_ga_workflows`, `ga/clean_merged_branch`, `ga/git_ai`, `ga/lint_ga`, `ga/lint_repo_yml`, `ga/vscode_extensions`, `ga/vscode_settings`, `ga/workflows`, `ga/zizmor_yml`, `k8s/lint_k8s_yml`, `npm-module/npm_publish_yml`, `rust/toolchain_cache`, `security/lint_security_yml`, `style/lint_style_yml`, `text/lint_text`. Разом із ними — їхні теки `docs/` і чотирнадцять характеризаційних тест-файлів. Гість відтоді ЄДИНА реалізація фіксу цих концернів, а не пріоритетна з JS-fallback-ом.

Спостережувана поведінка `--fix` не змінилась: гість і доти мав пріоритет (`T0Pattern.guestFix`). Джерела концернів — `.rego`, `concern.json`, `template/**`, `.mdc` — НЕ чіпані: їх гість вшиває `include_str!`-ом, і detect-парність лишається живою.

Практичний наслідок, який варто знати: fallback-у більше немає. Якщо wasm-компонент `ci-github` у консюмері не резолвиться (плагін не зібрано, розбіжність піна, хост без wasm), концерн деградує з «автофікс» у «порушення показано, концерн пішов у LLM-ладдер» — раніше цей випадок гасив JS-канон.

`ga/service_deploy_workflow` і `ci_artifact/consume` СВІДОМО лишились на JS (§2.81: їхні фікси потребують графа ввімкнених правил, каналу до якого гість не має).

Деталі й зразок — §2.90 / §2.88 `docs/plans/2026-08-05-open-questions-register.md`.
