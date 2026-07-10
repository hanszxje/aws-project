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
  // 1. Login as manager1
  console.log('1. Logging in as manager1...');
  const loginRes = await apiCall('/api/auth/login', 'POST', { username: 'manager1', password: 'password123' });
  console.log('Login Status:', loginRes.status);
  if (!loginRes.body?.token) {
    console.log('Login failed:', JSON.stringify(loginRes.body));
    return;
  }
  const token = loginRes.body.token;

  // 2. Fetch /api/stores
  console.log('\n2. Fetching /api/stores...');
  const storesRes = await apiCall('/api/stores', 'GET', null, token);
  console.log('Stores Status:', storesRes.status);
  console.log('Stores Body:', JSON.stringify(storesRes.body));

  // 3. Fetch /api/customers?page=1&limit=300
  console.log('\n3. Fetching /api/customers...');
  const custRes = await apiCall('/api/customers?page=1&limit=300', 'GET', null, token);
  console.log('Customers Status:', custRes.status);
  console.log('Customers Count:', custRes.body?.data?.length);

  // 4. Fetch /api/inventory?store_id=1
  console.log('\n4. Fetching /api/inventory?store_id=1...');
  const invRes = await apiCall('/api/inventory?store_id=1', 'GET', null, token);
  console.log('Inventory Status:', invRes.status);
  console.log('Inventory Count:', invRes.body?.length);

  // 5. Submit /api/transactions
  console.log('\n5. Submitting transaction...');
  const txRes = await apiCall('/api/transactions', 'POST', {
    store_id: 1,
    customer_id: 1,
    sku: 'CHAC10010--',
    quantity: 1,
    price: 15.0,
    payment_method: 'Cash'
  }, token);
  console.log('Transaction Status:', txRes.status);
  console.log('Transaction Body:', JSON.stringify(txRes.body));
}

test().catch(console.error);
