const fs = require('fs');
const content = fs.readFileSync('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail/views/partials/modals.ejs', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('discount') || line.includes('Season') || line.includes('Khuyến mãi')) {
    console.log(`line ${idx+1}: ${line.trim()}`);
  }
});
