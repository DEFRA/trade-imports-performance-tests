import { neostandard, resolveIgnoresFromGitignore } from 'neostandard'

const gitignored = resolveIgnoresFromGitignore()

export default [
  { ignores: gitignored },
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: gitignored,
    noJsx: true,
    noStyle: true
  }),
  {
    files: ['src/**/*.k6.js', 'src/k6/service-http.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __ITER: 'readonly',
        __VU: 'readonly',
        open: 'readonly'
      }
    }
  }
]
