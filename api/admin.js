const express = require('express');
const router = express.Router();
const cache = require('./cache');
const db = require('./db');

// Parse JSON bodies for admin routes
router.use(express.json());

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';

// Optional Firebase Admin integration: if available, allow exchanging a Firebase ID token
// for the admin token. Provide `FIREBASE_SERVICE_ACCOUNT` (JSON) or set
// GOOGLE_APPLICATION_CREDENTIALS in the environment to enable verification.
let firebaseAdmin = null;
try{
  const fadmin = require('firebase-admin');
  // initialize if credentials are provided
  if(!fadmin.apps || fadmin.apps.length === 0){
    // Only initialize firebase-admin when explicit credentials are provided
    if(process.env.FIREBASE_SERVICE_ACCOUNT){
      const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      fadmin.initializeApp({ credential: fadmin.credential.cert(svc) });
      firebaseAdmin = fadmin;
    } else if(process.env.GOOGLE_APPLICATION_CREDENTIALS){
      // rely on ADC via GOOGLE_APPLICATION_CREDENTIALS
      try{
        fadmin.initializeApp();
        firebaseAdmin = fadmin;
      }catch(e){
        console.error('firebase-admin init via ADC failed:', e && (e.stack || e));
        firebaseAdmin = null;
      }
    } else {
      // No credentials provided; do not initialize — keep firebaseAdmin null
      firebaseAdmin = null;
    }
  } else {
    // already initialized by other codepaths
    firebaseAdmin = fadmin;
  }
}catch(e){
  // firebase-admin not available or failed to init — issue-token route will return 501
  firebaseAdmin = null;
}

// Exchange Firebase ID token for admin token
router.post('/issue-token', express.json(), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const idToken = (authHeader.match(/^Bearer\s+(.+)$/i) || [])[1] || req.body && req.body.idToken;
  if(!idToken) return res.status(400).json({ error: 'idToken required' });
  if(!firebaseAdmin) return res.status(501).json({ error: 'firebase-admin-not-configured' });
  try{
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const allowed = process.env.ADMIN_ALLOWED_EMAILS;
    if(allowed){
      const allowedArr = allowed.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if(!decoded.email || !allowedArr.includes(decoded.email.toLowerCase())){
        return res.status(403).json({ error: 'forbidden' });
      }
    }
    // success — return the server-side admin token for client to store
    return res.json({ admin_token: ADMIN_TOKEN, uid: decoded.uid, email: decoded.email });
  }catch(err){
    console.error('issue-token verify error:', err && (err.stack || err));
    return res.status(401).json({ error: 'invalid_id_token' });
  }
});

// TMDB / IMDb search proxy (no auth) mounted before token middleware
try{
  const imdbRouter = require('./imdb');
  router.use('/imdb', imdbRouter);
}catch(e){
  console.warn('Failed to mount imdb proxy:', e && (e.stack || e));
}

