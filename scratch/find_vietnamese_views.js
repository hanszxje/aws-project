const fs = require('fs');
const path = require('path');

const files = [
  'views/index.ejs',
  'views/login.ejs',
  'views/partials/modals.ejs',
  'views/partials/sidebar.ejs',
  'views/partials/header.ejs'
];

const vnRegex = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

files.forEach(fileRel => {
  const filePath = path.join('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail', fileRel);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  console.log(`\n--- Scanning ${fileRel} ---`);
  lines.forEach((line, idx) => {
    // If the line has Vietnamese characters, check if it has data-i18n attribute
    if (vnRegex.test(line)) {
      if (!line.includes('data-i18n') && !line.includes('i18n') && !line.trim().startsWith('<!--')) {
        console.log(`line ${idx+1}: ${line.trim()}`);
      }
    }
  });
});
