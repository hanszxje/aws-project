const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function generateMockData() {
  console.log('Generating mock data for AWS Capstone Project...');

  // 1. Generate Users with Roles (RBAC)
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  const users = [
    { id: 1, username: 'director', password: passwordHash, role: 'Director', store_id: null },
    { id: 2, username: 'manager1', password: passwordHash, role: 'Store Manager', store_id: 1 },
    { id: 3, username: 'manager2', password: passwordHash, role: 'Store Manager', store_id: 2 },
    { id: 4, username: 'sales1', password: passwordHash, role: 'Sales Staff', store_id: 1 },
    { id: 5, username: 'sales2', password: passwordHash, role: 'Sales Staff', store_id: 2 }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

  // 2. Generate Stores
  const stores = [
    { store_id: 1, store_name: 'New York flagship', latitude: 40.7128, longitude: -74.0060, country: 'United States', num_distinct_skus: 150, num_distinct_products: 45 },
    { store_id: 2, store_name: 'Beijing Central', latitude: 39.9042, longitude: 116.4074, country: 'China', num_distinct_skus: 120, num_distinct_products: 38 },
    { store_id: 3, store_name: 'Berlin Kurfürstendamm', latitude: 52.5200, longitude: 13.4050, country: 'Germany', num_distinct_skus: 95, num_distinct_products: 30 },
    { store_id: 4, store_name: 'London Oxford St', latitude: 51.5074, longitude: -0.1278, country: 'United Kingdom', num_distinct_skus: 140, num_distinct_products: 42 },
    { store_id: 5, store_name: 'Paris Champs-Élysées', latitude: 48.8566, longitude: 2.3522, country: 'France', num_distinct_skus: 160, num_distinct_products: 48 },
    { store_id: 6, store_name: 'Madrid Gran Vía', latitude: 40.4168, longitude: -3.7038, country: 'Spain', num_distinct_skus: 110, num_distinct_products: 35 },
    { store_id: 7, store_name: 'Lisbon Chiado', latitude: 38.7223, longitude: -9.1393, country: 'Portugal', num_distinct_skus: 85, num_distinct_products: 28 },
    { store_id: 8, store_name: 'Los Angeles Fashion District', latitude: 34.0522, longitude: -118.2437, country: 'United States', num_distinct_skus: 130, num_distinct_products: 40 },
    { store_id: 9, store_name: 'Shanghai Nanjing Rd', latitude: 31.2304, longitude: 121.4737, country: 'China', num_distinct_skus: 145, num_distinct_products: 44 },
    { store_id: 10, store_name: 'Munich Marienplatz', latitude: 48.1351, longitude: 11.5820, country: 'Germany', num_distinct_skus: 90, num_distinct_products: 29 }
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'stores.json'), JSON.stringify(stores, null, 2));

  // 3. Generate Products (with descriptions and mock S3 image URLs)
  const productTemplates = [
    { category: 'Clothing', sub_category: 'Jackets', desc: 'Sports Velvet Sports Jacket', color_type: 'Cor Unica' },
    { category: 'Clothing', sub_category: 'Jeans', desc: 'Luxurious Pink Denim Jeans', color_type: 'Multi Color' },
    { category: 'Clothing', sub_category: 'T-Shirts', desc: 'Classic Cotton White Tee', color_type: 'Cor Unica' },
    { category: 'Clothing', sub_category: 'Dresses', desc: 'Elegant Summer Floral Dress', color_type: 'Multi Color' },
    { category: 'Clothing', sub_category: 'Sweaters', desc: 'Warm Cashmere Winter Sweater', color_type: 'Cor Unica' },
    { category: 'Shoes', sub_category: 'Sneakers', desc: 'Urban Streetwear Sneakers', color_type: 'Multi Color' },
    { category: 'Shoes', sub_category: 'Boots', desc: 'Premium Leather Ankle Boots', color_type: 'Cor Unica' },
    { category: 'Accessories', sub_category: 'Bags', desc: 'Minimalist Travel Backpack', color_type: 'Cor Unica' },
    { category: 'Accessories', sub_category: 'Hats', desc: 'Vintage Wool Fedora Hat', color_type: 'Cor Unica' }
  ];

  const products = [];
  const skus = [];
  let productCounter = 1000;
  let skuCounter = 5000;

  for (let i = 0; i < 40; i++) {
    const template = productTemplates[i % productTemplates.length];
    const product_id = productCounter++;
    
    // Generate 1 to 3 SKUs per product (different sizes/colors)
    const numSkus = Math.floor(Math.random() * 3) + 1;
    const productSkus = [];
    const sizes = ['S', 'M', 'L', 'XL'];
    
    for (let j = 0; j < numSkus; j++) {
      const sku_id = `SKU-${skuCounter++}`;
      const size = sizes[j % sizes.length];
      skus.push({
        sku: sku_id,
        product_id: product_id,
        size: size,
        color: template.color_type === 'Cor Unica' ? 'Solid' : 'Patterned'
      });
      productSkus.push(sku_id);
    }

    products.push({
      product_id: product_id,
      product_name: template.desc + ` (${productSkus.length} variants)`,
      category: template.category,
      sub_category: template.sub_category,
      color_type: template.color_type,
      description_en: template.desc,
      // Simulated S3 URLs (these would be populated by Bedrock AI in Phase 2)
      image_url: `https://picsum.photos/300/300?random=${product_id}`
    });
  }
  
  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'skus.json'), JSON.stringify(skus, null, 2));

  // 4. Generate Employees
  const employeeNames = [
    'Emma Smith', 'Noah Johnson', 'Oliver Williams', 'Sophia Brown', 'James Jones',
    'Jack Wang', 'Wei Li', 'Min Chen', 'Lan Zhang', 'Yan Liu',
    'Lukas Schmidt', 'Lina Müller', 'Leon Fischer', 'Mia Weber', 'Jonas Becker',
    'Thomas Taylor', 'Jessica Evans', 'Daniel Davies', 'Chloe Thomas', 'Jack Roberts',
    'Lucas Martin', 'Chloé Bernard', 'Manon Dubois', 'Thomas Michel', 'Léa Petit',
    'Daniel García', 'Sofía Rodríguez', 'Alejandro González', 'Lucía Fernández', 'Martín López',
    'João Silva', 'Maria Santos', 'Pedro Ferreira', 'Ana Pereira', 'Rui Costa'
  ];

  const employees = [];
  let employeeId = 200;
  stores.forEach((store) => {
    // Generate 3-5 employees per store
    const numEmp = Math.floor(Math.random() * 3) + 3;
    for (let j = 0; j < numEmp; j++) {
      const name = employeeNames[(store.store_id * 5 + j) % employeeNames.length];
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
      customer_name: `Customer #${i}`,
      age: Math.floor(Math.random() * 50) + 18, // 18 to 67
      gender: genders[i % genders.length],
      country: countries[i % countries.length]
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(customers, null, 2));

  // 6. Generate Discounts
  const discounts = [];
  let discountId = 1;
  stores.forEach((store) => {
    // Generate active discount schemes
    const seasons = ['Summer Sale', 'Winter Clearance', 'Spring Promo', 'Autumn Collection'];
    seasons.forEach((season, index) => {
      discounts.push({
        discount_id: discountId++,
        store_id: store.store_id,
        season_name: season,
        total_discount_avg: parseFloat((Math.random() * 0.25 + 0.05).toFixed(4)), // 5% to 30%
        start_date: `2026-0${1 + index * 3}-01`,
        end_date: `2026-0${2 + index * 3}-28`
      });
    });
  });
  fs.writeFileSync(path.join(DATA_DIR, 'discounts.json'), JSON.stringify(discounts, null, 2));

  // 7. Generate Transactions (past 60 days)
  const transactions = [];
  const paymentMethods = ['Credit Card', 'PayPal', 'Cash', 'Apple Pay'];
  const currencyMap = {
    'United States': { code: 'USD', rate: 1.0 },
    'China': { code: 'CNY', rate: 0.14 },
    'Germany': { code: 'EUR', rate: 1.08 },
    'United Kingdom': { code: 'GBP', rate: 1.27 },
    'France': { code: 'EUR', rate: 1.08 },
    'Spain': { code: 'EUR', rate: 1.08 },
    'Portugal': { code: 'EUR', rate: 1.08 }
  };

  let transactionId = 500000;
  const now = new Date();
  
  for (let i = 0; i < 400; i++) {
    const store = stores[i % stores.length];
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    
    // Find matching SKU
    const productSkus = skus.filter(s => s.product_id === product.product_id);
    const skuObj = productSkus[Math.floor(Math.random() * productSkus.length)];
    const sku = skuObj.sku;

    // Date generation (last 60 days)
    const transactionDate = new Date();
    transactionDate.setDate(now.getDate() - Math.floor(Math.random() * 60));
    
    const currInfo = currencyMap[store.country] || { code: 'USD', rate: 1.0 };
    const quantity = Math.floor(Math.random() * 3) + 1;
    const basePriceUSD = parseFloat((Math.random() * 80 + 20).toFixed(2)); // $20 to $100
    const localPrice = parseFloat((basePriceUSD / currInfo.rate).toFixed(2));
    const lineTotalLocal = parseFloat((localPrice * quantity).toFixed(2));
    const lineTotalUSD = parseFloat((lineTotalLocal * currInfo.rate).toFixed(2));

    transactions.push({
      transaction_id: transactionId++,
      store_id: store.store_id,
      customer_id: customer.customer_id,
      product_id: product.product_id,
      sku: sku,
      date: transactionDate.toISOString().split('T')[0],
      payment_method: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      currency: currInfo.code,
      local_price: localPrice,
      usd_price: basePriceUSD,
      quantity: quantity,
      line_total: lineTotalUSD
    });
  }
  
  // Sort transactions by date descending
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync(path.join(DATA_DIR, 'transactions.json'), JSON.stringify(transactions, null, 2));

  // 8. Generate Weekly Forecasts (Time Series prediction results)
  // Store-SKU demand forecasts for 12 weeks
  const forecasts = [];
  let forecastId = 1;
  const forecastWeeks = [];
  
  // Create list of 12 upcoming weeks (Year-Week)
  let currentYear = 2026;
  let currentWeek = 26;
  for (let w = 0; w < 12; w++) {
    forecastWeeks.push({ year: currentYear, week: currentWeek });
    currentWeek++;
    if (currentWeek > 52) {
      currentWeek = 1;
      currentYear++;
    }
  }

  stores.forEach((store) => {
    // Select 3 random products for this store's dashboard display
    const sampleProducts = products.slice(0, 3);
    sampleProducts.forEach((product) => {
      const productSkus = skus.filter(s => s.product_id === product.product_id);
      productSkus.forEach((skuObj) => {
        // Generate a 12-week forecast sequence
        let baseDemand = Math.floor(Math.random() * 15) + 5; // 5 to 20 units
        forecastWeeks.forEach((fw, idx) => {
          // Trend + randomness
          const trend = Math.sin(idx / 2) * 3;
          const predicted = Math.max(1, Math.round(baseDemand + trend + (Math.random() * 4 - 2)));
          // Actual demand (only for first 6 weeks, simulating historical actuals compared to forecast)
          const actual = idx < 6 ? Math.max(1, Math.round(predicted + (Math.random() * 6 - 3))) : null;

          forecasts.push({
            forecast_id: forecastId++,
            store_id: store.store_id,
            sku: skuObj.sku,
            product_name: product.product_name,
            category: product.category,
            year: fw.year,
            week: fw.week,
            predicted_quantity: predicted,
            actual_quantity: actual
          });
        });
      });
    });
  });
  
  fs.writeFileSync(path.join(DATA_DIR, 'forecasts.json'), JSON.stringify(forecasts, null, 2));
  console.log('Mock data generation completed successfully!');
}

module.exports = generateMockData;

// If run directly
if (require.main === module) {
  generateMockData();
}
