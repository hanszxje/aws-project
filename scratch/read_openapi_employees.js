const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'openapi.json');
if (!fs.existsSync(filePath)) {
  console.log('openapi.json not found at:', filePath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const paths = Object.keys(data.paths).filter(p => p.startsWith('/employees'));
console.log('Employee paths:', paths);

paths.forEach(p => {
  console.log(`\nPath: ${p}`);
  const methods = Object.keys(data.paths[p]);
  methods.forEach(m => {
    console.log(`  Method: ${m.toUpperCase()}`);
    const operation = data.paths[p][m];
    if (operation.parameters) {
      console.log('    Parameters:', operation.parameters.map(param => `${param.name} (${param.in})`));
    }
    if (operation.requestBody) {
      console.log('    Request Body schema (ref):', JSON.stringify(operation.requestBody, null, 2));
    }
  });
});

// Print the schema for Employee if it exists in components
if (data.components && data.components.schemas) {
  const schemas = Object.keys(data.components.schemas).filter(s => s.toLowerCase().includes('employee'));
  console.log('\nEmployee schemas:', schemas);
  schemas.forEach(s => {
    console.log(`\nSchema ${s}:`, JSON.stringify(data.components.schemas[s], null, 2));
  });
}
