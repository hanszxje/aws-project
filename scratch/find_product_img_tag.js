const fs = require('fs');
const path = require('path');

const walk = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
};

const files = walk('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail/views');
files.forEach(f => {
  if (!f.endsWith('.ejs')) return;
  const content = fs.readFileSync(f, 'utf8');
  if (content.includes('product-image') || content.includes('onerror')) {
    console.log(`File: ${f}`);
    const lines = content.split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('img') || l.includes('onerror')) {
        console.log(`  line ${idx+1}: ${l.trim()}`);
      }
    });
  }
});
