/**
 * Тести перевірки `mirror.gcr.io` для образів oven/bun, alpine, nginx, node (Docker Hub).
 */
import { describe, expect, test } from 'bun:test'

import {
  getFromImageToken,
  getMirrorGcrHint,
  getRequiredMirrorGcrImage,
  normalizeHubRepoPath,
  isDockerHubStyleImageRef
} from '../../../utils/docker-mirror.mjs'

describe('getFromImageToken', () => {
  test('токен після змінних FROM', () => {
    expect(getFromImageToken('FROM node:20-alpine AS build')).toBe('node:20-alpine')
    expect(getFromImageToken('FROM --platform=linux/amd64 oven/bun:alpine AS x')).toBe('oven/bun:alpine')
    expect(getFromImageToken('  from   alpine:3.20  ')).toBe('alpine:3.20')
  })

  test('inline-коментар', () => {
    expect(getFromImageToken('FROM nginx:1  # comm')).toBe('nginx:1')
  })
})

describe('normalizeHubRepoPath', () => {
  test('короткі імена library', () => {
    expect(normalizeHubRepoPath('node:20-bullseye')).toBe('library/node')
    expect(normalizeHubRepoPath('alpine:3.20')).toBe('library/alpine')
  })

  test('явний docker.io', () => {
    expect(normalizeHubRepoPath('docker.io/library/node:20')).toBe('library/node')
  })

  test('oven/bun', () => {
    expect(normalizeHubRepoPath('oven/bun:alpine')).toBe('oven/bun')
  })
})

describe('isDockerHubStyleImageRef', () => {
  test('вважає Hub короткі імена', () => {
    expect(isDockerHubStyleImageRef('node:20')).toBe(true)
  })

  test('відсікає чужі реєстри', () => {
    expect(isDockerHubStyleImageRef('gcr.io/foo/bar:1')).toBe(false)
    expect(isDockerHubStyleImageRef('reg.example.com/oven/bun:1')).toBe(false)
  })

  test('mirror.gcr.io вже — не “хаб”', () => {
    expect(isDockerHubStyleImageRef('mirror.gcr.io/library/node:20')).toBe(false)
  })
})

describe('getRequiredMirrorGcrImage', () => {
  test('для Hub без дзеркала — рекомендація', () => {
    expect(getRequiredMirrorGcrImage('node:20')).toBe('mirror.gcr.io/library/node')
    expect(getRequiredMirrorGcrImage('alpine:3.20')).toBe('mirror.gcr.io/library/alpine')
    expect(getRequiredMirrorGcrImage('nginx:1')).toBe('mirror.gcr.io/library/nginx')
    expect(getRequiredMirrorGcrImage('oven/bun:alpine')).toBe('mirror.gcr.io/oven/bun')
    expect(getRequiredMirrorGcrImage('nginxinc/nginx-unprivileged:alpine-slim')).toBe(
      'mirror.gcr.io/nginxinc/nginx-unprivileged'
    )
  })

  test('для дзеркала — null', () => {
    expect(getRequiredMirrorGcrImage('mirror.gcr.io/library/node:20')).toBe(null)
    expect(getRequiredMirrorGcrImage('mirror.gcr.io/oven/bun:alpine')).toBe(null)
    expect(getRequiredMirrorGcrImage('mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim')).toBe(null)
  })

  test('інші Hub-образи — null', () => {
    expect(getRequiredMirrorGcrImage('ubuntu:22.04')).toBe(null)
  })
})

describe('getMirrorGcrHint', () => {
  test('помилка на прямий Hub', () => {
    const h = getMirrorGcrHint('FROM node:20\nRUN echo\n')
    expect(h).toContain('library/node')
    expect(h).toContain('mirror.gcr.io')
  })

  test('ok для дзеркала', () => {
    expect(getMirrorGcrHint('FROM mirror.gcr.io/library/node:20\n')).toBe(null)
  })

  test('помилка: nginxinc/nginx-unprivileged без дзеркала', () => {
    const h = getMirrorGcrHint('FROM nginxinc/nginx-unprivileged:alpine-slim\n')
    expect(h).toContain('mirror.gcr.io/nginxinc/nginx-unprivileged')
  })

  test('ok: mirror.gcr.io/nginxinc/nginx-unprivileged', () => {
    expect(getMirrorGcrHint('FROM mirror.gcr.io/nginxinc/nginx-unprivileged:alpine-slim\n')).toBe(null)
  })
})
