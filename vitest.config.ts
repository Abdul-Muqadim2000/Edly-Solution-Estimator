import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      /**
       * istanbul, not v8. There is no node on this machine, so vitest runs under Bun, where the
       * v8 provider fails to map several files and then reports them as 100% covered. A number
       * that is wrong in the flattering direction is worse than no number at all.
       */
      provider: 'istanbul',
      include: ['src/domain/**', 'src/lib/**', 'src/state/**', 'server/**'],
      /**
       * Not measured here: modules that need a DOM, a canvas, a clipboard or a React renderer.
       * They are exercised by the browser runners in VERIFY.md instead. Excluded rather than
       * left in at 0%, so the number below means something.
       */
      exclude: [
        'src/lib/ganttPng.ts',
        'src/lib/useHover.ts',
        'src/lib/useViewport.ts',
        'src/state/AppProvider.tsx',
        'src/state/useSync.ts',
        'src/state/useRouting.ts'
      ],
      reporter: ['text', 'html'],
      /* Floors, not targets: they are set just under what the suite achieves today, so a change
         that drops coverage fails the gate instead of drifting. Raise them, never lower them. */
      thresholds: { statements: 90, branches: 78, functions: 92, lines: 92 }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@server': fileURLToPath(new URL('./server', import.meta.url))
    }
  }
});
