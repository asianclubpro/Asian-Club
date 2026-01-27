const express = require('express');
const router = express.Router();

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w500';

async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('tmdb error: '+res.status);
  return res.json();
}

// GET /admin/imdb/search?q=...
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if(!q) return res.status(400).json({ error: 'q required' });
  try{
    // Perform two searches: one forcing English results, and a fallback without language.
    const urlEn = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&page=1&include_adult=false&language=en-US`;
    const urlFallback = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&page=1&include_adult=false`;

    const [dataEn, dataFallback] = await Promise.all([fetchJson(urlEn).catch(()=>({ results: [] })), fetchJson(urlFallback).catch(()=>({ results: [] }))]);

    const map = new Map();
    const pushToMap = (r, sourceIsEn) => {
      if(!r) return;
      const media = r.media_type;
      if(media !== 'movie' && media !== 'tv') return;
      const key = `${media}:${r.id}`;
      const existing = map.get(key);
      // Prefer English-source entry but keep fallback if missing
      if(!existing) map.set(key, { r, sourceIsEn });
      else if(sourceIsEn && !existing.sourceIsEn) map.set(key, { r, sourceIsEn });
    };

    (dataFallback.results || []).forEach(r => pushToMap(r, false));
    (dataEn.results || []).forEach(r => pushToMap(r, true));

    // Also always include searches in common Asian locales so original titles are discoverable
    const LANGS = ['ko-KR', 'ja-JP', 'zh-CN'];
    const extraResults = await Promise.all(LANGS.map(async (lang) => {
      try{
        const url = `${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&page=1&include_adult=false&language=${lang}`;
        const d = await fetchJson(url).catch(()=>({ results: [] }));
        return d.results || [];
      }catch(e){ return []; }
    }));
    for (const arr of extraResults) { (arr || []).forEach(r => pushToMap(r, false)); }

    let combined = Array.from(map.values()).map(v => v.r);
    // limit after merging all locales
    combined = combined.slice(0, 40);

    // For each result, fetch external_ids to obtain imdb_id (if available)
    const enriched = await Promise.all(combined.map(async r => {
      try{
        const media = r.media_type; // 'movie' | 'tv'
        const extUrl = `${TMDB_BASE}/${media}/${r.id}/external_ids?api_key=${TMDB_KEY}`;
        const ext = await fetchJson(extUrl).catch(()=>null);
        const posterPath = r.poster_path || r.profile_path || null;
        const poster_url = posterPath ? (TMDB_IMG_BASE + posterPath) : null;
        // Fetch English details to obtain the english/localized title when available
        let english_title = r.title || r.name || '';
        try{
          const detailsUrl = `${TMDB_BASE}/${media}/${r.id}?api_key=${TMDB_KEY}&language=en-US`;
          const details = await fetchJson(detailsUrl).catch(()=>null);
          if(details){
            english_title = details.title || details.name || english_title;
            // include popularity and vote_count for better ranking
            r._popularity = details.popularity || 0;
            r._vote_count = details.vote_count || 0;
            // prefer release_date from details if present
            if(details.release_date || details.first_air_date) r._release_date = details.release_date || details.first_air_date;
          }
        }catch(e){ /* ignore */ }
        const original_title = r.original_title || r.original_name || '';
        const original_language = r.original_language || '';
        return {
          title: english_title,
          original_title,
          original_language,
          year: (r._release_date || r.release_date || r.first_air_date || '').split('-')[0] || '',
          popularity: r._popularity || 0,
          vote_count: r._vote_count || 0,
          tmdb_id: r.id,
          imdb_id: ext && ext.imdb_id ? ext.imdb_id : null,
          media_type: media,
          overview: r.overview || '',
          poster_path: posterPath,
          poster_url
        };
      }catch(e){
        return null;
      }
    }));
    const filtered = enriched.filter(Boolean);
    // Prepare normalized query for promotion-only reordering (no scoring sort)
    const qnorm = q.toLowerCase().trim();
    // normalize helper: remove diacritics, punctuation and collapse spaces
    function normalizeText(s){
      if(!s) return '';
      // remove accents
      const noAcc = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      // remove punctuation, keep alphanumerics and spaces
      const cleaned = noAcc.replace(/[^\p{L}\p{N} ]+/gu, ' ');
      return cleaned.replace(/\s+/g, ' ').trim().toLowerCase();
    }
    const qnormFull = normalizeText(qnorm);
    // Final promotion pass: if any result has an exact normalized title match (english or original),
    // promote those to the top preserving their relative order. Otherwise, promote results that
    // contain all query words across title/original_title.
    const seen = new Set();
    const norm = (s) => normalizeText(s || '');
    const exactMatches = filtered.filter(it => {
      const tq = qnormFull;
      return norm(it.title) === tq || norm(it.original_title) === tq;
    });
    exactMatches.forEach(it => seen.add(it.tmdb_id + '|' + (it.imdb_id || '')));

    let finalResults = [];
    if (exactMatches.length > 0) {
      finalResults = finalResults.concat(exactMatches);
      // append remaining in previous order
      for (const it of filtered) {
        const key = it.tmdb_id + '|' + (it.imdb_id || '');
        if (!seen.has(key)) finalResults.push(it);
      }
    } else {
      // all-words match promotion
      const qWords = qnormFull.split(' ').filter(Boolean);
      const allWordMatches = [];
      for (const it of filtered) {
        const hay = (norm(it.title) + ' ' + norm(it.original_title)).trim();
        let all = true;
        for (const w of qWords) if (!new RegExp('\\b' + w.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&') + '\\b').test(hay)) { all = false; break; }
        if (all) allWordMatches.push(it);
      }
      allWordMatches.forEach(it => seen.add(it.tmdb_id + '|' + (it.imdb_id || '')));
      if (allWordMatches.length > 0) {
        finalResults = finalResults.concat(allWordMatches);
        for (const it of filtered) {
          const key = it.tmdb_id + '|' + (it.imdb_id || '');
          if (!seen.has(key)) finalResults.push(it);
        }
      } else {
        finalResults = filtered;
      }
    }

    res.json({ ok: true, results: finalResults });
  }catch(err){
    console.error('TMDB search error:', err && (err.stack || err));
    res.status(500).json({ ok: false, error: 'tmdb_error' });
  }
});

module.exports = router;
