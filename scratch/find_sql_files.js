const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const fp = path.join(dir, f);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) {
      if (f !== 'node_modules' && !f.startsWith('.')) {
        searchDir(fp);
      }
    } else {
      if (f.endsWith('.sql') || f.toLowerCase().includes('schema') || f.toLowerCase().includes('setup') || f.toLowerCase().includes('migration')) {
        console.log(fp);
      }
    }
  });
}

searchDir('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail');
