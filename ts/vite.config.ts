import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

/** Mounts the same /api handlers Vercel runs, so `vite dev` behaves like production. */
function apiDevServer(): Plugin {
  return {
    name: 'edly-api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url: string = req.url ?? '/';
        if (!url.startsWith('/api/')) return next();
        const name = url.split('?')[0]!.replace('/api/', '').replace(/\/$/, '');
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          await (mod.default as ApiHandler)(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@server': fileURLToPath(new URL('./server', import.meta.url))
    }
  },
  server: { port: 3000 },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' }
});
