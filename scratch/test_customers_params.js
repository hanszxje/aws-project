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
  console.log('Testing search param...');
  const res1 = await apiCall('/customers?name=Tyler');
  console.log('Search by name count:', res1.data ? res1.data.length : 'none');

  console.log('Testing customer_id param...');
  const res2 = await apiCall('/customers?customer_id=1');
  console.log('Search by customer_id:', res2.data ? res2.data.length : 'none');

  console.log('Testing sort or order params...');
  const res3 = await apiCall('/customers?limit=5&sort=created_at&order=desc');
  console.log('Sort output:', JSON.stringify(res3.data, null, 2));

  console.log('Testing limit parameter larger...');
  const res4 = await apiCall('/customers?limit=1');
  console.log('Limit=1 total attribute:', res4.total);
}

test().catch(console.error);
