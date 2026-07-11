const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const generateMockData = require('./mock_db_generator');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Helper to get stable AI-generated product images from Pollinations AI (Stable Diffusion)
function getProductImageUrl(productName, category, productId) {
  const pId = productId || Math.floor(Math.random() * 1000);
  // Picsum.photos - 100% reliable, instant loading, seed ensures consistent image per product
  return `https://picsum.photos/seed/${pId}/300/300`;
}

// Setup DB Modes
const API_BASE_URL = process.env.API_BASE_URL ? process.env.API_BASE_URL.replace(/\/$/, '') : null;
const isApiMode = !!API_BASE_URL;

let isMockMode = false;
let pool = null;

let productsCache = {};
const PRODUCTS_CACHE_TTL = 300000; // 5 minutes cache

let storesCache = null;
let storesCacheTimestamp = 0;
const STORES_CACHE_TTL = 300000; // 5 minutes cache

// Initialize PostgreSQL pool if credentials are provided (needed for direct users table CRUD)
const hasCredentials = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

if (hasCredentials) {
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 5432,
      connectionTimeoutMillis: 3000
    });
    console.log('PostgreSQL database pool created.');
  } catch (err) {
    console.warn('Failed to initialize PostgreSQL pool. Falling back to Mock Mode for local DB.', err.message);
  }
}

if (!isApiMode && !hasCredentials) {
  console.log('No DB credentials found in .env. Running in Mock Mode.');
  isMockMode = true;
} else if (isApiMode) {
  console.log(`Running in API Mode. Connecting to FastAPI at ${API_BASE_URL}`);
}

// Function to read a JSON file in Mock/API Mode
function readMockFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    // Return empty array by default if it's inventory/logs and doesn't exist
    if (['inventory.json', 'inventory_imports.json', 'audit_logs.json'].includes(fileName)) {
      return [];
    }
    throw new Error(`Mock file ${fileName} not found. Please run generator script first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeMockFile(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function initializeProductStock(sku) {
  try {
    const inventory = readMockFile('inventory.json') || [];
    let modified = false;
    for (let sId = 1; sId <= 35; sId++) {
      const exists = inventory.some(item => item.store_id === sId && item.sku === sku);
      if (!exists) {
        inventory.push({
          store_id: sId,
          sku: sku,
          stock_quantity: 0
        });
        modified = true;
      }
    }
    if (modified) {
      writeMockFile('inventory.json', inventory);
    }
  } catch (err) {
    console.warn(`Failed to initialize stock to 0 for SKU ${sku}:`, err.message);
  }
}

function removeProductStock(productId, sku) {
  try {
    const possibleSkus = [`SKU-${productId}`, `CHAC${productId}--`, `FEAC${productId}--`, `MAAC${productId}--`];
    if (sku) {
      possibleSkus.push(sku);
    }
    const inventory = readMockFile('inventory.json') || [];
    const filtered = inventory.filter(item => !possibleSkus.includes(item.sku));
    if (inventory.length !== filtered.length) {
      writeMockFile('inventory.json', filtered);
    }
  } catch (err) {
    console.warn(`Failed to clean up stock for product ${productId}:`, err.message);
  }
}

// Generic API helper in API Mode
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YWRtaW46cGFzc3dvcmQxMjM=',
        ...options.headers,
      },
    });

    if (!response.ok) {
      let errMsg = `API error: ${response.status} ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody && errBody.detail) {
          errMsg += ` - ${JSON.stringify(errBody.detail)}`;
        }
      } catch (_) {}
      throw new Error(errMsg);
    }
    return await response.json();
  } catch (err) {
    console.error(`HTTP request to ${url} failed:`, err.message);
    throw err;
  }
}

// Check database connection or switch to mock
async function initDatabase() {
  if (isApiMode) {
    try {
      // Test ping to API server root
      await apiCall('/');
      console.log(`Database layer initialized in API Mode (FastAPI Connected).`);
      
      // Ensure local required files exist for local hybrid mode (users, permissions, inventory)
      const localFiles = ['users.json', 'permissions.json', 'inventory.json'];
      for (const file of localFiles) {
        if (!fs.existsSync(path.join(DATA_DIR, file))) {
          if (file === 'users.json') {
            // Generate basic default users
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash('password123', salt);
            const defaultUsers = [
              { id: 1, username: 'admin', password: passwordHash, role: 'IT Admin', store_id: null, mfa_enabled: false, mfa_secret: null },
              { id: 2, username: 'director', password: passwordHash, role: 'Director', store_id: null, mfa_enabled: false, mfa_secret: null },
              { id: 6, username: 'manager1', password: passwordHash, role: 'Store Manager', store_id: 1, mfa_enabled: false, mfa_secret: null },
              { id: 7, username: 'sales1', password: passwordHash, role: 'Sales Staff', store_id: 1, mfa_enabled: false, mfa_secret: null }
            ];
            writeMockFile('users.json', defaultUsers);
          } else if (file === 'permissions.json') {
            const defaultPerms = {
              "IT Admin": ["manage_users", "manage_permissions", "view_audit_logs", "view_inventory", "manage_inventory", "create_transaction"],
              "Director": ["view_dashboard", "view_all_stores", "view_customers", "create_customer", "delete_customer", "view_discounts", "view_employees", "view_products", "view_transactions", "view_inventory", "manage_inventory", "create_transaction"],
              "Finance/Auditor": ["view_all_stores", "view_transactions", "view_discounts", "view_inventory"],
              "Inventory Manager": ["view_own_store", "view_products", "edit_products", "view_inventory", "manage_inventory"],
              "Marketing Manager": ["view_all_stores", "view_discounts", "edit_discounts", "view_inventory"],
              "Store Manager": ["view_dashboard", "view_own_store", "view_customers", "create_customer", "view_discounts", "edit_discounts", "view_employees", "edit_employees", "view_products", "view_inventory", "manage_inventory", "create_transaction", "view_transactions"],
              "Sales Staff": ["view_own_store", "view_products", "view_transactions", "view_inventory", "view_customers", "create_customer", "create_transaction"]
            };
            writeMockFile('permissions.json', defaultPerms);
          } else if (file === 'inventory.json') {
            writeMockFile('inventory.json', []);
          }
        }
      }
      return;
    } catch (err) {
      console.warn(`FastAPI server connection failed: ${err.message}. Falling back to Local Mock Mode.`);
      // If API fails, fall back to mock
      isMockMode = true;
    }
  }

  if (isMockMode) {
    // Ensure mock files exist
    const requiredFiles = ['users.json', 'stores.json', 'products.json', 'employees.json', 'customers.json', 'discounts.json', 'transactions.json', 'forecasts.json'];
    let needsGeneration = false;
    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(DATA_DIR, file))) {
        needsGeneration = true;
        break;
      }
    }
    if (needsGeneration) {
      await generateMockData();
    }
    console.log('Database running in MOCK mode (JSON data files).');
    return;
  }

  try {
    const client = await pool.connect();
    console.log('Database running in REAL mode (PostgreSQL Connected).');
    client.release();
  } catch (err) {
    console.warn(`Database connection failed: ${err.message}`);
    console.warn('Automatically switching to MOCK mode.');
    isMockMode = true;
    await initDatabase(); // Run mock initialization
  }
}

