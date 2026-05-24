/**
 * Тести автофіксу `images:` у kustomization.yaml (check-k8s):
 * розбір image на name/tag/digest, очищення блоку `images:` від зайвих тегів,
 * детекція JSON6902 image-replace patch для Deployment, e2e-конвертація patch → images:.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  cleanupKustomizationImagesInYamlText,
  convertImagePatchesToImagesInKustomization,
  imageReplaceDeploymentPatchInfo,
  splitImageNameTagDigest
} from '../../../manifests.mjs'

describe('splitImageNameTagDigest', () => {
  test('звичайний image:tag', () => {
    expect(splitImageNameTagDigest('foo:tag')).toEqual({ name: 'foo', tag: 'tag', hasDigest: false })
  })

  test('digest залишається цілим (hasDigest)', () => {
    expect(splitImageNameTagDigest('foo@sha256:abc')).toEqual({
      name: 'foo@sha256:abc',
      tag: null,
      hasDigest: true
    })
  })

  test('реєстр з портом без тегу', () => {
    expect(splitImageNameTagDigest('localhost:5000/foo')).toEqual({
      name: 'localhost:5000/foo',
      tag: null,
      hasDigest: false
    })
  })

  test('реєстр з портом і тегом', () => {
    expect(splitImageNameTagDigest('localhost:5000/foo:tag')).toEqual({
      name: 'localhost:5000/foo',
      tag: 'tag',
      hasDigest: false
    })
  })

  test('image без тегу', () => {
    expect(splitImageNameTagDigest('foo')).toEqual({ name: 'foo', tag: null, hasDigest: false })
  })
})

describe('cleanupKustomizationImagesInYamlText', () => {
  test('зрізає :tag з name й видаляє newTag, що збігається', () => {
    const input = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
images:
  - name: europe-west4-docker.pkg.dev/abie-ua/c/x:latest
    newName: europe-west4-docker.pkg.dev/abie-ua/c/x
    newTag: latest
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
images:
  - name: europe-west4-docker.pkg.dev/abie-ua/c/x
    newName: europe-west4-docker.pkg.dev/abie-ua/c/x
`)
  })

  test('digest у name не чіпає', () => {
    const input = `images:
  - name: foo@sha256:abc123
    newTag: latest
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(false)
    expect(r.content).toBe(input)
  })

  test('newTag відрізняється — лишає newTag, лише зрізає тег з name', () => {
    const input = `images:
  - name: foo:dev
    newTag: prod
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`images:
  - name: foo
    newTag: prod
`)
  })

  test('name з тегом без newTag', () => {
    const input = `images:
  - name: foo:latest
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`images:
  - name: foo
`)
  })

  test('кілька записів — обробляються незалежно', () => {
    const input = `images:
  - name: a:v1
    newTag: v1
  - name: b@sha256:zzz
    newTag: latest
  - name: c:dev
    newTag: prod
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`images:
  - name: a
  - name: b@sha256:zzz
    newTag: latest
  - name: c
    newTag: prod
`)
  })

  test('порт реєстру без тегу не зрізається', () => {
    const input = `images:
  - name: localhost:5000/foo
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(false)
  })

  test('порт реєстру з тегом — зрізається лише тег', () => {
    const input = `images:
  - name: localhost:5000/foo:v1
    newTag: v1
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`images:
  - name: localhost:5000/foo
`)
  })

  test('відсутній блок images: — без змін', () => {
    const input = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(false)
  })

  test('коментарі й пробіли в межах блоку зберігаються', () => {
    const input = `images:
  # коментар перед entry
  - name: foo:v1
    newTag: v1

  - name: bar:v2
    newTag: v3
`
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(`images:
  # коментар перед entry
  - name: foo

  - name: bar
    newTag: v3
`)
  })

  test('CRLF-переноси зберігаються', () => {
    const input = 'images:\r\n  - name: foo:v1\r\n    newTag: v1\r\n'
    const r = cleanupKustomizationImagesInYamlText(input)
    expect(r.changed).toBe(true)
    expect(r.content).toBe('images:\r\n  - name: foo\r\n')
  })
})

describe('imageReplaceDeploymentPatchInfo', () => {
  test('детектить JSON6902 image replace для Deployment', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'auth' },
      patch: `- op: replace
  path: /spec/template/spec/containers/0/image
  value: foo:latest`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toEqual({
      deployName: 'auth',
      totalOps: 1,
      ops: [{ containerIndex: 0, newImage: 'foo:latest', opIndex: 0 }]
    })
  })

  test('null для не-Deployment target', () => {
    const patch = {
      target: { kind: 'HorizontalPodAutoscaler', name: 'auth' },
      patch: `- op: replace
  path: /spec/template/spec/containers/0/image
  value: foo:latest`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toBeNull()
  })

  test('null для path не-image', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'auth' },
      patch: `- op: replace
  path: /spec/replicas
  value: 2`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toBeNull()
  })

  test('multi-op patch: повертає лише image-replace op із opIndex/totalOps', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'auth' },
      patch: `- op: replace
  path: /spec/template/spec/containers/0/image
  value: foo:latest
- op: replace
  path: /spec/replicas
  value: 2`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toEqual({
      deployName: 'auth',
      totalOps: 2,
      ops: [{ containerIndex: 0, newImage: 'foo:latest', opIndex: 0 }]
    })
  })

  test('multi-image patch: повертає всі image-replace ops', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'auth' },
      patch: `- op: replace
  path: /spec/template/spec/containers/0/image
  value: a:v1
- op: replace
  path: /spec/template/spec/containers/1/image
  value: b:v2`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toEqual({
      deployName: 'auth',
      totalOps: 2,
      ops: [
        { containerIndex: 0, newImage: 'a:v1', opIndex: 0 },
        { containerIndex: 1, newImage: 'b:v2', opIndex: 1 }
      ]
    })
  })

  test('null для op не-replace', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'auth' },
      patch: `- op: add
  path: /spec/template/spec/containers/0/image
  value: foo:latest`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toBeNull()
  })

  test('контейнер з іншим індексом', () => {
    const patch = {
      target: { kind: 'Deployment', name: 'web' },
      patch: `- op: replace
  path: /spec/template/spec/containers/2/image
  value: bar:v1`
    }
    expect(imageReplaceDeploymentPatchInfo(patch)).toEqual({
      deployName: 'web',
      totalOps: 1,
      ops: [{ containerIndex: 2, newImage: 'bar:v1', opIndex: 0 }]
    })
  })
})

/**
 * Створює тимчасовий kustomize-кореневий каталог із `k8s/base` (мінімальний kustomization.yaml)
 * та `k8s/prod` (порожній). Використовується e2e-тестами `convertImagePatchesToImagesInKustomization`.
 * @param {string} prefix префікс для тимчасового каталогу
 * @returns {Promise<{ root: string, baseDir: string, prodDir: string }>} абсолютні шляхи до тимчасового кореня і двох каталогів kustomize
 */
