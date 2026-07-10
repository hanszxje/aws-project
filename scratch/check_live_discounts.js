const http = require('http');

http.get('http://13.229.124.81:8000/discounts?limit=1000', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const obj = JSON.parse(data);
      console.log('Response keys:', Object.keys(obj));
      const list = obj.data || obj;
      if (Array.isArray(list)) {
        const seasons = [...new Set(list.map(d => d.season_name))];
        console.log('Unique Season Names in DB:', seasons);
      } else {
        console.log('Response is not an array:', obj);
      }
    } catch (err) {
      console.error('Parsing error:', err.message);
    }
  });
}).on('error', (err) => {
  console.error('HTTP error:', err.message);
});
