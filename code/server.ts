import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { PROJECT_ROOT } from './src/server/loadEnv.ts';
import { createApp } from './src/server/createApp.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  const app = createApp();
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: PROJECT_ROOT,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(PROJECT_ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BlurGuard server listening on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start BlurGuard server:', err);
    process.exit(1);
  });
}
