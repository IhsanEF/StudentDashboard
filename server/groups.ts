import express from 'express';
import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

export const secureInvitePattern = /^LMS-[A-F0-9]{24}$/;
const newInvite = () => `LMS-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;

export function mountGroupRoutes(app: express.Express, dependencies: {
  authenticate: express.RequestHandler; db: () => Firestore;
  rateLimit: (key: string, limit: number, windowMs: number) => Promise<boolean>;
}) {
  const signedIn: express.RequestHandler = (req, res, next) => {
    const user = (req as any).user;
    if (!user || user.isDemo) { res.status(403).json({ error: 'Sign in to use group invitations.' }); return; }
    next();
  };
  const limits: express.RequestHandler = async (req, res, next) => {
    try {
      if (!await dependencies.rateLimit(`group_invites_${(req as any).user.uid}`, 10, 60000)) {
        res.status(429).json({ error: 'Too many invitation requests. Wait a minute and try again.' }); return;
      }
      next();
    } catch { res.status(503).json({ error: 'Invitations are temporarily unavailable.' }); }
  };
  app.post('/api/groups/join', dependencies.authenticate, signedIn, limits, express.json({ limit: '2kb' }), async (req: express.Request, res: express.Response) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'code') || typeof body.code !== 'string') {
      res.status(400).json({ error: 'Enter the invitation code shared by the group owner.' }); return;
    }
    const code = body.code.trim().toUpperCase();
    if (!secureInvitePattern.test(code)) {
      res.status(400).json({ error: 'Ask the group owner to copy a new secure invite code from Groups.' }); return;
    }
    try {
      const db = dependencies.db();
      const matches = await db.collection('groups').where('invite_code', '==', code).limit(2).get();
      if (matches.size !== 1) { res.status(404).json({ error: 'That invitation is unavailable. Ask the owner for the current code.' }); return; }
      const ref = matches.docs[0].ref;
      const user = (req as any).user;
      const result = await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref), group = snap.data();
        if (!snap.exists || !group || group.invite_code !== code || !Array.isArray(group.members)) return { status: 404 };
        if (group.members.includes(user.uid)) return { status: 200, id: ref.id };
        if (group.members.length >= 50) return { status: 409 };
        const displayName = typeof user.name === 'string' ? user.name.trim().slice(0, 200) : 'Student';
        transaction.update(ref, { members: [...group.members, user.uid],
          member_details: { ...group.member_details, [user.uid]: { uid: user.uid, displayName: displayName || 'Student', role: 'member' } },
          updated_at: new Date().toISOString() });
        return { status: 200, id: ref.id };
      });
      if (!result.id) { res.status(result.status).json({ error: result.status === 409 ? 'This group is full.' : 'That invitation is unavailable.' }); return; }
      // The SDK can read this document only after membership is committed.
      res.json({ groupId: result.id });
    } catch { res.status(503).json({ error: 'Could not join the group. Please try again.' }); }
  });
  app.post('/api/groups/invite', dependencies.authenticate, signedIn, limits, express.json({ limit: '2kb' }), async (req: express.Request, res: express.Response) => {
    const body = req.body;
    if (!body || Object.keys(body).some(key => key !== 'groupId') || typeof body.groupId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.groupId)) {
      res.status(400).json({ error: 'Choose a valid group.' }); return;
    }
    try {
      const ref = dependencies.db().collection('groups').doc(body.groupId);
      const result = await dependencies.db().runTransaction(async transaction => {
        const snap = await transaction.get(ref), group = snap.data(), uid = (req as any).user.uid;
        if (!snap.exists || group?.created_by !== uid || !group?.members?.includes(uid)) return null;
        const code = secureInvitePattern.test(group.invite_code) ? group.invite_code : newInvite();
        if (code !== group.invite_code) transaction.update(ref, { invite_code: code, updated_at: new Date().toISOString() });
        return code;
      });
      if (!result) { res.status(403).json({ error: 'Only the current group owner can upgrade the invite code.' }); return; }
      res.json({ code: result });
    } catch { res.status(503).json({ error: 'Could not upgrade the invitation. Please try again.' }); }
  });
  app.post('/api/groups/delete', dependencies.authenticate, signedIn, limits, express.json({ limit: '2kb' }), async (req: express.Request, res: express.Response) => {
    const body = req.body;
    if (!body || Object.keys(body).some(key => key !== 'groupId') || typeof body.groupId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.groupId)) {
      res.status(400).json({ error: 'Choose a valid group.' }); return;
    }
    try {
      const ref = dependencies.db().collection('groups').doc(body.groupId);
      const result = await dependencies.db().runTransaction(async transaction => {
        const snap = await transaction.get(ref), group = snap.data(), uid = (req as any).user.uid;
        if (!snap.exists || group?.created_by !== uid || !group?.members?.includes(uid)) return 'denied';
        // Select only references so large task bodies cannot exhaust server memory.
        // Keep the whole removal atomic; oversized groups are never partly deleted.
        const tasks = await transaction.get(ref.collection('tasks').select().limit(500));
        if (tasks.size > 499) return 'large';
        for (const task of tasks.docs) transaction.delete(task.ref);
        transaction.delete(ref);
        return 'deleted';
      });
      if (result === 'denied') { res.status(403).json({ error: 'Only the current group owner can delete the group.' }); return; }
      if (result === 'large') { res.status(409).json({ error: 'This group is too large to delete at once. Export your work and remove tasks in smaller batches first.' }); return; }
      res.json({ ok: true });
    } catch { res.status(503).json({ error: 'The group was not confirmed deleted. Please try again.' }); }
  });
  app.use(['/api/groups/join', '/api/groups/invite', '/api/groups/delete'], (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'The invitation request could not be processed.' });
  });
}
