const LRU = require('lru-cache');
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const defaultTtlMs = 1000 * 60 * 5; // 5 minutes default

// In-process inflight map for request coalescing (per instance)
const inflight = new Map();

// Local metrics counters (per-process)
const localMetrics = { gets: 0, hits: 0, misses: 0, sets: 0, dels: 0, coalesced: 0 };

// Helper for namespaced version keys
function versionKey(ns) { return `version:${ns}`; }

// If Upstash env vars provided, use Redis; otherwise fallback to in-memory LRU
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

  // Metric helpers (persisted in Upstash + mirrored in localMetrics)
  async function incrMetric(name) {
    try {
      localMetrics[name] = (localMetrics[name] || 0) + 1;
      // fire-and-forget the redis increment to avoid blocking critical path
      redis.incr(`metrics:cache:${name}`).catch(e => console.error('Metric incr error', e && (e.stack || e)));
    } catch (e) {
      console.error('incrMetric error', e && (e.stack || e));
    }
  }

  async function getMetrics() {
    try {
      const keys = ['gets','hits','misses','sets','dels','coalesced'];
      const out = {};
      for (const k of keys) {
        const v = await redis.get(`metrics:cache:${k}`);
        out[k] = Number(v) || 0;
      }
      out._local = { ...localMetrics };
      return out;
    } catch (e) {
      console.error('getMetrics error', e && (e.stack || e));
      return { _local: { ...localMetrics } };
    }
  }

  // Key helpers: normalize parts and produce a fixed-length hashed key
  function normalizePart(p) {
    if (p == null) return '';
    if (typeof p === 'object') {
      try { return JSON.stringify(p); } catch (e) { return String(p); }
    }
    return String(p).trim();
  }

  function buildRawKey(ns, parts) {
    const arr = Array.isArray(parts) ? parts : [parts];
    return ns + '|' + arr.map(normalizePart).join('|');
  }

  function hashKey(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // Negative cache helper: store a marker object to indicate upstream failure
  async function setNegative(key, errObj, ttl = 30 * 1000) {
    const payload = { __negative: true, error: { message: errObj && errObj.message ? errObj.message : String(errObj) }, ts: Date.now() };
    await set(key, payload, ttl);
  }

  // Distributed lock + negative-cache + polling/backoff to avoid stampedes
  async function getOrSetWithLock(ns, parts, fetcher, opts = {}) {
    const ttl = opts.ttl ?? defaultTtlMs;
    const negativeTtl = opts.negativeTtl ?? 30 * 1000; // 30s default for negative cache
    const lockTtl = Math.ceil((opts.lockTtlMs ?? 15 * 1000) / 1000); // seconds
    const waitTimeout = opts.waitTimeoutMs ?? 10 * 1000;
    const pollInterval = opts.pollIntervalMs ?? 200;

    const raw = buildRawKey(ns, parts);
    const key = `cache:${hashKey(raw)}`;
    const lockKey = `${key}:lock`;

    // Fast path: existing value
    const existing = await get(key);
    if (existing != null) return existing;

    // In-process coalescing
    if (inflight.has(key)) { incrMetric('coalesced'); return inflight.get(key); }

    // Try to acquire distributed lock
    let lockAcquired = false;
    try {
      const res = await redis.set(lockKey, '1', { nx: true, ex: lockTtl });
      lockAcquired = !!res;
    } catch (e) {
      // if lock operation fails, fall back to polling
      console.error('lock set error', e && (e.stack || e));
    }

    if (lockAcquired) {
      const p = (async () => {
        try {
          // Fetch with simple retry/backoff
          const maxAttempts = Math.max(1, opts.maxAttempts || 3);
          let attempt = 0;
          let lastErr = null;
          while (attempt < maxAttempts) {
            try {
              const val = await fetcher();
              if (val != null) {
                await set(key, val, ttl);
                return val;
              }
              // treat null as failure to avoid caching empties
              lastErr = new Error('fetcher returned null/undefined');
            } catch (e) {
              lastErr = e;
            }
            attempt++;
            // exponential backoff with jitter
            const backoff = Math.min(2000, Math.pow(2, attempt) * 100) + Math.floor(Math.random() * 100);
            await new Promise(r => setTimeout(r, backoff));
          }
          // on repeated failure, negative-cache to avoid stampede
          await setNegative(key, lastErr || 'fetch-failed', negativeTtl);
          return null;
        } finally {
          try { await redis.del(lockKey); } catch (e) { /* best-effort */ }
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    }

    // Lock not acquired -> poll until another instance sets the value or timeout
    const waitP = (async () => {
      const start = Date.now();
      while (Date.now() - start < waitTimeout) {
        await new Promise(r => setTimeout(r, pollInterval + Math.floor(Math.random() * 50)));
        const v = await get(key);
        if (v != null) return v;
      }
      // timeout -> give up
      return null;
    })();
    inflight.set(key, waitP);
    return waitP;
  }

  async function scanDel(pattern) {
    let cursor = 0;
    do {
      const res = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = res.cursor;
      if (res.keys && res.keys.length) await redis.del(...res.keys);
    } while (cursor !== 0);
  }

  async function get(key) {
    await incrMetric('gets');
    const v = await redis.get(key);
    if (v == null) {
      // missed the cache
      await incrMetric('misses');
      return null;
    }
    await incrMetric('hits');
    // Upstash client sometimes returns already-parsed objects; handle both cases
    if (typeof v === 'string') {
      try { return JSON.parse(v); }
      catch (e) {
        console.error('Cache JSON parse error for key', key, e && (e.stack || e));
        return v;
      }
    }
    return v;
  }

  async function set(key, value, ttl = defaultTtlMs) {
    await incrMetric('sets');
    const val = JSON.stringify(value);
    if (ttl) await redis.set(key, val, { ex: Math.ceil(ttl / 1000) });
    else await redis.set(key, val);
  }

  async function del(key) { await (async () => { await incrMetric('dels'); await redis.del(key); })(); }
  async function delPattern(pattern) { await scanDel(pattern); }
  async function clear() { await redis.flushdb(); }

  // Request coalescing: only one fetcher active per key
  async function getOrSet(key, fetcher, ttl = defaultTtlMs) {
    const existing = await get(key);
    if (existing != null) return existing;
    if (inflight.has(key)) {
      // another request is already fetching this key; count coalesced
      incrMetric('coalesced');
      return inflight.get(key);
    }
    const p = (async () => {
      try {
        const val = await fetcher();
        if (val != null) await set(key, val, ttl);
        return val;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  // Version helpers - avoid expensive pattern deletes
  async function getVersion(ns) {
    const k = versionKey(ns);
    const v = await redis.get(k);
    if (!v) {
      // initialize version key to 1 so future bumps increment
      await redis.set(k, '1');
      return 1;
    }
    return Number(v) || 1;
  }

  async function bumpVersion(ns) {
    const newV = await redis.incr(versionKey(ns));
    return Number(newV);
  }

  module.exports = { get, set, del, delPattern, clear, getOrSet, getOrSetWithLock, setNegative, getVersion, bumpVersion, getMetrics };
} else {
  // Fallback LRU in-memory with async API
  const LRUModule = LRU;
  const LRUClass = LRUModule && (LRUModule.LRUCache || LRUModule.default || LRUModule);
  const cache = new LRUClass({ max: 2000, ttl: defaultTtlMs });

  // Local metric helpers (LRU-only): increments local counters
  function incrMetric(name) {
    localMetrics[name] = (localMetrics[name] || 0) + 1;
  }
  async function getMetrics() { return { ...localMetrics }; }
  
  // Key helpers for LRU fallback (same normalization & hashing)
  function normalizePart(p) {
    if (p == null) return '';
    if (typeof p === 'object') {
      try { return JSON.stringify(p); } catch (e) { return String(p); }
    }
    return String(p).trim();
  }

  function buildRawKey(ns, parts) {
    const arr = Array.isArray(parts) ? parts : [parts];
    return ns + '|' + arr.map(normalizePart).join('|');
  }

  function hashKey(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async function setNegative(key, errObj, ttl = 30 * 1000) {
    const payload = { __negative: true, error: { message: errObj && errObj.message ? errObj.message : String(errObj) }, ts: Date.now() };
    await set(key, payload, ttl);
  }

  // Simplified getOrSetWithLock for single-process LRU fallback
  async function getOrSetWithLock(ns, parts, fetcher, opts = {}) {
    const ttl = opts.ttl ?? defaultTtlMs;
    const raw = buildRawKey(ns, parts);
    const key = `cache:${hashKey(raw)}`;
    // Use existing in-process coalescing/getOrSet
    return getOrSet(key, fetcher, ttl);
  }

  async function get(key) { incrMetric('gets'); const v = cache.get(key); if (v == null) { incrMetric('misses'); } else { incrMetric('hits'); } return v; }
  async function set(key, value, ttl = defaultTtlMs) { incrMetric('sets'); cache.set(key, value, { ttl }); }
  async function del(key) { incrMetric('dels'); cache.delete(key); }
  async function delPattern(pattern) {
    // simple contains-based pattern (supports '*')
    const needle = pattern.replace(/\*/g, '');
    for (const k of cache.keys()) if (k.includes(needle)) cache.delete(k);
  }
  async function clear() { cache.clear(); }
  // Request coalescing (per-process)
  async function getOrSet(key, fetcher, ttl = defaultTtlMs) {
    const existing = await get(key);
    if (existing != null) return existing;
    if (inflight.has(key)) {
      incrMetric('coalesced');
      return inflight.get(key);
    }
    const p = (async () => {
      try {
        const val = await fetcher();
        if (val != null) await set(key, val, ttl);
        return val;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  // Version helpers
  async function getVersion(ns) {
    const v = cache.get(versionKey(ns));
    if (!v) return 1;
    return Number(v) || 1;
  }

  async function bumpVersion(ns) {
    const cur = await getVersion(ns);
    const next = cur + 1;
    cache.set(versionKey(ns), next);
    return next;
  }

  module.exports = { get, set, del, delPattern, clear, getOrSet, getOrSetWithLock, setNegative, getVersion, bumpVersion, getMetrics };
}
