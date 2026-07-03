import Vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import VueMacros from 'vue-macros/vite'
import { defineConfig } from 'vite'

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
  css: { transformer: 'lightningcss' }
})
