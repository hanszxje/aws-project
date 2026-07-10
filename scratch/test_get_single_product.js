const http = require('http');

http.get('http://13.229.124.81:8000/products/100', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      console.log('Product 100 response:', JSON.parse(data));
    } catch (err) {
      console.error('Parsing error:', err.message);
    }
  });
}).on('error', (err) => {
  console.error('HTTP error:', err.message);
});
