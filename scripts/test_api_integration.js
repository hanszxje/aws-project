require('dotenv').config();
const db = require('../config/db');

async function runTests() {
  console.log('--- Starting DB API Integration Tests ---');
  try {
    await db.init();
    
    // 1. Stores
    try {
      console.log('\nTesting Stores...');
      const stores = await db.getStores();
      console.log(`- Fetched ${stores.length} stores. First store:`, stores[0]);
      if (stores.length > 0) {
        const firstStoreId = stores[0].store_id;
        const store = await db.getStoreById(firstStoreId);
        console.log(`- Fetched store by ID ${firstStoreId}:`, store ? store.store_name : 'NOT FOUND');
      }
    } catch (err) {
      console.error('Stores test failed:', err.message);
    }

    // 2. Products
    try {
      console.log('\nTesting Products...');
      const products = await db.getProducts({ category: 'Children' });
      console.log(`- Fetched ${products.length} products in Children category.`);
      if (products.length > 0) {
        console.log(`- First product details:`, products[0]);
      }
    } catch (err) {
      console.error('Products test failed (Server 500 expected due to API bug):', err.message);
    }

    // 3. Customers (CRUD)
    try {
      console.log('\nTesting Customers (CRUD)...');
      const customersBefore = await db.getCustomers({ limit: 5 });
      console.log(`- Initial customers count: ${customersBefore.total}`);

      console.log('- Adding customer...');
      const newCustomer = await db.addCustomer({
        customer_name: 'Test Customer ' + Date.now(),
        age: 25,
        gender: 'Female',
        country: 'Viet Nam'
      });
      console.log('- Added customer:', newCustomer);

      console.log('- Deleting customer...');
      const deleted = await db.deleteCustomer(newCustomer.customer_id);
      console.log(`- Customer deleted: ${deleted}`);
    } catch (err) {
      console.error('Customers test failed:', err.message);
    }

    // 4. Discounts (CRUD)
    try {
      console.log('\nTesting Discounts (CRUD)...');
      const discountsBefore = await db.getDiscounts();
      console.log(`- Initial discounts count: ${discountsBefore.length}`);

      console.log('- Adding discount...');
      const newDiscount = await db.addDiscount({
        store_id: 1,
        season_name: 'Summer Sale Test',
        total_discount_avg: 0.15,
        start_date: '2026-07-01',
        end_date: '2026-07-31'
      });
      console.log('- Added discount:', newDiscount);

      console.log('- Updating discount...');
      const updated = await db.updateDiscountAvg(newDiscount.discount_id, 0.20);
      console.log(`- Discount updated: ${updated}`);

      console.log('- Deleting discount...');
      const deletedDiscount = await db.deleteDiscount(newDiscount.discount_id);
      console.log(`- Discount deleted: ${deletedDiscount}`);
    } catch (err) {
      console.error('Discounts test failed:', err.message);
    }

    // 5. Employees (CRUD)
    try {
      console.log('\nTesting Employees (CRUD)...');
      const employeesBefore = await db.getEmployees();
      console.log(`- Initial employees count: ${employeesBefore.length}`);

      console.log('- Adding employee...');
      const newEmployee = await db.addEmployee({
        store_id: 1,
        name: 'Test Employee',
        role: 'Sales Staff'
      });
      console.log('- Added employee:', newEmployee);

      console.log('- Updating employee...');
      const updatedEmp = await db.updateEmployee(newEmployee.employee_id, 'Updated Employee', 'Store Manager');
      console.log(`- Employee updated: ${updatedEmp}`);

      console.log('- Deleting employee...');
      const deletedEmp = await db.deleteEmployee(newEmployee.employee_id);
      console.log(`- Employee deleted: ${deletedEmp}`);
    } catch (err) {
      console.error('Employees test failed:', err.message);
    }

    // 6. Forecasts
    try {
      console.log('\nTesting Forecasts...');
      const forecasts = await db.getForecasts(1);
      console.log(`- Fetched ${forecasts.length} forecasts for store 1.`);
      if (forecasts.length > 0) {
        console.log(`- Sample forecast:`, forecasts[0]);
      }
    } catch (err) {
      console.error('Forecasts test failed:', err.message);
    }

    // 7. Remote Stock & Inventory API
    try {
      console.log('\nTesting Remote Stock & Inventory API...');
      const inventory = await db.getInventory(1);
      console.log(`- Fetched ${inventory.length} active inventory items for store 1.`);
      if (inventory.length > 0) {
        console.log(`- Sample inventory item:`, inventory[0]);
      }

      console.log('- Simulating Stock Import...');
      // Test import (updates stock via API)
      const imported = await db.addInventoryImport({
        store_id: 1,
        sku: 'CHAC12298--',
        quantity: 5,
        supplier: 'Test Supplier'
      });
      console.log(`- Stock import logged locally & updated on API:`, imported);

      console.log('- Simulating Stock Decrease (checkout)...');
      const remainingStock = await db.decreaseStock(1, 'CHAC12298--', 2);
      console.log(`- Remaining stock after checkout: ${remainingStock}`);
    } catch (err) {
      console.error('Stock & Inventory test failed:', err.message);
    }

    // 8. Transactions
    try {
      console.log('\nTesting Transactions...');
      const transactions = await db.getTransactions({ storeId: 1, limit: 5 });
      console.log(`- Fetched ${transactions.data.length} transactions. Total: ${transactions.total}`);
    } catch (err) {
      console.error('Transactions test failed:', err.message);
    }

    console.log('\n--- All DB API Integration Tests Completed! ---');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}

runTests();
