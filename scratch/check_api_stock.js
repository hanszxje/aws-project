const http = require('http');

function apiCall(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '13.229.124.81',
      port: 8000,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer YWRtaW46cGFzc3dvcmQxMjM=',
        'Content-Type': 'application/json'
      }
    };
    let data = '';
    http.request(opts, (res) => {
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    }).on('error', reject).end();
  });
}

async function test() {
  console.log('Fetching live stock data for store 1...');
  const res = await apiCall('/stock?store_id=1&limit=50');
  console.log('Total items in stock list:', res.total);
  if (res.data && res.data.length > 0) {
    console.log('Sample items with non-zero quantity:');
    const nonZero = res.data.filter(s => s.quantity > 0);
    console.log('Non-zero count in sample:', nonZero.length);
    console.log(JSON.stringify(nonZero.slice(0, 10), null, 2));
  }
}

test().catch(console.error);
