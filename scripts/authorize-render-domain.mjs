import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applicationDefault } from 'firebase-admin/app';

const dashboardHost = 'studentdashboardlms.onrender.com';
const dashboardProject = 'gen-lang-client-0442042800';

// Run with the deployment's existing identity. Google still enforces its IAM
// permissions; this never creates credentials or changes access roles.
export async function authorizeRenderDomain({ projectId, hostname, credential, request = fetch }) {
  if (projectId !== dashboardProject || hostname !== dashboardHost) return 'skipped';
  const token = await credential.getAccessToken();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  const read = await request(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!read.ok) throw new Error(`Config read rejected (${read.status})`);
  const config = await read.json();
  if (!Array.isArray(config.authorizedDomains) || !config.authorizedDomains.every(domain => typeof domain === 'string')) {
    throw new Error('Invalid authorized domain configuration');
  }
  if (config.authorizedDomains.includes(dashboardHost)) return 'already-authorized';
  const update = await request(`${url}?updateMask=authorizedDomains`, {
    method: 'PATCH', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ authorizedDomains: [...config.authorizedDomains, dashboardHost] })
  });
  if (!update.ok) throw new Error(`Config update rejected (${update.status})`);
  const result = await update.json();
  if (!result.authorizedDomains?.includes(dashboardHost)) throw new Error('Domain update was not confirmed');
  return 'authorized';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  try {
    const status = await authorizeRenderDomain({ projectId: config.projectId,
      hostname: process.env.RENDER_EXTERNAL_HOSTNAME, credential: applicationDefault() });
    console.info(`[FIREBASE_AUTH_DOMAIN] ${status}`);
  } catch (error) {
    // Never log OAuth tokens or private project configuration. Keep the current
    // dashboard available if this identity does not have configuration access.
    const message = error.message?.startsWith('Config ') || error.message === 'Domain update was not confirmed'
      ? error.message : 'Existing deployment credentials could not configure authentication';
    console.warn(`[FIREBASE_AUTH_DOMAIN_ERROR] ${message}`);
  }
}
