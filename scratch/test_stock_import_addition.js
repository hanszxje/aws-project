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
  const storeId = 1;
  const sku = 'CHAC10010--';
  
  // 1. Get current stock
  console.log('1. Checking current stock...');
  const stock1 = await apiCall(`/stock?store_id=${storeId}&sku=${sku}`, 'GET');
  console.log('Stock Response:', JSON.stringify(stock1.body));
  
  // 2. Perform stock import of 5 units
  console.log('\n2. Importing 5 units...');
  const imp = await apiCall('/stock-imports', 'POST', {
    store_id: storeId,
    sku: sku,
    quantity_imported: 5,
    import_date: '2026-07-10',
    supplier: 'Test Addition'
  });
  console.log('Import Response:', JSON.stringify(imp.body));
  
  // 3. Get stock again
  console.log('\n3. Checking stock after first import...');
  const stock2 = await apiCall(`/stock?store_id=${storeId}&sku=${sku}`, 'GET');
  console.log('Stock Response:', JSON.stringify(stock2.body));

  // 4. Perform second stock import of 10 units
  console.log('\n4. Importing 10 more units...');
  const imp2 = await apiCall('/stock-imports', 'POST', {
    store_id: storeId,
    sku: sku,
    quantity_imported: 10,
    import_date: '2026-07-10',
    supplier: 'Test Addition 2'
  });
  console.log('Import Response:', JSON.stringify(imp2.body));

  // 5. Get stock again
  console.log('\n5. Checking stock after second import...');
  const stock3 = await apiCall(`/stock?store_id=${storeId}&sku=${sku}`, 'GET');
  console.log('Stock Response:', JSON.stringify(stock3.body));
}

test().catch(console.error);
