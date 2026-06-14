import { describe, expect, test } from 'vitest'

import { extractUnitsRs } from '../units-rs.mjs'
import { extractUnits } from '../units.mjs'

const SRC = `
use std::path::PathBuf;

/// Знаходить домашню директорію.
pub fn find_home() -> Option<PathBuf> {
  std::env::var_os("HOME").map(PathBuf::from)
}

fn helper(x: &str) -> String {
  find_home();
  x.to_uppercase()
}

/// Публічна структура конфігурації.
pub struct Config {
  pub name: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
  helper(name)
}

impl Config {
  /// Нова конфігурація.
  pub fn new(name: String) -> Self {
    Config { name }
  }

  fn private_method(&self) -> &str {
    &self.name
  }
}
`

describe('extractUnitsRs — top-level і impl-методи', () => {
  const units = extractUnitsRs(SRC, 'lib.rs')
  const by = name => units.find(u => u.name === name)

  test('знаходить pub fn, fn, pub struct, exposed fn та impl-методи', () => {
    const names = units.map(u => u.name).toSorted()
    expect(names).toContain('find_home')
    expect(names).toContain('helper')
    expect(names).toContain('Config')
    expect(names).toContain('greet')
    expect(names).toContain('new')
    expect(names).toContain('private_method')
  })

  test('exported: pub fn → true, fn → false, #[tauri::command] → true', () => {
    expect(by('find_home').exported).toBe(true)
    expect(by('helper').exported).toBe(false)
    expect(by('greet').exported).toBe(true)
    expect(by('Config').exported).toBe(true)
  })

  test('kind розрізняє fn і struct', () => {
    expect(by('find_home').kind).toBe('fn')
    expect(by('Config').kind).toBe('struct')
    expect(by('new').kind).toBe('fn')
  })

  test('/// doc витягується', () => {
    expect(by('find_home').doc).toBe('Знаходить домашню директорію.')
    expect(by('Config').doc).toBe('Публічна структура конфігурації.')
    expect(by('new').doc).toBe('Нова конфігурація.')
    expect(by('helper').doc).toBe('')
  })

  test('implName: top-level → null, impl-метод → назва типу', () => {
    expect(by('find_home').implName).toBeNull()
    expect(by('helper').implName).toBeNull()
    expect(by('new').implName).toBe('Config')
    expect(by('private_method').implName).toBe('Config')
  })

  test('call-graph: виклики інших юнітів цього файлу', () => {
    expect(by('helper').calls).toContain('find_home')
    expect(by('greet').calls).toContain('helper')
    expect(by('find_home').calls).toEqual([])
  })

  test('hasBody: fn і struct мають body', () => {
    expect(by('find_home').hasBody ?? !!by('find_home').body).toBe(true)
    expect(by('Config').hasBody ?? !!by('Config').body).toBe(true)
  })

  test('порожній файл → null', () => {
    expect(extractUnitsRs('', 'empty.rs')).toBeNull()
  })
})

describe('extractUnits — фасад за розширенням', () => {
  test('rs → юніти (не null)', () => {
    const units = extractUnits(SRC, 'lib.rs')
    expect(units).not.toBeNull()
    expect(units.length).toBeGreaterThan(0)
  })

  test('vue та py — все ще null (не зламали)', () => {
    expect(extractUnits('<template></template>', 'c.vue')).toBeNull()
    expect(extractUnits('def f(): pass', 's.py')).toBeNull()
  })
})
