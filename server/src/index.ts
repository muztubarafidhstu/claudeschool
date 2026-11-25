import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './lib/db.js';
import { config } from './lib/config.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { updatesRouter } from './routes/updates.js';

const app = express();
app.set('trust proxy', 1);
// Next.js static export uses small inline bootstrap scripts, so allow 'unsafe-inline' for scripts only.
app.use(helmet({
  contentSecurityPolicy: { directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'] } },
}));
app.use(express.json({ limit: '256kb' }));

// Desktop clients call verify-license without an Origin (native HTTP); admin panel uses CORS.
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || origin.startsWith('tauri://') || origin === 'http://tauri.localhost'),
}));

app.use('/api/v1', publicRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/updates', updatesRouter);

// Admin panel (static Next.js export) served from the same domain, e.g. https://scool.rafid5.com
if (fs.existsSync(config.adminStaticDir)) {
  app.use(express.static(config.adminStaticDir, { extensions: ['html'] }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.adminStaticDir, 'index.html')));
  console.log(`Serving admin panel from ${config.adminStaticDir}`);
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  if (config.autoMigrate) {
    const schema = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../db/schema.sql');
    const file = fs.existsSync(schema) ? schema : path.resolve('db/schema.sql');
    await pool.query(fs.readFileSync(file, 'utf8'));
    console.log('Database schema verified.');
  }
  app.listen(config.port, () => console.log(`ScholarDesk license API listening on :${config.port}`));
}
start().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
