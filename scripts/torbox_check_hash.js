const axios = require('axios');
const TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const HASH = '1d4d6f55c06bb36dadd3653533fc81c3ad43ebde';
const BASE = 'https://api.torbox.app/v1/api';

(async () => {
  try {
    console.log('Checking cached for hash:', HASH);
    const res = await axios.get(`${BASE}/torrents/checkcached?hash=${HASH}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('Status:', res.status);
    console.log('Body:', JSON.stringify(res.data, null, 2));

    const body = res.data;
    if (body && body.success && body.data) {
      let entry = null;
      const data = body.data;
      if (Array.isArray(data) && data.length > 0) entry = data[0];
      else entry = data;

      if (entry) {
        console.log('Found entry:', JSON.stringify(entry, null, 2));
        let id = entry.id || entry.torrentId || entry._id;
        let files = entry.files || [];

        if (!id) {
          console.log('No id field found in entry, searching mylist for matching hash...');
          try {
            const mylist = await axios.get(`${BASE}/torrents/mylist`, { headers: { Authorization: `Bearer ${TOKEN}` } });
            if (mylist.data && mylist.data.success && Array.isArray(mylist.data.data)) {
              const found = mylist.data.data.find(t => (t.hash && t.hash.toLowerCase() === HASH.toLowerCase()));
              if (found) {
                id = found.id || found.torrentId || found._id;
                files = found.files || files;
                console.log('Found in mylist id:', id);
              }
            }
          } catch (e) {
            console.log('Error fetching mylist:', e.response?.status, e.response?.data || e.message);
          }
        }

        if (id) {
          const fileId = (files && files.length > 0 && (files[0].id !== undefined)) ? files[0].id : 0;
          console.log('Requesting download link with token param, torrent_id, file_id:', id, fileId);
          const url = `${BASE}/torrents/requestdl?token=${TOKEN}&torrent_id=${id}&file_id=${fileId}`;
          const dl = await axios.get(url);
          console.log('RequestDL status:', dl.status);
          console.log('RequestDL body:', JSON.stringify(dl.data, null, 2));
        } else {
          console.log('Unable to determine torrent id for requestdl.');
        }
      }
    } else {
      console.log('Not cached or empty response.');
    }
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
})();
