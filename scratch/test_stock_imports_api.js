const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../config/db');

async function test() {
  try {
    await db.init();
    const imports = await db.getInventoryImports();
    console.log('Total imports fetched from API:', imports.length);
    if (imports.length > 0) {
      console.log('Sample import:', imports[0]);
    }
  } catch (err) {
    console.error('Failed to get imports:', err);
  }
}

test();
