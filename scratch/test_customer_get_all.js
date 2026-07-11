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
    const req = http.request(opts, (res) => {
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  const getRes = await apiCall('/customers?limit=1000');
  console.log('Total customers returned:', getRes.data ? getRes.data.length : 'none');
  console.log('First 5 customers:', JSON.stringify(getRes.data ? getRes.data.slice(0, 5) : [], null, 2));
  console.log('Last 5 customers:', JSON.stringify(getRes.data ? getRes.data.slice(-5) : [], null, 2));
}

test().catch(console.error);
