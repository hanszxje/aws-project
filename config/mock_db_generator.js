const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ISO Week Number Helper
function getWeekNumber(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  // January 4 is always in week 1.
  const week1 = new Date(date.getFullYear(), 0, 4);
  // Adjust to Thursday in week 1 and calculate difference in weeks
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return {
    year: date.getFullYear(),
    week: weekNum
  };
}

async function generateMockData() {
  const sampleDataPath = path.join(DATA_DIR, 'sample_data.json');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  if (fs.existsSync(sampleDataPath)) {
    console.log('Detected sample_data.json. Parsing and converting to relational tables...');
    try {
      const rawData = fs.readFileSync(sampleDataPath, 'utf8');
      const sampleData = JSON.parse(rawData);

      // 1. Extract Unique Stores
      const storesMap = {};
      sampleData.forEach(row => {
        const id = row.store_id;
        if (!storesMap[id]) {
          storesMap[id] = {
            store_id: id,
            store_name: row.store_name || `Store #${id}`,
            latitude: row.lat || 0,
            longitude: row.lon || 0,
            country: row.country || 'Global',
            skusSet: new Set(),
            productsSet: new Set()
          };
        }
        if (row.products && Array.isArray(row.products)) {
          row.products.forEach(p => {
            storesMap[id].skusSet.add(p.id);
            const pId = parseInt(p.id) || p.id;
            storesMap[id].productsSet.add(pId);
          });
        }
      });

      const stores = Object.values(storesMap).map(s => {
        return {
          store_id: s.store_id,
          store_name: s.store_name,
          latitude: s.latitude,
          longitude: s.longitude,
          country: s.country,
          num_distinct_skus: s.skusSet.size,
          num_distinct_products: s.productsSet.size
        };
      });
      fs.writeFileSync(path.join(DATA_DIR, 'stores.json'), JSON.stringify(stores, null, 2));

      // 2. Generate Users mapped to these stores
      const users = [
        { id: 1, username: 'admin', password: passwordHash, role: 'IT Admin', store_id: null, mfa_enabled: false, mfa_secret: null },
        { id: 2, username: 'director', password: passwordHash, role: 'Director', store_id: null, mfa_enabled: false, mfa_secret: null },
        { id: 3, username: 'finance', password: passwordHash, role: 'Finance/Auditor', store_id: null, mfa_enabled: false, mfa_secret: null },
        { id: 4, username: 'inventory', password: passwordHash, role: 'Inventory Manager', store_id: null, mfa_enabled: false, mfa_secret: null },
        { id: 5, username: 'marketing', password: passwordHash, role: 'Marketing Manager', store_id: null, mfa_enabled: false, mfa_secret: null }
      ];
      let userIdCounter = 6;
      stores.forEach((store, index) => {
        if (index === 0) {
          users.push({ id: userIdCounter++, username: 'manager1', password: passwordHash, role: 'Store Manager', store_id: store.store_id, mfa_enabled: false, mfa_secret: null });
          users.push({ id: userIdCounter++, username: 'sales1', password: passwordHash, role: 'Sales Staff', store_id: store.store_id, mfa_enabled: false, mfa_secret: null });
        } else if (index === 1) {
          users.push({ id: userIdCounter++, username: 'manager2', password: passwordHash, role: 'Store Manager', store_id: store.store_id, mfa_enabled: false, mfa_secret: null });
          users.push({ id: userIdCounter++, username: 'sales2', password: passwordHash, role: 'Sales Staff', store_id: store.store_id, mfa_enabled: false, mfa_secret: null });
        }
      });
      if (stores.length < 2) {
        users.push({ id: userIdCounter++, username: 'manager2', password: passwordHash, role: 'Store Manager', store_id: stores[0].store_id, mfa_enabled: false, mfa_secret: null });
        users.push({ id: userIdCounter++, username: 'sales2', password: passwordHash, role: 'Sales Staff', store_id: stores[0].store_id, mfa_enabled: false, mfa_secret: null });
      }
      fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

      // 3. Extract Unique Products & SKUs
      const productsMap = {};
      const skus = [];
      const categoryTemplates = ['Clothing', 'Shoes', 'Accessories'];
      const subCategoryTemplates = {
        'Clothing': ['T-Shirts', 'Jeans', 'Jackets', 'Dresses', 'Sweaters'],
        'Shoes': ['Sneakers', 'Boots', 'Sandals'],
        'Accessories': ['Bags', 'Hats', 'Belts', 'Watches']
      };

      sampleData.forEach(row => {
        if (row.products && Array.isArray(row.products)) {
          row.products.forEach(p => {
            const pId = parseInt(p.id) || p.id;
            if (!productsMap[pId]) {
              const category = categoryTemplates[pId % categoryTemplates.length];
              const subList = subCategoryTemplates[category];
              const sub_category = subList[pId % subList.length];
              
              productsMap[pId] = {
                product_id: pId,
                product_name: `Sản phẩm SKU-${p.id}`,
                category: category,
                sub_category: sub_category,
                color_type: pId % 2 === 0 ? 'Cor Unica' : 'Multi Color',
                description_en: `Premium high-quality ${sub_category.toLowerCase()} item #${pId}.`,
                image_url: `https://picsum.photos/300/300?random=${pId}`
              };
            }
            skus.push({
              sku: `SKU-${p.id}`,
              product_id: pId,
              size: 'M',
              color: 'Mixed'
            });
          });
        }
      });

      // De-duplicate products and skus
      const uniqueSkusMap = {};
      skus.forEach(s => {
        uniqueSkusMap[s.sku] = s;
      });
      const uniqueSkus = Object.values(uniqueSkusMap);
      const products = Object.values(productsMap);
      fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2));
      fs.writeFileSync(path.join(DATA_DIR, 'skus.json'), JSON.stringify(uniqueSkus, null, 2));

      // 4. Generate Employees for each store
      const employeeNames = [
        'Emma Smith', 'Noah Johnson', 'Oliver Williams', 'Sophia Brown', 'James Jones',
        'Jack Wang', 'Wei Li', 'Min Chen', 'Lan Zhang', 'Yan Liu',
        'Lukas Schmidt', 'Lina Müller', 'Leon Fischer', 'Mia Weber', 'Jonas Becker'
      ];
      const employees = [];
      let employeeId = 200;
      stores.forEach(store => {
        // 3 employees per store
        for (let j = 0; j < 3; j++) {
          const name = employeeNames[(store.store_id * 3 + j) % employeeNames.length];
          employees.push({
            employee_id: employeeId++,
            store_id: store.store_id,
            name: name,
            role: j === 0 ? 'Store Manager' : 'Sales Staff'
          });
        }
      });
      fs.writeFileSync(path.join(DATA_DIR, 'employees.json'), JSON.stringify(employees, null, 2));

      // 5. Generate Customers
      const genders = ['Male', 'Female', 'Non-binary'];
      const countries = ['United States', 'China', 'Germany', 'United Kingdom', 'France', 'Spain', 'Portugal'];
      const customers = [];
      for (let i = 1; i <= 80; i++) {
        customers.push({
          customer_id: 10000 + i,
          customer_name: `Khách hàng #${i}`,
          age: Math.floor(Math.random() * 50) + 18,
          gender: genders[i % genders.length],
          country: countries[i % countries.length]
        });
      }
      fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(customers, null, 2));

      // 6. Generate Discounts for each store
      const discounts = [];
      let discountId = 1;
      stores.forEach(store => {
        const seasons = ['Summer Sale', 'Winter Clearance', 'Spring Promo', 'Autumn Collection'];
        seasons.forEach((season, index) => {
          discounts.push({
            discount_id: discountId++,
            store_id: store.store_id,
            season_name: season,
            total_discount_avg: parseFloat((Math.random() * 0.25 + 0.05).toFixed(4)),
            start_date: `2026-0${1 + index * 3}-01`,
            end_date: `2026-0${2 + index * 3}-28`
          });
        });
      });
      fs.writeFileSync(path.join(DATA_DIR, 'discounts.json'), JSON.stringify(discounts, null, 2));

      // 7. Parse Forecasts & Transactions from sample_data.json
      const forecasts = [];
      const transactions = [];
      let forecastId = 1;
      let transactionId = 500000;
      const paymentMethods = ['Credit Card', 'PayPal', 'Cash', 'Apple Pay'];

      sampleData.forEach((row, rowIndex) => {
        const { year, week } = getWeekNumber(row.date);
        
        if (row.products && Array.isArray(row.products)) {
          row.products.forEach(p => {
            const pId = parseInt(p.id) || p.id;
            const prodObj = productsMap[pId] || { product_name: `Sản phẩm SKU-${p.id}`, category: 'Clothing' };
            const skuCode = `SKU-${p.id}`;

            // Add to Forecasts
            forecasts.push({
              forecast_id: forecastId++,
              store_id: row.store_id,
              sku: skuCode,
              product_name: prodObj.product_name,
              category: prodObj.category,
              year: year,
              week: week,
              predicted_quantity: Math.round(p.weekly_forecast),
              actual_quantity: p.weekly_sale !== null ? Math.round(p.weekly_sale) : null
            });

            // Generate Transactions from actual sales (weekly_sale)
            // Limit total generated transactions to 2000 to keep responses fast
            if (p.weekly_sale > 0 && transactions.length < 2000 && rowIndex % 3 === 0) {
              const basePriceUSD = parseFloat((Math.random() * 80 + 20).toFixed(2));
              const qty = Math.max(1, Math.round(p.weekly_sale));
              transactions.push({
                transaction_id: transactionId++,
                store_id: row.store_id,
                customer_id: 10001 + (rowIndex % 80),
                product_id: pId,
                sku: skuCode,
                date: row.date,
                payment_method: paymentMethods[rowIndex % paymentMethods.length],
                currency: 'USD',
                local_price: basePriceUSD,
                usd_price: basePriceUSD,
                quantity: qty,
                line_total: basePriceUSD * qty
              });
            }
          });
        }
      });

      fs.writeFileSync(path.join(DATA_DIR, 'forecasts.json'), JSON.stringify(forecasts, null, 2));
      
      // Sort transactions by date descending
      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      fs.writeFileSync(path.join(DATA_DIR, 'transactions.json'), JSON.stringify(transactions, null, 2));

      // Generate stock and import logs
      generateInventoryAndImports(stores, uniqueSkus);

      console.log(`Parsed sample_data.json. Generated:`);
      console.log(`- ${stores.length} Stores`);
      console.log(`- ${products.length} Products`);
      console.log(`- ${forecasts.length} Forecast timeline entries`);
      console.log(`- ${transactions.length} Transactions`);
      writePermissionsAndLogs();
      console.log('Mock data migration from sample_data.json completed successfully!');
      return;
    } catch (err) {
      console.error('Error parsing sample_data.json, falling back to mock generator:', err);
    }
  }

  // ================= FALLBACK DEFAULT MOCK GENERATOR =================
  console.log('Generating fallback default mock data...');

  // 1. Generate Users with Roles (RBAC)
  const users = [
    { id: 1, username: 'admin', password: passwordHash, role: 'IT Admin', store_id: null, mfa_enabled: false, mfa_secret: null },
    { id: 2, username: 'director', password: passwordHash, role: 'Director', store_id: null, mfa_enabled: false, mfa_secret: null },
    { id: 3, username: 'finance', password: passwordHash, role: 'Finance/Auditor', store_id: null, mfa_enabled: false, mfa_secret: null },
    { id: 4, username: 'inventory', password: passwordHash, role: 'Inventory Manager', store_id: null, mfa_enabled: false, mfa_secret: null },
    { id: 5, username: 'marketing', password: passwordHash, role: 'Marketing Manager', store_id: null, mfa_enabled: false, mfa_secret: null },
    { id: 6, username: 'manager1', password: passwordHash, role: 'Store Manager', store_id: 1, mfa_enabled: false, mfa_secret: null },
    { id: 7, username: 'manager2', password: passwordHash, role: 'Store Manager', store_id: 2, mfa_enabled: false, mfa_secret: null },
    { id: 8, username: 'sales1', password: passwordHash, role: 'Sales Staff', store_id: 1, mfa_enabled: false, mfa_secret: null },
    { id: 9, username: 'sales2', password: passwordHash, role: 'Sales Staff', store_id: 2, mfa_enabled: false, mfa_secret: null }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

  // 2. Generate Stores
  const stores = [
    { store_id: 1, store_name: 'Store New York', latitude: 40.7128, longitude: -74.0060, country: 'United States', num_distinct_skus: 150, num_distinct_products: 45 },
    { store_id: 2, store_name: 'Store Los Angeles', latitude: 34.0522, longitude: -118.2437, country: 'United States', num_distinct_skus: 130, num_distinct_products: 40 }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'stores.json'), JSON.stringify(stores, null, 2));

  // 3. Generate Products
  const products = [];
  const skus = [];
  for (let i = 0; i < 15; i++) {
    const product_id = 1000 + i;
    skus.push({
      sku: `SKU-${10000 + i}`,
      product_id: product_id,
      size: 'M',
      color: 'Solid'
    });
    products.push({
      product_id: product_id,
      product_name: `Product #${product_id}`,
      category: 'Clothing',
      sub_category: 'T-Shirts',
      color_type: 'Cor Unica',
      description_en: `Classic high-quality tee #${product_id}`,
      image_url: `https://picsum.photos/300/300?random=${product_id}`
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'skus.json'), JSON.stringify(skus, null, 2));

  // 4. Generate Employees
  const employees = [
    { employee_id: 200, store_id: 1, name: 'Emma Smith', role: 'Store Manager' },
    { employee_id: 201, store_id: 1, name: 'Noah Johnson', role: 'Sales Staff' },
    { employee_id: 202, store_id: 2, name: 'Oliver Williams', role: 'Store Manager' },
    { employee_id: 203, store_id: 2, name: 'Sophia Brown', role: 'Sales Staff' }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'employees.json'), JSON.stringify(employees, null, 2));

  // 5. Generate Customers
  const customers = [];
  for (let i = 1; i <= 10; i++) {
    customers.push({
      customer_id: 10000 + i,
      customer_name: `Customer #${i}`,
      age: 25 + i,
      gender: 'Male',
      country: 'United States'
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(customers, null, 2));

  // 6. Generate Discounts
  const discounts = [
    { discount_id: 1, store_id: 1, season_name: 'Summer Sale', total_discount_avg: 0.15, start_date: '2026-06-01', end_date: '2026-08-31' },
    { discount_id: 2, store_id: 2, season_name: 'Winter Sale', total_discount_avg: 0.20, start_date: '2026-11-01', end_date: '2027-01-31' }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'discounts.json'), JSON.stringify(discounts, null, 2));

  // 7. Generate Transactions
  const transactions = [
    { transaction_id: 500001, store_id: 1, customer_id: 10001, product_id: 1000, sku: 'SKU-10000', date: '2026-06-20', payment_method: 'Cash', currency: 'USD', local_price: 35.0, usd_price: 35.0, quantity: 1, line_total: 35.0 }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'transactions.json'), JSON.stringify(transactions, null, 2));

  // 8. Generate Forecasts
  const forecasts = [
    { forecast_id: 1, store_id: 1, sku: 'SKU-10000', product_name: 'Product #1000', category: 'Clothing', year: 2026, week: 26, predicted_quantity: 10, actual_quantity: 8 }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'forecasts.json'), JSON.stringify(forecasts, null, 2));
  // Generate stock and import logs
  generateInventoryAndImports(stores, skus);

  writePermissionsAndLogs();
  console.log('Fallback mock data generation completed successfully!');
}

