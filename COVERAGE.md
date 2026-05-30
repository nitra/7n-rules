# Coverage

| Область | Рядки | Функції | Вбито мутацій | Score |
| --- | --- | --- | --- | --- |
| JS | 77.67% (6765/8710) | 84.47% (1110/1314) | 132/141 | 93.62% |

## Вцілілі мутанти

```json
[
  {
    "file": "npm/rules/test/coverage/coverage.mjs",
    "mutants": [
      {
        "line": 189,
        "col": 7,
        "mutantType": "ConditionalExpression",
        "original": "pts.fix)",
        "replacement": "true"
      },
      {
        "line": 189,
        "col": 7,
        "mutantType": "ConditionalExpression",
        "original": "pts.fix)",
        "replacement": "false"
      },
      {
        "line": 211,
        "col": 56,
        "mutantType": "ObjectLiteral",
        "original": " fix: false })",
        "replacement": "{}"
      },
      {
        "line": 211,
        "col": 63,
        "mutantType": "BooleanLiteral",
        "original": "alse ",
        "replacement": "true"
      }
    ],
    "exampleTest": {
      "testFile": "npm/rules/test/coverage/tests/coverage.test.mjs",
      "code": "  test('покомпонентне додавання lines та functions', () => {\n    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }\n    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }\n    expect(addCoverage(a, b)).toEqual({\n      lines: { covered: 15, total: 28 },\n      functions: { covered: 5, total: 9 }\n    })\n  })"
    },
    "recommendationText": null
  }
]
```

### npm/rules/test/coverage/coverage.mjs

| Рядок | Оригінал | Заміна | Тип |
| --- | --- | --- | --- |
| 189 | `pts.fix)` | `true` | ConditionalExpression |
| 189 | `pts.fix)` | `false` | ConditionalExpression |
| 211 | ` fix: false })` | `{}` | ObjectLiteral |
| 211 | `alse ` | `true` | BooleanLiteral |

**Приклад тесту** (`npm/rules/test/coverage/tests/coverage.test.mjs`):

```js
  test('покомпонентне додавання lines та functions', () => {
    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }
    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }
    expect(addCoverage(a, b)).toEqual({
      lines: { covered: 15, total: 28 },
      functions: { covered: 5, total: 9 }
    })
  })
```
