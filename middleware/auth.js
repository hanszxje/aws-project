const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fashion_retail_jwt_secret_key_987654321';

// Verify JWT Token Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  // Token format: "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Role Authorization Middleware
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Forbidden: Access restricted to roles [${allowedRoles.join(', ')}]. Your role: ${req.user.role}` 
      });
    }
    
    next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles
};
