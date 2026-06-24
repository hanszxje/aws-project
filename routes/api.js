const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// GET /api/config
router.get('/config', authenticateToken, (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_TOKEN,
    isMock: db.isMock()
  });
});

// POST /api/customers (Authorized create customer)
router.post('/customers', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  const { customer_name, age, gender, country } = req.body;

  if (!customer_name || !age || !gender || !country) {
    return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
  }

  try {
    const newCustomer = await db.addCustomer({ customer_name, age, gender, country });
    res.status(201).json({
      message: 'Thêm khách hàng mới thành công!',
      customer: newCustomer
    });
  } catch (err) {
    console.error('Error adding customer:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/customers/:id (Director only)
router.delete('/customers/:id', authenticateToken, authorizeRoles('Director'), async (req, res) => {
  try {
    const success = await db.deleteCustomer(req.params.id);
    if (success) {
      res.json({ message: 'Đã xóa khách hàng thành công!' });
    } else {
      res.status(404).json({ message: 'Không tìm thấy khách hàng' });
    }
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- Helper: Validate Store Access ---
// Ensures Store Managers and Sales Staff can only query their assigned store
function checkStoreAccess(req, res, storeId) {
  if (req.user.role !== 'Director' && req.user.store_id !== parseInt(storeId)) {
    res.status(403).json({ message: `Access denied. You do not have permissions for store ID ${storeId}.` });
    return false;
  }
  return true;
}

// 1. GET /api/stores
// Director sees all stores; Managers/Staff only see their assigned store.
router.get('/stores', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'Director') {
      const stores = await db.getStores();
      return res.json(stores);
    } else {
      const store = await db.getStoreById(req.user.store_id);
      return res.json(store ? [store] : []);
    }
  } catch (err) {
    console.error('Error fetching stores:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 2. GET /api/customers
// Access: Director, Store Manager. (Sales Staff forbidden)
router.get('/customers', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const gender = req.query.gender || '';

    const result = await db.getCustomers({ page, limit, search, gender });
    res.json(result);
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// 3. GET /api/discounts
// Access: Director, Store Manager.
router.get('/discounts', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    // If Store Manager, force filter by their store_id
    const targetStoreId = req.user.role === 'Director' ? req.query.store_id : req.user.store_id;
    const discounts = await db.getDiscounts(targetStoreId);
    res.json(discounts);
  } catch (err) {
    console.error('Error fetching discounts:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/discounts/:id
// Access: Director, Store Manager (must match store).
router.put('/discounts/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const discountId = req.params.id;
    const { total_discount_avg } = req.body;

    if (total_discount_avg === undefined || isNaN(total_discount_avg)) {
      return res.status(400).json({ message: 'Invalid discount value' });
    }

    // In a real app we verify if this discount belongs to the manager's store
    // Let's get discounts first
    if (req.user.role !== 'Director') {
      const discounts = await db.getDiscounts(req.user.store_id);
      const hasDiscount = discounts.some(d => d.discount_id === parseInt(discountId));
      if (!hasDiscount) {
        return res.status(403).json({ message: 'Access denied. You cannot edit discounts for other stores.' });
      }
    }

    const success = await db.updateDiscountAvg(discountId, total_discount_avg);
    if (success) {
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
router.post('/discounts', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const { store_id, season_name, total_discount_avg, start_date, end_date } = req.body;

    if (!store_id || !season_name || total_discount_avg === undefined || !start_date || !end_date) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    if (req.user.role !== 'Director' && req.user.store_id !== parseInt(store_id)) {
      return res.status(403).json({ message: 'Access denied. You cannot create discounts for other stores.' });
    }

    const newDiscount = await db.addDiscount({ store_id, season_name, total_discount_avg, start_date, end_date });
    res.status(201).json({ message: 'Tạo khuyến mãi mới thành công!', discount: newDiscount });
  } catch (err) {
    console.error('Error creating discount:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/discounts/:id
router.delete('/discounts/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const discountId = req.params.id;

    if (req.user.role !== 'Director') {
      const discounts = await db.getDiscounts(req.user.store_id);
      const hasDiscount = discounts.some(d => d.discount_id === parseInt(discountId));
      if (!hasDiscount) {
        return res.status(403).json({ message: 'Access denied. You cannot delete discounts for other stores.' });
      }
    }

    const success = await db.deleteDiscount(discountId);
    if (success) {
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
// Access: Director, Store Manager.
router.get('/employees', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const targetStoreId = req.user.role === 'Director' ? req.query.store_id : req.user.store_id;
    const employees = await db.getEmployees(targetStoreId);
    res.json(employees);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/employees/:id
router.put('/employees/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { name, role } = req.body;

    if (!name || !role) {
      return res.status(400).json({ message: 'Name and role are required' });
    }

    if (req.user.role !== 'Director') {
      const employees = await db.getEmployees(req.user.store_id);
      const hasEmployee = employees.some(e => e.employee_id === parseInt(employeeId));
      if (!hasEmployee) {
        return res.status(403).json({ message: 'Access denied. You cannot edit employees for other stores.' });
      }
    }

    const success = await db.updateEmployee(employeeId, name, role);
    if (success) {
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
router.post('/employees', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const { store_id, name, role } = req.body;

    if (!store_id || !name || !role) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    if (req.user.role !== 'Director' && req.user.store_id !== parseInt(store_id)) {
      return res.status(403).json({ message: 'Access denied. You cannot create employees for other stores.' });
    }

    const newEmployee = await db.addEmployee({ store_id, name, role });
    res.status(201).json({ message: 'Thêm nhân viên mới thành công!', employee: newEmployee });
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/employees/:id
router.delete('/employees/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const employeeId = req.params.id;

    if (req.user.role !== 'Director') {
      const employees = await db.getEmployees(req.user.store_id);
      const hasEmployee = employees.some(e => e.employee_id === parseInt(employeeId));
      if (!hasEmployee) {
        return res.status(403).json({ message: 'Access denied. You cannot delete employees for other stores.' });
      }
    }

    const success = await db.deleteEmployee(employeeId);
    if (success) {
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
// Access: All roles (Director, Store Manager, Sales Staff)
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const category = req.query.category || '';
    const search = req.query.search || '';
    
    // Store constraint: Staff/Manager only see products (in a strict scenario we might filter, 
    // but the plan says "Products thuộc phạm vi cửa hàng được chỉ định". 
    // In our mock, all products are globally visible but we pass store_id constraint for completeness)
    const storeId = req.user.role === 'Director' ? null : req.user.store_id;

    const products = await db.getProducts({ storeId, category, search });
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/products
router.post('/products', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const { product_name, category, sub_category, color_type, description_en, image_url } = req.body;

    if (!product_name || !category || !sub_category || !color_type || !description_en) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const newProduct = await db.addProduct({ product_name, category, sub_category, color_type, description_en, image_url });
    res.status(201).json({ message: 'Thêm sản phẩm mới thành công!', product: newProduct });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/products/:id
router.put('/products/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const productId = req.params.id;
    const { product_name, category, sub_category, color_type, description_en, image_url } = req.body;

    if (!product_name || !category || !sub_category || !color_type || !description_en) {
      return res.status(400).json({ message: 'Tất cả các trường thông tin đều là bắt buộc' });
    }

    const updatedProduct = await db.updateProduct(productId, { product_name, category, sub_category, color_type, description_en, image_url });
    if (updatedProduct) {
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
router.delete('/products/:id', authenticateToken, authorizeRoles('Director', 'Store Manager'), async (req, res) => {
  try {
    const productId = req.params.id;
    const success = await db.deleteProduct(productId);
    if (success) {
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
// Access: All roles.
// Director sees all (or filtered by store_id); Managers/Staff are strictly locked to their store_id.
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    let targetStoreId = null;

    if (req.user.role === 'Director') {
      targetStoreId = req.query.store_id ? parseInt(req.query.store_id) : null;
    } else {
      targetStoreId = req.user.store_id; // Strictly lock to their store
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

// 7. GET /api/predict
// Access: All roles. 
// Serves demand forecasts. Connects to Lambda in Phase 3, currently serves from DB/Mock files.
router.get('/predict', authenticateToken, async (req, res) => {
  try {
    const storeId = req.query.store_id;
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' });
    }

    // Role security check
    if (!checkStoreAccess(req, res, storeId)) {
      return; // Error message already sent by checkStoreAccess
    }

    // Serve forecasts (in Phase 3, this will call AWS API Gateway using axios/fetch)
    const forecasts = await db.getForecasts(storeId);
    
    // Group forecasts by SKU to make it easy to draw time series for each item
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

module.exports = router;
