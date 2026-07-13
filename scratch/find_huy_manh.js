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
  const getRes = await apiCall('/employees?limit=1000');
  const employees = getRes.data || [];
  console.log('Total returned:', employees.length);
  
  const foundByName = employees.filter(e => e.name.toLowerCase().includes('manh'));
  console.log('Found by name "manh":', JSON.stringify(foundByName, null, 2));

  const foundById = employees.filter(e => e.employee_id === '1783771285111');
  console.log('Found by ID "1783771285111":', JSON.stringify(foundById, null, 2));
}

test().catch(console.error);
