#!/usr/bin/env bash
# Спільний добувач WASI SDK для збірки wasm-гостей під `wasm32-wasip3`
# (спека `docs/specs/2026-08-31-plugin-contract-v5.md`, розділ 10.1, крок 4
# порядку реалізації). Пінована версія — рішення власника 2026-08-31:
# **фінальний** реліз `wasi-sdk-34` (НЕ `34.0-rc.2`).
#
# ФОРМА перенесена із сусіднього `nitra/r-plugin`
# (`scripts/test-component-spike.sh`, клонується анонімно з
# `https://git.7n.ai/nitra/r-plugin`) — той самий каркас "case за
# uname → архів + sha256 → завантажити → звірити → розпакувати →
# перевірити VERSION". `r-plugin` сам перейшов зі `34.0-rc.2` на цей самий
# стабільний `wasi-sdk-34` (коміт `7cf8da9`) ПІД ЧАС цієї хвилі — тож
# контрольні суми нижче взяті ДОСЛІВНО з їхнього оновленого
# `scripts/test-component-spike.sh`, а не перераховані з нуля; розбіжність,
# що обґрунтовувала «форма, не вміст» на початку хвилі, зникла сама, коли
# обидва проєкти зійшлись на тому самому релізі.
#
# SHA-256 macOS/arm64 (наша збірна машина) ДОДАТКОВО звірено локально повним
# завантаженням+розпакуванням під час підготовки цієї хвилі — не лише
# скопійовано з чужого скрипта.
#
# # "Мінімум, а не точна версія" (спека, розділ 10.1)
#
# На відміну від r-plugin (точна рівність `VERSION`), гейт нижче —
# ПОРОГОВИЙ: перший рядок `VERSION` мусить парситись як `MAJOR.MINOR` і
# `MAJOR >= 34`. Старіші мажори SDK відхиляються гучно; новіші —
# приймаються (наступний бамп піна архіву — окрема свідома правка URL/sha256
# нижче, не авто-апгрейд).
#
# # Використання
#
# Джерелиться (не виконується) з `build.sh` кожного wasm-гостя:
#   source "$SCRIPT_DIR/../wasm-sdk/fetch-wasi-sdk.sh"
# Після джерелення в оточенні визначені:
#   WASI_SDK_PATH            — корінь розпакованого SDK у кеші
#   WASI_SDK_P3_LIBDIR        — `share/wasi-sysroot/lib/wasm32-wasip3`
#   WASI_SDK_COMPONENT_LD     — `bin/wasm-component-ld`
#   WASI_SDK_REACTOR_CRT      — `crt1-reactor.o` для reactor-компонентів
#
# Кеш — `${WASI_SDK_CACHE:-$HOME/.cache/n-rules/wasi-sdk-34}`: сім
# build.sh (шість гостей + `test-plugin-guest`) діляться ОДНИМ
# розпакованим SDK, не тягнуть ~180 MiB архіву на кожен.
set -euo pipefail

WASI_SDK_RELEASE_TAG="wasi-sdk-34"
WASI_SDK_MIN_MAJOR=34
WASI_SDK_CACHE="${WASI_SDK_CACHE:-$HOME/.cache/n-rules/wasi-sdk-34}"

case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    _wasi_sdk_archive_name="wasi-sdk-34.0-arm64-macos.tar.gz"
    _wasi_sdk_archive_sha256="9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9"
    ;;
  Darwin:x86_64)
    _wasi_sdk_archive_name="wasi-sdk-34.0-x86_64-macos.tar.gz"
    _wasi_sdk_archive_sha256="87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb"
    ;;
  Linux:aarch64 | Linux:arm64)
    _wasi_sdk_archive_name="wasi-sdk-34.0-arm64-linux.tar.gz"
    _wasi_sdk_archive_sha256="f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971"
    ;;
  Linux:x86_64)
    _wasi_sdk_archive_name="wasi-sdk-34.0-x86_64-linux.tar.gz"
    _wasi_sdk_archive_sha256="b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4"
    ;;
  *)
    echo "WASI SDK ${WASI_SDK_RELEASE_TAG} provenance піновано лише для macOS та Linux (arm64/x86_64) — та сама форма, що r-plugin." >&2
    exit 1
    ;;
esac

_wasi_sdk_extract_dir_name="${_wasi_sdk_archive_name%.tar.gz}"
WASI_SDK_PATH="${WASI_SDK_CACHE}/${_wasi_sdk_extract_dir_name}"

