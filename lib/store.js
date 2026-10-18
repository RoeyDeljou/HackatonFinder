/**
 * Tiny key-value layer. Production: Upstash Redis (REST, works on serverless).
 * Local/dev/tests: a JSON file under .data/ (single process only).
 * Values are JSON; hashes map field -> JSON value; sets hold strings.
 */
import { Redis } from '@upstash/redis';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'hf:';

function redisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

class RedisStore {
  constructor({ url, token }) {
    this.kind = 'redis';
    this.r = new Redis({ url, token, automaticDeserialization: false });
  }
  k(key) { return PREFIX + key; }
  async get(key) {
    const v = await this.r.get(this.k(key));
    return v == null ? null : JSON.parse(v);
  }
  async set(key, value, { ttlSec } = {}) {
    const v = JSON.stringify(value);
    if (ttlSec) await this.r.set(this.k(key), v, { ex: ttlSec });
    else await this.r.set(this.k(key), v);
  }
  /** Set only if absent. Returns true when the key was written. */
  async setNX(key, value, { ttlSec } = {}) {
    const res = await this.r.set(this.k(key), JSON.stringify(value), { nx: true, ...(ttlSec ? { ex: ttlSec } : {}) });
    return res === 'OK';
  }
  async del(key) { await this.r.del(this.k(key)); }
  async incr(key, by = 1, { ttlSec } = {}) {
    const n = await this.r.incrby(this.k(key), by);
    if (ttlSec) await this.r.expire(this.k(key), ttlSec);
    return n;
  }
  async hgetall(key) {
    const h = await this.r.hgetall(this.k(key));
    if (!h) return {};
    return Object.fromEntries(Object.entries(h).map(([f, v]) => [f, typeof v === 'string' ? JSON.parse(v) : v]));
  }
  async hset(key, obj) {
    const entries = Object.entries(obj);
    // Upstash request bodies are capped; write big hashes in chunks.
    for (let i = 0; i < entries.length; i += 200) {
      const chunk = Object.fromEntries(entries.slice(i, i + 200).map(([f, v]) => [f, JSON.stringify(v)]));
      await this.r.hset(this.k(key), chunk);
    }
  }
  async hdel(key, fields) {
    for (let i = 0; i < fields.length; i += 500) await this.r.hdel(this.k(key), ...fields.slice(i, i + 500));
  }
  async sadd(key, members) {
    if (!members.length) return;
    for (let i = 0; i < members.length; i += 500) await this.r.sadd(this.k(key), ...members.slice(i, i + 500));
  }
  async srem(key, members) {
    if (members.length) await this.r.srem(this.k(key), ...members);
  }
  async smembers(key) { return (await this.r.smembers(this.k(key))) || []; }
}

class FileStore {
  constructor(file) {
    this.kind = 'file';
    this.file = file;
    this.data = null;
  }
  load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    return this.data;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  entry(key) {
    const d = this.load();
    const e = d[key];
    if (e && e.exp && e.exp < Date.now()) { delete d[key]; return undefined; }
    return e;
  }
  async get(key) { return this.entry(key)?.v ?? null; }
  async set(key, value, { ttlSec } = {}) {
    this.load()[key] = { v: value, ...(ttlSec ? { exp: Date.now() + ttlSec * 1000 } : {}) };
    this.save();
  }
  async setNX(key, value, opts) {
    if (this.entry(key)) return false;
    await this.set(key, value, opts);
    return true;
  }
  async del(key) { delete this.load()[key]; this.save(); }
  async incr(key, by = 1, { ttlSec } = {}) {
    const n = (this.entry(key)?.v || 0) + by;
    await this.set(key, n, { ttlSec });
    return n;
  }
  async hgetall(key) { return { ...(this.entry(key)?.v || {}) }; }
  async hset(key, obj) {
    const d = this.load();
    d[key] = { v: { ...(this.entry(key)?.v || {}), ...structuredClone(obj) } };
    this.save();
  }
  async hdel(key, fields) {
    const h = this.entry(key)?.v;
    if (!h) return;
    for (const f of fields) delete h[f];
    this.save();
  }
  async sadd(key, members) {
    const d = this.load();
    const s = new Set(this.entry(key)?.v || []);
    members.forEach((m) => s.add(m));
    d[key] = { v: [...s] };
    this.save();
  }
  async srem(key, members) {
    const d = this.load();
    const s = new Set(this.entry(key)?.v || []);
    members.forEach((m) => s.delete(m));
    d[key] = { v: [...s] };
    this.save();
  }
  async smembers(key) { return [...(this.entry(key)?.v || [])]; }
}

let store;
export function getStore() {
  if (store) return store;
  const creds = redisCreds();
  if (creds) store = new RedisStore(creds);
  else store = new FileStore(process.env.DATA_FILE || path.join(process.cwd(), '.data', 'db.json'));
  return store;
}

/** For tests: swap in a fresh store. */
export function setStore(s) { store = s; }
export function createFileStore(file) { return new FileStore(file); }

/** True when running on Vercel without a real database configured. */
export function storageMisconfigured() {
  return !!process.env.VERCEL && !redisCreds();
}
