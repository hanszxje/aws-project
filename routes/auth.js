const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'fashion_retail_jwt_secret_key_987654321';

// --- Pure JS TOTP Helper functions ---
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let cleaned = base32.replace(/=+$/, '').toUpperCase();
  let length = cleaned.length;
  let bits = 0;
  let value = 0;
  let index = 0;
  let buffer = Buffer.alloc(Math.floor((length * 5) / 8));

  for (let i = 0; i < length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      buffer[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return buffer;
}

function generateHOTP(secretBuffer, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(buffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  return code % 1000000;
}

function verifyTOTP(token, secretBase32, window = 1) {
  try {
    const secretBuffer = base32Decode(secretBase32);
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i++) {
      const generated = generateHOTP(secretBuffer, counter + i);
      const formatted = String(generated).padStart(6, '0');
      if (formatted === token) {
        return true;
      }
    }
  } catch (err) {
    console.error('Error verifying TOTP:', err);
  }
  return false;
}

function generateBase32Secret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 16; i++) {
    secret += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return secret;
}

// Helper to sign user JWT token
function signToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      store_id: user.store_id 
    }, 
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const user = await db.getUserByUsername(username);

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Check if MFA is enabled
    if (user.mfa_enabled) {
      // Return dynamic ticket based on username
      const ticket = Buffer.from(user.username).toString('base64');
      return res.json({
        mfa_required: true,
        ticket
      });
    }

    // Sign JWT as normal
    const token = signToken(user);

    // Get permissions
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[user.role] || [];

    // Add login log
    await db.addAuditLog({
      username: user.username,
      role: user.role,
      action: 'LOGIN',
      details: 'Đăng nhập thành công',
      ip: req.ip || '127.0.0.1'
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        store_id: user.store_id,
        permissions: userPermissions
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/verify-mfa
router.post('/verify-mfa', async (req, res) => {
  const { ticket, code } = req.body;

  if (!ticket || !code) {
    return res.status(400).json({ message: 'Ticket and OTP code are required' });
  }

  try {
    const username = Buffer.from(ticket, 'base64').toString('ascii');
    const user = await db.getUserByUsername(username);

    if (!user || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(400).json({ message: 'Yêu cầu không hợp lệ hoặc MFA chưa được kích hoạt' });
    }

    const isValid = verifyTOTP(code, user.mfa_secret);
    if (!isValid) {
      return res.status(401).json({ message: 'Mã xác thực OTP không chính xác hoặc đã hết hạn' });
    }

    // Sign JWT
    const token = signToken(user);

    // Get permissions
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[user.role] || [];

    // Add login log
    await db.addAuditLog({
      username: user.username,
      role: user.role,
      action: 'LOGIN_MFA',
      details: 'Đăng nhập thành công với xác thực 2 lớp (MFA)',
      ip: req.ip || '127.0.0.1'
    });

    res.json({
      message: 'MFA Verification successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        store_id: user.store_id,
        permissions: userPermissions
      }
    });
  } catch (err) {
    console.error('MFA Verify error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/mfa/setup
router.post('/mfa/setup', authenticateToken, async (req, res) => {
  try {
    const secret = generateBase32Secret();
    const otpauthUrl = `otpauth://totp/G-FashionBI:${req.user.username}?secret=${secret}&issuer=G-FashionBI`;
    res.json({ secret, otpauthUrl });
  } catch (err) {
    console.error('MFA Setup error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/mfa/enable
router.post('/mfa/enable', authenticateToken, async (req, res) => {
  const { secret, code } = req.body;

  if (!secret || !code) {
    return res.status(400).json({ message: 'Secret and code are required' });
  }

  try {
    const isValid = verifyTOTP(code, secret);
    if (!isValid) {
      return res.status(400).json({ message: 'Mã OTP không chính xác. Kích hoạt thất bại.' });
    }

    // Save secret and enable MFA in database
    await db.updateUserMfa(req.user.id, { mfa_enabled: true, mfa_secret: secret });

    // Add audit log
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'MFA_ENABLE',
      details: 'Bật xác thực 2 lớp thành công',
      ip: req.ip || '127.0.0.1'
    });

    res.json({ message: 'Kích hoạt xác thực 2 lớp (MFA) thành công!' });
  } catch (err) {
    console.error('MFA Enable error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/auth/mfa/disable
router.post('/mfa/disable', authenticateToken, async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ message: 'Code is required' });
  }

  try {
    const user = await db.getUserByUsername(req.user.username);
    if (!user || !user.mfa_enabled) {
      return res.status(400).json({ message: 'Tài khoản chưa được kích hoạt MFA' });
    }

    const isValid = verifyTOTP(code, user.mfa_secret);
    if (!isValid) {
      return res.status(400).json({ message: 'Mã OTP không chính xác. Hủy kích hoạt thất bại.' });
    }

    await db.updateUserMfa(req.user.id, { mfa_enabled: false, mfa_secret: null });

    // Add audit log
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'MFA_DISABLE',
      details: 'Hủy xác thực 2 lớp thành công',
      ip: req.ip || '127.0.0.1'
    });

    res.json({ message: 'Hủy xác thực 2 lớp (MFA) thành công!' });
  } catch (err) {
    console.error('MFA Disable error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserByUsername(req.user.username);
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[user.role] || [];
    res.json({ 
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        store_id: user.store_id,
        mfa_enabled: user.mfa_enabled,
        permissions: userPermissions
      }
    });
  } catch (err) {
    res.json({ user: req.user });
  }
});

module.exports = router;