# Структурна перевірка кешу: маркер-файл `.n-rules-verified` пишеться лише
# ПІСЛЯ повного проходження sha256+VERSION-гейту нижче — часткова/перервана
# розпаковка НІКОЛИ не пройде як "вже готово" (мовчазний пропуск — вада,
# правило проєкту).
if [[ ! -f "${WASI_SDK_PATH}/.n-rules-verified" ]]; then
  echo "== WASI SDK ${WASI_SDK_RELEASE_TAG}: кеш порожній/неповний, добуваю ${_wasi_sdk_archive_name} ==" >&2

  mkdir -p "${WASI_SDK_CACHE}"
  _wasi_sdk_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/n-rules-wasi-sdk.XXXXXX")"
  trap 'rm -rf -- "${_wasi_sdk_tmp_dir}"' EXIT

  _wasi_sdk_archive_path="${_wasi_sdk_tmp_dir}/${_wasi_sdk_archive_name}"
  _wasi_sdk_url="https://github.com/WebAssembly/wasi-sdk/releases/download/${WASI_SDK_RELEASE_TAG}/${_wasi_sdk_archive_name}"
  curl -fL --retry 5 --retry-delay 2 -o "${_wasi_sdk_archive_path}" "${_wasi_sdk_url}"

  if command -v shasum >/dev/null 2>&1; then
    _wasi_sdk_digest="$(shasum -a 256 "${_wasi_sdk_archive_path}")"
  elif command -v sha256sum >/dev/null 2>&1; then
    _wasi_sdk_digest="$(sha256sum "${_wasi_sdk_archive_path}")"
  else
    echo "Потрібен shasum або sha256sum для перевірки WASI SDK." >&2
    exit 1
  fi
  _wasi_sdk_digest="${_wasi_sdk_digest%% *}"
  if [[ "${_wasi_sdk_digest}" != "${_wasi_sdk_archive_sha256}" ]]; then
    echo "Контрольна сума WASI SDK не збіглась для ${_wasi_sdk_archive_name}." >&2
    echo "Очікував ${_wasi_sdk_archive_sha256}, отримав ${_wasi_sdk_digest}." >&2
    exit 1
  fi

  rm -rf -- "${WASI_SDK_PATH}"
  tar -xzf "${_wasi_sdk_archive_path}" -C "${WASI_SDK_CACHE}"

  if [[ ! -f "${WASI_SDK_PATH}/VERSION" ]]; then
    echo "У розпакованому SDK немає файлу VERSION: ${WASI_SDK_PATH}/VERSION" >&2
    exit 1
  fi
  _wasi_sdk_version_major="$(head -n1 "${WASI_SDK_PATH}/VERSION" | cut -d. -f1)"
  if ! [[ "${_wasi_sdk_version_major}" =~ ^[0-9]+$ ]]; then
    echo "Не вдалось розпарсити мажор-версію з VERSION: '$(head -n1 "${WASI_SDK_PATH}/VERSION")'" >&2
    exit 1
  fi
  if (( _wasi_sdk_version_major < WASI_SDK_MIN_MAJOR )); then
    echo "WASI SDK мажор ${_wasi_sdk_version_major} < піновано мінімуму ${WASI_SDK_MIN_MAJOR}." >&2
    exit 1
  fi

  _wasi_sdk_component_ld="${WASI_SDK_PATH}/bin/wasm-component-ld"
  _wasi_sdk_reactor_crt="${WASI_SDK_PATH}/share/wasi-sysroot/lib/wasm32-wasip3/crt1-reactor.o"
  if [[ ! -x "${_wasi_sdk_component_ld}" || ! -f "${_wasi_sdk_reactor_crt}" ]]; then
    echo "WASI SDK ${WASI_SDK_RELEASE_TAG}: не знайдено wasm-component-ld або crt1-reactor.o для wasm32-wasip3 під ${WASI_SDK_PATH}." >&2
    exit 1
  fi

  touch "${WASI_SDK_PATH}/.n-rules-verified"
  rm -rf -- "${_wasi_sdk_tmp_dir}"
  trap - EXIT
  echo "OK: ${WASI_SDK_PATH} (VERSION мажор ${_wasi_sdk_version_major})" >&2
else
  # Кеш уже верифікований попереднім прогоном — усе одно перевіряємо
  # структурну наявність лінкера й reactor CRT, а не лише маркер-файл:
  # часткове ручне втручання в кеш (наприклад, `rm` одного файлу) має
  # падати гучно, не мовчки використовувати неповний SDK.
  _wasi_sdk_component_ld="${WASI_SDK_PATH}/bin/wasm-component-ld"
  _wasi_sdk_reactor_crt="${WASI_SDK_PATH}/share/wasi-sysroot/lib/wasm32-wasip3/crt1-reactor.o"
  if [[ ! -x "${_wasi_sdk_component_ld}" || ! -f "${_wasi_sdk_reactor_crt}" ]]; then
    echo "Кеш WASI SDK позначений верифікованим, але lінкер/CRT відсутні: ${WASI_SDK_PATH}" >&2
    echo "Видаліть ${WASI_SDK_PATH} і повторіть збірку." >&2
    exit 1
  fi
fi

WASI_SDK_P3_LIBDIR="${WASI_SDK_PATH}/share/wasi-sysroot/lib/wasm32-wasip3"
WASI_SDK_COMPONENT_LD="${WASI_SDK_PATH}/bin/wasm-component-ld"
WASI_SDK_REACTOR_CRT="${WASI_SDK_P3_LIBDIR}/crt1-reactor.o"

unset _wasi_sdk_archive_name _wasi_sdk_archive_sha256 _wasi_sdk_extract_dir_name \
  _wasi_sdk_tmp_dir _wasi_sdk_archive_path _wasi_sdk_url _wasi_sdk_digest \
  _wasi_sdk_version_major _wasi_sdk_component_ld _wasi_sdk_reactor_crt