function writePermissionsAndLogs() {
  const defaultPermissions = {
    "IT Admin": ["manage_users", "manage_permissions", "view_audit_logs", "view_inventory", "manage_inventory", "create_transaction"],
    "Director": ["view_dashboard", "view_all_stores", "view_customers", "view_discounts", "view_employees", "view_products", "view_transactions", "view_inventory", "manage_inventory", "create_transaction"],
    "Finance/Auditor": ["view_all_stores", "view_transactions", "view_discounts", "view_inventory"],
    "Inventory Manager": ["view_all_stores", "view_products", "edit_products", "view_inventory", "manage_inventory"],
    "Marketing Manager": ["view_all_stores", "view_discounts", "edit_discounts", "view_inventory"],
    "Store Manager": ["view_dashboard", "view_own_store", "view_customers", "create_customer", "view_discounts", "edit_discounts", "view_employees", "edit_employees", "view_products", "view_inventory", "manage_inventory", "create_transaction", "view_transactions"],
    "Sales Staff": ["view_own_store", "view_products", "view_transactions", "view_inventory", "view_customers", "create_customer", "create_transaction"]
  };
  fs.writeFileSync(path.join(DATA_DIR, 'permissions.json'), JSON.stringify(defaultPermissions, null, 2));
  
  if (!fs.existsSync(path.join(DATA_DIR, 'audit_logs.json'))) {
    fs.writeFileSync(path.join(DATA_DIR, 'audit_logs.json'), JSON.stringify([], null, 2));
  }
}

