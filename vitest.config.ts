import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // unplugin-swc disables Vitest's esbuild transform; Vitest 4 additionally
  // needs oxc disabled explicitly, or it transforms with Oxc (which does not
  // emit decorator metadata) and warns on every run.
  oxc: false,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{spec,e2e-spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
    },
  },
  plugins: [
    // SWC honors emitDecoratorMetadata; Vitest's default esbuild transform
    // does not, and NestJS DI depends on design:paramtypes metadata.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
