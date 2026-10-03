import assert from 'node:assert/strict';
import { readFileSync, accessSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const app = read('firebase-applet-config.json');
const config = read('firebase.json');
assert.equal(read('.firebaserc').projects.default, app.projectId);
assert.deepEqual(config.firestore, [{ database: app.firestoreDatabaseId, rules: 'firestore.rules' }]);
accessSync(new URL('../firestore.rules', import.meta.url));
console.log('Firestore deployment targets the client/server project and named database.');
