const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'openapi.json');
if (!fs.existsSync(filePath)) {
  console.log('openapi.json not found at:', filePath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Print the schema for Product if it exists in components
if (data.components && data.components.schemas) {
  const schemas = Object.keys(data.components.schemas).filter(s => s.toLowerCase().includes('product'));
  console.log('\nProduct schemas:', schemas);
  schemas.forEach(s => {
    console.log(`\nSchema ${s}:`, JSON.stringify(data.components.schemas[s], null, 2));
  });
}
