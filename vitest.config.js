import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    exclude: [...configDefaults.exclude, 'src/**/*.k6.js']
  }
})
