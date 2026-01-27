const http = require('http');
const url = 'http://127.0.0.1:3000/realdebrid=RKXA6I4ORL2E63CHIWRRD5OMAQKIAH4QYGBHP3LG3ZFPFTIF72PA/stream/movie/tt30472557.json';

console.log('Requesting:', url);
http.get(url, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const json = JSON.parse(d);
      console.log('Response JSON:\n', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Raw response:\n', d);
    }
  });
}).on('error', e => console.error('ERROR_REQUEST:', e.message));
