import type { Firestore } from 'firebase-admin/firestore';
export async function sweepAiUsage(db: Firestore) {
  for (const collection of ['ai_daily_usage', 'ai_rate_usage']) {
    const expired = await db.collection(collection).where('expiresAt', '<=', new Date()).limit(100).get();
    await Promise.all(expired.docs.map(document => db.runTransaction(async transaction => {
      const current = await transaction.get(document.ref);
      if (current.data()?.expiresAt?.toMillis() <= Date.now()) transaction.delete(document.ref);
    })));
  }
}
