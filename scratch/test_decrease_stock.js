const http = require('http');

function apiCall(path, method, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: '13.229.124.81',
      port: 8000,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer YWRtaW46cGFzc3dvcmQxMjM=',
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(b) } : {})
      }
    };
    let data = '';
    http.request(opts, (res) => {
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject).end(b);
  });
}

async function test() {
  console.log('1. Fetching /stock?limit=1000...');
  try {
    const t0 = Date.now();
    const res = await apiCall('/stock?limit=1000', 'GET');
    console.log('Finished in', Date.now() - t0, 'ms. Status:', res.status, 'Total items:', res.body?.total || res.body?.data?.length || res.body?.length);
  } catch (err) {
    console.error('Error fetching limit=1000:', err.message);
  }

  console.log('\n2. Fetching /stock?store_id=1&sku=CHAC10010--...');
  try {
    const t0 = Date.now();
    const res = await apiCall('/stock?store_id=1&sku=CHAC10010--', 'GET');
    console.log('Finished in', Date.now() - t0, 'ms. Status:', res.status, 'Body:', JSON.stringify(res.body));
  } catch (err) {
    console.error('Error fetching specific stock:', err.message);
  }
}

test().catch(console.error);
