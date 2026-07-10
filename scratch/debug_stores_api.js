const http = require('http');

function apiCall(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
  const loginRes = await apiCall('/api/auth/login', 'POST', { username: 'admin', password: 'password123' });
  const token = loginRes.body.token;
  console.log('Login Status:', loginRes.status);
  
  const storesRes = await apiCall('/api/stores', 'GET', null, token);
  console.log('Stores API Status:', storesRes.status);
  console.log('Stores Count:', Array.isArray(storesRes.body) ? storesRes.body.length : 'not an array');
  console.log('First 3 stores:', JSON.stringify((storesRes.body || []).slice(0, 3)));
}

test().catch(console.error);
