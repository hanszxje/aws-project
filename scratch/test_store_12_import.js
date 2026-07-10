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

async function run() {
  console.log('--- Testing Store 12 Integration ---');
  
  // 1. Initial stock check
  console.log('1. Checking initial stock of CHAC10010-- in Store 12...');
  const initRes = await apiCall('/stock?store_id=12&sku=CHAC10010--', 'GET');
  console.log('Initial Stock:', JSON.stringify(initRes.body));

  // 2. Import stock
  console.log('\n2. Importing 5 units of CHAC10010-- for Store 12...');
  const importRes = await apiCall('/stock-imports', 'POST', {
    store_id: 12,
    sku: 'CHAC10010--',
    quantity_imported: 5,
    import_date: new Date().toISOString(),
    supplier: 'Test Store 12 Supplier'
  });
  console.log('Import Status:', importRes.status);
  console.log('Import Response:', JSON.stringify(importRes.body));

  // 3. Verify stock increased
  console.log('\n3. Verifying updated stock...');
  const updatedRes = await apiCall('/stock?store_id=12&sku=CHAC10010--', 'GET');
  console.log('Updated Stock:', JSON.stringify(updatedRes.body));

  // 4. Reset stock back to 0 (tí xóa nhé)
  console.log('\n4. Resetting stock back to 0 (as requested)...');
  const resetRes = await apiCall('/stock/12/CHAC10010--', 'PUT', {
    quantity: 0
  });
  console.log('Reset Status:', resetRes.status);
  console.log('Reset Response:', JSON.stringify(resetRes.body));

  // 5. Final verification
  console.log('\n5. Final verification check...');
  const finalRes = await apiCall('/stock?store_id=12&sku=CHAC10010--', 'GET');
  console.log('Final Stock:', JSON.stringify(finalRes.body));
}

run().catch(console.error);
