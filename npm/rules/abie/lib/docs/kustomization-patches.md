---
type: JS Module
title: kustomization-patches.mjs
resource: npm/rules/abie/lib/kustomization-patches.mjs
docgen:
  crc: cc6c6707
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей модуль відповідає за парсинг inline JSON6902-патчів у конфігурації `abie ua-kustomization`. Він спеціалізується на витягуванні даних із патчів `nodeSelector` для об'єктів `Deployment` (з умовою `preem: false`), а також на обробці патчів `HTTPRoute` для визначення хостнеймів, імен просторів імен `parentRefs` та `backendRefs`. (abie.mdc)

Модуль забезпечує відмовостійкість, перехоплюючи потенційні помилки, що виникають під час парсингу, і не викликаючи винятків назовні. За певних умов помилок повертає `null` замість генерації винятку.

## Поведінка

Поведінка:
kustomizationHasAbieDeploymentNodeSelectorPatch визначає, чи містить документ Kustomization відповідний inline patch на `Deployment` для режиму `ua`.
getCombinedNginxRunPatchTextFromKustomization збирає всі inline JSON6902-фрагменти для `HTTPRoute` з усіх документів Kustomization у вигляді одного тексту.
validateAbieNginxRunHttpRoutePatches перевіряє сукупний текст patch HTTPRoute на відповідність вимогам abie.mdc, зокрема щодо доменів, `parentRefs` namespace та кількості `backendRefs` для спільних сервісів, при цьому не перевіряє жодних внутрішніх прихованих змінних.

## Публічний API

kustomizationHasAbieDeploymentNodeSelectorPatch — Встановлює, чи містить файл `kustomization.yaml` коректний внутрішній патч для узгодження селектора нод у Deployment (українська версія).
getCombinedNginxRunPatchTextFromKustomization — Збирає до одного тексту всі фрагменти JSON6902 HTTPRoute, які не є порожніми та містяться в `kustomization.yaml`.
validateAbieNginxRunHttpRoutePatches — Порівнює зібраний текст патчів HTTPRoute з вимогами, зазначеними у файлі `abie.mdc`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
