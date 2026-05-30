# Coverage

| Область | Рядки | Функції | Вбито мутацій | Score |
| --- | --- | --- | --- | --- |
| JS | 88.21% (8024/9096) | 90.60% (1244/1373) | 132/141 | 93.62% |

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
        "original": "",
        "replacement": "true"
      },
      {
        "line": 189,
        "col": 7,
        "mutantType": "ConditionalExpression",
        "original": "",
        "replacement": "false"
      },
      {
        "line": 211,
        "col": 56,
        "mutantType": "ObjectLiteral",
        "original": "",
        "replacement": "{}"
      },
      {
        "line": 211,
        "col": 63,
        "mutantType": "BooleanLiteral",
        "original": "",
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
| 189 | `` | `true` | ConditionalExpression |
| 189 | `` | `false` | ConditionalExpression |
| 211 | `` | `{}` | ObjectLiteral |
| 211 | `` | `true` | BooleanLiteral |

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