function generateInventoryAndImports(stores, skus) {
  const inventory = [];
  const imports = [];
  let importId = 1;
  const suppliers = ["Fashion Global Wholesaler", "Asia Apparel Co.", "US Textile Group", "EuroStyle Distributor", "Modern Threads Inc."];

  stores.forEach(store => {
    // For each SKU, generate a random stock
    skus.forEach(s => {
      const stock = Math.floor(Math.random() * 41) + 10; // 10 to 50
      inventory.push({
        store_id: store.store_id,
        sku: s.sku,
        stock_quantity: stock
      });

      // Generate 1 initial import log per store/SKU to populate history
      const importDate = new Date();
      importDate.setDate(importDate.getDate() - (Math.floor(Math.random() * 10) + 1));
      imports.push({
        import_id: importId++,
        store_id: store.store_id,
        sku: s.sku,
        quantity: stock + 20, // initial import was slightly higher
        import_date: importDate.toISOString(),
        supplier: suppliers[importId % suppliers.length]
      });
    });
  });

  fs.writeFileSync(path.join(DATA_DIR, 'inventory.json'), JSON.stringify(inventory, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'inventory_imports.json'), JSON.stringify(imports, null, 2));
  console.log(`- Generated ${inventory.length} Inventory stock items`);
  console.log(`- Generated ${imports.length} Inventory import logs`);
}

module.exports = generateMockData;

if (require.main === module) {
  generateMockData();
}
