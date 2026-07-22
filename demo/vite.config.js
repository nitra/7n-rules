/**
 * Vite-конфіг demo-застосунку: збірка Vue SFC через Vue Macros (розширені
 * `<script setup>`-макроси), автоімпорт Vue API з генерацією d.ts і швидка
 * обробка стилів через Lightning CSS.
 */
import Vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import VueMacros from 'vue-macros/vite'
import { defineConfig } from 'vite'

/** Конфігурація збірки demo: плагіни Vue/VueMacros/AutoImport і Lightning CSS-трансформер. */
export default defineConfig({
  plugins: [
    VueMacros({
      plugins: {
        vue: Vue()
      }
    }),
    AutoImport({
      imports: ['vue'],
      dts: 'src/auto-imports.d.ts'
    })
  ],
  css: { transformer: 'lightningcss' }
})
