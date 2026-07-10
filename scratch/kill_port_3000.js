const { execSync } = require('child_process');

try {
  console.log('Finding process on port 3000...');
  const output = execSync('netstat -ano | findstr :3000', { encoding: 'utf8' });
  console.log(output);
  const lines = output.trim().split('\n');
  const pids = new Set();
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      const pid = parts[parts.length - 1];
      pids.add(pid);
    }
  });
  pids.forEach(pid => {
    console.log(`Killing process ${pid}...`);
    try {
      execSync(`taskkill /F /PID ${pid}`);
      console.log(`Process ${pid} killed.`);
    } catch (e) {
      console.error(`Failed to kill ${pid}:`, e.message);
    }
  });
} catch (err) {
  console.log('No process found on port 3000 or error:', err.message);
}
