# Bench A/B Фази A: anchored-edits і verify-loop (результати)

**Дата:** 2026-07-11
**Статус:** виміряно — рішення застосовано (дефолт `N_LLM_FIX_ANCHORED=cloud`)
**Зв'язані документи:** `docs/specs/2026-07-11-llm-lib-run-harness-dev-design.md` (гейт «дефолт міняється лише за результатами bench»)

## Методика

`tier-sampling-bench` (реальні git-фікстури + живі моделі, timeout 180s/attempt), розширений A/B-прапорцями: `N_LLM_FIX_ANCHORED` (той самий env-опт-ін, що й у default-worker) і `N_LLM_FIX_BENCH_VERIFY=1` (evidence-гейт A1 у worker-і бенча). Моделі: local-min `omlx/gemma-4-e4b-it-OptiQ-4bit`, cloud-min `openai-codex/gpt-5.4-mini`. Фікстури: `package-script-no-fix` (правка наявного рядка), `missing-jscpd-config` (створення нового файлу).

## Результати

### Одиночні прогони, обидва тири (n=1 на клітинку)

| Фікстура | Тир | Baseline | Anchored |
|---|---|---|---|
| package-script-no-fix (edit) | local-min | clean, 6.6s | clean, **61.4s (9×)** |
| package-script-no-fix (edit) | cloud-min | clean, avg 8.5s | clean, avg 6.6s |
| missing-jscpd-config (new file) | local-min | **FAIL**, 23.1s | **clean, 9.7s** (rescue) |
| missing-jscpd-config (new file) | cloud-min | clean, avg 8.8s | clean, avg 8.6s |

### Cloud-min, 3 повтори × 2 фікстури × 2 sampling-профілі (n=12 attempts на конфігурацію)

| Конфігурація | cleanRate | avgAttemptMs (rep1/rep2/rep3) | Середнє |
|---|---|---|---|
| Baseline | 12/12 | 9453 / 7920 / 8138 | ~8.5s |
| Anchored (`cloud`) | 12/12 | 10254 / 8722 / 9051 | ~9.3s (**+10%**) |

### Verify-loop (A1), cloud-min, happy-path

Verify-конфігурація: clean, avg 7.2s проти базлайну ~8.5s — оверхед у межах шуму (одна додаткова детектор-перевірка). Ефект verify на провальних кейсах бенч не вимірює (фікстури заскладні для фейлу cloud) — справжній вимір = nightly smoke / live `lint --full` на складних правилах (doc-files/js-run/npm-module/test).

## Рішення

1. **Дефолт `N_LLM_FIX_ANCHORED=cloud`** (перемкнуто в default-worker): на cloud паритет коректності при ~+10% латентності — дешева страховка від collateral-класу (переписаний файл, літеральний `\n\n`), який на легких bench-фікстурах не відтворюється, але задокументований live. Off-switch: `N_LLM_FIX_ANCHORED=0`.
2. **Local лишається off**: на edit-фікстурі протокол якорів 9× повільніший (4B «гризе» якорі багатьма turns). Знахідка на майбутнє: на new-file фікстурі anchored-toolset **урятував** local-4B (базлайн фейлився — модель плуталась у built-in read/edit; без них пішла одразу у write). Гіпотеза «anchored шкодить local» уточнена: шкодить латентності edit-кейсів, допомагає new-file кейсам — перегляд після ширшої вибірки.
3. **Verify-loop** лишається як у A1 (увімкнений через `fixCtx.verify` у драбині) — happy-path оверхед ~нуль.

## Чесні обмеження

- Вибірка мала (12 attempts/конфігурація на cloud; local n=1-2), фікстури легкі — cleanRate 100% на cloud не диференціює коректність, рішення про дефолт спирається на «відсутність регресії + якісна страховка», не на виміряний приріст pass-rate.
- Справжній гейт якості — nightly smoke на складних правилах (Ф2 pi-migration) і телеметрія verifyAttempts/anchoredEdits з live-прогонів.
