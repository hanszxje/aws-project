const fs = require('fs');

const content = fs.readFileSync('C:/Users/manhl/.gemini/antigravity/scratch/aws-fashion-retail/public/js/app.js', 'utf8');
const lines = content.split('\n');

const vnRegex = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

console.log('Scanning public/js/app.js logic lines...');
lines.forEach((line, idx) => {
  const lineNum = idx + 1;
  // Ignore lines in translation block (approx lines 3400 to 4250)
  if (lineNum >= 3400 && lineNum <= 4250) return;
  
  if (vnRegex.test(line)) {
    // Ignore lines that are comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) return;
    console.log(`line ${lineNum}: ${line.trim()}`);
  }
});
