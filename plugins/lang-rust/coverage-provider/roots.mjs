/**
 * Rust-корені проєкту для coverage-виміру — тонка обгортка спільного пошуку
 * коренів за маніфестом (`Cargo.toml`) зі спільної lib концерну coverage.
 */
import { findManifestRoots } from '@7n/rules/rules/test/coverage/lib/manifest-roots.mjs'

/**
 * Rust-корені під `cwd` (корінь + перший рівень тек із Cargo.toml).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи каталогів із Cargo.toml
 */
export function findRustRoots(cwd) {
  return findManifestRoots(cwd, ['Cargo.toml'])
}
