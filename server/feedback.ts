import express from 'express';
import crypto from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { validateFeedback } from '../shared/feedback';

export function mountFeedbackRoutes(app: express.Express, dependencies: {
  authenticate: express.RequestHandler;
  db: () => Firestore;
  rateLimit: (key: string, limit: number, windowMs: number) => Promise<boolean>;
}) {
  app.post('/api/feedback', dependencies.authenticate, express.json({ limit: '24kb' }), async (req: express.Request, res: express.Response) => {
    const user = (req as express.Request & { user?: { uid: string; isDemo?: boolean } }).user;
    if (!user || user.isDemo) { res.status(403).json({ error: 'Sign in to send feedback. Demo feedback is not submitted.' }); return; }
    const payload = validateFeedback(req.body);
    if (!payload) { res.status(400).json({ error: 'Check your feedback category and message (5–4,000 characters).' }); return; }
    // The caller cannot set the reporter, status or app version. A stable request
    // ID makes a retry after a lost response safe, including across deployments.
    const id = crypto.createHash('sha256').update(`${user.uid}:${payload.requestId}`).digest('hex');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    try {
      const ref = dependencies.db().collection('feedback_submissions').doc(id);
      const existing = await ref.get();
      if (existing.exists) {
        if (existing.data()?.fingerprint !== fingerprint) { res.status(409).json({ error: 'This submission changed. Please send it as a new message.' }); return; }
        res.json({ ok: true, id, status: existing.data()?.status || 'new' }); return;
      }
      if (!await dependencies.rateLimit(`feedback_${user.uid}`, 5, 60 * 60 * 1000)) {
        res.status(429).json({ error: 'You have sent several messages. Please try again in an hour.' }); return;
      }
      const created = await dependencies.db().runTransaction(async transaction => {
        const current = await transaction.get(ref);
        if (current.exists) return current.data()?.fingerprint === fingerprint ? 'existing' : 'conflict';
        transaction.set(ref, {
          reporterId: crypto.createHash('sha256').update(`feedback-reporter:${user.uid}`).digest('hex'),
          category: payload.category, message: payload.message,
          steps: payload.steps, severity: payload.severity, status: 'new', fingerprint,
          ...(payload.context ? { context: { ...payload.context, appVersion: (process.env.RENDER_GIT_COMMIT || 'development').slice(0, 12) } } : {}),
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        });
        return 'created';
      });
      if (created === 'conflict') { res.status(409).json({ error: 'This submission changed. Please send it as a new message.' }); return; }
      // Content and reporter identifiers stay in private storage, never in logs.
      console.info(JSON.stringify({ type: 'FEEDBACK_RECEIVED', id, category: payload.category }));
      res.status(created === 'created' ? 201 : 200).json({ ok: true, id, status: 'new' });
    } catch {
      console.warn('[FEEDBACK_STORAGE_ERROR] Could not save a feedback submission');
      res.status(503).json({ error: 'Feedback could not be saved. Your message is still here; please try again.' });
    }
  }, (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Body-parser errors can carry the submitted text. Keep them out of the
    // application's generic error logger as well as the response.
    const status = error.type === 'entity.too.large' ? 413
      : ['charset.unsupported', 'encoding.unsupported'].includes(error.type) ? 415
      : ['entity.parse.failed', 'request.aborted', 'request.size.invalid'].includes(error.type) ? 400 : 500;
    res.status(status).json({ error: 'Feedback could not be processed. Check your message and try again.' });
  });
}

export async function sweepExpiredFeedback(db: Firestore) {
  const expired = await db.collection('feedback_submissions').where('expiresAt', '<=', new Date()).limit(100).get();
  if (expired.empty) return;
  const batch = db.batch();
  for (const document of expired.docs) batch.delete(document.ref);
  await batch.commit();
}
