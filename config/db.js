const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const generateMockData = require('./mock_db_generator');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Setup DB Mode
let isMockMode = false;
let pool = null;

// Check if credentials are provided in .env
const hasCredentials = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

if (hasCredentials) {
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 5432,
      // Short connection timeout so we fallback quickly if offline
      connectionTimeoutMillis: 3000
    });
    console.log('PostgreSQL database pool created.');
  } catch (err) {
    console.warn('Failed to initialize PostgreSQL pool. Falling back to Mock Mode.', err.message);
    isMockMode = true;
  }
} else {
  console.log('No DB credentials found in .env. Running in Mock Mode.');
  isMockMode = true;
}

// Function to read a JSON file in Mock Mode
function readMockFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    // Generate mock files synchronously if missing
    // We run generator from child process or direct call
    // Generator is imported so we can call it
    // Wait, generateMockData is async but we can block or run it
    throw new Error(`Mock file ${fileName} not found. Please run generator script first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeMockFile(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Check database connection or switch to mock
async function initDatabase() {
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
    // Try a simple query to verify connection
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
  isMock: () => isMockMode,
  init: initDatabase,

  // --- Auth & Users ---
  getUserByUsername: async (username) => {
    if (isMockMode) {
      const users = readMockFile('users.json');
      return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
    } else {
      const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      return res.rows[0] || null;
    }
  },

  // --- Stores ---
  getStores: async () => {
    if (isMockMode) {
      return readMockFile('stores.json');
    } else {
      const res = await pool.query('SELECT * FROM stores ORDER BY store_id ASC');
      return res.rows;
    }
  },

  getStoreById: async (storeId) => {
    if (isMockMode) {
      const stores = readMockFile('stores.json');
      return stores.find(s => s.store_id === parseInt(storeId)) || null;
    } else {
      const res = await pool.query('SELECT * FROM stores WHERE store_id = $1', [storeId]);
      return res.rows[0] || null;
    }
  },

  // --- Customers ---
  getCustomers: async ({ page = 1, limit = 10, search = '', gender = '' }) => {
    const offset = (page - 1) * limit;
    
    if (isMockMode) {
      let data = readMockFile('customers.json');
      
      // Filter
      if (search) {
        data = data.filter(c => c.customer_name.toLowerCase().includes(search.toLowerCase()) || c.customer_id.toString().includes(search));
      }
      if (gender) {
        data = data.filter(c => c.gender.toLowerCase() === gender.toLowerCase());
      }
      
      const total = data.length;
      const paginatedData = data.slice(offset, offset + limit);
      
      return { data: paginatedData, total, page, limit };
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
    if (isMockMode) {
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

  // --- Discounts ---
  getDiscounts: async (storeId = null) => {
    if (isMockMode) {
      let data = readMockFile('discounts.json');
      if (storeId) {
        data = data.filter(d => d.store_id === parseInt(storeId));
      }
      return data;
    } else {
      if (storeId) {
        const res = await pool.query('SELECT * FROM discounts WHERE store_id = $1 ORDER BY start_date DESC', [storeId]);
        return res.rows;
      } else {
        const res = await pool.query('SELECT * FROM discounts ORDER BY start_date DESC');
        return res.rows;
      }
    }
  },

  updateDiscountAvg: async (discountId, newDiscountAvg) => {
    if (isMockMode) {
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

  // --- Employees ---
  getEmployees: async (storeId = null) => {
    if (isMockMode) {
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
    if (isMockMode) {
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

  // --- Products ---
  getProducts: async ({ storeId = null, category = '', search = '' }) => {
    if (isMockMode) {
      let productsList = readMockFile('products.json');
      
      if (category) {
        productsList = productsList.filter(p => p.category.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        productsList = productsList.filter(p => p.product_name.toLowerCase().includes(search.toLowerCase()) || p.description_en.toLowerCase().includes(search.toLowerCase()));
      }
      
      // If storeId is provided, we simulate products available at this store.
      // In mock, we let all products be available.
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

  // --- Transactions ---
  getTransactions: async ({ storeId = null, paymentMethod = '', page = 1, limit = 15 }) => {
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
      const paginatedData = data.slice(offset, offset + limit);

      return { data: paginatedData, total, page, limit };
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

  // --- New CRUD Operations ---

  // Customers
  deleteCustomer: async (customerId) => {
    if (isMockMode) {
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

  // Discounts
  addDiscount: async (discountData) => {
    if (isMockMode) {
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
    if (isMockMode) {
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

  // Employees
  addEmployee: async (employeeData) => {
    if (isMockMode) {
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
    if (isMockMode) {
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

  // Products
  addProduct: async (productData) => {
    if (isMockMode) {
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
    if (isMockMode) {
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
    if (isMockMode) {
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

  // --- Demand Forecasts ---
  getForecasts: async (storeId) => {
    if (isMockMode) {
      const data = readMockFile('forecasts.json');
      return data.filter(f => f.store_id === parseInt(storeId));
    } else {
      const res = await pool.query('SELECT * FROM forecasts WHERE store_id = $1 ORDER BY year ASC, week ASC', [storeId]);
      return res.rows;
    }
  }
};

module.exports = db;
