const http = require('http');
const fs = require('fs');
const path = require('path');

function fetchUrl(urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '13.229.124.81',
      port: 8000,
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer YWRtaW46cGFzc3dvcmQxMjM='
      }
    };
    let data = '';
    const req = http.request(opts, (res) => {
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('Fetching openapi.json...');
  try {
    const data = await fetchUrl('/openapi.json');
    fs.writeFileSync(path.join(__dirname, 'openapi.json'), data);
    console.log('Saved openapi.json successfully!');
    
    // Parse and show /customers parameters
    const openapi = JSON.parse(data);
    const customersGet = openapi.paths['/customers'] && openapi.paths['/customers'].get;
    if (customersGet) {
      console.log('Parameters for GET /customers:');
      console.log(JSON.stringify(customersGet.parameters, null, 2));
    } else {
      console.log('GET /customers not found in OpenAPI paths');
    }
  } catch(e) {
    console.error('Error fetching openapi.json:', e);
  }
}

test().catch(console.error);
