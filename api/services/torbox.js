const axios = require("axios");
const cache = new Map(); // caché global
const BASE = "https://api.torbox.app/v1/api";

function crearTituloEpico(item, fromCache = false) {
  const calidad = (item.quality || "1080p").trim();
  const idioma = (item.language || "MX LATINO").trim();
  const title = `${calidad} ${idioma}${fromCache ? " ⚡️ CACHÉ" : ""} Primer Latino`.trim();
  const infoTitle = "Primer Latino";
  return { title, infoTitle };
}

async function getStream(key, hash, item) {
  const hashUpper = hash.trim().toUpperCase();

  if (cache.has(hashUpper) && Date.now() < cache.get(hashUpper).expires) {
    const titulos = crearTituloEpico(item, true);
    return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: cache.get(hashUpper).url }];
  }

  const auth = { headers: { "Authorization": `Bearer ${key}` } };

  try {
    // 1) Comprobar si ya está cacheado en TorBox
    let torrentEntry = null;
    try {
      const res = await axios.get(`${BASE}/torrents/checkcached?hash=${encodeURIComponent(hashUpper)}`, auth);
      const body = res.data;
      if (body && body.success && body.data) {
        // data puede ser array, objeto directo o mapa indexado por hash
        const data = body.data;
        if (Array.isArray(data) && data.length > 0) torrentEntry = data[0];
        else if (data && (data.id || data.hash)) torrentEntry = data;
        else if (data && typeof data === 'object') {
          const keys = Object.keys(data);
          if (keys.length > 0) torrentEntry = data[keys[0]];
        }
      }
    } catch (e) {
      // no fatal; seguimos a crear si hace falta
      // console.debug('checkcached error', e.response?.data || e.message);
    }

    // 2) Si no existe, intentar crear con magnet
    if (!torrentEntry) {
      const magnet = `magnet:?xt=urn:btih:${hashUpper}`;
      try {
        const createResp = await axios.post(`${BASE}/torrents/createtorrent`, { magnet }, auth);
        if (createResp.data && createResp.data.success) {
          // Algunos endpoints devuelven el objeto en data, otros devuelven id
          const created = createResp.data.data;
          // we don't rely on this too much — seguiremos consultando checkcached/poll
        }
      } catch (errCreate) {
        // si la creación falla, mostrar info y seguir (podría estar ya en caché)
        // console.error('create torrent failed', errCreate.response?.data || errCreate.message);
      }

      // Poll para ver si aparece en cache (hasta 40 veces)
      for (let i = 0; i < 40 && !torrentEntry; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const res = await axios.get(`${BASE}/torrents/checkcached?hash=${encodeURIComponent(hashUpper)}`, auth);
          const body = res.data;
          if (body && body.success && body.data) {
            const data = body.data;
            if (Array.isArray(data) && data.length > 0) torrentEntry = data[0];
            else if (data && (data.id || data.hash)) torrentEntry = data;
            if (torrentEntry) break;
          }
        } catch (e) {
          // seguir intentando
        }
      }
    }

    if (torrentEntry) {
      // Intentar obtener link de descarga
      try {
        // si torrentEntry tiene id
        let id = torrentEntry.id || torrentEntry.torrentId || torrentEntry._id;
        let files = torrentEntry.files || [];

        // Si no tenemos id, intentar encontrarlo en la lista de torrents del usuario
        if (!id) {
          try {
            const mylistResp = await axios.get(`${BASE}/torrents/mylist`, auth);
            if (mylistResp.data && mylistResp.data.success && Array.isArray(mylistResp.data.data)) {
              const found = mylistResp.data.data.find(t => (t.hash && t.hash.toUpperCase() === hashUpper) || (t.hash && t.hash.toLowerCase() === hashUpper.toLowerCase()));
              if (found) {
                id = found.id || found.torrentId || found._id;
                files = found.files || files;
              }
            }
          } catch (e) {
            // no fatal
          }
        }

        if (id) {
          // elegir file id (0 por defecto o el primero disponible)
          const fileId = (files && files.length > 0 && (files[0].id !== undefined)) ? files[0].id : 0;

          // Requestar link usando token en query (requerido por la API)
          const url = `${BASE}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${encodeURIComponent(id)}&file_id=${encodeURIComponent(fileId)}`;
          const dlResp = await axios.get(url);
          const dlBody = dlResp.data;

          // data puede ser string (link) o contener link(s)
          let finalUrl = null;
          if (dlBody && dlBody.success && dlBody.data) {
            if (typeof dlBody.data === 'string') finalUrl = dlBody.data;
            else if (dlBody.data.link) finalUrl = dlBody.data.link;
            else if (Array.isArray(dlBody.data.links) && dlBody.data.links.length > 0) finalUrl = dlBody.data.links[0];
          }

          // como respaldo, si torrentEntry tiene campos con links, úsalos
          if (!finalUrl && torrentEntry.links && torrentEntry.links[0]) {
            finalUrl = torrentEntry.links[0];
          }

          if (finalUrl) {
            cache.set(hashUpper, { url: finalUrl, expires: Date.now() + 24*60*60*1000 });
            const titulos = crearTituloEpico(item, false);
            return [{ title: titulos.title, infoTitle: titulos.infoTitle, url: finalUrl }];
          }
        }
      } catch (errDl) {
        // show inline error
        console.error('ERROR Torbox requestdl:', errDl.response?.data || errDl.message);
      }
    }
  } catch (err) {
    console.error("ERROR Torbox:", err.response?.data || err.message);
  }

  return [];
}

module.exports = { getStream };
