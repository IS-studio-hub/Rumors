process.env.TZ = 'America/Toronto';

import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { config, ROOT, UPLOAD_DIR } from './src/config.js';
import './src/db.js';
import { securityHeaders, loadSession } from './src/security.js';
import { ensureBrandAssets } from './src/brand.js';
import { bootstrapAdmin } from './scripts/create-admin.js';
import { router as seoRouter } from './src/routes/seo.js';
import { router as adminRouter } from './src/routes/admin.js';
import { router as publicRouter } from './src/routes/public.js';
import { startRadarSchedule } from './src/radar.js';
import { importContentIfEmpty } from './src/import-content.js';

await ensureBrandAssets();
importContentIfEmpty();
await bootstrapAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy || false);
app.set('etag', 'weak');

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.use(compression());
app.use(securityHeaders);

// Static assets: fingerprinted (?v=hash) or content-addressed, so cache aggressively.
const immutable = { maxAge: '1y', immutable: true, index: false, dotfiles: 'deny' };
app.use('/uploads', express.static(UPLOAD_DIR, { ...immutable, fallthrough: false }));
app.use(express.static(path.join(ROOT, 'public'), {
  index: false, dotfiles: 'deny',
  setHeaders: (res, file) => res.set('Cache-Control', /\.(css|js)$/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'),
}));

app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 100 }));
app.use(loadSession);

app.use(seoRouter);
app.use('/admin', adminRouter);
app.use(publicRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.status === 404 || err.statusCode === 404) return res.status(404).type('text/plain').send('Not found');
  console.error(err);
  res.status(err.status || 500).type('text/plain').send('Something went wrong.');
});

app.listen(config.port, '0.0.0.0', () => {
  startRadarSchedule();
  console.log(`Rumors running at http://localhost:${config.port}  (admin: /admin)`);
});


