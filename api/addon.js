// api/addon.js → Versión compatible con nombres completos + retrocompatibilidad con iniciales
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.type("application/json");
  next();
});

// FUNCIÓN QUE LEE LOS JSONs
function loadJSON(filename) {
  const filePath = path.resolve(process.cwd(), "public", filename);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filename}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// Prefer DB when DATABASE_URL is configured. Keep JSON as fallback.
const db = require('./db');
const useDb = Boolean(process.env.DATABASE_URL);
if (useDb) console.log('DB mode enabled: addon will read content from Postgres');

// MANIFEST (sin cambios)
const manifest = {
  id: "org.asianclub.addon",
  version: "0.0.2",
  name: "Asian Club",
  description: "Gems of Asian cinema in one place.",
  logo: "https://asian-club-production.up.railway.app/logo.png",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "asianclub_movies", name: "Asian Club" },
    { type: "series", id: "asianclub_series", name: "Asian Club" }
  ],
  idPrefixes: ["tt"]
};

// Public manifest endpoint (used by the admin UI to show addon version)
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// IMPORTA LOS SERVICIOS
const realDebrid = require("./services/realDebrid");
const allDebrid = require("./services/allDebrid");
const torbox = require("./services/torbox");

// Helper: safe cache version retrieval
async function safeGetVersion(ns) {
  try {
    const cache = require('./cache');
    return await cache.getVersion(ns);
  } catch (e) {
    console.warn('[cache] getVersion failed, falling back to 1', e && (e.message || e));
    return 1;
  }
}

// Build a catalog meta entry
async function buildCatalogMetaEntry(m) {
  return {
    id: m.id,
    type: 'movie',
    name: m.title || m.t || '',
    poster: m.poster || m.p || manifest.logo
  };
}

// Extract quality suffix from movie
function getQualitySuffix(m) {
  let qualities = [];
  if (m.quality) qualities = Array.isArray(m.quality) ? m.quality : m.quality.split("|").map(q => q.trim());
  else if (m.q) qualities = Array.isArray(m.q) ? m.q : m.q.split("|").map(q => q.trim());
  return qualities.length > 0 ? ` (${qualities.join(" / ")})` : "";
}

// Helper: build movie catalog with quality suffix
async function buildMovieCatalog() {
  let metas = [];
  if (useDb) {
    try {
      const rows = await db.listMovies(1000, 0);
      // Defensive: ensure rows are sorted by created_at desc (most recent first)
      if (rows && rows.length && rows[0].created_at !== undefined) {
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      for (const m of rows) metas.push(await buildCatalogMetaEntry(m));
    } catch (e) {
      console.warn('[db] listMovies failed, falling back to JSON', e && (e.message || e));
      for (const m of movies) metas.push(await buildCatalogMetaEntry(m));
    }
  } else {
    for (const m of movies) {
      const enriched = await buildCatalogMetaEntry(m);
      enriched.name = (enriched.name || '') + getQualitySuffix(m);
      metas.push(enriched);
    }
  }
  return metas;
}

// RUTAS
app.get("/:service(realdebrid|alldebrid|torbox)=:token/manifest.json", (req, res) => {
  res.json(manifest);
});

// Catalog movie - unified route supporting both /:service=:token and /local formats
app.get(["/:service(realdebrid|alldebrid|torbox)=:token/catalog/movie/asianclub_movies.json", "/catalog/movie/asianclub_movies.json"], async (req, res) => {
  const { token, service } = req.params;
  const cache = require('./cache');
  const isLocal = !service;
  const catalogNs = isLocal ? `catalog:local:movies` : `catalog:service:${service}:token:${token}`;
  const catalogVersion = await safeGetVersion(catalogNs);
  const cacheKey = `catalog:v:${catalogVersion}:movies:${isLocal ? 'local' : `service:${service}:token:${token}`}:all`;

  const cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);

  const metas = await buildMovieCatalog();
  const payload = { metas };
  await cache.set(cacheKey, payload, 1000 * 60 * 5);
  res.json(payload);
});



