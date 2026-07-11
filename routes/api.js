const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, authorizePermission } = require('../middleware/auth');

// GET /api/config
router.get('/config', authenticateToken, (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_TOKEN,
    isMock: db.isMock()
  });
});

// --- Helper: Validate Store Access ---
// Ensures Store Managers and Sales Staff can only query their assigned store
async function checkStoreAccess(req, res, storeId) {
  const rolePermissions = await db.getRolePermissions();
  const userPermissions = rolePermissions[req.user.role] || [];
  
  if (userPermissions.includes('view_all_stores')) {
    return true;
  }
  
  if (userPermissions.includes('view_own_store') && req.user.store_id === parseInt(storeId)) {
    return true;
  }
  
  res.status(403).json({ message: `Access denied. You do not have permissions for store ID ${storeId}.` });
  return false;
}

// 1. GET /api/stores
// Director sees all stores; Managers/Staff only see their assigned store.
router.get('/stores', authenticateToken, async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    if (userPermissions.includes('view_all_stores') || userPermissions.includes('manage_users')) {
      const stores = await db.getStores();
      return res.json(stores);
    } else if (userPermissions.includes('view_own_store')) {
      const store = await db.getStoreById(req.user.store_id);
      return res.json(store ? [store] : []);
    } else {
      return res.json([]);
    }
  } catch (err) {
    console.error('Error fetching stores:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 2. GET /api/customers
// Access: view_customers permission.
router.get('/customers', authenticateToken, authorizePermission('view_customers'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const gender = req.query.gender || '';

    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    let storeId = null;
    if (userPermissions.includes('view_all_stores')) {
      storeId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      storeId = req.user.store_id;
    }

    const result = await db.getCustomers({ storeId, page, limit, search, gender });
    res.json(result);
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/customers
router.post('/customers', authenticateToken, authorizePermission('create_customer'), async (req, res) => {
  const { customer_name, age, gender, country, store_id } = req.body;

  if (!customer_name || !age || !gender || !country) {
    return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
  }

  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = store_id ? parseInt(store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const newCustomer = await db.addCustomer({ customer_name, age, gender, country, store_id: targetStoreId });
    
    // Log
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'CUSTOMER_CREATE',
      details: `Thêm khách hàng mới: ${customer_name} (#ID: ${newCustomer.customer_id})`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({
      message: 'Thêm khách hàng mới thành công!',
      customer: newCustomer
    });
  } catch (err) {
    console.error('Error adding customer:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/customers/:id
router.delete('/customers/:id', authenticateToken, authorizePermission('delete_customer'), async (req, res) => {
  try {
    const success = await db.deleteCustomer(req.params.id);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'CUSTOMER_DELETE',
        details: `Xóa khách hàng #ID: ${req.params.id}`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Đã xóa khách hàng thành công!' });
    } else {
      res.status(404).json({ message: 'Không tìm thấy khách hàng' });
    }
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 3. GET /api/discounts
// Access: view_discounts.
router.get('/discounts', authenticateToken, authorizePermission('view_discounts'), async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const discounts = await db.getDiscounts(targetStoreId);
    res.json(discounts);
  } catch (err) {
    console.error('Error fetching discounts:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/discounts/:id
// Access: edit_discounts.
router.put('/discounts/:id', authenticateToken, authorizePermission('edit_discounts'), async (req, res) => {
  try {
    const discountId = req.params.id;
    const { total_discount_avg } = req.body;

    if (total_discount_avg === undefined || isNaN(total_discount_avg)) {
      return res.status(400).json({ message: 'Invalid discount value' });
    }

    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores')) {
      const discounts = await db.getDiscounts(req.user.store_id);
      const hasDiscount = discounts.some(d => d.discount_id === parseInt(discountId));
      if (!hasDiscount) {
        return res.status(403).json({ message: 'Access denied. You cannot edit discounts for other stores.' });
      }
    }

    const success = await db.updateDiscountAvg(discountId, total_discount_avg);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'DISCOUNT_UPDATE',
        details: `Cập nhật chiết khấu trung bình của khuyến mãi #ID: ${discountId} thành ${total_discount_avg * 100}%`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Discount updated successfully' });
    } else {
      res.status(404).json({ message: 'Discount not found' });
    }
  } catch (err) {
    console.error('Error updating discount:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/discounts
router.post('/discounts', authenticateToken, authorizePermission('edit_discounts'), async (req, res) => {
  try {
    const { store_id, season_name, total_discount_avg, start_date, end_date } = req.body;

    if (!store_id || !season_name || total_discount_avg === undefined || !start_date || !end_date) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores') && req.user.store_id !== parseInt(store_id)) {
      return res.status(403).json({ message: 'Access denied. You cannot create discounts for other stores.' });
    }

    const newDiscount = await db.addDiscount({ store_id, season_name, total_discount_avg, start_date, end_date });

    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'DISCOUNT_CREATE',
      details: `Tạo khuyến mãi mới: ${season_name} (Store: ${store_id}, Chiết khấu: ${total_discount_avg * 100}%)`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({ message: 'Tạo khuyến mãi mới thành công!', discount: newDiscount });
  } catch (err) {
    console.error('Error creating discount:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/discounts/:id
router.delete('/discounts/:id', authenticateToken, authorizePermission('edit_discounts'), async (req, res) => {
  try {
    const discountId = req.params.id;
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores')) {
      const discounts = await db.getDiscounts(req.user.store_id);
      const hasDiscount = discounts.some(d => d.discount_id === parseInt(discountId));
      if (!hasDiscount) {
        return res.status(403).json({ message: 'Access denied. You cannot delete discounts for other stores.' });
      }
    }

    const success = await db.deleteDiscount(discountId);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'DISCOUNT_DELETE',
        details: `Xóa khuyến mãi #ID: ${discountId}`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Đã xóa khuyến mãi thành công!' });
    } else {
      res.status(404).json({ message: 'Không tìm thấy khuyến mãi' });
    }
  } catch (err) {
    console.error('Error deleting discount:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 4. GET /api/employees
// Access: view_employees.
router.get('/employees', authenticateToken, authorizePermission('view_employees'), async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const employees = await db.getEmployees(targetStoreId);
    res.json(employees);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/employees/:id
router.put('/employees/:id', authenticateToken, authorizePermission('edit_employees'), async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { name, role } = req.body;

    if (!name || !role) {
      return res.status(400).json({ message: 'Name and role are required' });
    }

    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores')) {
      const employees = await db.getEmployees(req.user.store_id);
      const hasEmployee = employees.some(e => e.employee_id === parseInt(employeeId));
      if (!hasEmployee) {
        return res.status(403).json({ message: 'Access denied. You cannot edit employees for other stores.' });
      }
    }

    const success = await db.updateEmployee(employeeId, name, role);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'EMPLOYEE_UPDATE',
        details: `Cập nhật nhân viên #ID: ${employeeId} (Tên: ${name}, Chức vụ: ${role})`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Employee updated successfully' });
    } else {
      res.status(404).json({ message: 'Employee not found' });
    }
  } catch (err) {
    console.error('Error updating employee:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/employees
router.post('/employees', authenticateToken, authorizePermission('edit_employees'), async (req, res) => {
  try {
    const { store_id, name, role } = req.body;

    if (!store_id || !name || !role) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores') && req.user.store_id !== parseInt(store_id)) {
      return res.status(403).json({ message: 'Access denied. You cannot create employees for other stores.' });
    }

    const newEmployee = await db.addEmployee({ store_id, name, role });

    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'EMPLOYEE_CREATE',
      details: `Thêm nhân sự mới: ${name} (Store: ${store_id}, Vai trò: ${role})`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({ message: 'Thêm nhân viên mới thành công!', employee: newEmployee });
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/employees/:id
router.delete('/employees/:id', authenticateToken, authorizePermission('edit_employees'), async (req, res) => {
  try {
    const employeeId = req.params.id;
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes('view_all_stores')) {
      const employees = await db.getEmployees(req.user.store_id);
      const hasEmployee = employees.some(e => e.employee_id === parseInt(employeeId));
      if (!hasEmployee) {
        return res.status(403).json({ message: 'Access denied. You cannot delete employees for other stores.' });
      }
    }

    const success = await db.deleteEmployee(employeeId);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'EMPLOYEE_DELETE',
        details: `Xóa nhân sự #ID: ${employeeId}`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Đã xóa nhân viên thành công!' });
    } else {
      res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 5. GET /api/products
// Access: view_products.
router.get('/products', authenticateToken, authorizePermission('view_products'), async (req, res) => {
  try {
    const category = req.query.category || '';
    const search = req.query.search || '';
    
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    const storeId = userPermissions.includes('view_all_stores') ? null : req.user.store_id;

    const products = await db.getProducts({ storeId, category, search });
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/products
router.post('/products', authenticateToken, authorizePermission('edit_products'), async (req, res) => {
  try {
    const { product_name, category, sub_category, color_type, description_en, image_url } = req.body;

    if (!product_name || !category || !sub_category || !color_type || !description_en) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const newProduct = await db.addProduct({ product_name, category, sub_category, color_type, description_en, image_url });

    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'PRODUCT_CREATE',
      details: `Tạo sản phẩm mới: ${product_name} (#ID: ${newProduct.product_id})`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({ message: 'Thêm sản phẩm mới thành công!', product: newProduct });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/products/:id
router.put('/products/:id', authenticateToken, authorizePermission('edit_products'), async (req, res) => {
  try {
    const productId = req.params.id;
    const { product_name, category, sub_category, color_type, description_en, image_url } = req.body;

    if (!product_name || !category || !sub_category || !color_type || !description_en) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const updatedProduct = await db.updateProduct(productId, { product_name, category, sub_category, color_type, description_en, image_url });
    if (updatedProduct) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'PRODUCT_UPDATE',
        details: `Cập nhật sản phẩm #ID: ${productId} (Tên: ${product_name})`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Cập nhật sản phẩm thành công!', product: updatedProduct });
    } else {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/products/:id
router.delete('/products/:id', authenticateToken, authorizePermission('edit_products'), async (req, res) => {
  try {
    const productId = req.params.id;
    const success = await db.deleteProduct(productId);
    if (success) {
      await db.addAuditLog({
        username: req.user.username,
        role: req.user.role,
        action: 'PRODUCT_DELETE',
        details: `Xóa sản phẩm #ID: ${productId}`,
        ip: req.ip || '127.0.0.1'
      });
      res.json({ message: 'Đã xóa sản phẩm thành công!' });
    } else {
      res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    }
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 6. GET /api/transactions
// Access: view_transactions.
router.get('/transactions', authenticateToken, authorizePermission('view_transactions'), async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];

    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const paymentMethod = req.query.payment_method || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;

    const result = await db.getTransactions({ storeId: targetStoreId, paymentMethod, page, limit });
    res.json(result);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/transactions
// Access: create_transaction.
router.post('/transactions', authenticateToken, authorizePermission('create_transaction'), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  
  if (items.length === 0) {
    return res.status(400).json({ message: 'Danh sách mặt hàng trống' });
  }

  // Validate all items first
  for (const item of items) {
    const { store_id, customer_id, sku, quantity, payment_method, price } = item;
    if (!store_id || !customer_id || !sku || !quantity || !payment_method || !price) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }
  }

  try {
    const txId = (Date.now() + Math.floor(Math.random() * 1000)).toString();
    const results = [];

    for (const item of items) {
      const { store_id, customer_id, sku, quantity, payment_method, price } = item;
      
      // Validate store access
      if (!(await checkStoreAccess(req, res, store_id))) {
        return;
      }

      // Extract product_id from SKU
      const skuMatch = sku.match(/\d+/);
      const productId = skuMatch ? parseInt(skuMatch[0]) : NaN;
      if (isNaN(productId)) {
        return res.status(400).json({ message: 'SKU không hợp lệ' });
      }

      // 1. Decrease stock
      await db.decreaseStock(store_id, sku, quantity);

      // 2. Add transaction record with custom shared txId
      const newTx = await db.addTransaction({
        store_id,
        customer_id,
        product_id: productId,
        sku,
        quantity,
        payment_method,
        price,
        salesperson: req.user.username,
        customTxId: txId
      });

      results.push(newTx);
    }

    // 3. Log
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'TRANSACTION_CREATE',
      details: `Tạo giao dịch bán hàng mới: Cửa hàng #${items[0].store_id}, Khách hàng #${items[0].customer_id}, Số lượng mặt hàng: ${items.length}`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({
      message: 'Giao dịch được tạo thành công, kho hàng đã tự động cập nhật!',
      transaction: results[0],
      transactions: results
    });
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(400).json({ message: err.message || 'Lỗi khi tạo giao dịch' });
  }
});

// 7. GET /api/predict
// Access: view_dashboard.
router.get('/predict', authenticateToken, authorizePermission('view_dashboard'), async (req, res) => {
  try {
    const storeId = req.query.store_id;
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' });
    }

    if (!(await checkStoreAccess(req, res, storeId))) {
      return;
    }

    const forecasts = await db.getForecasts(storeId);
    
    const formattedForecasts = {};
    forecasts.forEach(f => {
      if (!formattedForecasts[f.sku]) {
        formattedForecasts[f.sku] = {
          sku: f.sku,
          product_name: f.product_name,
          category: f.category,
          timeline: []
        };
      }
      formattedForecasts[f.sku].timeline.push({
        year: f.year,
        week: f.week,
        predicted: f.predicted_quantity,
        actual: f.actual_quantity
      });
    });

    res.json({
      store_id: parseInt(storeId),
      forecasts: Object.values(formattedForecasts)
    });
  } catch (err) {
    console.error('Error serving predictions:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ================= IT ADMIN ENDPOINTS =================

const ROLE_HIERARCHY = [
  'Director',
  'IT Admin',
  'Finance/Auditor',
  'Inventory Manager',
  'Marketing Manager',
  'Store Manager',
  'Sales Staff'
];

function checkRoleHierarchy(currentUserRole, targetRole) {
  const curIdx = ROLE_HIERARCHY.indexOf(currentUserRole);
  const tarIdx = ROLE_HIERARCHY.indexOf(targetRole);
  if (curIdx === -1 || tarIdx === -1) return false;
  // Deny if current user has a lower rank (higher index) than target role (lower index)
  if (curIdx > tarIdx) return false;
  return true;
}

// --- ADMIN USER CRUD ---
router.get('/admin/users', authenticateToken, authorizePermission('manage_users'), async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    console.error('Error fetching admin users:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/admin/users', authenticateToken, authorizePermission('manage_users'), async (req, res) => {
  const { username, password, role, store_id } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Username, password and role are required' });
  }

  // Hierarchy check: Cannot create a user with a higher role
  if (!checkRoleHierarchy(req.user.role, role)) {
    return res.status(403).json({ message: 'Bạn không được phép tạo tài khoản có vai trò cao hơn bản thân.' });
  }

  try {
    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ message: 'Tên tài khoản đã tồn tại' });
    }
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const newUser = await db.addUser({ username, password: passwordHash, role, store_id });
    
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'USER_CREATE',
      details: `Tạo tài khoản mới: ${username} (Vai trò: ${role})`,
      ip: req.ip || '127.0.0.1'
    });
    
    res.status(201).json({ message: 'Tạo tài khoản thành công', user: newUser });
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/admin/users/:id', authenticateToken, authorizePermission('manage_users'), async (req, res) => {
  const { role, store_id, password } = req.body;
  const userId = req.params.id;
  try {
    const users = await db.getUsers();
    const targetUser = users.find(u => u.id.toString() === userId.toString());
    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // Hierarchy check 1: Cannot edit users with a higher role
    if (!checkRoleHierarchy(req.user.role, targetUser.role)) {
      return res.status(403).json({ message: 'Bạn không được phép chỉnh sửa tài khoản có vai trò cao hơn bản thân.' });
    }

    // Hierarchy check 2: Cannot set a role higher than yours
    if (role && !checkRoleHierarchy(req.user.role, role)) {
      return res.status(403).json({ message: 'Bạn không được phép thay đổi tài khoản thành vai trò cao hơn bản thân.' });
    }

    const payload = { role: role || targetUser.role, store_id };
    if (password && password.trim() !== '') {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      payload.password = await bcrypt.hash(password, salt);
    }
    const updated = await db.updateUser(userId, payload);
    if (!updated) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'USER_UPDATE',
      details: `Cập nhật tài khoản #ID: ${userId} (Vai trò mới: ${role})`,
      ip: req.ip || '127.0.0.1'
    });
    
    res.json({ message: 'Cập nhật tài khoản thành công', user: updated });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/admin/users/:id', authenticateToken, authorizePermission('manage_users'), async (req, res) => {
  const userId = req.params.id;
  try {
    const users = await db.getUsers();
    const targetUser = users.find(u => u.id.toString() === userId.toString());
    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // Hierarchy check: Cannot delete users with a higher role
    if (!checkRoleHierarchy(req.user.role, targetUser.role)) {
      return res.status(403).json({ message: 'Bạn không được phép xóa tài khoản có vai trò cao hơn bản thân.' });
    }

    const success = await db.deleteUser(userId);
    if (!success) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'USER_DELETE',
      details: `Xóa tài khoản #ID: ${userId}`,
      ip: req.ip || '127.0.0.1'
    });
    
    res.json({ message: 'Xóa tài khoản thành công' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset MFA ticket for user
router.post('/admin/users/:id/reset-mfa', authenticateToken, authorizePermission('manage_users'), async (req, res) => {
  const userId = req.params.id;
  try {
    const success = await db.updateUserMfa(userId, { mfa_enabled: false, mfa_secret: null });
    if (!success) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }
    
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'USER_MFA_RESET',
      details: `Reset MFA của tài khoản #ID: ${userId}`,
      ip: req.ip || '127.0.0.1'
    });
    
    res.json({ message: 'Đã tắt và reset MFA cho tài khoản thành công' });
  } catch (err) {
    console.error('Error resetting user MFA:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN PERMISSION ENDPOINTS ---
router.get('/admin/permissions', authenticateToken, authorizePermission('manage_permissions'), async (req, res) => {
  try {
    const perms = await db.getRolePermissions();
    res.json(perms);
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/admin/permissions', authenticateToken, authorizePermission('manage_permissions'), async (req, res) => {
  try {
    const permsMap = req.body;
    const oldPerms = await db.getRolePermissions();

    // Check hierarchy for all roles whose permissions are being modified
    for (const role of Object.keys(permsMap)) {
      const oldVal = JSON.stringify(oldPerms[role] || []);
      const newVal = JSON.stringify(permsMap[role] || []);
      
      if (oldVal !== newVal) {
        if (!checkRoleHierarchy(req.user.role, role)) {
          return res.status(403).json({
            message: `Bạn không được phép chỉnh sửa phân quyền của vai trò cao hơn bản thân (${role}).`
          });
        }
      }
    }

    await db.updateRolePermissions(permsMap);
    
    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'PERMISSIONS_UPDATE',
      details: 'Cập nhật ma trận phân quyền động',
      ip: req.ip || '127.0.0.1'
    });
    
    res.json({ message: 'Cập nhật phân quyền thành công!' });
  } catch (err) {
    console.error('Error updating permissions:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN AUDIT LOGS ENDPOINT ---
router.get('/admin/audit-logs', authenticateToken, authorizePermission('view_audit_logs'), async (req, res) => {
  try {
    const logs = await db.getAuditLogs();
    res.json(logs);
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- INVENTORY ENDPOINTS ---

// 12. GET /api/inventory
router.get('/inventory', authenticateToken, authorizePermission('view_inventory'), async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const search = req.query.search || '';
    const inventory = await db.getInventory(targetStoreId, search);
    res.json(inventory);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 13. GET /api/inventory/imports
router.get('/inventory/imports', authenticateToken, authorizePermission('view_inventory'), async (req, res) => {
  try {
    const rolePermissions = await db.getRolePermissions();
    const userPermissions = rolePermissions[req.user.role] || [];
    
    let targetStoreId = null;
    if (userPermissions.includes('view_all_stores')) {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id;
    }

    const imports = await db.getInventoryImports(targetStoreId);
    res.json(imports);
  } catch (err) {
    console.error('Error fetching inventory imports:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 14. POST /api/inventory/imports
router.post('/inventory/imports', authenticateToken, authorizePermission('manage_inventory'), async (req, res) => {
  const { store_id, sku, quantity, supplier } = req.body;
  if (!store_id || !sku || !quantity || !supplier) {
    return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
  }

  try {
    // Validate manager access to store_id
    if (!(await checkStoreAccess(req, res, store_id))) {
      return;
    }

    const newImport = await db.addInventoryImport({ store_id, sku, quantity, supplier });

    await db.addAuditLog({
      username: req.user.username,
      role: req.user.role,
      action: 'INVENTORY_IMPORT',
      details: `Nhập hàng mới cho store #${store_id}: SKU ${sku}, Số lượng: ${quantity}, Nhà CC: ${supplier}`,
      ip: req.ip || '127.0.0.1'
    });

    res.status(201).json({
      message: 'Nhập hàng thành công!',
      import: newImport
    });
  } catch (err) {
    console.error('Error creating inventory import:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
