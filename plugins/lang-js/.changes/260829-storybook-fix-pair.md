---
bump: minor
section: Changed
---

T0-фікси `test/storybook-ci` і `test/storybook-scaffold` виконує wasm-гість. Детект обох переїхав раніше; тепер у гості й fix-половина, тож увесь цикл концерну йде без Node-канону.

`storybook-ci` відтворює composite action `setup-playwright-chromium` і `.github/workflows/lint-storybook.yml`, будуючи матрицю `strategy.matrix.package` з фактичного списку Storybook-пакетів репозиторію (без пакетів у скоупі workflow не пишеться — порожня матриця дала б невалідний YAML). `storybook-scaffold` відтворює канонічні `.storybook/main.js`, `preview.js`, `mocks/gql-sse.js`, `empty-vite.config.js`, `vitest.setup.js` (для library- і app-пакетів окремо) і дописує `package.json#scripts.storybook`. Супутні файли, які консюмер уже має, не затираються.

Полагоджений дефект канону: JS-фікс читав `package.json` через `JSON.parse` у `try`/`catch`, тож файл із `//`-коментарем чи trailing-комою мовчки пропускався — концерн лишався червоним назавжди, без жодного сліду у виводі. Гість читає той самий вхід JSONC-парсером і таки виправляє. Заразом `scripts.storybook` тепер дописується зі збереженням порядку решти ключів файлу.

`test/storybook-vitest-config` СВІДОМО лишається на JS-каноні: його фікс не генерує файл із шаблону, а хірургічно редагує чужий `vitest.config.*` (AST-splice-и з підбором відступу, повторний parse і відкат при невалідному результаті). Часткова заглушка в гості тут заборонена — непорожній план гостя вимикає JS-канон концерну цілком, тож краще не оголошувати fix узагалі.

Деталі — §2.87 `docs/plans/2026-08-05-open-questions-register.md`.
