import express from 'express';
import { initFirebase } from './middleware/firebaseAuth.js';
import { voiceTriageRouter } from './routes/voiceTriage.js';
import { documentAuditRouter } from './routes/documentAudit.js';
import { citationVerifierRouter } from './routes/citationVerifier.js';

const app = express();
const PORT = process.env.PORT || 8080;

// ── Firebase Admin init ───────────────────────────────────────────────────────
initFirebase();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));  // base64 documents can be large
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// CORS — restrict to app origins in production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',');
  if (!origin || allowed.includes(origin) || process.env.NODE_ENV === 'development') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Version');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Request logger (structured for Cloud Logging)
app.use((req, _res, next) => {
  console.log(JSON.stringify({
    severity: 'INFO',
    message: `${req.method} ${req.path}`,
    httpRequest: { method: req.method, requestUrl: req.path, userAgent: req.headers['user-agent'] },
  }));
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'ok', service: 'nyaayasetu-backend' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/v1/triage', voiceTriageRouter);
app.use('/v1/audit',  documentAuditRouter);
app.use('/v1/verify', citationVerifierRouter);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ severity: 'ERROR', message: err.message, stack: err.stack }));
  res.status(err.status || 500).json({
    success: false,
    error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' }
  });
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: `NyaayaSetu backend listening on :${PORT}` }));
});
