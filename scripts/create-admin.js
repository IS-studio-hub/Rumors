// Usage:
//   npm run create-admin -- <username>        (prompts for a password, creates or resets that user)
// On server start, if no admin exists and ADMIN_USER / ADMIN_PASSWORD are set in .env, that admin is created.
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { hashPassword } from '../src/security.js';

export async function upsertAdmin(username, password) {
  if (!/^[a-zA-Z0-9_.+@-]{3,80}$/.test(username)) throw new Error('Username must be 3–80 characters: letters, numbers, or . _ - + @ (an email address works).');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  } else db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
}

export async function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (count) return;
  const { ADMIN_USER, ADMIN_PASSWORD, ADMIN_PASSWORD_HASH } = process.env;
  // A ready-made scrypt hash (copied from a local install) means no plain password is stored on the host.
  if (ADMIN_USER && ADMIN_PASSWORD_HASH && /^scrypt\$/.test(ADMIN_PASSWORD_HASH)) {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(ADMIN_USER, ADMIN_PASSWORD_HASH);
    console.log(`Created admin user "${ADMIN_USER}" from environment.`);
  } else if (ADMIN_USER && ADMIN_PASSWORD) {
    await upsertAdmin(ADMIN_USER, ADMIN_PASSWORD);
    console.log(`Created admin user "${ADMIN_USER}" from environment.`);
  } else {
    console.warn('No admin user yet. Run: npm run create-admin -- <username>');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const username = process.argv[2];
  if (!username) { console.error('Usage: npm run create-admin -- <username>'); process.exit(1); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('Password')) rl.output.write(s); };
  rl.question('Password (min 12 chars): ', async (pw) => {
    rl.close();
    process.stdout.write('\n');
    try { await upsertAdmin(username, pw); console.log(`Admin "${username}" saved.`); }
    catch (e) { console.error(e.message); process.exit(1); }
  });
}
