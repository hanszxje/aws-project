const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fashion_retail_jwt_secret_key_987654321';

// Verify JWT Token Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
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

// Role Authorization Middleware (Deprecated, prefer authorizePermission)
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

// Dynamic Permission Middleware
function authorizePermission(requiredPermission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
      const rolePermissions = await db.getRolePermissions();
      const userPermissions = rolePermissions[req.user.role] || [];
      
      if (!userPermissions.includes(requiredPermission)) {
        return res.status(403).json({
          message: `Forbidden: Quyền hạn hạn chế. Yêu cầu quyền [${requiredPermission}] để thực hiện hành động này. Vai trò: ${req.user.role}`
        });
      }
      
      next();
    } catch (err) {
      console.error('Error in permission authorization middleware:', err);
      res.status(500).json({ message: 'Internal server error during authorization check' });
    }
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles,
  authorizePermission
};
