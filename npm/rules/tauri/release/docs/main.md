---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/release/main.mjs
docgen:
  crc: fc5e2737
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл запускає `lint` для перевірки Tauri-застосунків у workspace, знаходить їхні каталоги через `findTauriAppDirs` і окремо звіряє наявність workflow dispatch через `hasWorkflowDispatch`. Для релізного контуру використовує `CHANGELOG_RELEASE_WORKFLOW` і `RELEASE_WORKFLOW`, щоб тримати в полі зору canonical workflow для changelog і release. Свідомо пропускає `.github` і `.git`, звертається до мережі, працює з кешуванням у межах прогону та поводиться fail-safe: помилки перехоплює і не викидає назовні.

## Поведінка

`lint` запускає повну перевірку Tauri-налаштувань у межах одного прогону: спершу `findTauriAppDirs` знаходить усі workspace з Tauri-застосунками за `tauri.conf.json`, після чого результати передаються в правила для конфігів і GitHub Actions. Для workflow-частини `CHANGELOG_RELEASE_WORKFLOW` і `RELEASE_WORKFLOW` задають канонічні шляхи `.github/workflows/changelog-release.yml` і `.github/workflows/release.yml`, а `hasWorkflowDispatch` використовується як спільна перевірка на наявність `workflow_dispatch` у корені workflow. Дані читаються з `tauri.conf.json` і `latest.json`, а також з workflow-файлів; результати йдуть у fail-safe reporting, без винесення винятків назовні. У межах прогону діє кешування, тому повторні звернення до вже прочитаних артефактів не дублюють роботу. Перевірки свідомо оминають `.github` і `.git`, щоб не змішувати службові каталоги з робочими шляхами застосунків. Для релізного циклу потік також враховує віддалений доступ через URL на кшталт `https://x-access-token:\`, щоб узгодити автоматизацію оновлень і публікації без ручного втручання.

## Публічний API

- CHANGELOG_RELEASE_WORKFLOW — Шлях workflow, що на push у main бампає версію з change-файлів і створює тег.
- RELEASE_WORKFLOW — Шлях workflow, що на тег збирає й публікує реліз Tauri-застосунку.
- findTauriAppDirs — Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/tauri.conf.json` чи legacy `<ws>/tauri.conf.json`).
- hasWorkflowDispatch — Чи `on.workflow_dispatch` присутній у корені workflow.
- lint — запускає перевірки для шляху з репозиторію; якщо шлях вказує на змінений файл, пропускає лише релевантні правила і не чіпає інше.
- CHANGELOG_RELEASE_WORKFLOW=".github/workflows/changelog-release.yml" — константа для workflow, що готує changelog-реліз.
- RELEASE_WORKFLOW=".github/workflows/release.yml" — константа для workflow, що запускає релізний процес.
- https://x-access-token:\ — базовий шаблон URL для доступу до GitHub через token-автентифікацію під час мережевих операцій.
- tauri.conf.json — джерело налаштувань Tauri, з яких код бере параметри застосунку.
- latest.json — файл з даними про останній доступний реліз, які використовуються для оновлень.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.github`, `.git`.
