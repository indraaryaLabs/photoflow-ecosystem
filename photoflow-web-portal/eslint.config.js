import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      // Tanpa ini, no-unused-vars tidak melihat komponen yang hanya dipakai di
      // dalam JSX. Setiap `import { motion }` dan setiap komponen hasil
      // destructuring dilaporkan "defined but never used" -- delapan temuan
      // palsu yang menenggelamkan satu temuan sungguhan, dan itu pula alasan
      // lint frontend di CI masih dibiarkan continue-on-error.
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // Aturan inilah yang memberi tahu no-unused-vars bahwa sebuah nama
      // dipakai di dalam JSX. Config 'jsx-runtime' hanya mematikan keharusan
      // mengimpor React; ia tidak menyalakan yang ini.
      'react/jsx-uses-vars': 'error',
    },
  },
])
