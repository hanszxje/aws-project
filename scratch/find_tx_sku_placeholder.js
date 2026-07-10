const fs = require('fs');
const content = fs.readFileSync('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail/public/js/app.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('tx-sku-search') || line.includes('txSkuSearch')) {
    console.log(`line ${idx+1}: ${line.trim()}`);
  }
});
