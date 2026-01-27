const http = require('http');
const app = require('../api/addon');

const TORBOX_TOKEN = '9f21afe0-5dbd-4f64-87c2-570c1448e9c8';
const ID = 'tt31184028';

const server = app.listen(0, () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/torbox=${TORBOX_TOKEN}/stream/movie/${ID}.json`;
  console.log('Temporary server listening on port', port);
  console.log('Requesting:', url);

  http.get(url, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(d);
        console.log('Response JSON:', JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Raw response:', d);
      }
      server.close();
    });
  }).on('error', e => {
    console.error('REQUEST_ERROR:', e.message);
    server.close();
  });
});
