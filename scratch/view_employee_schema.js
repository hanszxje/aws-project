const fs = require('fs');
const openapi = JSON.parse(fs.readFileSync('C:/Users/manhl/.gemini/antigravity/brain/6d3762b7-5bac-482c-90d5-0c390784d057/scratch/openapi.json', 'utf8'));

console.log('Schemas in OpenAPI:');
const schemas = openapi.components.schemas;
Object.keys(schemas).forEach(sName => {
  if (sName.toLowerCase().includes('employee')) {
    console.log(`\nSchema: ${sName}`);
    console.log(JSON.stringify(schemas[sName], null, 2));
  }
});
