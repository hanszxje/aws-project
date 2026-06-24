require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./config/db');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Body parser
app.use(express.json());

// Serve static frontend files (caching disabled for development)
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB and start server
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`📦 Database Mode: ${db.isMock() ? 'MOCK (JSON)' : 'REAL (PostgreSQL)'}`);
    console.log(`=================================================`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
