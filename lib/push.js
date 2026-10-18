import webpush from 'web-push';

let configured = false;

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
}

/** Test hook: replace the sender. */
let sender = null;
export function setPushSender(fn) { sender = fn; }

/**
 * Sends one notification. Returns 'sent' | 'gone' (subscription expired and
 * should be deleted) | 'failed' | 'disabled'.
 */
export async function sendPush(subscription, payload) {
  if (!subscription?.endpoint) return 'failed';
  if (sender) return sender(subscription, payload);
  if (!pushConfigured()) return 'disabled';
  configure();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: 'high' });
    return 'sent';
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return 'gone';
    console.error('push failed', e.statusCode, e.body || e.message);
    return 'failed';
  }
}
