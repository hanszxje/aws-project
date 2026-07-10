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
  console.log('Querying SKUs for store_id=1...');
  const res1 = await apiCall('/skus?store_id=1&limit=5');
  console.log('Store 1 SKUs Total:', res1.total);

  console.log('\nQuerying SKUs for store_id=12...');
  const res2 = await apiCall('/skus?store_id=12&limit=5');
  console.log('Store 12 SKUs Total:', res2.total);

  console.log('\nQuerying SKUs for store_id=9999...');
  const res3 = await apiCall('/skus?store_id=9999&limit=5');
  console.log('Store 9999 SKUs Total:', res3.total);
}

test().catch(console.error);