async function setupKustTree(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const baseDir = join(root, 'k8s/base')
  const prodDir = join(root, 'k8s/prod')
  await mkdir(baseDir, { recursive: true })
  await mkdir(prodDir, { recursive: true })
  await writeFile(
    join(baseDir, 'kustomization.yaml'),
    `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - deploy.yaml
`,
    'utf8'
  )
  return { root, baseDir, prodDir }
}

/**
 * Мінімальний `Deployment` у base — один контейнер `app` із заданим образом.
 * Вилучено в helper щоб прибрати дублювання (jscpd, порогова межа 25 рядків)
 * між тестами `convertImagePatchesToImagesInKustomization`.
 * @param {string} image повний `image:` для першого контейнера (з тегом)
 * @returns {string} YAML-текст файлу `base/deploy.yaml`
 */
function buildBaseDeployYaml(image) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  template:
    spec:
      containers:
        - name: app
          image: ${image}
`
}

/**
 * `kustomization.yaml` у `prod/` із одним **image-replace** patch на `Deployment auth`.
 * @param {string} imageValue нове значення `value:` (повний `image:tag`)
 * @returns {string} YAML-текст файлу `prod/kustomization.yaml`
 */
function buildProdKustImageReplace(imageValue) {
  return `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: auth
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: ${imageValue}
`
}

describe('convertImagePatchesToImagesInKustomization (e2e)', () => {
  test('конвертує одиничний image-replace patch у images:', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-1-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      buildBaseDeployYaml('europe-west4-docker.pkg.dev/abie-ua/c/x:dev'),
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(prodKust, buildProdKustImageReplace('europe-west4-docker.pkg.dev/abie-ua/c/x:latest'), 'utf8')
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.errors).toEqual([])
    await writeFile(prodKust, r.content, 'utf8')
    const after = await readFile(prodKust, 'utf8')
    expect(after).toContain('images:')
    expect(after).toContain('- name: europe-west4-docker.pkg.dev/abie-ua/c/x')
    expect(after).toContain('newName: europe-west4-docker.pkg.dev/abie-ua/c/x')
    expect(after).toContain('newTag: latest')
    expect(after).not.toContain('patches:')
  })

  test('коли тег у patch.value збігається з base — newTag не виставляється', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-2-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      buildBaseDeployYaml('europe-west4-docker.pkg.dev/abie-ua/c/x:latest'),
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(prodKust, buildProdKustImageReplace('europe-west4-docker.pkg.dev/abie-ua/c/x:latest'), 'utf8')
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.content).toContain('- name: europe-west4-docker.pkg.dev/abie-ua/c/x')
    expect(r.content).not.toContain('newTag:')
  })

  test('зберігає інші patches (не-image)', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-3-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  template:
    spec:
      containers:
        - name: app
          image: foo:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: auth
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: foo:prod
  - target:
      kind: HorizontalPodAutoscaler
      name: auth
    patch: |-
      - op: replace
        path: /spec/minReplicas
        value: 2
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.content).toContain('patches:')
    expect(r.content).toContain('HorizontalPodAutoscaler')
    expect(r.content).toContain('images:')
    expect(r.content).toContain('newTag: prod')
  })

  test('повертає errors якщо base image не знайдено', async () => {
    const { root, prodDir } = await setupKustTree('k8s-img-conv-4-')
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: missing
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: foo:latest
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(false)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('missing')
  })

  test('зберігає modeline (yaml-language-server)', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-5-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  template:
    spec:
      containers:
        - name: app
          image: foo:latest
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: auth
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: foo:latest
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.content.split('\n')[0]).toBe(
      '# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json'
    )
  })

  test('multi-op patch (image + non-image): конвертує image, лишає не-image op', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-multi-1-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  template:
    spec:
      containers:
        - name: app
          image: foo:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: auth
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: foo:prod
      - op: add
        path: /spec/template/spec/nodeSelector/foo
        value: bar
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.content).toContain('patches:')
    expect(r.content).toContain('path: /spec/template/spec/nodeSelector/foo')
    expect(r.content).not.toContain('/spec/template/spec/containers/0/image')
    expect(r.content).toContain('images:')
    expect(r.content).toContain('newTag: prod')
  })

  test('multi-op patch (image + add containers + add volumes + replace nodeSelector): лишаються 3 ops', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-multi-2-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: graphql-engine
spec:
  template:
    spec:
      containers:
        - name: hge
          image: hasura:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: graphql-engine
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: hasura:prod
      - op: add
        path: /spec/template/spec/containers/-
        value:
          name: sidecar
          image: side:1
      - op: add
        path: /spec/template/spec/volumes
        value:
          - name: tmp
            emptyDir: {}
      - op: replace
        path: /spec/template/spec/nodeSelector
        value:
          preem: "false"
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.content).toContain('patches:')
    expect(r.content).not.toContain('/spec/template/spec/containers/0/image')
    expect(r.content).toContain('/spec/template/spec/containers/-')
    expect(r.content).toContain('/spec/template/spec/volumes')
    expect(r.content).toContain('/spec/template/spec/nodeSelector')
    expect(r.content).toContain('images:')
    expect(r.content).toContain('newTag: prod')
  })

  test('multi-image patch (containers/0 + containers/1): обидва конвертуються, патч видаляється', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-multi-3-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: app
          image: a:dev
        - name: side
          image: b:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: web
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: a:prod
      - op: replace
        path: /spec/template/spec/containers/1/image
        value: b:prod
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.content).not.toContain('patches:')
    expect(r.content).toContain('- name: a')
    expect(r.content).toContain('- name: b')
    expect(r.content.match(/newTag: prod/gu)?.length).toBe(2)
  })

  test('multi-op patch з digest у image-value: image op зі звичайним тегом конвертується, digest op лишається', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-multi-4-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: app
          image: a:dev
        - name: side
          image: b:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    await writeFile(
      prodKust,
      `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: web
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: a:prod
      - op: replace
        path: /spec/template/spec/containers/1/image
        value: b@sha256:abc
`,
      'utf8'
    )
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(true)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('digest')
    expect(r.content).toContain('patches:')
    expect(r.content).toContain('/spec/template/spec/containers/1/image')
    expect(r.content).not.toContain('/spec/template/spec/containers/0/image')
    expect(r.content).toContain('images:')
    expect(r.content).toContain('newTag: prod')
  })

  test('одиничний image-replace із digest у value: пропускається, патч не змінюється', async () => {
    const { root, baseDir, prodDir } = await setupKustTree('k8s-img-conv-digest-solo-')
    await writeFile(
      join(baseDir, 'deploy.yaml'),
      `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
spec:
  template:
    spec:
      containers:
        - name: app
          image: foo:dev
`,
      'utf8'
    )
    const prodKust = join(prodDir, 'kustomization.yaml')
    const original = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-ns
resources:
  - ../base

patches:
  - target:
      kind: Deployment
      name: auth
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: foo@sha256:abc
`
    await writeFile(prodKust, original, 'utf8')
    const r = await convertImagePatchesToImagesInKustomization(prodKust, resolve(root))
    expect(r.changed).toBe(false)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('digest')
    expect(await readFile(prodKust, 'utf8')).toBe(original)
  })
})