// Unified Database Access Layer (DAL)
const db = {
  isMock: () => isMockMode || isApiMode, // treat as mock UI state if not PG
  init: initDatabase,

  // --- Auth & Users (Always Local) ---
  getUserByUsername: async (username) => {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (res.rows.length > 0) {
          const u = res.rows[0];
          return {
            id: parseInt(u.id),
            username: u.username,
            password: u.password,
            role: u.role || u.position || '',
            store_id: u.store_id ? parseInt(u.store_id) : null,
            mfa_enabled: !!u.mfa_enabled,
            mfa_secret: u.mfa_secret || null
          };
        }
        return null;
      } catch (err) {
        console.warn('PostgreSQL getUserByUsername failed, falling back to JSON:', err.message);
      }
    }
    const users = readMockFile('users.json');
    return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
  },

  // --- Stores ---
  getStores: async () => {
    if (isApiMode) {
      // Return cached data if available and fresh
      if (storesCache && (Date.now() - storesCacheTimestamp < STORES_CACHE_TTL)) {
        return storesCache;
      }

      const res = await apiCall('/stores?limit=1000');
      const stores = res.data || [];

      // Fetch all inventory to calculate real SKU & product counts per store
      let allInventory = [];
      try {
        allInventory = await db.getInventory(null);
      } catch (err) {
        console.warn('Failed to fetch inventory for getStores counts:', err.message);
      }

      // Group inventory by store_id
      const inventoryByStore = {};
      allInventory.forEach(item => {
        const sId = item.store_id;
        if (!inventoryByStore[sId]) {
          inventoryByStore[sId] = {
            skus: new Set(),
            products: new Set()
          };
        }
        inventoryByStore[sId].skus.add(item.sku);
        if (item.product_name) {
          inventoryByStore[sId].products.add(item.product_name);
        }
      });

      const result = stores.map(s => {
        const sId = parseInt(s.store_id);
        const storeStats = inventoryByStore[sId] || { skus: new Set(), products: new Set() };
        return {
          store_id: sId,
          store_name: s.name || `Store #${s.store_id}`,
          latitude: s.latitude || 0,
          longitude: s.longitude || 0,
          country: s.country || 'Global',
          num_distinct_skus: storeStats.skus.size,
          num_distinct_products: storeStats.products.size
        };
      });

      // Cache the result
      storesCache = result;
      storesCacheTimestamp = Date.now();

      return result;
    } else if (isMockMode) {
      return readMockFile('stores.json');
    } else {
      const res = await pool.query('SELECT * FROM stores ORDER BY store_id ASC');
      return res.rows;
    }
  },

  getStoreById: async (storeId) => {
    if (isApiMode) {
      try {
        const stores = await db.getStores();
        return stores.find(s => s.store_id.toString() === storeId.toString()) || null;
      } catch (err) {
        console.error(`Store ID ${storeId} not found on API:`, err.message);
        return null;
      }
    } else if (isMockMode) {
      const stores = readMockFile('stores.json');
      return stores.find(s => s.store_id === parseInt(storeId)) || null;
    } else {
      const res = await pool.query('SELECT * FROM stores WHERE store_id = $1', [storeId]);
      return res.rows[0] || null;
    }
  },

  // --- Customers ---
  getCustomers: async ({ storeId = null, page = 1, limit = 10, search = '', gender = '' }) => {
    let list = [];
    if (isApiMode) {
      const res = await apiCall('/customers?limit=1000');
      list = (res.data || []).map(c => {
        const cId = parseInt(c.customer_id);
        return {
          customer_id: cId,
          customer_name: c.name || `Khách hàng #${c.customer_id}`,
          age: c.age || 30,
          gender: c.gender === 'M' ? 'Male' : (c.gender === 'F' ? 'Female' : c.gender || 'Unknown'),
          country: c.country || 'United States',
          store_id: (cId % 35) + 1
        };
      });

      // Merge with locally created customers
      try {
        const localFile = path.join(DATA_DIR, 'local_created_customers.json');
        if (fs.existsSync(localFile)) {
          const localCusts = JSON.parse(fs.readFileSync(localFile, 'utf8') || '[]');
          localCusts.forEach(lc => {
            if (!list.some(c => c.customer_id === lc.customer_id)) {
              list.push(lc);
            }
          });
        }
      } catch (err) {
        console.warn('Failed to load local created customers:', err.message);
      }

      if (storeId && storeId !== 'null') {
        list = list.filter(c => c.store_id.toString() === storeId.toString());
      }
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(c => c.customer_name.toLowerCase().includes(q) || c.customer_id.toString().includes(q));
      }
      if (gender) {
        list = list.filter(c => c.gender.toLowerCase() === gender.toLowerCase());
      }

      const total = list.length;
      const offset = (page - 1) * limit;
      const paginatedData = list.slice(offset, offset + limit);

      return { data: paginatedData, total, page, limit };
    }

    const offset = (page - 1) * limit;
    if (isMockMode) {
      const data = readMockFile('customers.json');
      list = data.map(c => {
        const cId = parseInt(c.customer_id);
        return {
          customer_id: cId,
          customer_name: c.customer_name || `Khách hàng #${cId}`,
          age: c.age || 30,
          gender: c.gender || 'Male',
          country: c.country || 'United States',
          store_id: c.store_id || (cId % 35) + 1
        };
      });

      if (storeId && storeId !== 'null') {
        list = list.filter(c => c.store_id.toString() === storeId.toString());
      }
      if (search) {
        list = list.filter(c => c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.customer_id.toString().includes(search));
      }
      if (gender) {
        list = list.filter(c => c.gender.toLowerCase() === gender.toLowerCase());
      }
      const total = list.length;
      return { data: list.slice(offset, offset + limit), total, page, limit };
    } else {
      const res = await pool.query('SELECT * FROM customers');
      list = res.rows.map(c => {
        const cId = parseInt(c.customer_id || c.id);
        return {
          customer_id: cId,
          customer_name: c.customer_name || c.name || `Khách hàng #${cId}`,
          age: c.age || 30,
          gender: c.gender || 'Male',
          country: c.country || 'United States',
          store_id: c.store_id || (cId % 35) + 1
        };
      });

      if (storeId && storeId !== 'null') {
        list = list.filter(c => c.store_id.toString() === storeId.toString());
      }
      if (search) {
        list = list.filter(c => c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.customer_id.toString().includes(search));
      }
      if (gender) {
        list = list.filter(c => c.gender.toLowerCase() === gender.toLowerCase());
      }
      const total = list.length;
      return { data: list.slice(offset, offset + limit), total, page, limit };
    }
  },

  addCustomer: async (customerData) => {
    const store_id = customerData.store_id ? parseInt(customerData.store_id) : 1;
    if (isApiMode) {
      // Math alignment to force (customer_id % 35) + 1 to equal store_id
      const base = Date.now() + Math.floor(Math.random() * 1000);
      const remainder = base % 35;
      const targetRemainder = store_id - 1;
      let nextId = base + (targetRemainder - remainder);
      if (nextId < base) {
        nextId += 35;
      }

      const payload = {
        customer_id: nextId.toString(),
        name: customerData.customer_name,
        age: parseInt(customerData.age),
        gender: customerData.gender === 'Male' ? 'M' : (customerData.gender === 'Female' ? 'F' : customerData.gender),
        country: customerData.country
      };

      const res = await apiCall('/customers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      const created = res.data || res;
      const newCust = {
        customer_id: parseInt(created.customer_id),
        customer_name: created.name,
        age: created.age,
        gender: created.gender === 'M' ? 'Male' : (created.gender === 'F' ? 'Female' : created.gender),
        country: created.country,
        store_id: store_id
      };

      // Save to local_created_customers.json
      try {
        const localFile = path.join(DATA_DIR, 'local_created_customers.json');
        let localCusts = [];
        if (fs.existsSync(localFile)) {
          localCusts = JSON.parse(fs.readFileSync(localFile, 'utf8') || '[]');
        }
        localCusts.push(newCust);
        fs.writeFileSync(localFile, JSON.stringify(localCusts, null, 2), 'utf8');
      } catch (err) {
        console.error('Failed to save customer locally:', err.message);
      }

      return newCust;
    } else if (isMockMode) {
      const customers = readMockFile('customers.json');
      const base = customers.length > 0 ? Math.max(...customers.map(c => c.customer_id)) + 1 : 10001;
      const remainder = base % 35;
      const targetRemainder = store_id - 1;
      let newId = base + (targetRemainder - remainder);
      if (newId < base) {
        newId += 35;
      }
      const newCustomer = {
        customer_id: newId,
        customer_name: customerData.customer_name,
        age: parseInt(customerData.age),
        gender: customerData.gender,
        country: customerData.country,
        store_id: store_id
      };
      customers.push(newCustomer);
      writeMockFile('customers.json', customers);
      return newCustomer;
    } else {
      const res = await pool.query(
        'INSERT INTO customers (customer_name, age, country, gender) VALUES ($1, $2, $3, $4) RETURNING *',
        [customerData.customer_name, customerData.age, customerData.country, customerData.gender]
      );
      const row = res.rows[0];
      const cId = parseInt(row.customer_id || row.id);
      return {
        customer_id: cId,
        customer_name: row.customer_name || row.name,
        age: row.age,
        gender: row.gender,
        country: row.country,
        store_id: (cId % 35) + 1
      };
    }
  },

  deleteCustomer: async (customerId) => {
    if (isApiMode) {
      await apiCall(`/customers/${customerId}`, { method: 'DELETE' });
      
      // Also delete from local_created_customers.json if present
      try {
        const localFile = path.join(DATA_DIR, 'local_created_customers.json');
        if (fs.existsSync(localFile)) {
          let localCusts = JSON.parse(fs.readFileSync(localFile, 'utf8') || '[]');
          localCusts = localCusts.filter(c => c.customer_id.toString() !== customerId.toString());
          fs.writeFileSync(localFile, JSON.stringify(localCusts, null, 2), 'utf8');
        }
      } catch (err) {
        console.error('Failed to update local customers after delete:', err.message);
      }
      return true;
    } else if (isMockMode) {
      const customers = readMockFile('customers.json');
      const filtered = customers.filter(c => c.customer_id !== parseInt(customerId));
      if (customers.length === filtered.length) return false;
      writeMockFile('customers.json', filtered);
      return true;
    } else {
      const res = await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
      return res.rowCount > 0;
    }
  },

  // --- Discounts ---
  getDiscounts: async (storeId = null) => {
    let list = [];
    if (isApiMode) {
      let url = '/discounts?limit=1000';
      const res = await apiCall(url);
      list = (res.data || []).map(d => ({
        discount_id: parseInt(d.discount_id),
        store_id: parseInt(d.store_id),
        season_name: d.description || `Khuyến mãi #${d.discount_id}`,
        total_discount_avg: d.discount_pct || 0,
        start_date: d.start_date || new Date().toISOString().split('T')[0],
        end_date: d.end_date || new Date().toISOString().split('T')[0]
      }));

      if (storeId && storeId !== 'null') {
        list = list.filter(d => isNaN(d.store_id) || d.store_id === null || d.store_id.toString() === storeId.toString());
      }
    } else if (isMockMode) {
      list = readMockFile('discounts.json');
      if (storeId) {
        list = list.filter(d => !d.store_id || d.store_id === parseInt(storeId));
      }
    } else {
      if (storeId) {
        const res = await pool.query('SELECT * FROM discounts WHERE store_id = $1 OR store_id IS NULL', [storeId]);
        list = res.rows;
      } else {
        const res = await pool.query('SELECT * FROM discounts');
        list = res.rows;
      }
    }

    // Sort by end_date descending: latest first, earliest at the bottom
    list.sort((a, b) => {
      const dateA = new Date(a.end_date || a.valid_until || a.start_date || 0);
      const dateB = new Date(b.end_date || b.valid_until || b.start_date || 0);
      return dateB - dateA;
    });

    return list;
  },

  updateDiscountAvg: async (discountId, newDiscountAvg) => {
    if (isApiMode) {
      await apiCall(`/discounts/${discountId}`, {
        method: 'PUT',
        body: JSON.stringify({
          discount_pct: parseFloat(newDiscountAvg)
        })
      });
      return true;
    } else if (isMockMode) {
      const discounts = readMockFile('discounts.json');
      const discount = discounts.find(d => d.discount_id === parseInt(discountId));
      if (!discount) return false;
      discount.total_discount_avg = parseFloat(newDiscountAvg);
      writeMockFile('discounts.json', discounts);
      return true;
    } else {
      const res = await pool.query('UPDATE discounts SET total_discount_avg = $1 WHERE discount_id = $2', [newDiscountAvg, discountId]);
      return res.rowCount > 0;
    }
  },

  addDiscount: async (discountData) => {
    if (isApiMode) {
      const nextId = Date.now() + Math.floor(Math.random() * 1000);

      const payload = {
        discount_id: nextId.toString(),
        store_id: discountData.store_id.toString(),
        discount_pct: parseFloat(discountData.total_discount_avg),
        start_date: discountData.start_date,
        end_date: discountData.end_date,
        description: discountData.season_name
      };

      const res = await apiCall('/discounts', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const created = res.data || res;
      return {
        discount_id: parseInt(created.discount_id),
        store_id: parseInt(created.store_id),
        season_name: created.description,
        total_discount_avg: created.discount_pct,
        start_date: created.start_date,
        end_date: created.end_date
      };
    } else if (isMockMode) {
      const discounts = readMockFile('discounts.json');
      const newId = discounts.length > 0 ? Math.max(...discounts.map(d => d.discount_id)) + 1 : 1;
      const newDiscount = {
        discount_id: newId,
        store_id: parseInt(discountData.store_id),
        season_name: discountData.season_name,
        total_discount_avg: parseFloat(discountData.total_discount_avg),
        start_date: discountData.start_date,
        end_date: discountData.end_date
      };
      discounts.push(newDiscount);
      writeMockFile('discounts.json', discounts);
      return newDiscount;
    } else {
      const res = await pool.query(
        'INSERT INTO discounts (store_id, season_name, total_discount_avg, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [discountData.store_id, discountData.season_name, discountData.total_discount_avg, discountData.start_date, discountData.end_date]
      );
      return res.rows[0];
    }
  },

  deleteDiscount: async (discountId) => {
    if (isApiMode) {
      await apiCall(`/discounts/${discountId}`, { method: 'DELETE' });
      return true;
    } else if (isMockMode) {
      const discounts = readMockFile('discounts.json');
      const filtered = discounts.filter(d => d.discount_id !== parseInt(discountId));
      if (discounts.length === filtered.length) return false;
      writeMockFile('discounts.json', filtered);
      return true;
    } else {
      const res = await pool.query('DELETE FROM discounts WHERE discount_id = $1', [discountId]);
      return res.rowCount > 0;
    }
  },

  // --- Employees ---
  getEmployees: async (storeId = null) => {
    if (isApiMode) {
      let url = '/employees?limit=1000';
      const res = await apiCall(url);
      let list = (res.data || []).map(e => ({
        employee_id: parseInt(e.employee_id),
        store_id: parseInt(e.store_id),
        name: e.name || `Nhân viên #${e.employee_id}`,
        role: e.position || 'Staff'
      }));

      if (storeId && storeId !== 'null') {
        list = list.filter(e => e.store_id.toString() === storeId.toString());
      }
      return list;
    } else if (isMockMode) {
      let data = readMockFile('employees.json');
      if (storeId) {
        data = data.filter(e => e.store_id === parseInt(storeId));
      }
      return data;
    } else {
      if (storeId) {
        const res = await pool.query('SELECT * FROM employees WHERE store_id = $1 ORDER BY employee_id ASC', [storeId]);
        return res.rows;
      } else {
        const res = await pool.query('SELECT * FROM employees ORDER BY employee_id ASC');
        return res.rows;
      }
    }
  },

  updateEmployee: async (employeeId, name, role) => {
    if (isApiMode) {
      await apiCall(`/employees/${employeeId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          position: role
        })
      });
      return true;
    } else if (isMockMode) {
      const employees = readMockFile('employees.json');
      const emp = employees.find(e => e.employee_id === parseInt(employeeId));
      if (!emp) return false;
      emp.name = name;
      emp.role = role;
      writeMockFile('employees.json', employees);
      return true;
    } else {
      const res = await pool.query('UPDATE employees SET name = $1, role = $2 WHERE employee_id = $3', [name, role, employeeId]);
      return res.rowCount > 0;
    }
  },

  addEmployee: async (employeeData) => {
    if (isApiMode) {
      const nextId = Date.now() + Math.floor(Math.random() * 1000);

      const payload = {
        employee_id: nextId.toString(),
        store_id: employeeData.store_id.toString(),
        name: employeeData.name,
        position: employeeData.role
      };

      const res = await apiCall('/employees', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const created = res.data || res;
      return {
        employee_id: parseInt(created.employee_id),
        store_id: parseInt(created.store_id),
        name: created.name,
        role: created.position
      };
    } else if (isMockMode) {
      const employees = readMockFile('employees.json');
      const newId = employees.length > 0 ? Math.max(...employees.map(e => e.employee_id)) + 1 : 200;
      const newEmployee = {
        employee_id: newId,
        store_id: parseInt(employeeData.store_id),
        name: employeeData.name,
        role: employeeData.role
      };
      employees.push(newEmployee);
      writeMockFile('employees.json', employees);
      return newEmployee;
    } else {
      const res = await pool.query(
        'INSERT INTO employees (store_id, name, role) VALUES ($1, $2, $3) RETURNING *',
        [employeeData.store_id, employeeData.name, employeeData.role]
      );
      return res.rows[0];
    }
  },

  deleteEmployee: async (employeeId) => {
    if (isApiMode) {
      await apiCall(`/employees/${employeeId}`, { method: 'DELETE' });
      return true;
    } else if (isMockMode) {
      const employees = readMockFile('employees.json');
      const filtered = employees.filter(e => e.employee_id !== parseInt(employeeId));
      if (employees.length === filtered.length) return false;
      writeMockFile('employees.json', filtered);
      return true;
    } else {
      const res = await pool.query('DELETE FROM employees WHERE employee_id = $1', [employeeId]);
      return res.rowCount > 0;
    }
  },

  // --- Products ---
  getProducts: async ({ storeId = null, category = '', search = '' }) => {
    if (isApiMode) {
      try {
        const cacheKey = category || 'all';
        const cached = productsCache[cacheKey];
        if (cached && (Date.now() - cached.timestamp < PRODUCTS_CACHE_TTL)) {
          let list = cached.data;
          if (search) {
            const q = search.toLowerCase();
            list = list.filter(p => p.product_name.toLowerCase().includes(q) || p.description_en.toLowerCase().includes(q));
          }
          return list;
        }

        let url = '/products?limit=100'; // reduced from 1000 to prevent server 500 error
        if (category) {
          url += `&category=${encodeURIComponent(category)}`;
        }
        const res = await apiCall(url);
        let list = (res.data || [])
          .filter(p => {
            const name = (p.description_en || p.name_en || '').toLowerCase();
            const sub = (p.sub_category || '').toLowerCase();
            const sku = (p.sku || '').toLowerCase();
            const id = String(p.product_id).toLowerCase();
            if (id === 'string' || name === 'string' || sub === 'string' || sku === 'string') {
              return false;
            }
            if (name.includes('sports velvet sports')) {
              return false;
            }
            if (isNaN(parseInt(p.product_id))) {
              return false;
            }
            return true;
          })
          .map(p => ({
            product_id: parseInt(p.product_id),
            sku: p.sku || `SKU-${p.product_id}`,
            product_name: p.description_en || p.name_en || `Sản phẩm #${p.product_id}`,
            category: p.category || 'Children',
            sub_category: p.sub_category || 'Other',
            color_type: p.color_type || 'Cor Unica',
            description_en: p.description_en || `Sản phẩm #${p.product_id}`,
            image_url: (p.image_url && !p.image_url.includes('picsum.photos')) ? p.image_url : getProductImageUrl(p.description_en || p.name_en, p.category, p.product_id)
          }))
          // Only show allowed categories
          .filter(p => ['Children', 'Masculine', 'Feminine'].includes(p.category));

        // Merge local created_products.json to resolve newly created items
        try {
          const filePath = path.join(__dirname, '../data/created_products.json');
          if (fs.existsSync(filePath)) {
            const localCreated = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(localCreated)) {
              localCreated.forEach(localProd => {
                const exists = list.some(p => p.product_id === localProd.product_id);
                if (!exists) {
                  // Filter by category if requested
                  if (!category || localProd.category === category) {
                    list.push(localProd);
                  }
                }
              });
            }
          }
        } catch (err) {
          console.warn('Failed to load local created products in getProducts:', err.message);
        }

        // Save in cache
        productsCache[cacheKey] = {
          data: list,
          timestamp: Date.now()
        };

        if (search) {
          const q = search.toLowerCase();
          list = list.filter(p => p.product_name.toLowerCase().includes(q) || p.description_en.toLowerCase().includes(q));
        }
        return list;
      } catch (err) {
        console.warn(`Failed to fetch products from API: ${err.message}. Falling back to local products.`);
        try {
          const localProducts = readMockFile('products.json');
          if (localProducts && localProducts.length > 0) {
            let list = localProducts.filter(p => {
              const name = (p.product_name || p.description_en || '').toLowerCase();
              if (name.includes('string') || name.includes('sports velvet sports')) return false;
              // Only allowed categories
              if (!['Children', 'Masculine', 'Feminine'].includes(p.category)) return false;
              return true;
            });
            if (category) {
              list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
            }
            if (search) {
              const q = search.toLowerCase();
              list = list.filter(p => p.product_name.toLowerCase().includes(q) || p.description_en.toLowerCase().includes(q));
            }
            return list;
          }
        } catch (e) {
          // ignore
        }
        return [];
      }
    } else if (isMockMode) {
      let productsList = readMockFile('products.json');
      productsList = productsList.filter(p => {
        const name = (p.product_name || p.description_en || '').toLowerCase();
        if (name.includes('string') || name.includes('sports velvet sports')) return false;
        return true;
      });
      if (category) {
        productsList = productsList.filter(p => p.category.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        productsList = productsList.filter(p => p.product_name.toLowerCase().includes(search.toLowerCase()) || p.description_en.toLowerCase().includes(search.toLowerCase()));
      }
      return productsList;
    } else {
      let query = 'SELECT * FROM products WHERE 1=1';
      const params = [];
      if (category) {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (product_name ILIKE $${params.length} OR description_en ILIKE $${params.length})`;
      }
      const res = await pool.query(query, params);
      return res.rows.filter(p => {
        const name = (p.product_name || p.description_en || '').toLowerCase();
        if (name.includes('string') || name.includes('sports velvet sports')) return false;
        return true;
      });
    }
  },

  addProduct: async (productData) => {
    if (isApiMode) {
      const nextId = Date.now() + Math.floor(Math.random() * 1000);
      
      let skuPrefix = 'SKU';
      const cat = productData.category || '';
      if (cat.toLowerCase() === 'children') skuPrefix = 'CHAC';
      else if (cat.toLowerCase() === 'feminine') skuPrefix = 'FEAC';
      else if (cat.toLowerCase() === 'masculine') skuPrefix = 'MAAC';

      const payload = {
        product_id: nextId.toString(),
        sku: `${skuPrefix}${nextId}--`,
        description_en: productData.product_name || productData.description_en,
        category: productData.category,
        sub_category: productData.sub_category,
        color: 'NEUTRAL',
        size: 'M',
        price: 50.0,
        image_url: productData.image_url || getProductImageUrl(productData.product_name || productData.description_en, productData.category, nextId)
      };

      const res = await apiCall('/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const created = res.data || res;
      const newProduct = {
        product_id: parseInt(created.product_id),
        sku: created.sku || `SKU-${created.product_id}`,
        product_name: productData.product_name || created.description_en,
        category: created.category,
        sub_category: created.sub_category,
        color_type: 'Cor Unica',
        description_en: productData.product_name || created.description_en,
        image_url: (created.image_url && !created.image_url.includes('picsum.photos')) ? created.image_url : getProductImageUrl(productData.product_name || created.description_en, created.category, created.product_id)
      };

      try {
        const filePath = path.join(__dirname, '../data/created_products.json');
        let list = [];
        if (fs.existsSync(filePath)) {
          list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        list.push(newProduct);
        fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
      } catch (err) {
        console.error('Failed to save newly created product locally:', err);
      }

      initializeProductStock(newProduct.sku);
      return newProduct;
    } else if (isMockMode) {
      const products = readMockFile('products.json');
      const newId = products.length > 0 ? Math.max(...products.map(p => p.product_id)) + 1 : 1000;
      
      let skuPrefix = 'SKU';
      const cat = productData.category || '';
      if (cat.toLowerCase() === 'children') skuPrefix = 'CHAC';
      else if (cat.toLowerCase() === 'feminine') skuPrefix = 'FEAC';
      else if (cat.toLowerCase() === 'masculine') skuPrefix = 'MAAC';
      const sku = `${skuPrefix}${newId}--`;

      const newProduct = {
        product_id: newId,
        sku: sku,
        product_name: productData.product_name,
        category: productData.category,
        sub_category: productData.sub_category,
        color_type: productData.color_type,
        description_en: productData.description_en,
        image_url: productData.image_url || getProductImageUrl(productData.product_name, productData.category, newId)
      };
      products.push(newProduct);
      writeMockFile('products.json', products);
      
      initializeProductStock(sku);
      return newProduct;
    } else {
      const res = await pool.query(
        'INSERT INTO products (product_name, category, sub_category, color_type, description_en, image_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [productData.product_name, productData.category, productData.sub_category, productData.color_type, productData.description_en, productData.image_url]
      );
      const created = res.rows[0];
      let skuPrefix = 'SKU';
      const cat = created.category || '';
      if (cat.toLowerCase() === 'children') skuPrefix = 'CHAC';
      else if (cat.toLowerCase() === 'feminine') skuPrefix = 'FEAC';
      else if (cat.toLowerCase() === 'masculine') skuPrefix = 'MAAC';
      const sku = `${skuPrefix}${created.product_id}--`;
      
      initializeProductStock(sku);
      return created;
    }
  },

  updateProduct: async (productId, productData) => {
    if (isApiMode) {
      const payload = {
        description_en: productData.product_name || productData.description_en,
        category: productData.category,
        sub_category: productData.sub_category,
        image_url: productData.image_url
      };
      const res = await apiCall(`/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const updated = res.data || res;
      return {
        product_id: parseInt(updated.product_id),
        product_name: updated.description_en,
        category: updated.category,
        sub_category: updated.sub_category,
        color_type: 'Cor Unica',
        description_en: updated.description_en,
        image_url: updated.image_url
      };
    } else if (isMockMode) {
      const products = readMockFile('products.json');
      const pIndex = products.findIndex(p => p.product_id === parseInt(productId));
      if (pIndex === -1) return null;
      
      const updated = {
        ...products[pIndex],
        product_name: productData.product_name,
        category: productData.category,
        sub_category: productData.sub_category,
        color_type: productData.color_type,
        description_en: productData.description_en,
        image_url: productData.image_url || products[pIndex].image_url
      };
      products[pIndex] = updated;
      writeMockFile('products.json', products);
      return updated;
    } else {
      const res = await pool.query(
        'UPDATE products SET product_name = $1, category = $2, sub_category = $3, color_type = $4, description_en = $5, image_url = $6 WHERE product_id = $7 RETURNING *',
        [productData.product_name, productData.category, productData.sub_category, productData.color_type, productData.description_en, productData.image_url, productId]
      );
      return res.rows[0] || null;
    }
  },

  deleteProduct: async (productId) => {
    let sku = null;

    // Try to find the SKU of the product to delete
    try {
      if (isApiMode) {
        const filePath = path.join(__dirname, '../data/created_products.json');
        if (fs.existsSync(filePath)) {
          const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const found = list.find(p => p.product_id === parseInt(productId));
          if (found) {
            sku = found.sku;
          }
        }
      } else if (isMockMode) {
        const products = readMockFile('products.json');
        const found = products.find(p => p.product_id === parseInt(productId));
        if (found) {
          sku = found.sku;
        }
      } else {
        const res = await pool.query('SELECT sku FROM products WHERE product_id = $1', [productId]);
        if (res.rows && res.rows[0]) {
          sku = res.rows[0].sku;
        }
      }
    } catch (e) {
      console.warn('Failed to resolve SKU for deletion lookup:', e.message);
    }

    // Clean up corresponding stock records in all stores (inventory.json)
    removeProductStock(productId, sku);

    if (isApiMode) {
      // 1. Delete from local created_products.json
      try {
        const filePath = path.join(__dirname, '../data/created_products.json');
        if (fs.existsSync(filePath)) {
          let list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          list = list.filter(p => p.product_id !== parseInt(productId));
          fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
        }
      } catch (err) {
        console.warn('Failed to delete locally created product file:', err.message);
      }

      // 2. Call remote API. If it fails, ignore (since product is removed locally anyway)
      try {
        await apiCall(`/products/${productId}`, { method: 'DELETE' });
      } catch (apiErr) {
        console.warn(`Remote delete for product ${productId} failed:`, apiErr.message);
      }
      return true;
    } else if (isMockMode) {
      const products = readMockFile('products.json');
      const filtered = products.filter(p => p.product_id !== parseInt(productId));
      if (products.length === filtered.length) return false;
      writeMockFile('products.json', filtered);
      return true;
    } else {
      const res = await pool.query('DELETE FROM products WHERE product_id = $1', [productId]);
      return res.rowCount > 0;
    }
  },

  // --- Transactions ---
  getTransactions: async ({ storeId = null, paymentMethod = '', page = 1, limit = 15 }) => {
    // Helper to map employee role/store back to local account username
    const resolveUsernameFromEmployee = (emp) => {
      if (!emp) return 'System';
      const role = emp.role || emp.position || '';
      const storeId = emp.store_id;

      if (role === 'IT Admin') return 'admin';
      if (role === 'Director') return 'director';
      if (role === 'Store Manager') return storeId ? `manager${storeId}` : 'manager';
      if (role === 'Sales Staff') return storeId ? `sales${storeId}` : 'sales';
      
      const cleanRole = role.toLowerCase().replace(/\s+/g, '');
      return storeId ? `${cleanRole}${storeId}` : cleanRole;
    };

    if (isApiMode) {
      let url = '/transactions?limit=1000';
      if (paymentMethod) {
        url += `&payment_method=${encodeURIComponent(paymentMethod)}`;
      }
      
      const res = await apiCall(url);
      
      // Fetch employees to resolve name from employee_id
      let employees = [];
      try {
        const empRes = await apiCall('/employees?limit=1000');
        employees = empRes.data || [];
      } catch (err) {
        console.warn('Failed to fetch employees for transaction mapping:', err.message);
      }

      let list = (res.data || []).map(t => {
        const emp = employees.find(e => e.employee_id.toString() === (t.employee_id || '').toString());
        return {
          transaction_id: parseInt(t.transaction_id) || t.transaction_id,
          store_id: parseInt(t.store_id),
          customer_id: parseInt(t.customer_id),
          product_id: parseInt(t.product_id),
          sku: t.sku || `SKU-${t.product_id}`,
          product_name: `Sản phẩm #${t.product_id}`,
          date: t.transaction_date ? t.transaction_date.split('T')[0] : new Date().toISOString().split('T')[0],
          timestamp: t.transaction_date || new Date().toISOString(),
          salesperson: emp ? resolveUsernameFromEmployee(emp) : (t.employee_id || 'System'),
          payment_method: t.payment_method || 'Cash',
          currency: t.currency || 'USD',
          local_price: t.unit_price || 0,
          usd_price: t.unit_price || 0,
          quantity: t.quantity || 1,
          line_total: t.line_total || ((t.unit_price || 0) * (t.quantity || 1))
        };
      });

      if (storeId) {
        list = list.filter(t => t.store_id.toString() === storeId.toString());
      }

      const total = list.length;
      const offset = (page - 1) * limit;
      const paginatedData = list.slice(offset, offset + limit);

      return {
        data: paginatedData,
        total,
        page,
        limit
      };
    }

    const offset = (page - 1) * limit;
    if (isMockMode) {
      let data = readMockFile('transactions.json');
      if (storeId) {
        data = data.filter(t => t.store_id === parseInt(storeId));
      }
      if (paymentMethod) {
        data = data.filter(t => t.payment_method.toLowerCase() === paymentMethod.toLowerCase());
      }
      const total = data.length;
      return { data: data.slice(offset, offset + limit), total, page, limit };
    } else {
      let query = 'SELECT t.*, p.product_name FROM transactions t LEFT JOIN products p ON t.product_id = p.product_id WHERE 1=1';
      const params = [];
      let countQuery = 'SELECT COUNT(*) FROM transactions WHERE 1=1';
      const countParams = [];

      if (storeId) {
        params.push(storeId);
        query += ` AND t.store_id = $${params.length}`;
        countParams.push(storeId);
        countQuery += ` AND store_id = $${countParams.length}`;
      }
      if (paymentMethod) {
        params.push(paymentMethod);
        query += ` AND t.payment_method = $${params.length}`;
        countParams.push(paymentMethod);
        countQuery += ` AND payment_method = $${countParams.length}`;
      }

      const totalRes = await pool.query(countQuery, countParams);
      const total = parseInt(totalRes.rows[0].count);

      params.push(limit, offset);
      query += ` ORDER BY t.date DESC, t.transaction_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const dataRes = await pool.query(query, params);

      return { data: dataRes.rows, total, page, limit };
    }
  },

  addTransaction: async ({ store_id, customer_id, product_id, sku, quantity, payment_method, price, salesperson, customTxId }) => {
    if (isApiMode) {
      const txId = customTxId || (Date.now() + Math.floor(Math.random() * 1000)).toString();

      // Resolve a valid employee_id to satisfy the foreign key constraint on the database
      let resolvedEmployeeId = '1'; // Default fallback that is guaranteed to exist
      try {
        const empRes = await apiCall('/employees?limit=1000');
        const employees = empRes.data || [];
        // Try to find an employee belonging to the store
        const storeEmp = employees.find(e => e.store_id.toString() === store_id.toString());
        if (storeEmp) {
          resolvedEmployeeId = storeEmp.employee_id.toString();
        } else if (employees.length > 0) {
          resolvedEmployeeId = employees[0].employee_id.toString();
        }
      } catch (err) {
        console.warn('Failed to resolve employee_id, falling back to 1:', err);
      }

      const payload = {
        transaction_id: txId,
        store_id: store_id.toString(),
        customer_id: customer_id.toString(),
        employee_id: resolvedEmployeeId,
        product_id: product_id.toString(),
        sku: sku || `SKU-${product_id}`,
        quantity: parseInt(quantity),
        unit_price: parseFloat(price),
        currency: 'USD',
        discount_pct: 0.0,
        line_total: parseFloat(price) * parseInt(quantity),
        payment_method: payment_method,
        transaction_date: new Date().toISOString()
      };

      const res = await apiCall('/transactions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const created = res.data || res;
      return {
        transaction_id: parseInt(created.transaction_id),
        store_id: parseInt(created.store_id),
        customer_id: parseInt(created.customer_id),
        product_id: parseInt(created.product_id),
        sku: created.sku,
        product_name: `Sản phẩm #${created.product_id}`,
        date: created.transaction_date.split('T')[0],
        timestamp: created.transaction_date,
        salesperson: created.employee_id,
        payment_method: created.payment_method,
        currency: created.currency,
        local_price: created.unit_price,
        usd_price: created.unit_price,
        quantity: created.quantity,
        line_total: created.line_total
      };
    } else if (isMockMode) {
      const transactions = readMockFile('transactions.json');
      const products = readMockFile('products.json');
      const prod = products.find(p => p.product_id === parseInt(product_id)) || { product_name: `Sản phẩm ${sku}` };
      
      const newTx = {
        transaction_id: Date.now() + Math.floor(Math.random() * 1000),
        store_id: parseInt(store_id),
        customer_id: parseInt(customer_id),
        product_id: parseInt(product_id),
        sku,
        product_name: prod.product_name,
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        salesperson: salesperson || 'System',
        payment_method,
        currency: 'USD',
        local_price: parseFloat(price),
        usd_price: parseFloat(price),
        quantity: parseInt(quantity),
        line_total: parseFloat(price) * parseInt(quantity)
      };
      
      transactions.push(newTx);
      transactions.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
      writeMockFile('transactions.json', transactions);
      return newTx;
    } else {
      const sId = parseInt(store_id);
      const cId = parseInt(customer_id);
      const pId = parseInt(product_id);
      const qty = parseInt(quantity);
      const prc = parseFloat(price);
      const lineTotal = prc * qty;
      const dateStr = new Date().toISOString().split('T')[0];
      const timestampStr = new Date().toISOString();

      await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS salesperson VARCHAR(255)');
      await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

      const res = await pool.query(`
        INSERT INTO transactions (store_id, customer_id, product_id, sku, date, timestamp, salesperson, payment_method, currency, local_price, usd_price, quantity, line_total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USD', $9, $9, $10, $11)
        RETURNING *
      `, [sId, cId, pId, sku, dateStr, timestampStr, salesperson || 'System', payment_method, prc, qty, lineTotal]);
      return res.rows[0];
    }
  },

  // --- Demand Forecasts ---
  getForecasts: async (storeId) => {
    if (isApiMode) {
      if (!storeId || storeId === 'null') {
        return [];
      }
      const res = await apiCall(`/final-daily?store_id=${storeId}&limit=100`);
      const list = res.data || [];
      
      const result = [];
      list.forEach(f => {
        const dateObj = new Date(f.date);
        const year = dateObj.getFullYear();
        
        // Calculate Week number for the date
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (dateObj - firstDayOfYear) / 86400000;
        const week = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

        // 1. Add the real snapshot point
        const actualQty = Math.round(f.s_sales_velocity || 0);
        const predictedQty = Math.round(f.s_sales_velocity || f.s2_sales_velocity || 1) + 1;
        
        result.push({
          store_id: parseInt(f.store_id),
          sku: f.sku,
          product_name: `Sản phẩm ${f.sku}`,
          category: f.category || 'Clothing',
          year: year,
          week: week,
          predicted_quantity: predictedQty,
          actual_quantity: actualQty
        });

        // 2. Synthesize 5 weeks of history backwards (Weeks 11, 10, 9, 8, 7)
        const baseQty = actualQty > 0 ? actualQty : Math.floor(Math.random() * 3) + 1;
        for (let i = 1; i <= 5; i++) {
          const pastWeek = week - i;
          if (pastWeek <= 0) continue;
          
          const variance = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
          const pastActual = Math.max(0, baseQty + variance);
          const pastPredicted = Math.max(1, pastActual + (Math.floor(Math.random() * 2) - 1));

          result.push({
            store_id: parseInt(f.store_id),
            sku: f.sku,
            product_name: `Sản phẩm ${f.sku}`,
            category: f.category || 'Clothing',
            year: year,
            week: pastWeek,
            predicted_quantity: pastPredicted,
            actual_quantity: pastActual
          });
        }
      });

      // Sort chronological order (by year and week)
      return result.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.week - b.week;
      });
    } else if (isMockMode) {
      const data = readMockFile('forecasts.json');
      return data.filter(f => f.store_id === parseInt(storeId));
    } else {
      const res = await pool.query('SELECT * FROM forecasts WHERE store_id = $1 ORDER BY year ASC, week ASC', [storeId]);
      return res.rows;
    }
  },

  // --- Local User Administration (IT Admin) ---
  getUsers: async () => {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM users ORDER BY id ASC');
        return res.rows.map(u => ({
          id: parseInt(u.id),
          username: u.username,
          role: u.role || u.position || '',
          store_id: u.store_id ? parseInt(u.store_id) : null,
          mfa_enabled: !!u.mfa_enabled,
          mfa_secret: u.mfa_secret || null
        }));
      } catch (err) {
        console.warn('PostgreSQL getUsers failed, falling back to JSON:', err.message);
      }
    }
    return readMockFile('users.json');
  },

  addUser: async (userData) => {
    if (pool) {
      try {
        const res = await pool.query(
          'INSERT INTO users (username, password, role, store_id, mfa_enabled, mfa_secret) VALUES ($1, $2, $3, $4, false, null) RETURNING *',
          [userData.username, userData.password, userData.role, userData.store_id ? parseInt(userData.store_id) : null]
        );
        const u = res.rows[0];
        return {
          id: parseInt(u.id),
          username: u.username,
          role: u.role || u.position || '',
          store_id: u.store_id ? parseInt(u.store_id) : null,
          mfa_enabled: !!u.mfa_enabled,
          mfa_secret: u.mfa_secret || null
        };
      } catch (err) {
        console.warn('PostgreSQL addUser failed, falling back to JSON:', err.message);
      }
    }
    const users = readMockFile('users.json');
    const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    const newUser = {
      id: newId,
      username: userData.username,
      password: userData.password,
      role: userData.role,
      store_id: userData.store_id ? parseInt(userData.store_id) : null,
      mfa_enabled: false,
      mfa_secret: null
    };
    users.push(newUser);
    writeMockFile('users.json', users);
    return newUser;
  },

  updateUser: async (userId, userData) => {
    if (pool) {
      try {
        let query = 'UPDATE users SET role = $1, store_id = $2';
        const params = [userData.role, userData.store_id ? parseInt(userData.store_id) : null];
        
        if (userData.password) {
          params.push(userData.password);
          query += `, password = $${params.length}`;
        }
        if (userData.mfa_enabled !== undefined) {
          params.push(!!userData.mfa_enabled);
          query += `, mfa_enabled = $${params.length}`;
        }
        
        params.push(parseInt(userId));
        query += ` WHERE id = $${params.length} RETURNING *`;
        
        const res = await pool.query(query, params);
        if (res.rows.length > 0) {
          const u = res.rows[0];
          return {
            id: parseInt(u.id),
            username: u.username,
            role: u.role || u.position || '',
            store_id: u.store_id ? parseInt(u.store_id) : null,
            mfa_enabled: !!u.mfa_enabled,
            mfa_secret: u.mfa_secret || null
          };
        }
        return null;
      } catch (err) {
        console.warn('PostgreSQL updateUser failed, falling back to JSON:', err.message);
      }
    }
    const users = readMockFile('users.json');
    const uIndex = users.findIndex(u => u.id === parseInt(userId));
    if (uIndex === -1) return null;
    users[uIndex] = {
      ...users[uIndex],
      role: userData.role,
      store_id: userData.store_id ? parseInt(userData.store_id) : null,
      mfa_enabled: userData.mfa_enabled !== undefined ? userData.mfa_enabled : users[uIndex].mfa_enabled
    };
    if (userData.password) {
      users[uIndex].password = userData.password;
    }
    writeMockFile('users.json', users);
    return users[uIndex];
  },

  deleteUser: async (userId) => {
    if (pool) {
      try {
        const res = await pool.query('DELETE FROM users WHERE id = $1', [parseInt(userId)]);
        return res.rowCount > 0;
      } catch (err) {
        console.warn('PostgreSQL deleteUser failed, falling back to JSON:', err.message);
      }
    }
    const users = readMockFile('users.json');
    const filtered = users.filter(u => u.id !== parseInt(userId));
    if (users.length === filtered.length) return false;
    writeMockFile('users.json', filtered);
    return true;
  },

  updateUserMfa: async (userIdOrUsername, mfaData) => {
    if (pool) {
      try {
        const isNum = !isNaN(userIdOrUsername);
        const res = await pool.query(
          'UPDATE users SET mfa_enabled = $1, mfa_secret = $2 WHERE id = $3 OR username = $4',
          [!!mfaData.mfa_enabled, mfaData.mfa_secret, isNum ? parseInt(userIdOrUsername) : -1, userIdOrUsername.toString()]
        );
        return res.rowCount > 0;
      } catch (err) {
        console.warn('PostgreSQL updateUserMfa failed, falling back to JSON:', err.message);
      }
    }
    const users = readMockFile('users.json');
    const uIndex = users.findIndex(u => 
      u.id.toString() === userIdOrUsername.toString() || 
      u.username.toLowerCase() === userIdOrUsername.toString().toLowerCase()
    );
    if (uIndex === -1) return false;
    users[uIndex].mfa_enabled = mfaData.mfa_enabled;
    users[uIndex].mfa_secret = mfaData.mfa_secret;
    writeMockFile('users.json', users);
    return true;
  },

  // --- Dynamic Permissions ---
  getRolePermissions: async () => {
    return readMockFile('permissions.json');
  },

  updateRolePermissions: async (rolePermissionsMap) => {
    writeMockFile('permissions.json', rolePermissionsMap);
    return true;
  },

  // --- Audit Logs ---
  getAuditLogs: async () => {
    const logs = readMockFile('audit_logs.json');
    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  addAuditLog: async (logData) => {
    const newLog = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      username: logData.username || 'system',
      role: logData.role || 'System',
      action: logData.action,
      details: logData.details || '',
      ip: logData.ip || '127.0.0.1'
    };

    try {
      const logs = readMockFile('audit_logs.json');
      logs.push(newLog);
      if (logs.length > 1000) logs.shift();
      writeMockFile('audit_logs.json', logs);
    } catch (err) {
      console.error('Error writing audit log:', err);
    }
    return newLog;
  },

  // --- Inventory & Imports (API & Local Hybrid Mode) ---
  getInventory: async (storeId, search = '') => {
    if (isApiMode) {
      let productsList = [];
      try {
        productsList = await db.getProducts({});
      } catch (e) {}

      // Merge local created_products.json into productsList to resolve newly created items
      try {
        const filePath = path.join(__dirname, '../data/created_products.json');
        if (fs.existsSync(filePath)) {
          const localCreated = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (Array.isArray(localCreated)) {
            productsList = productsList.concat(localCreated);
          }
        }
      } catch (err) {
        console.warn('Failed to load local created products in getInventory:', err.message);
      }

      // Synchronous helper to resolve product name from cache or SKU matching
      const resolveProductName = (productId, sku) => {
        if (productId) {
          const prod = productsList.find(p => p.product_id === parseInt(productId));
          if (prod) return prod.product_name;
        }

        const skuDigits = sku ? sku.match(/\d+/) : null;
        const pId = skuDigits ? parseInt(skuDigits[0]) : null;
        if (pId) {
          const prod = productsList.find(p => p.product_id === pId);
          if (prod) return prod.product_name;
        }

        return `Sản phẩm ${sku}`;
      };

      if (!storeId || storeId === 'null') {
        let stockList = [];
        const limit = 1000;
        let offset = 0;
        let hasMore = true;
        const batchSize = 3;

        while (hasMore) {
          const promises = [];
          for (let i = 0; i < batchSize; i++) {
            const currentOffset = offset + (i * limit);
            let url = `/stock?limit=${limit}&offset=${currentOffset}`;
            if (search && (search.toUpperCase().startsWith('CH') || search.toUpperCase().startsWith('MA') || search.toUpperCase().startsWith('FE') || search.toUpperCase().startsWith('SKU'))) {
              url = `/stock?sku=${encodeURIComponent(search)}&limit=${limit}&offset=${currentOffset}`;
            }
            promises.push(apiCall(url).catch(err => {
              console.error(`Failed to fetch stock batch at offset ${currentOffset}:`, err.message);
              return { data: [] };
            }));
          }

          const results = await Promise.all(promises);
          let batchHasEmptyOrPartial = false;

          for (let r = 0; r < results.length; r++) {
            const pageData = results[r].data || [];
            stockList = stockList.concat(pageData);
            if (pageData.length < limit) {
              batchHasEmptyOrPartial = true;
            }
          }

          if (batchHasEmptyOrPartial) {
            hasMore = false;
          } else {
            offset += batchSize * limit;
          }
        }
        const localInventory = readMockFile('inventory.json');

        // Merge remote stock list with local inventory fallbacks
        let data = stockList.map(stockItem => {
          let category = 'Clothing';
          const skuUpper = stockItem.sku.toUpperCase();
          if (skuUpper.startsWith('CH')) category = 'Children';
          else if (skuUpper.startsWith('FE')) category = 'Feminine';
          else if (skuUpper.startsWith('MA')) category = 'Masculine';

          let qty = parseInt(stockItem.quantity) || 0;
          const localStock = localInventory.find(i => i.store_id.toString() === stockItem.store_id.toString() && i.sku === stockItem.sku);
          if (localStock && localStock.stock_quantity > qty) {
            qty = localStock.stock_quantity;
          }

          const productName = resolveProductName(null, stockItem.sku);

          return {
            store_id: parseInt(stockItem.store_id),
            sku: stockItem.sku,
            stock_quantity: qty,
            product_name: productName,
            category: category
          };
        });

        // Add any local stock items that aren't on the API
        localInventory.forEach(localStock => {
          const exists = data.some(d => d.store_id.toString() === localStock.store_id.toString() && d.sku === localStock.sku);
          if (!exists) {
            let category = 'Clothing';
            const skuUpper = localStock.sku.toUpperCase();
            if (skuUpper.startsWith('CH')) category = 'Children';
            else if (skuUpper.startsWith('FE')) category = 'Feminine';
            else if (skuUpper.startsWith('MA')) category = 'Masculine';

            const productName = resolveProductName(null, localStock.sku);

            data.push({
              store_id: localStock.store_id,
              sku: localStock.sku,
              stock_quantity: localStock.stock_quantity,
              product_name: productName,
              category: category
            });
          }
        });

        // Filter out test/garbage SKUs and only allow 3 categories
        data = data.filter(d => {
          const sku = d.sku || '';
          if (!sku) return false;
          if (sku.toLowerCase() === 'string') return false;
          if (sku.toLowerCase().includes('string')) return false;
          if (sku.startsWith('SKU-')) return false;
          if (sku === 'undefined') return false;
          return ['Children', 'Masculine', 'Feminine'].includes(d.category);
        });

        if (search) {
          const query = search.toLowerCase();
          data = data.filter(d => 
            d.sku.toLowerCase().includes(query) || 
            d.product_name.toLowerCase().includes(query) || 
            d.category.toLowerCase().includes(query)
          );
        }
        return data;
      }

      // 1. Fetch SKUs for store from remote API
      const skusRes = await apiCall(`/skus?store_id=${storeId}`);
      const skusList = skusRes.data || [];

      // 2. Fetch remote stock levels specifically for this store
      let stockUrl = `/stock?store_id=${storeId}&limit=1000`;
      if (search && (search.toUpperCase().startsWith('CH') || search.toUpperCase().startsWith('MA') || search.toUpperCase().startsWith('FE') || search.toUpperCase().startsWith('SKU'))) {
        stockUrl = `/stock?store_id=${storeId}&sku=${encodeURIComponent(search)}&limit=100`;
      }
      const stockRes = await apiCall(stockUrl);
      const stockList = stockRes.data || [];

      // 3. Read local inventory (fallback)
      const localInventory = readMockFile('inventory.json');

      let data = skusList.map(item => {
        const stockItem = stockList.find(s => s.store_id.toString() === storeId.toString() && s.sku === item.sku);
        let qty = stockItem ? parseInt(stockItem.quantity) : 0;
        
        // Merge with local stock if local is higher (since local handles fallback updates)
        const localStock = localInventory.find(i => i.store_id === parseInt(storeId) && i.sku === item.sku);
        if (localStock && localStock.stock_quantity > qty) {
          qty = localStock.stock_quantity;
        }
        if (!stockItem && !localStock) {
          qty = 0; // default for remote SKUs when they don't have stock records yet
        }

        const skuUpperMap = item.sku.toUpperCase();
        let catFromSku = 'Other';
        if (skuUpperMap.startsWith('CH')) catFromSku = 'Children';
        else if (skuUpperMap.startsWith('FE')) catFromSku = 'Feminine';
        else if (skuUpperMap.startsWith('MA')) catFromSku = 'Masculine';

        const productName = resolveProductName(item.product_id, item.sku);

        return {
          store_id: parseInt(storeId),
          sku: item.sku,
          stock_quantity: qty,
          product_name: productName,
          category: catFromSku
        };
      });

      // Merge new stock items that are not in skusList to ensure immediate visibility
      stockList.forEach(stockItem => {
        if (stockItem.store_id.toString() === storeId.toString()) {
          const exists = data.some(d => d.sku === stockItem.sku);
          if (!exists) {
            let category = 'Clothing';
            const skuUpper = stockItem.sku.toUpperCase();
            if (skuUpper.startsWith('CH')) category = 'Children';
            else if (skuUpper.startsWith('FE')) category = 'Feminine';
            else if (skuUpper.startsWith('MA')) category = 'Masculine';

            const productName = resolveProductName(null, stockItem.sku);

            data.push({
              store_id: parseInt(storeId),
              sku: stockItem.sku,
              stock_quantity: parseInt(stockItem.quantity) || 0,
              product_name: productName,
              category: category
            });
          }
        }
      });

      // Merge local inventory items that are not in data to ensure immediate visibility of local creations/fallback stock
      localInventory.forEach(localStock => {
        if (localStock.store_id.toString() === storeId.toString()) {
          const exists = data.some(d => d.sku === localStock.sku);
          if (!exists) {
            let category = 'Clothing';
            const skuUpper = localStock.sku.toUpperCase();
            if (skuUpper.startsWith('CH')) category = 'Children';
            else if (skuUpper.startsWith('FE')) category = 'Feminine';
            else if (skuUpper.startsWith('MA')) category = 'Masculine';

            const productName = resolveProductName(null, localStock.sku);

            data.push({
              store_id: parseInt(storeId),
              sku: localStock.sku,
              stock_quantity: localStock.stock_quantity,
              product_name: productName,
              category: category
            });
          }
        }
      });

      // Filter out test/garbage SKUs (string, SKU-undefined, SKU-{timestamp}, etc.)
      data = data.filter(d => {
        const sku = d.sku || '';
        if (!sku) return false;
        if (sku.toLowerCase() === 'string') return false;
        if (sku.toLowerCase().includes('string')) return false;
        if (sku.startsWith('SKU-')) return false; // test garbage SKUs
        if (sku === 'undefined') return false;
        return true;
      });

      // Only allow 3 categories: Children, Masculine, Feminine
      data = data.filter(d => ['Children', 'Masculine', 'Feminine'].includes(d.category));

      if (search) {
        const query = search.toLowerCase();
        data = data.filter(d => 
          d.sku.toLowerCase().includes(query) || 
          d.product_name.toLowerCase().includes(query) || 
          d.category.toLowerCase().includes(query)
        );
      }
      return data;
    } else if (isMockMode) {
      let inventory = readMockFile('inventory.json');
      const skus = readMockFile('skus.json');
      const products = readMockFile('products.json');

      if (storeId) {
        inventory = inventory.filter(i => i.store_id === parseInt(storeId));
      }

      let data = inventory.map(item => {
        const skuInfo = skus.find(s => s.sku === item.sku);
        const prod = skuInfo ? products.find(p => p.product_id === skuInfo.product_id) : null;
        return {
          store_id: item.store_id,
          sku: item.sku,
          stock_quantity: item.stock_quantity,
          product_name: prod ? prod.product_name : `Sản phẩm ${item.sku}`,
          category: prod ? prod.category : 'Clothing'
        };
      });

      // Filter out 'string' test SKUs
      data = data.filter(d => d.sku && d.sku.toLowerCase() !== 'string' && !d.sku.toLowerCase().includes('string'));

      if (search) {
        const query = search.toLowerCase();
        data = data.filter(d => 
          d.sku.toLowerCase().includes(query) || 
          d.product_name.toLowerCase().includes(query) || 
          d.category.toLowerCase().includes(query)
        );
      }
      return data;
    } else {
      let query = `
        SELECT i.store_id, i.sku, i.stock_quantity, p.product_name, p.category 
        FROM inventory i
        JOIN skus s ON i.sku = s.sku
        JOIN products p ON s.product_id = p.product_id
        WHERE 1=1
      `;
      const params = [];
      if (storeId) {
        params.push(parseInt(storeId));
        query += ` AND i.store_id = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (i.sku ILIKE $${params.length} OR p.product_name ILIKE $${params.length} OR p.category ILIKE $${params.length})`;
      }
      const res = await pool.query(query, params);
      return res.rows.filter(d => d.sku && d.sku.toLowerCase() !== 'string' && !d.sku.toLowerCase().includes('string'));
    }
  },

  getInventoryImports: async (storeId) => {
    let list = [];
    if (isApiMode) {
      try {
        const res = await apiCall('/stock-imports?limit=1000');
        list = (res.data || []).map(item => ({
          import_id: parseInt(item.import_id || Date.now()),
          store_id: parseInt(item.store_id),
          sku: item.sku,
          quantity: parseInt(item.quantity_imported || item.quantity || 0),
          import_date: item.import_date || item.created_at || new Date().toISOString(),
          supplier: item.supplier || 'N/A'
        }));
      } catch (err) {
        console.error('Error fetching API stock-imports:', err.message);
      }
    }

    // Merge/Fallback with local imports (always pull local logs as backup/failsafe)
    try {
      const localImports = readMockFile('inventory_imports.json') || [];
      localImports.forEach(localItem => {
        const exists = list.some(d => d.import_id.toString() === localItem.import_id.toString());
        if (!exists) {
          list.push({
            import_id: parseInt(localItem.import_id),
            store_id: parseInt(localItem.store_id),
            sku: localItem.sku,
            quantity: parseInt(localItem.quantity || 0),
            import_date: localItem.import_date,
            supplier: localItem.supplier || 'N/A'
          });
        }
      });
    } catch (err) {
      console.warn('Failed to read local fallback imports:', err.message);
    }

    if (storeId) {
      list = list.filter(i => i.store_id.toString() === storeId.toString());
    }

    const stores = await db.getStores();
    list.sort((a, b) => {
      const diff = new Date(b.import_date) - new Date(a.import_date);
      if (diff !== 0) return diff;
      return parseInt(b.import_id || 0) - parseInt(a.import_id || 0);
    });

    // Fetch products to look up real product names
    let productsList = [];
    try {
      productsList = await db.getProducts({});
    } catch (e) {}

    return list.slice(0, 150).map(item => {
      const store = stores.find(s => s.store_id === item.store_id);

      // Look up real product name
      let productName = `Sản phẩm ${item.sku}`;
      const skuDigits = item.sku.match(/\d+/);
      if (skuDigits) {
        const pId = parseInt(skuDigits[0]);
        const prod = productsList.find(p => p.product_id === pId);
        if (prod) {
          productName = prod.product_name;
        }
      }

      return {
        ...item,
        store_name: store ? store.store_name : `Store #${item.store_id}`,
        product_name: productName
      };
    });
  },

  addInventoryImport: async ({ store_id, sku, quantity, supplier }) => {
    const qty = parseInt(quantity);
    const storeId = parseInt(store_id);

    if (isApiMode) {
      // POST /stock-imports - API tự động cập nhật stock và ghi log trong 1 lần gọi
      try {
        const importRes = await apiCall('/stock-imports', {
          method: 'POST',
          body: JSON.stringify({
            store_id: storeId,
            sku: sku,
            quantity_imported: qty,
            import_date: new Date().toISOString(),
            supplier: supplier || null
          })
        });

        const apiImport = importRes.data || {};
        const newStock = importRes.new_stock_quantity || qty;

        // Also sync local inventory cache
        const inventory = readMockFile('inventory.json');
        let localItem = inventory.find(i => i.store_id === storeId && i.sku === sku);
        if (localItem) {
          localItem.stock_quantity = newStock;
        } else {
          inventory.push({ store_id: storeId, sku, stock_quantity: newStock });
        }
        writeMockFile('inventory.json', inventory);

        // Log locally as well for instant display
        const imports = readMockFile('inventory_imports.json');
        const newImport = {
          import_id: parseInt(apiImport.import_id) || Date.now(),
          store_id: storeId,
          sku,
          quantity: qty,
          import_date: new Date().toISOString(),
          supplier
        };
        imports.push(newImport);
        writeMockFile('inventory_imports.json', imports);
        return newImport;
      } catch (err) {
        console.warn(`API /stock-imports failed (${err.message}). Falling back to local-only import.`);
        // Fallback: log locally only
        const inventory = readMockFile('inventory.json');
        let localItem = inventory.find(i => i.store_id === storeId && i.sku === sku);
        if (localItem) {
          localItem.stock_quantity += qty;
        } else {
          inventory.push({ store_id: storeId, sku, stock_quantity: qty });
        }
        writeMockFile('inventory.json', inventory);

        const imports = readMockFile('inventory_imports.json');
        const newImport = {
          import_id: Date.now() + Math.floor(Math.random() * 1000),
          store_id: storeId,
          sku,
          quantity: qty,
          import_date: new Date().toISOString(),
          supplier
        };
        imports.push(newImport);
        writeMockFile('inventory_imports.json', imports);
        return newImport;
      }
    }

    // 1. Update Local Inventory
    const inventory = readMockFile('inventory.json');
    let item = inventory.find(i => i.store_id === storeId && i.sku === sku);
    if (item) {
      item.stock_quantity += qty;
    } else {
      item = { store_id: storeId, sku, stock_quantity: qty };
      inventory.push(item);
    }
    writeMockFile('inventory.json', inventory);

    // 2. Add Import Log
    const imports = readMockFile('inventory_imports.json');
    const newImport = {
      import_id: Date.now() + Math.floor(Math.random() * 1000),
      store_id: storeId,
      sku,
      quantity: qty,
      import_date: new Date().toISOString(),
      supplier
    };
    imports.push(newImport);
    writeMockFile('inventory_imports.json', imports);

    return newImport;
  },

  decreaseStock: async (storeId, sku, quantity) => {
    const qty = parseInt(quantity);
    const sId = parseInt(storeId);
    
    if (isApiMode) {
      let currentQty = 0;
      let exists = false;
      try {
        const stockRes = await apiCall('/stock?limit=1000');
        const stockList = stockRes.data || [];
        const stockItem = stockList.find(s => s.store_id.toString() === sId.toString() && s.sku === sku);
        if (stockItem) {
          currentQty = parseInt(stockItem.quantity);
          exists = true;
        }
      } catch (err) {
        console.warn('Failed to query remote stock level for decrease:', err.message);
      }

      // Check local inventory fallback if remote check failed or is lower
      const inventory = readMockFile('inventory.json');
      let localItem = inventory.find(i => i.store_id === sId && i.sku === sku);
      const stockToUse = Math.max(currentQty, localItem ? localItem.stock_quantity : 100);

      if (stockToUse < qty) {
        throw new Error(`Không đủ hàng tồn kho. Lượng tồn kho hiện tại: ${stockToUse}`);
      }

      try {
        if (exists) {
          await apiCall(`/stock/${sId}/${sku}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: stockToUse - qty })
          });
        }
      } catch (err) {
        console.warn(`API stock decrease failed (${err.message}). Updating local fallback stock.`);
      }

      // Update local fallback stock
      if (localItem) {
        localItem.stock_quantity = stockToUse - qty;
      } else {
        inventory.push({ store_id: sId, sku, stock_quantity: stockToUse - qty });
      }
      writeMockFile('inventory.json', inventory);
      
      return stockToUse - qty;
    }

    const inventory = readMockFile('inventory.json');
    let item = inventory.find(i => i.store_id === sId && i.sku === sku);
    if (!item) {
      item = { store_id: sId, sku, stock_quantity: 100 };
      inventory.push(item);
    }
    if (item.stock_quantity < qty) {
      throw new Error(`Không đủ hàng tồn kho. Lượng tồn kho hiện tại: ${item.stock_quantity}`);
    }
    item.stock_quantity -= qty;
    writeMockFile('inventory.json', inventory);
    return item.stock_quantity;
  }
};

module.exports = db;
