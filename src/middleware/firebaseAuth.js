import admin from 'firebase-admin';

let firebaseReady = false;

export function initFirebase() {
  if (admin.apps.length) { firebaseReady = true; return; }
  try {
    // On Google Cloud Run: uses Application Default Credentials automatically.
    // On Render / local: set FIREBASE_SERVICE_ACCOUNT env var (JSON string of service account key).
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else {
      // Fallback: try Application Default Credentials (works on GCP, fails elsewhere)
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
    }
    firebaseReady = true;
    console.log(JSON.stringify({ severity: 'INFO', message: 'Firebase Admin initialised' }));
  } catch (err) {
    // Non-fatal on Render during development — auth routes will return 503
    firebaseReady = false;
    console.warn(JSON.stringify({ severity: 'WARNING', message: `Firebase Admin not initialised: ${err.message}` }));
  }
}

/**
 * Hard auth — requires a valid Firebase ID token.
 */
export async function requireAuth(req, res, next) {
  if (!firebaseReady) {
    return res.status(503).json({ success: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Auth service not configured on this instance' } });
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing auth token' } });
  }
  try {
    req.user = await admin.auth().verifyIdToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

/**
 * Soft auth — continues even if Firebase isn't configured or token is absent.
 */
export async function softAuth(req, _res, next) {
  if (!firebaseReady) { req.user = null; return next(); }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { req.user = await admin.auth().verifyIdToken(header.slice(7)); }
    catch { req.user = null; }
  } else {
    req.user = null;
  }
  next();
}
