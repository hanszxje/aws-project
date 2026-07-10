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
  // 1. Login as IT Admin (admin/password123)
  console.log('1. Logging in as IT Admin...');
  const loginRes = await apiCall('/api/auth/login', 'POST', { username: 'admin', password: 'password123' });
  console.log('Login Status:', loginRes.status);
  const token = loginRes.body.token;

  // 2. Fetch user list to find the Director account ID (username: 'director')
  console.log('\n2. Fetching user list...');
  const usersRes = await apiCall('/api/admin/users', 'GET', null, token);
  console.log('Get Users Status:', usersRes.status);
  const directorUser = usersRes.body.find(u => u.username === 'director');
  console.log('Director User Object:', JSON.stringify(directorUser));

  if (!directorUser) {
    console.log('Director user not found, aborting edit check.');
    return;
  }

  // 3. Try to update Director role to Sales Staff (IT Admin trying to edit Director)
  console.log(`\n3. IT Admin trying to modify Director (id: ${directorUser.id}) to role: Sales Staff...`);
  const updateRes1 = await apiCall(`/api/admin/users/${directorUser.id}`, 'PUT', {
    role: 'Sales Staff',
    store_id: 1
  }, token);
  console.log('Update Status (should be 403):', updateRes1.status);
  console.log('Update Response:', JSON.stringify(updateRes1.body));

  // 4. Try to create a new Director account (IT Admin trying to create a Director)
  console.log('\n4. IT Admin trying to create a new Director account...');
  const createRes = await apiCall('/api/admin/users', 'POST', {
    username: 'test_director_hierarchy',
    password: 'password123',
    role: 'Director',
    store_id: null
  }, token);
  console.log('Create Status (should be 403):', createRes.status);
  console.log('Create Response:', JSON.stringify(createRes.body));

  // 5. Try to modify Sales Staff (id: 7) permissions of Director (IT Admin modifying Director permissions)
  console.log('\n5. IT Admin trying to modify Director permissions matrix...');
  const currentPerms = await apiCall('/api/admin/permissions', 'GET', null, token);
  const newPerms = { ...currentPerms.body };
  newPerms['Director'] = ['view_dashboard']; // Strip most permissions
  
  const permUpdateRes = await apiCall('/api/admin/permissions', 'PUT', newPerms, token);
  console.log('Permissions Update Status (should be 403):', permUpdateRes.status);
  console.log('Permissions Update Response:', JSON.stringify(permUpdateRes.body));
}

test().catch(console.error);
