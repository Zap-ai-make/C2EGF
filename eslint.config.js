import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactRefresh.configs.vite,
    ],
    // Les deux règles des hooks, sans préréglage : depuis la 7, celui du
    // plugin ajoute quinze règles du React Compiler. Les adopter est une
    // décision à part, pas l'effet d'une mise à jour.
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Entrée dans eslint:recommended avec ESLint 10. Elle relève six valeurs
      // initiales jamais lues : des défauts défensifs, dans les scripts des
      // comptes techniques. L'adopter, c'est retoucher ces scripts : un choix à
      // part. Les deux autres règles entrées avec elle (no-unassigned-vars,
      // preserve-caught-error) ne relèvent rien et restent actives.
      'no-useless-assignment': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      // Plus de react/jsx-uses-vars (eslint-plugin-react) : depuis ESLint 10,
      // `<Composant />` compte comme une utilisation de `Composant`, pour
      // no-unused-vars comme pour no-undef.
    },
  },
])
