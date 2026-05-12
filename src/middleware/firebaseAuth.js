import admin from 'firebase-admin';

export function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      // On Cloud Run: Application Default Credentials are used automatically.
      // Locally: set GOOGLE_APPLICATION_CREDENTIALS env var.
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

/**
 * Express middleware — verifies Firebase ID token in Authorization header.
 * Attaches decoded token to req.user.
 * Routes can opt into anonymous access by checking req.user === null.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing auth token' } });
  }
  try {
    const token = header.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

/**
 * Soft auth — attaches user if token is present, continues if not.
 * Use for pre-auth value delivery (show case summary before OTP gate).
 */
export async function softAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = await admin.auth().verifyIdToken(header.slice(7));
    } catch (_) { req.user = null; }
  } else {
    req.user = null;
  }
  next();
}
