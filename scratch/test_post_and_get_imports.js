const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../config/db');

async function test() {
  try {
    await db.init();
    
    console.log('1. Posting stock import log to API...');
    const payload = {
      store_id: 1,
      sku: 'CHAC12298--',
      quantity_imported: 10,
      import_date: new Date().toISOString(),
      supplier: 'Integration Test Supplier'
    };
    
    const apiCall = require('../config/db').__proto__.apiCall || db.apiCall; // wait, let's find apiCall in db
    // Since apiCall is private to db.js, let's look at how db.js exports it or just call getInventoryImports
    // Let's call getInventoryImports directly to see what it fetches!
    // But wait, getInventoryImports does GET /stock-imports.
    // Let's call db.addInventoryImport which now does both the PUT /stock and POST /stock-imports!
    const res = await db.addInventoryImport({
      store_id: 1,
      sku: 'CHAC12298--',
      quantity: 10,
      supplier: 'Integration Test Supplier'
    });
    console.log('addInventoryImport result:', res);

    console.log('2. Fetching recent imports...');
    const imports = await db.getInventoryImports(1);
    console.log('Fetched imports list:', imports);
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test();