// Simple token-based protection (header x-admin-token) for remaining admin routes
router.use((req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// Revalidate endpoint
// POST /admin/revalidate { key?: string, movie?: string, all?: boolean }
router.post('/revalidate', async (req, res) => {
  const { key, all, movie } = req.body || {};
  try {
    if (all) {
      await cache.clear();
      return res.json({ ok: true, cleared: 'all' });
    }
    if (movie) {
      // bump the version for this movie namespace so old keys become stale
      const newVersion = await cache.bumpVersion(`movie:${movie}`);
      return res.json({ ok: true, invalidated: movie, newVersion });
    }
    if (!key) return res.status(400).json({ error: 'movie or key or all required' });
    await cache.del(key);
    return res.json({ ok: true, invalidated: key });
  } catch (err) {
    console.error('Revalidate error:', err && (err.stack || err));
    res.status(500).json({ error: 'internal_error' });
  }
});

// Cache connectivity test
// GET /admin/cache/test -> runs a small set/get/del test and returns backend info
router.get('/cache/test', async (req, res) => {
  try {
    const backend = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'lru';
    const k = `__cache_test__${Date.now()}`;
    await cache.set(k, { ts: Date.now() }, 5000);
    const v = await cache.get(k);
    await cache.del(k);

    // Prepare a safe representation of the cached value to avoid JSON serialization errors
    let safe;
    try {
      safe = JSON.parse(JSON.stringify(v));
    } catch (e) {
      safe = `__UNSERIALIZABLE__:${typeof v}:${String(v)}`;
    }

    res.json({ ok: true, backend, setValue: safe, rawType: typeof v });
  } catch (err) {
    console.error('Cache test error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

// Cache metrics/status
// GET /admin/cache/status -> returns metrics (hits/misses/gets/sets/dels/coalesced)
router.get('/cache/status', async (req, res) => {
  try {
    const backend = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ? 'upstash' : 'lru';
    const metrics = await cache.getMetrics();
    res.json({ ok: true, backend, metrics });
  } catch (err) {
    console.error('Cache status error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

// DB: initialize schema
router.post('/db/init', async (req, res) => {
  try {
    await db.init();
    res.json({ ok: true });
  } catch (err) {
    console.error('DB init error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

// DB: movies CRUD
router.get('/db/movies', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const offset = parseInt(req.query.offset || '0');
    const rows = await db.listMovies(limit, offset);
    res.json({ ok: true, movies: rows });
  } catch (err) {
    console.error('DB listMovies error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.post('/db/movies', async (req, res) => {
  try {
    const m = req.body || {};
    console.log('[admin] POST /db/movies incoming, id=', m.id, 'hasToken=', !!req.headers['x-admin-token']);
    if (!m.id) return res.status(400).json({ ok: false, error: 'id required' });
    await db.createMovie(m);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB createMovie error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.get('/db/movies/:id', async (req, res) => {
  try {
    const row = await db.getMovieById(req.params.id);
    res.json({ ok: true, movie: row });
  } catch (err) {
    console.error('DB getMovie error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.put('/db/movies/:id', async (req, res) => {
  try {
    const m = req.body || {};
    await db.updateMovie(req.params.id, m);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB updateMovie error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.delete('/db/movies/:id', async (req, res) => {
  try {
    await db.deleteMovie(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB deleteMovie error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

// Series CRUD endpoints
router.get('/db/series', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const offset = parseInt(req.query.offset || '0');
    const rows = await db.listSeries(limit, offset);
    res.json({ ok: true, series: rows });
  } catch (err) {
    console.error('DB listSeries error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.post('/db/series', async (req, res) => {
  try {
    const s = req.body || {};
    console.log('[admin] POST /db/series incoming, id=', s.id, 'hasToken=', !!req.headers['x-admin-token']);
    if (!s.id) return res.status(400).json({ ok: false, error: 'id required' });
    await db.createSeries(s);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB createSeries error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.get('/db/series/:id', async (req, res) => {
  try {
    const row = await db.getSeriesById(req.params.id);
    res.json({ ok: true, series: row });
  } catch (err) {
    console.error('DB getSeries error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.put('/db/series/:id', async (req, res) => {
  try {
    const s = req.body || {};
    await db.updateSeries(req.params.id, s);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB updateSeries error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.delete('/db/series/:id', async (req, res) => {
  try {
    await db.deleteSeries(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB deleteSeries error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

// Episodes CRUD endpoints
router.get('/db/episodes', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200');
    const offset = parseInt(req.query.offset || '0');
    const rows = await db.listEpisodes(limit, offset);
    res.json({ ok: true, episodes: rows });
  } catch (err) {
    console.error('DB listEpisodes error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.post('/db/episodes', async (req, res) => {
  try {
    const e = req.body || {};
    console.log('[admin] POST /db/episodes incoming, id=', e.id, 'hasToken=', !!req.headers['x-admin-token']);
    if (!e.id) return res.status(400).json({ ok: false, error: 'id required' });
    await db.createEpisode(e);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB createEpisode error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.get('/db/episodes/:id', async (req, res) => {
  try {
    const row = await db.getEpisodeById(req.params.id);
    res.json({ ok: true, episode: row });
  } catch (err) {
    console.error('DB getEpisode error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.put('/db/episodes/:id', async (req, res) => {
  try {
    const e = req.body || {};
    await db.updateEpisode(req.params.id, e);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB updateEpisode error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

router.delete('/db/episodes/:id', async (req, res) => {
  try {
    await db.deleteEpisode(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB deleteEpisode error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: err && (err.message || String(err)) });
  }
});

module.exports = router;
