const fs = require('fs');
require('dotenv').config();
const db = require('../config/db');

async function test() {
  await db.init();
  console.log('Fetching inventory for store 1...');
  const inv = await db.getInventory({ storeId: '1', search: '', category: '' });
  console.log('Total items:', inv.length);

  // Check for garbage
  const garbage = inv.filter(i => i.sku.startsWith('SKU-') || i.sku === 'undefined' || i.category === 'Clothing');
  console.log('Garbage items remaining:', garbage.length);
  if (garbage.length > 0) {
    console.log('Sample garbage:', garbage.slice(0, 3));
  }

  // Check categories
  const cats = {};
  inv.forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
  console.log('Categories in inventory:', cats);
}

test().catch(console.error);
