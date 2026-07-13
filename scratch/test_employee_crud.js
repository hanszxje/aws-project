const http = require('http');

function apiCall(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '13.229.124.81',
      port: 8000,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer YWRtaW46cGFzc3dvcmQxMjM=',
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    let data = '';
    const req = http.request(opts, (res) => {
      console.log(`STATUS ${method} ${path}: ${res.statusCode}`);
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function test() {
  console.log('Fetching 1 employee to see schema...');
  const getRes = await apiCall('/employees?limit=1');
  console.log(JSON.stringify(getRes, null, 2));

  console.log('\nTesting POST /employees...');
  const nextId = Date.now() + Math.floor(Math.random() * 1000);
  const payload = {
    employee_id: nextId.toString(),
    store_id: '1',
    name: 'Test Emp ' + nextId,
    position: 'Sales Staff'
  };
  const postRes = await apiCall('/employees', 'POST', JSON.stringify(payload));
  console.log('POST Response:', JSON.stringify(postRes, null, 2));
}

test().catch(console.error);
