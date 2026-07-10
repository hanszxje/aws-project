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
  console.log('Testing GET /users on FastAPI...');
  const res1 = await apiCall('/users', 'GET');
  console.log('Status:', res1.status, 'Body:', JSON.stringify(res1.body));

  console.log('\nTesting GET /admin/users on FastAPI...');
  const res2 = await apiCall('/admin/users', 'GET');
  console.log('Status:', res2.status, 'Body:', JSON.stringify(res2.body));
}

test().catch(console.error);
