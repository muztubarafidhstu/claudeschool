import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { updatesRouter } from './routes/updates.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

// Desktop clients call verify-license without an Origin (native HTTP); admin panel uses CORS.
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || origin.startsWith('tauri://') || origin === 'http://tauri.localhost'),
}));

app.use('/api/v1', publicRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/updates', updatesRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => console.log(`ScholarDesk license API listening on :${config.port}`));