// Catalog series - unified route supporting both /:service=:token and /local formats
app.get(["/:service(realdebrid|alldebrid|torbox)=:token/catalog/series/asianclub_series.json", "/catalog/series/asianclub_series.json"], async (req, res) => {
  const { token, service } = req.params;
  const cache = require('./cache');
  const isLocal = !service;
  const cacheKey = `catalog:series:${isLocal ? 'local' : `service:${service}:token:${token}`}:all`;
  const cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);

  let metas = [];
  if (useDb) {
    try {
      const rows = await db.listSeries(1000, 0);
      metas = rows.map(s => ({ id: s.id, type: 'series', name: s.title || s.t || '', poster: s.poster || s.p || manifest.logo }));
    } catch (e) {
      console.warn('[db] listSeries failed, falling back to JSON', e && (e.message || e));
      metas = seriesList.map(s => ({ id: s.id, type: 'series', name: s.title || s.t || '', poster: s.poster || s.p || manifest.logo }));
    }
  } else {
    metas = seriesList.map(s => ({ id: s.id, type: 'series', name: s.title || s.t || '', poster: s.poster || s.p || manifest.logo }));
  }
  const payload = { metas };
  await cache.set(cacheKey, payload, 1000 * 60 * 5);
  res.json(payload);
});

// Meta movie
// Build meta object from a raw item (support full and abbreviated keys)
function buildMetaFromItem(m){
  if(!m) return null;
  return {
    id: m.id,
    type: 'movie',
    name: (m.title || m.t || '').toString(),
    poster: (m.poster || m.p || m.por || manifest.logo)
  };
}

// TMDB enrichment removed — addon will return minimal local meta only

// Meta movie - unified route supporting both /:service=:token and /local formats
app.get(["/:service(realdebrid|alldebrid|torbox)=:token/meta/movie/:id.json", "/meta/movie/:id.json"], async (req, res) => {
  const { token, service, id } = req.params;
  const cache = require('./cache');
  const isLocal = !service;
  const movieNs = `movie:${id}`;
  const metaVersion = await safeGetVersion(movieNs);
  const cacheKey = `meta:v:${metaVersion}:movie:${isLocal ? 'id' : `service:${service}:token:${token}:id`}:${id}`;

  const cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);
  
  let m = null;
  if (useDb) {
    try {
      m = await db.getMovieById(id);
    } catch (e) {
      console.warn('[db] getMovieById failed, falling back to JSON', e && (e.message || e));
      m = movies.find(x => x.id === id);
    }
  } else {
    m = movies.find(x => x.id === id);
  }

  let meta = null;
  if (m) meta = buildMetaFromItem(m);

  if (meta) {
    if (!meta.description && meta.overview) meta.description = meta.overview;
    if (!meta.backdrop && meta.background) meta.backdrop = meta.background;
    if (!meta.background && meta.backdrop) meta.background = meta.backdrop;
  }

  const payload = { meta };
  await cache.set(cacheKey, payload, 1000 * 60 * 10);
  res.json(payload);
});

// Meta series (sin cambios importantes)
app.get('/:service(realdebrid|alldebrid|torbox)=:token/meta/series/:id.json', async (req, res) => {
  const baseId = req.params.id.split(":")[0];
  let serie = null;
  if (useDb) {
    try {
      serie = await db.getSeriesById(baseId);
    } catch (e) {
      console.warn('[db] getSeriesById failed, falling back to JSON', e && (e.message || e));
      serie = seriesList.find(s => s.id === baseId);
    }
  } else {
    serie = seriesList.find(s => s.id === baseId);
  }
  if (!serie) return res.json({ meta: null });

  const seasonMap = {};
  if (useDb) {
    try {
      // list episodes and filter by series_id
      const allEps = await db.listEpisodes(1000, 0);
      allEps.filter(e => (e.series_id || '').toString() === baseId.toString()).forEach(e => {
        const s = String(e.season || 0);
        const ep = String(e.episode || 0);
        if (!seasonMap[s]) seasonMap[s] = [];
        seasonMap[s].push({ id: e.id, title: e.title || `Episodio ${ep}`, episode: Number(e.episode || 0) });
      });
    } catch (e) {
      console.warn('[db] listEpisodes failed, falling back to JSON', e && (e.message || e));
      episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
        const [, s, ep] = e.id.split(":");
        if (!seasonMap[s]) seasonMap[s] = [];
        seasonMap[s].push({ id: e.id, title: `Episodio ${ep}`, episode: +ep });
      });
    }
  } else {
    episodes.filter(e => e.id.startsWith(baseId + ":")).forEach(e => {
      const [, s, ep] = e.id.split(":");
      if (!seasonMap[s]) seasonMap[s] = [];
      seasonMap[s].push({ id: e.id, title: `Episodio ${ep}`, episode: +ep });
    });
  }

  const videos = {};
  Object.keys(seasonMap).sort((a, b) => a - b).forEach(s => {
    videos[s] = { "0": seasonMap[s].sort((a, b) => a.episode - b.episode) };
  });

  res.json({ meta: { id: baseId, type: 'series', name: serie.title || serie.t || '', poster: serie.poster || serie.p, videos } });
});

