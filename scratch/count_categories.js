const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../config/db');

async function count() {
  try {
    await db.init();
    const inventory = await db.getInventory(1); // store 1
    const counts = { Children: 0, Masculine: 0, Feminine: 0, Other: 0 };
    inventory.forEach(item => {
      if (counts[item.category] !== undefined) {
        counts[item.category]++;
      } else {
        counts['Other']++;
      }
    });
    console.log('Categories count in Store 1 stock:', counts);
  } catch (err) {
    console.error('Error counting stock categories:', err);
  }
}

count();
