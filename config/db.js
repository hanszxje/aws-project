const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const generateMockData = require('./mock_db_generator');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Setup DB Modes
const API_BASE_URL = process.env.API_BASE_URL ? process.env.API_BASE_URL.replace(/\/$/, '') : null;
const isApiMode = !!API_BASE_URL;

let isMockMode = false;
let pool = null;

// Only initialize PostgreSQL pool if not in API mode and credentials are provided
const hasCredentials = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

if (!isApiMode && hasCredentials) {
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
    console.warn('Failed to initialize PostgreSQL pool. Falling back to Mock Mode.', err.message);
    isMockMode = true;
  }
} else if (!isApiMode) {
  console.log('No DB credentials found in .env. Running in Mock Mode.');
  isMockMode = true;
} else {
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

// Generic API helper in API Mode
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
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
              "Director": ["view_dashboard", "view_all_stores", "view_customers", "view_discounts", "view_employees", "view_products", "view_transactions", "view_inventory", "manage_inventory", "create_transaction"],
              "Finance/Auditor": ["view_all_stores", "view_transactions", "view_discounts", "view_inventory"],
              "Inventory Manager": ["view_all_stores", "view_products", "edit_products", "view_inventory", "manage_inventory"],
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
    const users = readMockFile('users.json');
    return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
  },

  // --- Stores ---
  getStores: async () => {
    if (isApiMode) {
      const res = await apiCall('/stores?limit=1000');
      return (res.data || []).map(s => ({
        store_id: parseInt(s.store_id),
        store_name: s.name || `Store #${s.store_id}`,
        latitude: s.latitude || 0,
        longitude: s.longitude || 0,
        country: s.country || 'Global',
        num_distinct_skus: s.num_employees || 10, // reuse num_employees or similar
        num_distinct_products: s.num_employees || 10
      }));
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
  getCustomers: async ({ page = 1, limit = 10, search = '', gender = '' }) => {
    if (isApiMode) {
      const res = await apiCall('/customers?limit=1000');
      let list = (res.data || []).map(c => ({
        customer_id: parseInt(c.customer_id),
        customer_name: c.name || `Khách hàng #${c.customer_id}`,
        age: c.age || 30,
        gender: c.gender === 'M' ? 'Male' : (c.gender === 'F' ? 'Female' : c.gender || 'Unknown'),
        country: c.country || 'United States'
      }));

      // Filter in-memory
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
      let data = readMockFile('customers.json');
      if (search) {
        data = data.filter(c => c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.customer_id.toString().includes(search));
      }
      if (gender) {
        data = data.filter(c => c.gender.toLowerCase() === gender.toLowerCase());
      }
      const total = data.length;
      return { data: data.slice(offset, offset + limit), total, page, limit };
    } else {
      let query = 'SELECT * FROM customers WHERE 1=1';
      const params = [];
      let countQuery = 'SELECT COUNT(*) FROM customers WHERE 1=1';
      const countParams = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (customer_name ILIKE $${params.length} OR customer_id::text ILIKE $${params.length})`;
        countParams.push(`%${search}%`);
        countQuery += ` AND (customer_name ILIKE $${countParams.length} OR customer_id::text ILIKE $${countParams.length})`;
      }
      if (gender) {
        params.push(gender);
        query += ` AND gender = $${params.length}`;
        countParams.push(gender);
        countQuery += ` AND gender = $${countParams.length}`;
      }

      const totalRes = await pool.query(countQuery, countParams);
      const total = parseInt(totalRes.rows[0].count);

      params.push(limit, offset);
      query += ` ORDER BY customer_id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const dataRes = await pool.query(query, params);
      
      return { data: dataRes.rows, total, page, limit };
    }
  },

  addCustomer: async (customerData) => {
    if (isApiMode) {
      const nextId = Date.now() + Math.floor(Math.random() * 1000);

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
      return {
        customer_id: parseInt(created.customer_id),
        customer_name: created.name,
        age: created.age,
        gender: created.gender === 'M' ? 'Male' : (created.gender === 'F' ? 'Female' : created.gender),
        country: created.country
      };
    } else if (isMockMode) {
      const customers = readMockFile('customers.json');
      const newId = customers.length > 0 ? Math.max(...customers.map(c => c.customer_id)) + 1 : 10001;
      const newCustomer = {
        customer_id: newId,
        customer_name: customerData.customer_name,
        age: parseInt(customerData.age),
        gender: customerData.gender,
        country: customerData.country
      };
      customers.push(newCustomer);
      writeMockFile('customers.json', customers);
      return newCustomer;
    } else {
      const res = await pool.query(
        'INSERT INTO customers (customer_name, age, country, gender) VALUES ($1, $2, $3, $4) RETURNING *',
        [customerData.customer_name, customerData.age, customerData.country, customerData.gender]
      );
      return res.rows[0];
    }
  },

  deleteCustomer: async (customerId) => {
    if (isApiMode) {
      await apiCall(`/customers/${customerId}`, { method: 'DELETE' });
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
    if (isApiMode) {
      let url = '/discounts?limit=1000';
      const res = await apiCall(url);
      let list = (res.data || []).map(d => ({
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
      return list;
    } else if (isMockMode) {
      let data = readMockFile('discounts.json');
      if (storeId) {
        data = data.filter(d => !d.store_id || d.store_id === parseInt(storeId));
      }
      return data;
    } else {
      if (storeId) {
        const res = await pool.query('SELECT * FROM discounts WHERE store_id = $1 OR store_id IS NULL ORDER BY start_date DESC', [storeId]);
        return res.rows;
      } else {
        const res = await pool.query('SELECT * FROM discounts ORDER BY start_date DESC');
        return res.rows;
      }
    }
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
        let url = '/products?limit=100'; // reduced from 1000 to prevent server 500 error
        if (category) {
          url += `&category=${encodeURIComponent(category)}`;
        }
        const res = await apiCall(url);
        let list = (res.data || []).map(p => ({
          product_id: parseInt(p.product_id),
          product_name: p.description_en || p.name_en || `Sản phẩm #${p.product_id}`,
          category: p.category || 'Clothing',
          sub_category: p.sub_category || 'Other',
          color_type: p.color_type || 'Cor Unica',
          description_en: p.description_en || `Sản phẩm #${p.product_id}`,
          image_url: p.image_url || `https://picsum.photos/300/300?random=${p.product_id}`
        }));

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
            let list = localProducts;
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
      return res.rows;
    }
  },

  addProduct: async (productData) => {
    if (isApiMode) {
      const nextId = Date.now() + Math.floor(Math.random() * 1000);

      const payload = {
        product_id: nextId.toString(),
        sku: `SKU-${nextId}`,
        description_en: productData.product_name || productData.description_en,
        category: productData.category,
        sub_category: productData.sub_category,
        color: 'NEUTRAL',
        size: 'M',
        price: 50.0,
        image_url: productData.image_url || `https://picsum.photos/300/300?random=${nextId}`
      };

      const res = await apiCall('/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const created = res.data || res;
      return {
        product_id: parseInt(created.product_id),
        product_name: created.description_en,
        category: created.category,
        sub_category: created.sub_category,
        color_type: 'Cor Unica',
        description_en: created.description_en,
        image_url: created.image_url
      };
    } else if (isMockMode) {
      const products = readMockFile('products.json');
      const newId = products.length > 0 ? Math.max(...products.map(p => p.product_id)) + 1 : 1000;
      const newProduct = {
        product_id: newId,
        product_name: productData.product_name,
        category: productData.category,
        sub_category: productData.sub_category,
        color_type: productData.color_type,
        description_en: productData.description_en,
        image_url: productData.image_url || `https://picsum.photos/300/300?random=${newId}`
      };
      products.push(newProduct);
      writeMockFile('products.json', products);
      return newProduct;
    } else {
      const res = await pool.query(
        'INSERT INTO products (product_name, category, sub_category, color_type, description_en, image_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [productData.product_name, productData.category, productData.sub_category, productData.color_type, productData.description_en, productData.image_url]
      );
      return res.rows[0];
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
    if (isApiMode) {
      await apiCall(`/products/${productId}`, { method: 'DELETE' });
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
    if (isApiMode) {
      let url = '/transactions?limit=1000';
      if (paymentMethod) {
        url += `&payment_method=${encodeURIComponent(paymentMethod)}`;
      }
      
      const res = await apiCall(url);
      let list = (res.data || []).map(t => ({
        transaction_id: parseInt(t.transaction_id) || t.transaction_id,
        store_id: parseInt(t.store_id),
        customer_id: parseInt(t.customer_id),
        product_id: parseInt(t.product_id),
        sku: t.sku || `SKU-${t.product_id}`,
        product_name: `Sản phẩm #${t.product_id}`,
        date: t.transaction_date ? t.transaction_date.split('T')[0] : new Date().toISOString().split('T')[0],
        timestamp: t.transaction_date || new Date().toISOString(),
        salesperson: t.employee_id || 'System',
        payment_method: t.payment_method || 'Cash',
        currency: t.currency || 'USD',
        local_price: t.unit_price || 0,
        usd_price: t.unit_price || 0,
        quantity: t.quantity || 1,
        line_total: t.line_total || ((t.unit_price || 0) * (t.quantity || 1))
      }));

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

  addTransaction: async ({ store_id, customer_id, product_id, sku, quantity, payment_method, price, salesperson }) => {
    if (isApiMode) {
      const txId = (Date.now() + Math.floor(Math.random() * 1000)).toString();
      const payload = {
        transaction_id: txId,
        store_id: store_id.toString(),
        customer_id: customer_id.toString(),
        employee_id: salesperson || 'System',
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
    return readMockFile('users.json');
  },

  addUser: async (userData) => {
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
    const users = readMockFile('users.json');
    const filtered = users.filter(u => u.id !== parseInt(userId));
    if (users.length === filtered.length) return false;
    writeMockFile('users.json', filtered);
    return true;
  },

  updateUserMfa: async (userId, mfaData) => {
    const users = readMockFile('users.json');
    const uIndex = users.findIndex(u => u.id === parseInt(userId));
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
      if (!storeId || storeId === 'null') {
        // Fetch all stock levels from remote API (All Stores)
        const stockRes = await apiCall('/stock?limit=1000');
        const stockList = stockRes.data || [];
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

          return {
            store_id: parseInt(stockItem.store_id),
            sku: stockItem.sku,
            stock_quantity: qty,
            product_name: `Sản phẩm ${stockItem.sku}`,
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

            data.push({
              store_id: localStock.store_id,
              sku: localStock.sku,
              stock_quantity: localStock.stock_quantity,
              product_name: `Sản phẩm ${localStock.sku}`,
              category: category
            });
          }
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

      // 2. Fetch remote stock levels
      const stockRes = await apiCall('/stock?limit=1000');
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
          qty = 100; // default for remote SKUs so we can sell them
        }

        return {
          store_id: parseInt(storeId),
          sku: item.sku,
          stock_quantity: qty,
          product_name: `Sản phẩm ${item.sku}`,
          category: item.category || 'Clothing'
        };
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
      return res.rows;
    }
  },

  getInventoryImports: async (storeId) => {
    if (isApiMode) {
      try {
        const res = await apiCall('/stock-imports?limit=1000');
        let list = (res.data || []).map(item => ({
          import_id: parseInt(item.import_id || Date.now()),
          store_id: parseInt(item.store_id),
          sku: item.sku,
          quantity: parseInt(item.quantity),
          import_date: item.created_at || new Date().toISOString(),
          supplier: item.supplier || 'N/A'
        }));

        if (storeId) {
          list = list.filter(i => i.store_id.toString() === storeId.toString());
        }
        
        const stores = await db.getStores();
        list.sort((a, b) => new Date(b.import_date) - new Date(a.import_date));

        return list.slice(0, 150).map(item => {
          const store = stores.find(s => s.store_id === item.store_id);
          return {
            ...item,
            store_name: store ? store.store_name : `Store #${item.store_id}`,
            product_name: `Sản phẩm ${item.sku}`
          };
        });
      } catch (err) {
        console.error('Error fetching API stock-imports:', err.message);
      }
    }

    const imports = readMockFile('inventory_imports.json');
    const stores = await db.getStores();

    let list = imports;
    if (storeId) {
      list = imports.filter(i => i.store_id === parseInt(storeId));
    }

    list.sort((a, b) => new Date(b.import_date) - new Date(a.import_date));

    return list.slice(0, 150).map(item => {
      const store = stores.find(s => s.store_id === item.store_id);
      return {
        ...item,
        store_name: store ? store.store_name : `Store #${item.store_id}`,
        product_name: `Sản phẩm ${item.sku}`
      };
    });
  },

  addInventoryImport: async ({ store_id, sku, quantity, supplier }) => {
    const qty = parseInt(quantity);
    const storeId = parseInt(store_id);

    if (isApiMode) {
      // 1. Update remote stock
      let currentQty = 0;
      let exists = false;
      try {
        const stockRes = await apiCall('/stock?limit=1000');
        const stockList = stockRes.data || [];
        const stockItem = stockList.find(s => s.store_id.toString() === storeId.toString() && s.sku === sku);
        if (stockItem) {
          currentQty = parseInt(stockItem.quantity);
          exists = true;
        }
      } catch (err) {
        console.warn('Failed to query remote stock level:', err.message);
      }

      try {
        if (exists) {
          await apiCall(`/stock/${storeId}/${sku}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: currentQty + qty })
          });
        } else {
          await apiCall('/stock', {
            method: 'POST',
            body: JSON.stringify({
              store_id: storeId,
              sku: sku,
              quantity: qty
            })
          });
        }
      } catch (err) {
        console.warn(`API stock update failed (${err.message}). Updating local fallback stock.`);
      }

      // 2. Always log locally and update local inventory as backup
      const inventory = readMockFile('inventory.json');
      let localItem = inventory.find(i => i.store_id === storeId && i.sku === sku);
      if (localItem) {
        localItem.stock_quantity = Math.max(localItem.stock_quantity + qty, currentQty + qty);
      } else {
        inventory.push({ store_id: storeId, sku, stock_quantity: currentQty + qty });
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
