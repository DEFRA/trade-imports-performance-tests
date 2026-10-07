import path from 'node:path'

import { includeIgnoreFile } from 'eslint/config'
import { neostandard } from 'neostandard'

// neostandard 0.14 scopes its `ignores` option to its own layers, so the
// gitignored paths need an explicit global ignore. Resolving .gitignore from
// this file keeps it working from any working directory.
export default [
  includeIgnoreFile(path.join(import.meta.dirname, '.gitignore')),
  ...neostandard({
    env: ['node', 'vitest'],
    noJsx: true,
    noStyle: true
  }),
  {
    // Anchor the globs to this directory, not the working directory.
    basePath: import.meta.dirname,
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
