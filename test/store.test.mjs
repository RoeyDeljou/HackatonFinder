import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redisCreds, redisUrl } from '../lib/store.js';

test('finds Upstash REST credentials under any prefix', () => {
  assert.deepEqual(redisCreds({ KV_REST_API_URL: 'https://a.upstash.io', KV_REST_API_TOKEN: 't' }), { url: 'https://a.upstash.io', token: 't' });
  assert.deepEqual(redisCreds({ STORAGE_KV_REST_API_URL: 'https://b.upstash.io', STORAGE_KV_REST_API_TOKEN: 't2' }), { url: 'https://b.upstash.io', token: 't2' });
  assert.deepEqual(redisCreds({ UPSTASH_REDIS_REST_URL: ' "https://c.upstash.io" ', UPSTASH_REDIS_REST_TOKEN: 't3' }), { url: 'https://c.upstash.io', token: 't3' });
  assert.equal(redisCreds({ KV_REST_API_URL: 'https://a.upstash.io' }), null, 'needs token');
  assert.equal(redisCreds({ KV_REST_API_URL: 'redis://x', KV_REST_API_TOKEN: 't' }), null, 'needs https');
});

test('finds a plain Redis connection string', () => {
  assert.equal(redisUrl({ REDIS_URL: 'redis://default:pw@host:6379' }), 'redis://default:pw@host:6379');
  assert.equal(redisUrl({ HACKATHON_REDIS_URL: 'rediss://h:1' }), 'rediss://h:1');
  assert.equal(redisUrl({ KV_URL: 'rediss://k:1' }), 'rediss://k:1');
  assert.equal(redisUrl({ REDIS_URL: 'https://not-tcp' }), null);
  assert.equal(redisUrl({}), null);
});
