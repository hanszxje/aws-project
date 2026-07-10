const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../config/db');

async function test() {
  try {
    await db.init();
    
    console.log('1. Creating a new product...');
    const newProd = await db.addProduct({
      product_name: 'Test Product ' + Date.now(),
      category: 'Children',
      sub_category: 'New Import',
      color_type: 'Cor Unica',
      description_en: 'Test Description'
    });
    console.log('Created product:', newProd);

    console.log('2. Trying to import stock for this product...');
    const newImport = await db.addInventoryImport({
      store_id: 1,
      sku: newProd.sku,
      quantity: 5,
      supplier: 'Test Supplier'
    });
    console.log('Import successful:', newImport);
  } catch (err) {
    console.error('Test failed with error:', err);
  }
}

test();
