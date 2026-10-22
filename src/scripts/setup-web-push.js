/* Run once on each deployment. Never print keys or rotate existing credentials. */
require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const envPath = path.resolve(process.cwd(), '.env');
const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (!!process.env.VAPID_PUBLIC_KEY !== !!process.env.VAPID_PRIVATE_KEY) throw new Error('Both VAPID keys must be configured together. Existing values were preserved.');
if (!process.env.VAPID_PUBLIC_KEY) {
  const keys = webpush.generateVAPIDKeys();
  fs.appendFileSync(envPath, `\n# Web Push identity — keep private and stable across deployments\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`, { mode: 0o600 });
}
if (!process.env.VAPID_SUBJECT) fs.appendFileSync(envPath, '\nVAPID_SUBJECT=https://klevro.tech\n', { mode: 0o600 });
console.log('Web Push credentials are configured. No secrets were printed. Restart the backend to load them.');
