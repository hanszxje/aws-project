const fs = require('fs');
const swagger = JSON.parse(fs.readFileSync('C:/Users/manhl/.gemini/antigravity/brain/6d3762b7-5bac-482c-90d5-0c390784d057/scratch/openapi.json', 'utf8'));
const paths = Object.keys(swagger.paths);
console.log('Product endpoints:');
paths.forEach(p => {
  if (p.includes('product')) {
    console.log(p);
  }
});