// STREAM - Lógica 100% mantenida, solo con soporte dual de campos
app.get("/:service(realdebrid|alldebrid|torbox)=:token/stream/:type/:id.json", async (req, res) => {
  const { service, token, type, id } = req.params;

  let item = null;
  if (useDb) {
    try {
      if (type === 'movie') item = await db.getMovieById(id);
      else item = await db.getEpisodeById(id);
    } catch (e) {
      console.warn('[db] getItem failed, falling back to JSON', e && (e.message || e));
      item = type === 'movie' ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
    }
  } else {
    item = type === 'movie' ? movies.find(m => m.id === id) : episodes.find(e => e.id === id);
  }
  if (!item) return res.json({ streams: [] });

  // Soporte dual para hash/h
  let hashes = [];
  if (item.hash) hashes = Array.isArray(item.hash) ? item.hash : item.hash.split("|").map(h => h.trim());
  else if (item.h) hashes = Array.isArray(item.h) ? item.h : item.h.split("|").map(h => h.trim());
  if (hashes.length === 0) return res.json({ streams: [] });

  // Soporte dual para quality/q
  let qualities = [];
  if (item.quality) qualities = Array.isArray(item.quality) ? item.quality : item.quality.split("|").map(q => q.trim());
  else if (item.q) qualities = Array.isArray(item.q) ? item.q : item.q.split("|").map(q => q.trim());

  // Ajustar longitudes
  while (qualities.length < hashes.length) qualities.push("Unknown");
  while (hashes.length < qualities.length) hashes.push(null);

  try {
    const cache = require('./cache');
    const movieNs = `movie:${id}`;
    const streamVersion = await safeGetVersion(movieNs);
    const streamCacheKey = `stream:v:${streamVersion}:service:${service}:token:${token}:type:${type}:id:${id}`;

    // Use getOrSet so concurrent requests coalesce into a single upstream fetch
    const computed = await cache.getOrSet(streamCacheKey, async () => {
      let streams = [];

      for (let i = 0; i < hashes.length; i++) {
        const currentHash = hashes[i];
        if (!currentHash) continue;

        const manualQuality = qualities[i] || "Unknown";

        let partialStreams = [];
        if (service === "realdebrid") {
          partialStreams = await realDebrid.getStream(token, currentHash, item);
        } else if (service === "alldebrid") {
          partialStreams = await allDebrid.getStream(token, currentHash, item);
        } else if (service === "torbox") {
          partialStreams = await torbox.getStream(token, currentHash, item);
        }

        if (!partialStreams || partialStreams.length === 0) continue;

        partialStreams = partialStreams.map(stream => {
          const filename = (stream.name || "").toLowerCase();
          let quality = manualQuality;

          // Detección automática como respaldo
          if (filename.includes("2160") || filename.includes("4k") || filename.includes("uhd")) quality = "4K";
          else if (filename.includes("1440") || filename.includes("2k")) quality = "1440p";
          else if (filename.includes("1080")) quality = "1080p";
          else if (filename.includes("720")) quality = "720p";

          // Soporte dual language/l
          const langRaw = item.language || item.l || "";
          const lang = langRaw.replace(/\|/g, "·").trim();

          const title = lang
            ? `${quality} · ${lang}`
            : `${quality}`;

          return {
            ...stream,
            title: title.trim()
          };
        });

        streams = streams.concat(partialStreams);
      }

      // Eliminar duplicados por URL
      const uniqueStreams = [];
      const seenUrls = new Set();
      for (const stream of streams) {
        if (stream.url && !seenUrls.has(stream.url)) {
          seenUrls.add(stream.url);
          uniqueStreams.push(stream);
        }
      }

      // devolver el valor para que getOrSet lo guarde
      return uniqueStreams;
    }, 1000 * 60 * 2); // 2 min TTL

    res.json({ streams: computed || [] });
  } catch (err) {
    console.error("ERROR STREAM:", err.response?.data || err.message);
    res.json({ streams: [] });
  }
});

module.exports = app;