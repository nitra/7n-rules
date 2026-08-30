---
bump: patch
section: Fixed
---

`KNOWN_PLUGIN_RANGES` наздогнав версії плагінів воркспейсу: `lang-js` `^0.27`→`^0.34`, `lang-python` `^0.14`→`^0.15`, `lang-rust` `^0.17`→`^0.18`, `lang-php` `^0.4`→`^0.5`.

Наслідок дрейфу ширший за червоний гейт `known-plugin-ranges`: `ensurePluginInstalled` обмежує установку first-party плагіна саме цим range, тобто ставив би версію, старішу за ту, що вже лежить у воркспейсі.

Гейт лишається крихким за конструкцією — для `0.x` кожен minor-бамп плагіна ламає його знову, бо range треба піднімати вручну тим самим коммітом. Автоматизація не додається свідомо: `KNOWN_PLUGIN_RANGES` зникає разом із переходом на резолв за lock + OCI reference (робота Д1, `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`).
