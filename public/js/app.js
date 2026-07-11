

// Theme Initialization
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
  document.body.classList.add('light-theme');
}

// Plotly Theme Interceptor
if (window.Plotly) {
  const originalNewPlot = Plotly.newPlot;
  Plotly.newPlot = function(id, data, layout, config) {
    const container = typeof id === 'string' ? document.getElementById(id) : id;
    if (container) {
      if (container.querySelector('.skeleton') || container.querySelector('.skeleton-chart-box')) {
        container.innerHTML = '';
      }
    }
    if (layout) {
      const isLight = document.body.classList.contains('light-theme');
      const textColor = isLight ? '#1f2937' : '#f3f4f6';
      const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      
      if (!layout.font) layout.font = {};
      layout.font.color = textColor;
      
      if (layout.xaxis) {
        layout.xaxis.gridcolor = gridColor;
      }
      if (layout.yaxis) {
        layout.yaxis.gridcolor = gridColor;
      }
    }
    return originalNewPlot.call(Plotly, id, data, layout, config);
  };
}

// ================= GLOBAL STATE =================
let token = localStorage.getItem('token') || null;
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let activeTab = 'dashboard';
let map = null;
let storesData = [];
let mfaStepActive = false;
let mfaTicket = null;

// Pagination states
const pagState = {
  customers: { page: 1, limit: 10, total: 0, search: '', gender: '' },
  transactions: { page: 1, limit: 15, total: 0, store_id: '', payment_method: '' }
};

// Modals state
let activeEditDiscount = null;
let activeEditEmployee = null;
let activeEditProduct = null;

// Forecast state
let activeForecastStoreId = null;
let activeForecastsData = []; // Cache predictions for active store
let activeStoreInventoryData = []; // Cache inventory of active store for warnings

// ================= DOM ELEMENTS =================
const authOverlay = document.getElementById('auth-overlay');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const userDisplayName = document.getElementById('user-display-name');
const userDisplayRole = document.getElementById('user-display-role');
const btnLogout = document.getElementById('btn-logout');
const pageTitle = document.getElementById('page-title');
const dbModeText = document.getElementById('db-mode-text');
const dbModeBadge = document.getElementById('db-mode-badge');

// Tab containers
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

// CRUD Modals & Buttons
const customerModal = document.getElementById('customer-modal');
const btnAddCustomer = document.getElementById('btn-add-customer');
const btnCancelCustomer = document.getElementById('btn-cancel-customer');
const customerForm = document.getElementById('customer-form');

const discountCreateModal = document.getElementById('discount-create-modal');
const btnAddDiscount = document.getElementById('btn-add-discount');
const btnCancelCreateDiscount = document.getElementById('btn-cancel-create-discount');
const discountCreateForm = document.getElementById('discount-create-form');
const discountStoreInput = document.getElementById('discount-store-input');

const employeeCreateModal = document.getElementById('employee-create-modal');
const btnAddEmployee = document.getElementById('btn-add-employee');
const btnCancelCreateEmployee = document.getElementById('btn-cancel-create-employee');
const employeeCreateForm = document.getElementById('employee-create-form');
const employeeStoreInput = document.getElementById('employee-store-input');

const productModal = document.getElementById('product-modal');
const btnAddProduct = document.getElementById('btn-add-product');
const btnCancelProduct = document.getElementById('btn-cancel-product');
const productForm = document.getElementById('product-form');
const productModalTitle = document.getElementById('product-modal-title');

// ================= API CALL HELPER =================
async function fetchAPI(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401 || res.status === 403) {
    // If forbidden or unauthenticated, force logout if it was a credentials issue
    const errData = await res.json();
    if (res.status === 401) {
      alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      logout();
      throw new Error('Unauthorized');
    } else {
      alert(`Lỗi quyền truy cập: ${errData.message}`);
      throw new Error('Forbidden');
    }
  }

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.message || 'Lỗi bất ngờ xảy ra');
  }

  return res.json();
}

// ================= AUTHENTICATION LOGIC =================
async function checkAuth() {
  if (token) {
    try {
      // Validate session with server
      const data = await fetchAPI('/api/auth/me');
      currentUser = data.user;
      localStorage.setItem('user', JSON.stringify(currentUser));
      showApp();
    } catch (err) {
      console.warn('Session verification failed, logging out.', err);
      logout();
    }
  } else {
    showLogin();
  }
}

function showLogin() {
  authOverlay.classList.remove('hidden');
  appContainer.classList.add('hidden');
}

function showApp() {
  authOverlay.classList.add('hidden');
  appContainer.classList.remove('hidden');
  
  // Render user info
  userDisplayName.textContent = currentUser.username;
  userDisplayRole.textContent = currentUser.role;
  
  // Set role class on body for CSS-based RBAC visibility constraints if any
  document.body.className = 'dark-mode role-' + currentUser.role.toLowerCase().replace(' ', '-').replace('/', '-');
  
  // Initialize UI components based on permissions
  configurePermissionBasedVisibility();
  
  // Pre-render skeleton loading for all tabs (so they look alive while data loads)
  preRenderAllTabSkeletons();
  
  // Trigger initial tab loading
  switchTab(activeTab);
  loadDBModeStatus();
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  
  // Destroy map instance if exists to re-initialize on login
  if (map) {
    map.remove();
    map = null;
  }
  
  resetLoginFormState();
  showLogin();
}

// Hide elements depending on user permissions
function configurePermissionBasedVisibility() {
  const permissions = currentUser.permissions || [];
  
  const dashboardTab = document.getElementById('nav-dashboard');
  const customersTab = document.getElementById('nav-customers');
  const discountsTab = document.getElementById('nav-discounts');
  const employeesTab = document.getElementById('nav-employees');
  const productsTab = document.getElementById('nav-products');
  const storesTab = document.getElementById('nav-stores');
  const transactionsTab = document.getElementById('nav-transactions');
  
  const adminUsersTab = document.getElementById('nav-admin-users');
  const adminPermissionsTab = document.getElementById('nav-admin-permissions');
  const adminLogsTab = document.getElementById('nav-admin-logs');
  const inventoryTab = document.getElementById('nav-inventory');

  toggleElementVisibility(dashboardTab, permissions.includes('view_dashboard'));
  toggleElementVisibility(customersTab, permissions.includes('view_customers'));
  toggleElementVisibility(discountsTab, permissions.includes('view_discounts'));
  toggleElementVisibility(employeesTab, permissions.includes('view_employees'));
  toggleElementVisibility(productsTab, permissions.includes('view_products'));
  toggleElementVisibility(storesTab, permissions.includes('view_all_stores') || permissions.includes('view_own_store'));
  toggleElementVisibility(transactionsTab, permissions.includes('view_transactions'));
  toggleElementVisibility(inventoryTab, permissions.includes('view_inventory'));
  
  toggleElementVisibility(adminUsersTab, permissions.includes('manage_users'));
  toggleElementVisibility(adminPermissionsTab, permissions.includes('manage_permissions'));
  toggleElementVisibility(adminLogsTab, permissions.includes('view_audit_logs'));

  const selectStoreContainers = document.querySelectorAll('.select-store-container');
  selectStoreContainers.forEach(container => {
    toggleElementVisibility(container, permissions.includes('view_all_stores'));
  });

  const btnAddCustomer = document.getElementById('btn-add-customer');
  const btnAddDiscount = document.getElementById('btn-add-discount');
  const btnAddEmployee = document.getElementById('btn-add-employee');
  const btnAddProduct = document.getElementById('btn-add-product');
  const btnOpenImport = document.getElementById('btn-open-import');
  const btnAddTransaction = document.getElementById('btn-add-transaction');

  toggleElementVisibility(btnAddCustomer, permissions.includes('create_customer'));
  toggleElementVisibility(btnAddDiscount, permissions.includes('edit_discounts'));
  toggleElementVisibility(btnAddEmployee, permissions.includes('edit_employees'));
  toggleElementVisibility(btnAddProduct, permissions.includes('edit_products'));
  toggleElementVisibility(btnOpenImport, permissions.includes('manage_inventory'));
  toggleElementVisibility(btnAddTransaction, permissions.includes('create_transaction'));

  const tabToPermission = {
    'dashboard': 'view_dashboard',
    'customers': 'view_customers',
    'discounts': 'view_discounts',
    'employees': 'view_employees',
    'products': 'view_products',
    'stores': 'view_all_stores',
    'transactions': 'view_transactions',
    'inventory': 'view_inventory',
    'admin-users': 'manage_users',
    'admin-permissions': 'manage_permissions',
    'admin-logs': 'view_audit_logs'
  };

  const currentRequiredPerm = tabToPermission[activeTab];
  if (currentRequiredPerm) {
    let hasAccess = permissions.includes(currentRequiredPerm);
    if (activeTab === 'stores') {
      hasAccess = permissions.includes('view_all_stores') || permissions.includes('view_own_store');
    }
    if (!hasAccess) {
      const permittedTabs = Object.keys(tabToPermission).filter(t => {
        if (t === 'stores') return permissions.includes('view_all_stores') || permissions.includes('view_own_store');
        return permissions.includes(tabToPermission[t]);
      });
      if (permittedTabs.length > 0) {
        switchTab(permittedTabs[0]);
      } else {
        alert('Tài khoản của bạn không có quyền xem bất kỳ chức năng nào. Vui lòng liên hệ Admin.');
        logout();
      }
    }
  }
}

function toggleElementVisibility(element, isVisible) {
  if (!element) return;
  if (isVisible) {
    element.classList.remove('hidden');
  } else {
    element.classList.add('hidden');
  }
}

async function loadDBModeStatus() {
  try {
    // If real backend, we can query mock status
    // In our db.js we have an indicator if we are in mock mode
    // We can infer this from products or transaction returns
    const stores = await fetchAPI('/api/stores');
    // If mock mode is true, we display it
    // In our backend API we can expose a /api/config route
    const config = await fetchAPI('/api/config');
    if (config.isMock) {
      dbModeText.textContent = 'Mock Mode (JSON)';
      dbModeBadge.className = 'db-mode-badge';
    } else {
      dbModeText.textContent = 'Cloud Database (RDS)';
      dbModeBadge.className = 'db-mode-badge real-mode';
    }
  } catch (err) {
    console.error('Error fetching config:', err);
  }
}

// ================= PRE-RENDER SKELETON LOADING =================
function preRenderAllTabSkeletons() {
  // Pre-fill all tab tables and charts with skeleton placeholders
  // so users see loading animations instead of blank content when switching tabs
  
  // Customers tab
  showTableSkeleton('#customers-table tbody', 6);
  showChartSkeleton('customers-gender-chart');
  showChartSkeleton('customers-age-chart');
  
  // Discounts tab
  showTableSkeleton('#discounts-table tbody', 7);
  
  // Employees tab
  showTableSkeleton('#employees-table tbody', 6);
  
  // Products tab
  showTableSkeleton('#products-tbody', 6);
  
  // Stores tab
  showTableSkeleton('#stores-table tbody', 5);
  
  // Transactions tab
  showTableSkeleton('#transactions-table tbody', 7);
  
  // Admin tabs
  showTableSkeleton('#admin-users-table tbody', 6);
  showTableSkeleton('#admin-logs-table tbody', 6);
}

// ================= TAB MANAGEMENT =================
function switchTab(tabName) {
  activeTab = tabName;
  
  // Close sidebar on mobile
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && sidebar.classList.contains('sidebar-open')) {
    sidebar.classList.remove('sidebar-open');
    if (overlay) overlay.style.display = 'none';
  }
  
  // Update Nav Active state
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update Page Title
  if (typeof dynamicTitles !== 'undefined' && dynamicTitles[tabName] && typeof currentLang !== 'undefined') {
    pageTitle.textContent = dynamicTitles[tabName][currentLang] || 'G-Fashion BI';
  } else {
    const titles = {
      dashboard: 'Dashboard Bản đồ Cửa hàng',
      customers: 'Quản lý Khách hàng',
      discounts: 'Cơ chế Khuyến mãi',
      employees: 'Danh sách Nhân sự',
      products: 'Sản phẩm',
      stores: 'Danh sách Cửa hàng Toàn cầu',
      transactions: 'Lịch sử Giao dịch',
      inventory: 'Quản lý Kho hàng & Nhập kho',
      'admin-users': 'Quản lý Tài khoản Hệ thống',
      'admin-permissions': 'Thiết lập Phân quyền Dynamic',
      'admin-logs': 'Nhật ký Hoạt động Hệ thống'
    };
    pageTitle.textContent = titles[tabName] || 'G-Fashion BI';
  }

  // Toggle Tab Content Visibility
  tabContents.forEach(content => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  // Load specific tab data
  loadTabContent(tabName);
}

function loadTabContent(tabName) {
  switch (tabName) {
    case 'dashboard':
      initDashboardMap();
      break;
    case 'customers':
      loadCustomersTab();
      break;
    case 'discounts':
      loadDiscountsTab();
      break;
    case 'employees':
      loadEmployeesTab();
      break;
    case 'products':
      loadProductsTab();
      break;
    case 'stores':
      loadStoresTab();
      break;
    case 'transactions':
      loadTransactionsTab();
      break;
    case 'inventory':
      loadInventoryTab();
      break;
    case 'admin-users':
      loadAdminUsersTab();
      break;
    case 'admin-permissions':
      loadAdminPermissionsTab();
      break;
    case 'admin-logs':
      loadAdminLogsTab();
      break;
  }
}

// ================= DASHBOARD MAP & FORECASTING =================
async function initDashboardMap() {
  if (map) return; // Map already loaded

  try {
    // Fetch stores to center map
    storesData = await fetchAPI('/api/stores');
    
    // Default center (USA/Atlantic view)
    let center = [0, 20]; // Maplibre uses [lng, lat]
    let zoom = 1.5;
    
    if (storesData.length === 1) {
      // If single store (Manager/Staff role), center on that store
      center = [storesData[0].longitude, storesData[0].latitude];
      zoom = 10;
    } else if (storesData.length > 1) {
      // Average coordinates
      const sumLat = storesData.reduce((acc, s) => acc + s.latitude, 0);
      const sumLng = storesData.reduce((acc, s) => acc + s.longitude, 0);
      center = [sumLng / storesData.length, sumLat / storesData.length];
    }

    // Initialize Maplibre GL JS Map (No token needed!)
    map = new maplibregl.Map({
      container: 'map',
      style: {
        "version": 8,
        "sources": {
          "esri-satellite": {
            "type": "raster",
            "tiles": [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            ],
            "tileSize": 256,
            "attribution": "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community"
          }
        },
        "layers": [
          {
            "id": "esri-satellite-layer",
            "type": "raster",
            "source": "esri-satellite",
            "minzoom": 0,
            "maxzoom": 20
          }
        ]
      },
      center: center,
      zoom: zoom
    });

    // Set 3D Globe Projection (Maplibre v5+)
    map.on('style.load', () => {
      try {
        map.setProjection({
          type: 'globe'
        });
      } catch (e) {
        console.warn("Could not set globe projection:", e);
      }
    });

    map.addControl(new maplibregl.NavigationControl());

    // Add store markers
    storesData.forEach(store => {
      // Create HTML element for the custom marker (shop image from user's demo source)
      const el = document.createElement('div');
      el.className = 'store-marker';
      el.style.backgroundImage = "url(https://cdn-icons-png.flaticon.com/512/1356/1356596.png)";
      el.style.width = "35px";
      el.style.height = "35px";
      el.style.backgroundSize = "contain";
      el.style.backgroundRepeat = "no-repeat";
      el.style.cursor = "pointer";

      // Popup content
      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
        <div style="color: #f3f4f6; font-family: 'Inter', sans-serif;">
          <h4 style="margin: 0 0 4px 0; color: #818cf8; font-family: 'Outfit', sans-serif; font-size: 14px;">${store.store_name}</h4>
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #9ca3af;"><i class="fa-solid fa-earth-americas"></i> ${store.country}</p>
          <p style="margin: 0 0 8px 0; font-size: 11px; color: #9ca3af;"><i class="fa-solid fa-box"></i> SKU: ${store.num_distinct_skus} | ${translations[currentLang].db_products_abbr || 'Sp'}: ${store.num_distinct_products}</p>
          <button data-i18n="db_view_forecast" onclick="window.openForecastPanel(${store.store_id}, '${store.store_name.replace(/'/g, "\\'")}')" style="width: 100%; font-size: 11px; padding: 6px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; border-radius: 6px; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.background='#6366f1'; this.style.color='white';" onmouseout="this.style.background='rgba(99, 102, 241, 0.15)'; this.style.color='#818cf8';">${translations[currentLang].db_view_forecast || 'Xem Dự Báo'}</button>
        </div>
      `);

      new maplibregl.Marker({ element: el })
        .setLngLat([store.longitude, store.latitude])
        .setPopup(popup)
        .addTo(map);
    });

    // Hide skeleton loading
    const skeleton = document.getElementById('map-skeleton');
    if (skeleton) {
      skeleton.style.opacity = '0';
      setTimeout(() => {
        skeleton.style.display = 'none';
      }, 500);
    }

    // Add Vietnamese sovereignty markers for Hoàng Sa & Trường Sa islands
    const vnSovereigntyIslands = [
      { name: 'Quần đảo Hoàng Sa (Đà Nẵng, Việt Nam)', lat: 16.5, lng: 112.0 },
      { name: 'Quần đảo Trường Sa (Khánh Hòa, Việt Nam)', lat: 8.6, lng: 112.0 }
    ];

    vnSovereigntyIslands.forEach(island => {
      const el = document.createElement('div');
      el.className = 'sovereignty-marker';
      el.innerHTML = `<i class="fa-solid fa-location-dot" style="font-size: 16px; color: #ef4444; cursor: pointer; text-shadow: 0 0 8px rgba(239,68,68,0.8);"></i>`;

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
        <div style="color: #f3f4f6; font-family: 'Inter', sans-serif; text-align: center; min-width: 180px;">
          <h4 style="margin: 0 0 6px 0; color: #ef4444; font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 700;">
            <i class="fa-solid fa-flag" style="margin-right: 4px;"></i> ${island.name}
          </h4>
          <p style="margin: 0; font-size: 11px; color: #10b981; font-weight: 600;">Lãnh thổ Việt Nam</p>
        </div>
      `);

      new maplibregl.Marker({ element: el })
        .setLngLat([island.lng, island.lat])
        .setPopup(popup)
        .addTo(map);
    });

  } catch (err) {
    console.error('Error initializing map:', err);
    document.getElementById('map').innerHTML = `<div style="padding: 40px; color: var(--danger); text-align: center;">
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 48px; margin-bottom: 16px;"></i>
      <p>Không thể khởi tạo bản đồ. Vui lòng tải lại trang.</p>
    </div>`;
  }
}

// Global hook for Mapbox popup click
window.openForecastPanel = async function(storeId, storeName) {
  const panel = document.getElementById('forecast-panel');
  panel.classList.remove('hidden');
  
  document.getElementById('forecast-store-name').textContent = storeName;
  activeForecastStoreId = storeId;

  showForecastPanelSkeleton();

  try {
    const data = await fetchAPI(`/api/predict?store_id=${storeId}`);
    activeForecastsData = data.forecasts;
    
    // Fetch store inventory to check stock warnings
    try {
      activeStoreInventoryData = await fetchAPI(`/api/inventory?store_id=${storeId}`);
    } catch (e) {
      console.warn('Failed to load store inventory for warnings:', e);
      activeStoreInventoryData = [];
    }
    
    // Populate SKU Selector
    const selector = document.getElementById('forecast-sku-selector');
    selector.innerHTML = '';
    
    if (activeForecastsData.length === 0) {
      selector.innerHTML = `<option value="">${currentLang === 'en' ? 'No forecast data' : (currentLang === 'zh' ? '无预测数据' : 'Không có dữ liệu dự báo')}</option>`;
      document.getElementById('forecast-sku-count').textContent = '0';
      document.getElementById('forecast-next-week-qty').textContent = '0';
      Plotly.purge('forecast-chart');
      return;
    }

    document.getElementById('forecast-sku-count').textContent = activeForecastsData.length;

    activeForecastsData.forEach((f, idx) => {
      const option = document.createElement('option');
      option.value = f.sku;
      
      let displayName = f.product_name;
      if (displayName.startsWith('Sản phẩm')) {
        const suffix = displayName.replace('Sản phẩm', '').trim();
        if (currentLang === 'en') {
          displayName = `Product ${suffix}`;
        } else if (currentLang === 'zh') {
          displayName = `商品 ${suffix}`;
        } else {
          displayName = `Sản phẩm ${suffix}`;
        }
      }
      
      option.textContent = `${f.sku} - ${displayName}`;
      if (idx === 0) option.selected = true;
      selector.appendChild(option);
    });

    // Render initial chart
    renderForecastChart(activeForecastsData[0].sku);

  } catch (err) {
    console.error('Error loading forecast:', err);
    alert('Không thể tải dữ liệu dự báo cho cửa hàng này.');
  }
};

function renderForecastChart(sku) {
  const forecastObj = activeForecastsData.find(f => f.sku === sku);
  if (!forecastObj) return;

  const timeline = forecastObj.timeline; // Array of { year, week, predicted, actual }
  
  // Set stats card next week demand
  const nextWeekIndex = timeline.findIndex(t => t.actual === null);
  const nextWeekForecast = nextWeekIndex !== -1 ? timeline[nextWeekIndex].predicted : timeline[0].predicted;
  document.getElementById('forecast-next-week-qty').textContent = nextWeekForecast;

  // Warning check: if predicted quantity > stock remaining
  const alertBanner = document.getElementById('forecast-alert-banner');
  const inventoryItem = activeStoreInventoryData.find(i => i.sku === sku);
  const stockQty = inventoryItem ? inventoryItem.stock_quantity : 0;

  if (nextWeekForecast > stockQty) {
    const diff = nextWeekForecast - stockQty;
    const descEl = document.getElementById('alert-banner-desc');
    if (descEl) {
      if (currentLang === 'en') {
        descEl.innerHTML = `Next week forecasted demand (<strong>${nextWeekForecast}</strong>) exceeds the remaining in-stock quantity (<strong>${stockQty}</strong>). Please import <strong style="color:#f87171">${diff}</strong> more products!`;
      } else if (currentLang === 'zh') {
        descEl.innerHTML = `下周预测需求数量 (<strong>${nextWeekForecast}</strong>) 超出了目前该商品的剩余库存量 (<strong>${stockQty}</strong>)。请补货 <strong style="color:#f87171">${diff}</strong> 件商品！`;
      } else {
        descEl.innerHTML = `Số lượng dự báo tuần tới (<strong>${nextWeekForecast}</strong>) vượt quá số lượng hàng còn lại trong kho (<strong>${stockQty}</strong>). Vui lòng bổ sung thêm <strong style="color:#f87171">${diff}</strong> sản phẩm!`;
      }
    }
    alertBanner.classList.remove('hidden');
  } else {
    alertBanner.classList.add('hidden');
  }

  // Determine time grouping
  const timeGroup = document.getElementById('forecast-time-group').value;
  let dataPoints = [];

  if (timeGroup === 'month') {
    // Group timeline by month
    const monthlyMap = {};
    timeline.forEach(t => {
      // Map week (1-53) to month (1-12)
      const month = Math.min(12, Math.max(1, Math.floor((t.week - 1) / 4.34) + 1));
      let key = '';
      if (currentLang === 'en') {
        key = `Month ${month}/${t.year}`;
      } else if (currentLang === 'zh') {
        key = `第${month}月/${t.year}年`;
      } else {
        key = `Tháng ${month}/${t.year}`;
      }
      if (!monthlyMap[key]) {
        monthlyMap[key] = {
          label: key,
          predicted: 0,
          actual: 0,
          hasActual: false
        };
      }
      monthlyMap[key].predicted += t.predicted;
      if (t.actual !== null) {
        monthlyMap[key].actual += t.actual;
        monthlyMap[key].hasActual = true;
      }
    });

    dataPoints = Object.values(monthlyMap).map(m => ({
      label: m.label,
      predicted: m.predicted,
      actual: m.hasActual ? m.actual : null
    }));
  } else {
    // Group timeline by week/year to prevent duplicate labels causing overlapping columns
    const weeklyMap = {};
    timeline.forEach(t => {
      let key = '';
      if (currentLang === 'en') {
        key = `Week ${t.week}/${t.year}`;
      } else if (currentLang === 'zh') {
        key = `第${t.week}周/${t.year}年`;
      } else {
        key = `Tuần ${t.week}/${t.year}`;
      }
      if (!weeklyMap[key]) {
        weeklyMap[key] = {
          label: key,
          predicted: 0,
          actual: 0,
          hasActual: false
        };
      }
      weeklyMap[key].predicted += t.predicted;
      if (t.actual !== null) {
        weeklyMap[key].actual += t.actual;
        weeklyMap[key].hasActual = true;
      }
    });

    dataPoints = Object.values(weeklyMap).map(w => ({
      label: w.label,
      predicted: w.predicted,
      actual: w.hasActual ? w.actual : null
    }));
  }

  const labels = dataPoints.map(d => d.label);
  const predictedVals = dataPoints.map(d => d.predicted);
  const chartType = document.getElementById('forecast-chart-type').value;

  let traces = [];

  if (chartType === 'column') {
    // Grouped-Stacked column chart:
    // predicted = green column (left)
    // actual = royal blue column (right bottom)
    // upcoming = light blue column (right top)
    const actualVals = [];
    const upcomingVals = [];

    dataPoints.forEach(d => {
      const act = d.actual === null ? 0 : d.actual;
      const pred = d.predicted;
      actualVals.push(act);
      upcomingVals.push(Math.max(0, pred - act));
    });

    traces = [
      {
        x: labels,
        y: predictedVals,
        name: currentLang === 'en' ? 'Predicted' : (currentLang === 'zh' ? '预测 (Predicted)' : 'Dự kiến (Predicted)'),
        type: 'bar',
        offsetgroup: 'predicted',
        marker: { color: '#24ad4a' } // Green
      },
      {
        x: labels,
        y: actualVals,
        name: currentLang === 'en' ? 'Actual' : (currentLang === 'zh' ? '实际 (Actual)' : 'Thực tế (Actual)'),
        type: 'bar',
        offsetgroup: 'actual_upcoming',
        marker: { color: '#3f51b5' } // Royal Blue
      },
      {
        x: labels,
        y: upcomingVals,
        base: actualVals,
        name: currentLang === 'en' ? 'Upcoming' : (currentLang === 'zh' ? '即将到来 (Upcoming)' : 'Sắp tới (Upcoming)'),
        type: 'bar',
        offsetgroup: 'actual_upcoming',
        marker: { color: '#9ad6eb' } // Light Blue
      }
    ];
  } else {
    // Line chart
    const lineActualVals = dataPoints.map(d => d.actual);
    traces = [
      {
        x: labels,
        y: lineActualVals,
        name: currentLang === 'en' ? 'Actual' : (currentLang === 'zh' ? '实际 (Actual)' : 'Thực tế (Actual)'),
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#10b981', width: 3 }, // Green
        marker: { size: 6 }
      },
      {
        x: labels,
        y: predictedVals,
        name: currentLang === 'en' ? 'Forecast' : (currentLang === 'zh' ? '预测 (Forecast)' : 'Dự báo (Forecast)'),
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#818cf8', width: 3, dash: 'dash' }, // Dotted Indigo
        marker: { size: 6 }
      }
    ];
  }

  // Calculate dynamic bargap based on data points count to keep columns slim
  const numDataPoints = labels.length;
  let dynamicBargap = 0.3;
  if (numDataPoints <= 2) {
    dynamicBargap = 0.65; // Skinny columns when only 1-2 items
  } else if (numDataPoints <= 4) {
    dynamicBargap = 0.45; // Moderately skinny columns for 3-4 items
  }

  const layout = {
    barmode: 'group',
    bargap: dynamicBargap,
    height: 320,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter, sans-serif' },
    margin: { t: 20, r: 15, b: 60, l: 40 },
    legend: { orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center' },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { size: 10 } },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', title: currentLang === 'en' ? 'Product Quantity' : (currentLang === 'zh' ? '产品数量' : 'Số lượng sản phẩm') }
  };

  Plotly.newPlot('forecast-chart', traces, layout, { responsive: true, displayModeBar: false });
}

// Event handlers for selector changes
document.getElementById('forecast-sku-selector').addEventListener('change', (e) => {
  renderForecastChart(e.target.value);
});

document.getElementById('forecast-chart-type').addEventListener('change', () => {
  const sku = document.getElementById('forecast-sku-selector').value;
  if (sku) renderForecastChart(sku);
});

document.getElementById('forecast-time-group').addEventListener('change', () => {
  const sku = document.getElementById('forecast-sku-selector').value;
  if (sku) renderForecastChart(sku);
});

document.getElementById('btn-close-forecast').addEventListener('click', () => {
  document.getElementById('forecast-panel').classList.add('hidden');
});

function updateForecastPanelLanguage() {
  const forecastPanel = document.getElementById('forecast-panel');
  if (forecastPanel && !forecastPanel.classList.contains('hidden')) {
    const selector = document.getElementById('forecast-sku-selector');
    const selectedSku = selector ? selector.value : null;
    
    if (activeForecastsData && activeForecastsData.length > 0) {
      selector.innerHTML = '';
      activeForecastsData.forEach((f, idx) => {
        const option = document.createElement('option');
        option.value = f.sku;
        
        let displayName = f.product_name;
        if (displayName.startsWith('Sản phẩm')) {
          const suffix = displayName.replace('Sản phẩm', '').trim();
          if (currentLang === 'en') {
            displayName = `Product ${suffix}`;
          } else if (currentLang === 'zh') {
            displayName = `商品 ${suffix}`;
          } else {
            displayName = `Sản phẩm ${suffix}`;
          }
        }
        
        option.textContent = `${f.sku} - ${displayName}`;
        if (selectedSku && f.sku === selectedSku) {
          option.selected = true;
        } else if (!selectedSku && idx === 0) {
          option.selected = true;
        }
        selector.appendChild(option);
      });
      
      const currentSku = selector.value;
      if (currentSku) {
        renderForecastChart(currentSku);
      }
    }
  }
}

// ================= SKELETON LOADING HELPERS =================
function showTableSkeleton(tbodyId, colCount, rowCount = 5) {
  const tbody = document.querySelector(tbodyId);
  if (!tbody) return;
  let html = '';
  for (let r = 0; r < rowCount; r++) {
    html += '<tr class="skeleton-table-row">';
    for (let c = 0; c < colCount; c++) {
      const widthClass = c === 0 ? 'short' : (c === 1 ? 'medium' : '');
      html += `<td><span class="skeleton skeleton-text ${widthClass}"></span></td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

function showChartSkeleton(chartId) {
  const el = document.getElementById(chartId);
  if (!el) return;
  el.innerHTML = '<div class="skeleton skeleton-chart-box"><span class="skeleton skeleton-text short" style="width: 50px;"></span></div>';
}

function showGridSkeleton(gridId, cardCount = 8) {
  const grid = document.querySelector(gridId);
  if (!grid) return;
  let html = '';
  for (let i = 0; i < cardCount; i++) {
    html += `
      <div class="card skeleton-card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background: var(--bg-card); box-sizing: border-box;">
        <div class="skeleton" style="width: 100%; height: 180px; border-radius: var(--border-radius);"></div>
        <div class="skeleton skeleton-text" style="width: 80%;"></div>
        <div class="skeleton skeleton-text short" style="width: 40%;"></div>
        <div class="skeleton skeleton-text medium" style="width: 60%;"></div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function showForecastPanelSkeleton() {
  const countEl = document.getElementById('forecast-sku-count');
  const qtyEl = document.getElementById('forecast-next-week-qty');
  const selector = document.getElementById('forecast-sku-selector');
  
  if (countEl) countEl.innerHTML = '<span class="skeleton skeleton-text short" style="display:inline-block; width:30px; height:12px; margin:0;"></span>';
  if (qtyEl) qtyEl.innerHTML = '<span class="skeleton skeleton-text short" style="display:inline-block; width:30px; height:12px; margin:0;"></span>';
  if (selector) selector.innerHTML = `<option value="">${currentLang === 'en' ? 'Loading SKUs...' : (currentLang === 'zh' ? '正在加载商品...' : 'Đang tải danh sách hàng...')}</option>`;
  
  showChartSkeleton('forecast-chart');
}

// ================= CUSTOMERS TAB LOGIC =================
async function loadCustomersTab() {
  const storeSelect = document.getElementById('customers-store-filter');
  const storeFilterGroup = document.getElementById('customers-store-filter-group');

  if (storeSelect && storeSelect.children.length === 0) {
    try {
      const stores = await fetchAPI('/api/stores');
      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      
      storeSelect.innerHTML = hasAllStores ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeSelect.appendChild(opt);
      });

      if (hasAllStores) {
        storeFilterGroup.style.display = 'block';
      } else {
        storeSelect.value = currentUser.store_id || '';
        storeFilterGroup.style.display = 'none';
      }

      storeSelect.addEventListener('change', () => {
        pagState.customers.page = 1;
        loadCustomersTab();
      });
    } catch (e) {
      console.error('Error populating store filter in customers tab:', e);
    }
  }

  const { page, limit, search, gender } = pagState.customers;
  const storeId = storeSelect ? storeSelect.value : '';
  
  showTableSkeleton('#customers-table tbody', 6);
  showChartSkeleton('customers-gender-chart');
  showChartSkeleton('customers-age-chart');

  try {
    // Fetch paginated table data AND all customers for charts in parallel
    const [res, allCustomersRes] = await Promise.all([
      fetchAPI(`/api/customers?page=${page}&limit=${limit}&search=${search}&gender=${gender}&store_id=${storeId}`),
      fetchAPI(`/api/customers?page=1&limit=9999&search=&gender=&store_id=${storeId}`)
    ]);
    
    // Render Table
    const tbody = document.querySelector('#customers-table tbody');
    tbody.innerHTML = '';
    
    res.data.forEach(c => {
      const isDirector = currentUser.role === 'Director';
      const tr = document.createElement('tr');
      const genderText = c.gender === 'Male' ? (currentLang === 'en' ? 'Male' : (currentLang === 'zh' ? '男' : 'Nam')) :
                         (c.gender === 'Female' ? (currentLang === 'en' ? 'Female' : (currentLang === 'zh' ? '女' : 'Nữ')) : 
                         (currentLang === 'en' ? 'Non-binary' : (currentLang === 'zh' ? '其他' : 'Khác')));
      const deleteText = currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa');
      const lockedText = currentLang === 'en' ? 'Locked' : (currentLang === 'zh' ? '锁定' : 'Khóa');
      
      tr.innerHTML = `
        <td><code>#${c.customer_id}</code></td>
        <td><strong>${c.customer_name}</strong></td>
        <td>${c.age}</td>
        <td><span class="badge badge-gender">${genderText}</span></td>
        <td><i class="fa-solid fa-map-pin"></i> ${c.country}</td>
        <td>
          ${isDirector ? `<button class="btn-action-delete" onclick="deleteCustomer(${c.customer_id})"><i class="fa-solid fa-trash"></i> ${deleteText}</button>` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> ${lockedText}</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });

    pagState.customers.total = res.total;
    renderPagination('customers', res.total, page, limit);
    
    // Render charts using ALL customer data for accurate demographics
    renderCustomerCharts(allCustomersRes.data);

  } catch (err) {
    console.error('Error loading customers:', err);
  }
}

function renderCustomerCharts(allCustomers) {
  // Calculate REAL gender distribution from actual customer data
  let maleCount = 0, femaleCount = 0, otherCount = 0;
  allCustomers.forEach(c => {
    if (c.gender === 'Male' || c.gender === 'M') maleCount++;
    else if (c.gender === 'Female' || c.gender === 'F') femaleCount++;
    else otherCount++;
  });

  const genderLabels = currentLang === 'en' ? ['Male', 'Female', 'Other'] : (currentLang === 'zh' ? ['男', '女', '其他'] : ['Nam', 'Nữ', 'Khác']);
  const genderData = [
    { values: [maleCount, femaleCount, otherCount], labels: genderLabels, type: 'pie', hole: .4, 
      marker: { colors: ['#6366f1', '#ec4899', '#f59e0b'] },
      textinfo: 'label+percent',
      hovertemplate: '%{label}: %{value} (%{percent})<extra></extra>'
    }
  ];

  const genderLayout = {
    title: currentLang === 'en' ? 'Gender Distribution' : (currentLang === 'zh' ? '性别分布' : 'Phân bố Giới tính'),
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 40, r: 10, b: 10, l: 10 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.1 }
  };

  Plotly.newPlot('customers-gender-chart', genderData, genderLayout, { displayModeBar: false });

  // Calculate REAL age distribution from actual customer data
  let age18_25 = 0, age26_35 = 0, age36_45 = 0, age46_55 = 0, age56plus = 0;
  allCustomers.forEach(c => {
    const age = parseInt(c.age) || 0;
    if (age >= 18 && age <= 25) age18_25++;
    else if (age >= 26 && age <= 35) age26_35++;
    else if (age >= 36 && age <= 45) age36_45++;
    else if (age >= 46 && age <= 55) age46_55++;
    else if (age > 55) age56plus++;
    else age18_25++; // Default bucket for outliers
  });

  const ageTrace = {
    x: ['18-25', '26-35', '36-45', '46-55', '56+'],
    y: [age18_25, age26_35, age36_45, age46_55, age56plus],
    type: 'bar',
    marker: {
      color: ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6'],
      opacity: 0.85
    },
    hovertemplate: '%{x}: %{y} customers<extra></extra>'
  };

  const ageLayout = {
    title: currentLang === 'en' ? 'Age Distribution' : (currentLang === 'zh' ? '年龄分布' : 'Phân bố Độ tuổi'),
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 40, r: 10, b: 40, l: 30 },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)' }
  };

  Plotly.newPlot('customers-age-chart', [ageTrace], ageLayout, { displayModeBar: false });
}

// Customers tab search/filters
document.getElementById('customers-search').addEventListener('input', (e) => {
  pagState.customers.search = e.target.value;
  pagState.customers.page = 1;
  loadCustomersTab();
});

document.getElementById('customers-gender-filter').addEventListener('change', (e) => {
  pagState.customers.gender = e.target.value;
  pagState.customers.page = 1;
  loadCustomersTab();
});

// ================= DISCOUNTS TAB LOGIC =================
async function loadDiscountsTab() {
  const storeFilter = document.getElementById('discounts-store-filter');
  
  try {
    // Populate store filter dropdown if empty
    if (storeFilter.children.length === 0) {
      // Fetch stores
      const stores = await fetchAPI('/api/stores');
      storeFilter.innerHTML = currentUser.role === 'Director' ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeFilter.appendChild(opt);
      });
      
      // Set initial value for Managers
      if (currentUser.role !== 'Director') {
        storeFilter.value = currentUser.store_id;
      }
    }

    const storeId = storeFilter.value;
    showTableSkeleton('#discounts-table tbody', 6);
    showChartSkeleton('discounts-chart');
    const discounts = await fetchAPI(`/api/discounts?store_id=${storeId}`);
    
    // Render Table
    const tbody = document.querySelector('#discounts-table tbody');
    tbody.innerHTML = '';

    discounts.forEach(d => {
      const discountPct = (d.total_discount_avg * 100).toFixed(2);
      const isEditable = currentUser.role === 'Director' || !d.store_id || currentUser.store_id === d.store_id;
      
      const translateSeasonName = (name) => {
        if (!name) return '';
        const cleanName = name.trim();
        const years = ['2023', '2024', '2025', '2026', '2027'];
        const seasons = [
          { vi: 'Mùa đông', en: 'Winter', zh: '冬季' },
          { vi: 'Mùa xuân', en: 'Spring', zh: '春季' },
          { vi: 'Mùa hè', en: 'Summer', zh: '夏季' },
          { vi: 'Mùa thu', en: 'Autumn', zh: '秋季' }
        ];

        for (const year of years) {
          for (const s of seasons) {
            const matchVi = `${s.vi} ${year}`;
            const matchEn = `${s.en} ${year}`;
            const matchZh = `${year}年${s.zh}`;

            if (cleanName === matchVi || cleanName === matchEn || cleanName === matchZh) {
              return currentLang === 'en' ? matchEn : (currentLang === 'zh' ? matchZh : matchVi);
            }
          }
        }

        const campaigns = [
          { vi: 'Khuyến mãi mùa đông', en: 'Winter Sale', zh: '冬季大促销' },
          { vi: 'Khuyến mãi mùa xuân', en: 'Spring Sale', zh: '春季大促销' },
          { vi: 'Khuyến mãi mùa hè', en: 'Summer Sale', zh: '夏季大促销' },
          { vi: 'Khuyến mãi mùa thu', en: 'Autumn Sale', zh: '秋季大促销' },
          { vi: 'Giảm giá mùa đông', en: 'Winter Sale', zh: '冬季大降价' },
          { vi: 'Giảm giá mùa xuân', en: 'Spring Sale', zh: '春季大降价' },
          { vi: 'Giảm giá mùa hè', en: 'Summer Sale', zh: '夏季大降价' },
          { vi: 'Giảm giá mùa thu', en: 'Autumn Sale', zh: '秋季大降价' },
          { vi: 'Giảm giá đặc biệt', en: 'Special Sale', zh: '特大降价' },
          { vi: 'Ngày hội mua sắm', en: 'Black Friday', zh: '黑色星期五' }
        ];

        for (const c of campaigns) {
          if (cleanName.toLowerCase() === c.vi.toLowerCase() || 
              cleanName.toLowerCase() === c.en.toLowerCase() || 
              cleanName.toLowerCase() === c.zh.toLowerCase()) {
            return currentLang === 'en' ? c.en : (currentLang === 'zh' ? c.zh : c.vi);
          }
        }

        const genericSeasons = [
          { vi: 'Mùa đông', en: 'Winter', zh: '冬季' },
          { vi: 'Mùa xuân', en: 'Spring', zh: '春季' },
          { vi: 'Mùa hè', en: 'Summer', zh: '夏季' },
          { vi: 'Mùa thu', en: 'Autumn', zh: '秋季' }
        ];
        
        for (const s of genericSeasons) {
          if (cleanName.toLowerCase() === s.vi.toLowerCase() || 
              cleanName.toLowerCase() === s.en.toLowerCase() || 
              cleanName.toLowerCase() === s.zh.toLowerCase()) {
            return currentLang === 'en' ? s.en : (currentLang === 'zh' ? s.zh : s.vi);
          }
        }

        return name;
      };
      const seasonNameVal = translateSeasonName(d.season_name);
      const editText = currentLang === 'en' ? 'Edit' : (currentLang === 'zh' ? '编辑' : 'Sửa');
      const deleteText = currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa');
      const lockedText = currentLang === 'en' ? 'Locked' : (currentLang === 'zh' ? '锁定' : 'Khóa');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#DISC-${d.discount_id}</code></td>
        <td><strong>${seasonNameVal}</strong></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex-grow:1; background:rgba(255,255,255,0.05); height:8px; border-radius:4px; overflow:hidden;">
              <div style="background:var(--primary-gradient); width:${discountPct}%; height:100%;"></div>
            </div>
            <span>${discountPct}%</span>
          </div>
        </td>
        <td>${d.start_date}</td>
        <td>${d.end_date}</td>
        <td>
          ${isEditable ? `
            <div style="display: flex; gap: 8px;">
              <button class="btn-action-edit" onclick="openEditDiscount(${d.discount_id}, ${d.total_discount_avg})"><i class="fa-solid fa-pen-to-square"></i> ${editText}</button>
              <button class="btn-action-delete" onclick="deleteDiscount(${d.discount_id}, this)"><i class="fa-solid fa-trash"></i> ${deleteText}</button>
            </div>
          ` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> ${lockedText}</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Render discounts chart
    renderDiscountsChart(discounts);

  } catch (err) {
    console.error('Error loading discounts:', err);
  }
}

function renderDiscountsChart(discounts) {
  if (discounts.length === 0) {
    Plotly.purge('discounts-comparison-chart');
    return;
  }

  const seasonMap = {
    'Mùa đông 2024': { vi: 'Mùa đông 2024', en: 'Winter 2024', zh: '2024冬季' },
    'Mùa xuân 2024': { vi: 'Mùa xuân 2024', en: 'Spring 2024', zh: '2024春季' },
    'Mùa hè 2024': { vi: 'Mùa hè 2024', en: 'Summer 2024', zh: '2024夏季' },
    'Mùa thu 2024': { vi: 'Mùa thu 2024', en: 'Autumn 2024', zh: '2024秋季' }
  };
  const xData = discounts.map(d => {
    const name = seasonMap[d.season_name] ? seasonMap[d.season_name][currentLang] : d.season_name;
    const storeLabel = currentLang === 'en' ? 'Store' : (currentLang === 'zh' ? '门店' : 'Cửa hàng');
    return `${name} (${storeLabel} ${d.store_id})`;
  });
  const yData = discounts.map(d => d.total_discount_avg * 100);

  const trace = {
    x: xData,
    y: yData,
    type: 'bar',
    marker: {
      color: yData.map(v => v > 15 ? '#818cf8' : '#6366f1'),
      line: { width: 1, color: 'rgba(255,255,255,0.1)' }
    }
  };

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 20, r: 20, b: 60, l: 50 },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickangle: -20 },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', title: currentLang === 'en' ? 'Discount Percentage (%)' : (currentLang === 'zh' ? '折扣比例 (%)' : 'Phần trăm chiết khấu (%)') }
  };

  Plotly.newPlot('discounts-comparison-chart', [trace], layout, { displayModeBar: false });
}

window.openEditDiscount = function(id, val) {
  activeEditDiscount = id;
  const modal = document.getElementById('discount-modal');
  document.getElementById('edit-discount-val').value = val;
  modal.classList.add('active');
};

// Close modal buttons
document.getElementById('btn-cancel-discount').addEventListener('click', () => {
  document.getElementById('discount-modal').classList.remove('active');
  activeEditDiscount = null;
});

document.getElementById('btn-save-discount').addEventListener('click', async () => {
  const newVal = parseFloat(document.getElementById('edit-discount-val').value);
  if (isNaN(newVal) || newVal < 0 || newVal > 1) {
    alert('Mức chiết khấu phải nằm trong khoảng từ 0.00 đến 1.00');
    return;
  }

  try {
    await fetchAPI(`/api/discounts/${activeEditDiscount}`, {
      method: 'PUT',
      body: JSON.stringify({ total_discount_avg: newVal })
    });
    
    document.getElementById('discount-modal').classList.remove('active');
    activeEditDiscount = null;
    loadDiscountsTab();
  } catch (err) {
    console.error('Error updating discount:', err);
  }
});

document.getElementById('discounts-store-filter').addEventListener('change', () => {
  loadDiscountsTab();
});

// ================= EMPLOYEES TAB LOGIC =================
async function loadEmployeesTab() {
  const storeFilter = document.getElementById('employees-store-filter');
  
  try {
    if (storeFilter.children.length === 0) {
      const stores = await fetchAPI('/api/stores');
      storeFilter.innerHTML = currentUser.role === 'Director' ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeFilter.appendChild(opt);
      });
      
      if (currentUser.role !== 'Director') {
        storeFilter.value = currentUser.store_id;
      }
    }

    const storeId = storeFilter.value;
    showTableSkeleton('#employees-table tbody', 5);
    showChartSkeleton('employees-chart');
    const employees = await fetchAPI(`/api/employees?store_id=${storeId}`);
    
    const tbody = document.querySelector('#employees-table tbody');
    tbody.innerHTML = '';

    employees.forEach(e => {
      const isEditable = currentUser.role === 'Director' || currentUser.store_id === e.store_id;
      
      const roleMap = {
        'SALES STAFF': { vi: 'Nhân viên bán hàng', en: 'Sales Staff', zh: '销售员工' },
        'SALES ASSOCIATE': { vi: 'Nhân viên bán hàng', en: 'Sales Associate', zh: '销售助理' },
        'STORE MANAGER': { vi: 'Quản lý cửa hàng', en: 'Store Manager', zh: '门店经理' },
        'ASSISTANT MANAGER': { vi: 'Trợ lý quản lý', en: 'Assistant Manager', zh: '助理经理' },
        'CASHIER': { vi: 'Thu ngân', en: 'Cashier', zh: '收银员' },
        'STOCK CLERK': { vi: 'Nhân viên kho', en: 'Stock Clerk', zh: '库存员' },
        'DIRECTOR': { vi: 'Giám đốc', en: 'Director', zh: '董事/总监' },
        'INVENTORY MANAGER': { vi: 'Quản lý kho', en: 'Inventory Manager', zh: '库存经理' },
        'MARKETING MANAGER': { vi: 'Quản lý Marketing', en: 'Marketing Manager', zh: '营销经理' },
        'FINANCE/AUDITOR': { vi: 'Tài chính / Kiểm toán', en: 'Finance/Auditor', zh: '财务与审计' },
        'IT ADMIN': { vi: 'Quản trị IT', en: 'IT Admin', zh: 'IT管理员' }
      };
      const normalizedRole = (e.role || '').toUpperCase();
      const roleVal = roleMap[normalizedRole] ? roleMap[normalizedRole][currentLang] : e.role;
      const isManager = normalizedRole.includes('MANAGER') || normalizedRole.includes('DIRECTOR');
      
      const editText = currentLang === 'en' ? 'Edit' : (currentLang === 'zh' ? '编辑' : 'Sửa');
      const deleteText = currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa');
      const lockedText = currentLang === 'en' ? 'Locked' : (currentLang === 'zh' ? '锁定' : 'Khóa');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#EMP-${e.employee_id}</code></td>
        <td><strong>${e.name}</strong></td>
        <td>Store ${e.store_id}</td>
        <td><span class="badge" style="background:${isManager ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; color:${isManager ? 'var(--secondary)' : 'var(--text-main)'}; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600;">${roleVal}</span></td>
        <td>
          ${isEditable ? `
            <div style="display: flex; gap: 8px;">
              <button class="btn-action-edit" onclick="openEditEmployee(${e.employee_id}, '${e.name.replace(/'/g, "\\'")}', '${e.role}')"><i class="fa-solid fa-user-pen"></i> ${editText}</button>
              <button class="btn-action-delete" onclick="deleteEmployee(${e.employee_id})"><i class="fa-solid fa-trash"></i> ${deleteText}</button>
            </div>
          ` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> ${lockedText}</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });

    renderEmployeesChart(employees);

  } catch (err) {
    console.error('Error loading employees:', err);
  }
}

function renderEmployeesChart(employees) {
  if (employees.length === 0) {
    Plotly.purge('employees-chart');
    return;
  }

  // Count managers vs staff
  const managers = employees.filter(e => {
    const roleUpper = (e.role || '').toUpperCase();
    return roleUpper.includes('MANAGER') || roleUpper.includes('DIRECTOR');
  }).length;
  const staff = employees.length - managers;

  const labelManager = currentLang === 'en' ? 'Manager' : (currentLang === 'zh' ? '经理' : 'Quản lý (Manager)');
  const labelStaff = currentLang === 'en' ? 'Staff' : (currentLang === 'zh' ? '员工' : 'Nhân viên (Staff)');

  const data = [{
    values: [managers, staff],
    labels: [labelManager, labelStaff],
    type: 'pie',
    marker: { colors: ['#10b981', '#6366f1'] }
  }];

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 10, r: 10, b: 10, l: 10 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.1 }
  };

  Plotly.newPlot('employees-chart', data, layout, { displayModeBar: false });
}

window.openEditEmployee = function(id, name, role) {
  activeEditEmployee = id;
  document.getElementById('edit-employee-name').value = name;

  // Role hierarchy: higher index = higher rank
  const ALL_ROLES = [
    { value: 'Sales Staff',        i18n: 'modal_emp_role_staff',       label: { vi: 'Sales Staff (Nhân viên bán hàng)', en: 'Sales Staff', zh: '销售员工' } },
    { value: 'Sales Associate',    i18n: 'modal_emp_role_associate',   label: { vi: 'Sales Associate (Nhân viên bán hàng)', en: 'Sales Associate', zh: '销售助理' } },
    { value: 'Cashier',            i18n: 'modal_emp_role_cashier',     label: { vi: 'Cashier (Thu ngân)', en: 'Cashier', zh: '收银员' } },
    { value: 'Stock Clerk',        i18n: 'modal_emp_role_stock_clerk', label: { vi: 'Stock Clerk (Nhân viên kho)', en: 'Stock Clerk', zh: '库存员' } },
    { value: 'Assistant Manager',  i18n: 'modal_emp_role_assistant',   label: { vi: 'Assistant Manager (Trợ lý quản lý)', en: 'Assistant Manager', zh: '副经理' } },
    { value: 'Inventory Manager',  i18n: 'modal_emp_role_inventory',   label: { vi: 'Inventory Manager (Quản lý kho)', en: 'Inventory Manager', zh: '库存经理' } },
    { value: 'Marketing Manager',  i18n: 'modal_emp_role_marketing',   label: { vi: 'Marketing Manager (Quản lý Marketing)', en: 'Marketing Manager', zh: '市场经理' } },
    { value: 'Finance/Auditor',    i18n: 'modal_emp_role_finance',     label: { vi: 'Finance/Auditor (Tài chính / Kiểm toán)', en: 'Finance/Auditor', zh: '财务/审计' } },
    { value: 'IT Admin',           i18n: 'modal_emp_role_it',          label: { vi: 'IT Admin (Quản trị IT)', en: 'IT Admin', zh: 'IT管理员' } },
    { value: 'Store Manager',      i18n: 'modal_emp_role_manager',     label: { vi: 'Store Manager (Quản lý cửa hàng)', en: 'Store Manager', zh: '门店经理' } },
    { value: 'Director',           i18n: 'modal_emp_role_director',    label: { vi: 'Director (Giám đốc)', en: 'Director', zh: '总监' } },
  ];

  // Get current user's role level (index in ALL_ROLES)
  const myRole = (currentUser && currentUser.role) ? currentUser.role : '';
  const myRoleIndex = ALL_ROLES.findIndex(r => r.value.toUpperCase() === myRole.toUpperCase());

  // Director can assign all roles; others can only assign roles strictly below their level
  let allowedRoles;
  if (myRoleIndex === ALL_ROLES.length - 1) {
    // Director: can assign all roles
    allowedRoles = ALL_ROLES;
  } else if (myRoleIndex >= 0) {
    // Can only assign roles with a lower index than their own
    allowedRoles = ALL_ROLES.filter((_, idx) => idx < myRoleIndex);
  } else {
    // Unknown role: show only the employee's current role (read-only effectively)
    allowedRoles = [];
  }

  // Always include the employee's current role in the list (even if above user's level)
  const currentRoleInList = allowedRoles.some(r => r.value.toUpperCase() === (role || '').toUpperCase());
  if (!currentRoleInList && role) {
    const existingRole = ALL_ROLES.find(r => r.value.toUpperCase() === (role || '').toUpperCase());
    if (existingRole) allowedRoles = [existingRole, ...allowedRoles];
  }

  // Populate the select
  const select = document.getElementById('edit-employee-role');
  select.innerHTML = '';
  allowedRoles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.value;
    opt.textContent = r.label[currentLang] || r.label.vi;
    opt.setAttribute('data-i18n', r.i18n);
    select.appendChild(opt);
  });

  // Set current value
  let matchedValue = role;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value.toUpperCase() === (role || '').toUpperCase()) {
      matchedValue = select.options[i].value;
      break;
    }
  }
  select.value = matchedValue;
  document.getElementById('employee-modal').classList.add('active');
};

document.getElementById('btn-cancel-employee').addEventListener('click', () => {
  document.getElementById('employee-modal').classList.remove('active');
  activeEditEmployee = null;
});

document.getElementById('btn-save-employee').addEventListener('click', async () => {
  const name = document.getElementById('edit-employee-name').value.trim();
  const role = document.getElementById('edit-employee-role').value;

  if (!name) {
    alert('Họ tên nhân viên không được để trống.');
    return;
  }

  try {
    await fetchAPI(`/api/employees/${activeEditEmployee}`, {
      method: 'PUT',
      body: JSON.stringify({ name, role })
    });
    
    document.getElementById('employee-modal').classList.remove('active');
    activeEditEmployee = null;
    loadEmployeesTab();
  } catch (err) {
    console.error('Error updating employee:', err);
  }
});

document.getElementById('employees-store-filter').addEventListener('change', () => {
  loadEmployeesTab();
});

// ================= PRODUCTS TAB LOGIC =================
async function loadProductsTab() {
  const storeSelect = document.getElementById('products-store-filter');
  const storeFilterGroup = document.getElementById('products-store-filter-group');

  // Populate store filter once if empty
  if (storeSelect.children.length === 0) {
    try {
      const stores = await fetchAPI('/api/stores');
      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      
      storeSelect.innerHTML = hasAllStores ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeSelect.appendChild(opt);
      });

      if (hasAllStores) {
        storeFilterGroup.style.display = 'block';
      } else {
        storeSelect.value = currentUser.store_id || '';
        storeFilterGroup.style.display = 'none';
      }

      // Add listener to reload products tab when store filter changes
      storeSelect.addEventListener('change', () => {
        loadProductsTab();
      });
    } catch (e) {
      console.error('Error populating store filter in products tab:', e);
    }
  }

  const category = document.getElementById('products-category-filter').value;
  const search = document.getElementById('products-search').value;
  const storeId = storeSelect.value || '';

  showTableSkeleton('#products-tbody', 7);

  try {
    const products = await fetchAPI(`/api/products?category=${category}&search=${search}`);
    
    // Fetch inventory for the selected store/all stores to display stock quantity
    let inventoryItems = [];
    try {
      inventoryItems = await fetchAPI(`/api/inventory?store_id=${storeId}`);
    } catch (err) {
      console.warn('Failed to load inventory for stock display:', err);
    }

    const container = document.getElementById('products-tbody');
    container.innerHTML = '';

    if (products.length === 0) {
      const emptyText = currentLang === 'en' ? 'No products found.' : (currentLang === 'zh' ? '没有找到任何商品。' : 'Không tìm thấy sản phẩm nào.');
      container.innerHTML = `<tr><td colspan="7" style="padding: 40px; text-align: center; color: var(--text-muted);">${emptyText}</td></tr>`;
      return;
    }

    const hasAdminRights = currentUser.role === 'Director' || currentUser.role === 'Store Manager';
    products.forEach(p => {
      // Find matching items by SKU digits, or exact name match, or SKU prefix
      const matchingItems = inventoryItems.filter(item => {
        // 1. By SKU digits
        const skuDigits = item.sku ? item.sku.match(/\d+/) : null;
        const pId = skuDigits ? parseInt(skuDigits[0]) : null;
        if (pId === p.product_id) return true;

        // 2. By exact name match (case-insensitive)
        if (item.product_name && p.product_name && item.product_name.toLowerCase().trim() === p.product_name.toLowerCase().trim()) return true;

        // 3. By SKU prefix match
        if (p.sku && item.sku && item.sku.startsWith(p.sku.replace(/-+$/, ''))) return true;

        return false;
      });

      // Sum stock_quantity across matching items
      const stockQty = matchingItems.reduce((sum, item) => sum + (item.stock_quantity || 0), 0);

      const categoryMap = {
        'Children': { vi: 'Trẻ em (Children)', en: 'Children', zh: '儿童 (Children)' },
        'Masculine': { vi: 'Nam giới (Masculine)', en: 'Masculine', zh: '男装 (Masculine)' },
        'Feminine': { vi: 'Nữ giới (Feminine)', en: 'Feminine', zh: '女装 (Feminine)' }
      };
      const categoryVal = categoryMap[p.category] ? categoryMap[p.category][currentLang] : p.category;
      const outOfStockText = currentLang === 'en' ? 'Out of stock' : (currentLang === 'zh' ? '无库存' : 'Hết hàng');
      const editText = currentLang === 'en' ? 'Edit' : (currentLang === 'zh' ? '编辑' : 'Sửa');
      const deleteText = currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa');

      const escName = p.product_name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const escCategory = p.category.replace(/'/g, "\\'");
      const escSubCategory = p.sub_category.replace(/'/g, "\\'");
      const escColor = p.color_type.replace(/'/g, "\\'");
      const escDesc = p.description_en.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const escImg = p.image_url ? p.image_url.replace(/'/g, "\\'") : '';

      // Pick icon based on sub_category / product name keywords
      const nameLower = p.product_name.toLowerCase();
      const subLower = (p.sub_category || '').toLowerCase();
      let fashionIcon = 'fa-shirt'; // default
      if (subLower.includes('dress') || nameLower.includes('dress') || nameLower.includes('skirt')) {
        fashionIcon = 'fa-person-dress';
      } else if (subLower.includes('coat') || subLower.includes('blazer') || nameLower.includes('coat') || nameLower.includes('blazer') || nameLower.includes('jacket')) {
        fashionIcon = 'fa-vest-patches';
      } else if (subLower.includes('pants') || subLower.includes('jeans') || nameLower.includes('pants') || nameLower.includes('jeans') || nameLower.includes('trouser')) {
        fashionIcon = 'fa-socks';
      } else if (subLower.includes('shoe') || nameLower.includes('shoe') || nameLower.includes('sneaker') || nameLower.includes('boot')) {
        fashionIcon = 'fa-shoe-prints';
      } else if (subLower.includes('hat') || nameLower.includes('hat') || nameLower.includes('cap')) {
        fashionIcon = 'fa-hat-cowboy';
      } else if (subLower.includes('bag') || nameLower.includes('bag') || nameLower.includes('purse')) {
        fashionIcon = 'fa-bag-shopping';
      } else if (subLower.includes('suit') || nameLower.includes('suit') || nameLower.includes('tuxedo')) {
        fashionIcon = 'fa-user-tie';
      }

      // Category gradient class
      const catClass = p.category === 'Children' ? 'cat-children' 
                      : p.category === 'Feminine' ? 'cat-feminine'
                      : p.category === 'Masculine' ? 'cat-masculine'
                      : 'cat-default';

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      tr.innerHTML = `
        <td style="text-align: center; vertical-align: middle; padding: 12px 16px;">
          <div class="product-visual ${catClass} notranslate" translate="no" style="width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; position: relative; margin: 0 auto; box-shadow: var(--shadow-sm);">
            <i class="fa-solid ${fashionIcon}" style="font-size: 16px; color: rgba(255,255,255,0.95);"></i>
          </div>
        </td>
        <td style="vertical-align: middle; padding: 12px 16px;">
          <div style="font-weight: 600; color: var(--text-light);">${p.product_name}</div>
          <div style="font-size: 11px; color: var(--text-muted);">ID: ${p.product_id}</div>
        </td>
        <td style="vertical-align: middle; padding: 12px 16px;">
          <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); padding: 4px 8px; border-radius: 4px; font-size: 11px;">${categoryVal}</span>
        </td>
        <td style="vertical-align: middle; font-size: 13px; padding: 12px 16px;">${p.sub_category}</td>
        <td style="vertical-align: middle; font-size: 13px; color: var(--text-muted); padding: 12px 16px;">${p.color_type}</td>
        <td style="vertical-align: middle; text-align: right; font-weight: 700; font-size: 14px; color: ${stockQty > 0 ? '#10b981' : '#ef4444'}; padding: 12px 16px;">
          ${stockQty > 0 ? stockQty : outOfStockText}
        </td>
        <td style="vertical-align: middle; text-align: center; padding: 12px 16px;">
          ${hasAdminRights ? `
            <div style="display: flex; gap: 6px; justify-content: center;">
              <button class="btn-action-edit" style="padding: 6px 12px; font-size: 12px;" onclick="openEditProduct(${p.product_id}, '${escName}', '${escCategory}', '${escSubCategory}', '${escColor}', '${escDesc}', '${escImg}')"><i class="fa-solid fa-pen-to-square"></i> ${editText}</button>
              <button class="btn-action-delete" style="padding: 6px 12px; font-size: 12px;" onclick="deleteProduct(${p.product_id}, this)"><i class="fa-solid fa-trash"></i> ${deleteText}</button>
            </div>
          ` : '-'}
        </td>
      `;
      container.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

document.getElementById('products-search').addEventListener('input', () => {
  loadProductsTab();
});

document.getElementById('products-category-filter').addEventListener('change', () => {
  loadProductsTab();
});

// ================= STORES TAB LOGIC =================
async function loadStoresTab() {
  showTableSkeleton('#stores-table tbody', 7);
  showChartSkeleton('stores-chart');
  try {
    const stores = await fetchAPI('/api/stores');
    
    const tbody = document.querySelector('#stores-table tbody');
    tbody.innerHTML = '';

    stores.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#STORE-${s.store_id}</code></td>
        <td><strong>${s.store_name}</strong></td>
        <td>${s.latitude.toFixed(4)}</td>
        <td>${s.longitude.toFixed(4)}</td>
        <td><i class="fa-solid fa-earth-americas"></i> ${s.country}</td>
        <td>${s.num_distinct_skus}</td>
        <td>${s.num_distinct_products}</td>
      `;
      tbody.appendChild(tr);
    });

    renderStoresChart(stores);

  } catch (err) {
    console.error('Error loading stores:', err);
  }
}

function renderStoresChart(stores) {
  if (stores.length === 0) {
    Plotly.purge('stores-comparison-chart');
    return;
  }

  const names = stores.map(s => s.store_name);
  const skus = stores.map(s => s.num_distinct_skus);
  const products = stores.map(s => s.num_distinct_products);

  const traceSKUs = {
    x: names,
    y: skus,
    name: currentLang === 'en' ? 'Unique SKUs' : (currentLang === 'zh' ? '独立SKU数' : 'Số SKU duy nhất'),
    type: 'bar',
    marker: { color: '#6366f1' }
  };

  const traceProducts = {
    x: names,
    y: products,
    name: currentLang === 'en' ? 'Product Lines' : (currentLang === 'zh' ? '商品品类数' : 'Dòng sản phẩm'),
    type: 'bar',
    marker: { color: '#10b981' }
  };

  const layout = {
    barmode: 'group',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 20, r: 20, b: 60, l: 50 },
    legend: { orientation: 'h', y: -0.2 },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickangle: -15 },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)' }
  };

  Plotly.newPlot('stores-comparison-chart', [traceSKUs, traceProducts], layout, { displayModeBar: false });
}

// ================= TRANSACTIONS TAB LOGIC =================
async function loadTransactionsTab() {
  const storeFilter = document.getElementById('transactions-store-filter');
  
  try {
    if (storeFilter.children.length === 0) {
      const stores = await fetchAPI('/api/stores');
      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      storeFilter.innerHTML = hasAllStores ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeFilter.appendChild(opt);
      });
      
      if (!hasAllStores) {
        storeFilter.value = currentUser.store_id || '';
      }
    }

    const { page, limit, payment_method } = pagState.transactions;
    const storeId = storeFilter.value;
    showTableSkeleton('#transactions-table tbody', 10);
    const res = await fetchAPI(`/api/transactions?page=${page}&limit=${limit}&store_id=${storeId}&payment_method=${payment_method}`);
    
    const tbody = document.querySelector('#transactions-table tbody');
    tbody.innerHTML = '';

    res.data.forEach(t => {
      let formattedDate = t.date;
      if (t.timestamp) {
        formattedDate = new Date(t.timestamp).toLocaleDateString('vi-VN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      }
      const payMap = {
        'Credit Card': { vi: 'Thẻ tín dụng', en: 'Credit Card', zh: '信用卡' },
        'PayPal': { vi: 'PayPal', en: 'PayPal', zh: 'PayPal' },
        'Cash': { vi: 'Tiền mặt', en: 'Cash', zh: '现金' },
        'Apple Pay': { vi: 'Apple Pay', en: 'Apple Pay', zh: 'Apple Pay' }
      };
      const payVal = payMap[t.payment_method] ? payMap[t.payment_method][currentLang] : t.payment_method;
      const fallbackName = (currentLang === 'en' ? 'Product ' : (currentLang === 'zh' ? '商品 ' : 'Sản phẩm ')) + t.product_id;
      let displayName = t.product_name || fallbackName;
      if (displayName.startsWith('Sản phẩm #')) {
        const prodId = displayName.replace('Sản phẩm #', '');
        displayName = (currentLang === 'en' ? 'Product #' : (currentLang === 'zh' ? '商品 #' : 'Sản phẩm #')) + prodId;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#TX-${t.transaction_id}</code></td>
        <td>Store ${t.store_id}</td>
        <td><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-light); font-weight: normal;">${t.salesperson || 'System'}</span></td>
        <td><span style="font-size: 12px; color: var(--text-muted);">${formattedDate}</span></td>
        <td><code>${t.sku}</code></td>
        <td>${displayName}</td>
        <td><span class="badge">${payVal}</span></td>
        <td>${t.local_price} ${t.currency}</td>
        <td><strong>x${t.quantity}</strong></td>
        <td><strong style="color:var(--primary-light);">$${t.line_total.toFixed(2)}</strong></td>
      `;
      tbody.appendChild(tr);
    });

    pagState.transactions.total = res.total;
    renderPagination('transactions', res.total, page, limit);

  } catch (err) {
    console.error('Error loading transactions:', err);
  }
}

document.getElementById('transactions-store-filter').addEventListener('change', () => {
  pagState.transactions.page = 1;
  loadTransactionsTab();
});

document.getElementById('transactions-payment-filter').addEventListener('change', (e) => {
  pagState.transactions.payment_method = e.target.value;
  pagState.transactions.page = 1;
  loadTransactionsTab();
});

// ================= INVENTORY TAB MANAGEMENT =================
let inventorySearchTimeout = null;
let inventoryCurrentPage = 1;
const inventoryPageSize = 50;
let inventoryCachedStockItems = [];

async function loadInventoryTab() {
  const storeSelect = document.getElementById('inventory-store-select');
  const categorySelect = document.getElementById('inventory-category-select');
  const searchInput = document.getElementById('inventory-search');
  const prevBtn = document.getElementById('inventory-prev-btn');
  const nextBtn = document.getElementById('inventory-next-btn');

  try {
    // 1. Populate store filter
    if (storeSelect.children.length === 0) {
      const stores = await fetchAPI('/api/stores');
      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      
      storeSelect.innerHTML = hasAllStores ? `<option value="">${currentLang === 'en' ? 'All Stores' : (currentLang === 'zh' ? '所有门店' : 'Tất cả Cửa hàng')}</option>` : '';
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        storeSelect.appendChild(opt);
      });

      if (!hasAllStores) {
        storeSelect.value = currentUser.store_id || '';
        // Hide store filter if they only see their own store
        document.getElementById('inventory-store-filter-group').style.display = 'none';
      }

      // Add event listeners once
      storeSelect.addEventListener('change', () => {
        loadInventoryStock();
        loadInventoryImports();
      });

      categorySelect.addEventListener('change', () => {
        inventoryCurrentPage = 1;
        renderInventoryStock();
      });

      searchInput.addEventListener('input', () => {
        clearTimeout(inventorySearchTimeout);
        inventorySearchTimeout = setTimeout(() => {
          inventoryCurrentPage = 1;
          renderInventoryStock();
        }, 300);
      });

      prevBtn.addEventListener('click', () => {
        if (inventoryCurrentPage > 1) {
          inventoryCurrentPage--;
          renderInventoryStock();
        }
      });

      nextBtn.addEventListener('click', () => {
        inventoryCurrentPage++;
        renderInventoryStock();
      });
      
      setupInventoryEvents(stores);
    }

    // 2. Load Stock & Imports
    loadInventoryStock();
    loadInventoryImports();

  } catch (err) {
    console.error('Error loading inventory tab:', err);
  }
}

async function loadInventoryStock() {
  const storeId = document.getElementById('inventory-store-select').value;
  const tbody = document.getElementById('inventory-stock-tbody');
  
  showTableSkeleton('#inventory-stock-tbody', 4);
  
  try {
    inventoryCachedStockItems = await fetchAPI(`/api/inventory?store_id=${storeId}`);
    inventoryCurrentPage = 1;
    renderInventoryStock();
  } catch (err) {
    console.error('Error loading inventory stock:', err);
    const errorText = currentLang === 'en' ? 'Failed to load stock data.' : (currentLang === 'zh' ? '加载库存数据失败。' : 'Lỗi tải dữ liệu kho.');
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${errorText}</td></tr>`;
  }
}

function renderInventoryStock() {
  const tbody = document.getElementById('inventory-stock-tbody');
  const categoryFilter = document.getElementById('inventory-category-select').value;
  const search = document.getElementById('inventory-search').value.toLowerCase();
  const prevBtn = document.getElementById('inventory-prev-btn');
  const nextBtn = document.getElementById('inventory-next-btn');
  const pageInfo = document.getElementById('inventory-page-info');

  let filteredItems = inventoryCachedStockItems;

  if (categoryFilter) {
    filteredItems = filteredItems.filter(item => item.category === categoryFilter);
  }

  if (search) {
    filteredItems = filteredItems.filter(item => 
      item.sku.toLowerCase().includes(search) || 
      item.product_name.toLowerCase().includes(search) || 
      item.category.toLowerCase().includes(search)
    );
  }

  const totalFilteredItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredItems / inventoryPageSize));

  if (inventoryCurrentPage > totalPages) {
    inventoryCurrentPage = totalPages;
  }
  if (inventoryCurrentPage < 1) {
    inventoryCurrentPage = 1;
  }

  const start = (inventoryCurrentPage - 1) * inventoryPageSize;
  const end = start + inventoryPageSize;
  const pageItems = filteredItems.slice(start, end);

  tbody.innerHTML = '';

  if (pageItems.length === 0) {
    const emptyText = currentLang === 'en' ? 'No products found in stock.' : (currentLang === 'zh' ? '库存中未找到任何商品。' : 'Không tìm thấy sản phẩm nào trong kho.');
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">${emptyText}</td></tr>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    pageInfo.textContent = currentLang === 'en' 
      ? `Page 1 / 1 (Total: 0 rows)` 
      : (currentLang === 'zh' ? `第 1 / 1 页 (共 0 行)` : `Trang 1 / 1 (Tổng: 0 dòng)`);
    return;
  }

  pageItems.forEach(item => {
    const categoryMap = {
      'Children': { vi: 'Trẻ em (Children)', en: 'Children', zh: '儿童 (Children)' },
      'Masculine': { vi: 'Nam giới (Masculine)', en: 'Masculine', zh: '男装 (Masculine)' },
      'Feminine': { vi: 'Nữ giới (Feminine)', en: 'Feminine', zh: '女装 (Feminine)' }
    };
    const catVal = categoryMap[item.category] ? categoryMap[item.category][currentLang] : item.category;
    let displayName = item.product_name || '';
    if (displayName.startsWith('Sản phẩm #')) {
      const prodId = displayName.replace('Sản phẩm #', '');
      displayName = (currentLang === 'en' ? 'Product #' : (currentLang === 'zh' ? '商品 #' : 'Sản phẩm #')) + prodId;
    } else if (displayName.startsWith('Sản phẩm ')) {
      const suffix = displayName.replace('Sản phẩm ', '');
      displayName = (currentLang === 'en' ? 'Product ' : (currentLang === 'zh' ? '商品 ' : 'Sản phẩm ')) + suffix;
    }

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
    tr.innerHTML = `
      <td style="padding: 10px;"><code>${item.sku}</code></td>
      <td style="padding: 10px; color: var(--text-light); font-weight: 500;">${displayName}</td>
      <td style="padding: 10px;"><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted);">${catVal}</span></td>
      <td style="padding: 10px; text-align: right; font-weight: bold; color: ${item.stock_quantity <= 15 ? '#ef4444' : '#10b981'}">
        ${item.stock_quantity}
      </td>
    `;
    tbody.appendChild(tr);
  });

  prevBtn.disabled = (inventoryCurrentPage === 1);
  nextBtn.disabled = (inventoryCurrentPage === totalPages);
  
  if (currentLang === 'en') {
    pageInfo.textContent = `Page ${inventoryCurrentPage} / ${totalPages} (Total: ${totalFilteredItems} rows)`;
  } else if (currentLang === 'zh') {
    pageInfo.textContent = `第 ${inventoryCurrentPage} / ${totalPages} 页 (共 ${totalFilteredItems} 行)`;
  } else {
    pageInfo.textContent = `Trang ${inventoryCurrentPage} / ${totalPages} (Tổng: ${totalFilteredItems} dòng)`;
  }
}

async function loadInventoryImports() {
  const storeId = document.getElementById('inventory-store-select').value;
  const tbody = document.getElementById('inventory-imports-tbody');
  
  showTableSkeleton('#inventory-imports-tbody', 4);
  
  try {
    const imports = await fetchAPI(`/api/inventory/imports?store_id=${storeId}`);
    tbody.innerHTML = '';
    
    if (imports.length === 0) {
      const emptyText = currentLang === 'en' ? 'No stock imports found.' : (currentLang === 'zh' ? '暂无入库记录。' : 'Chưa có lịch sử nhập hàng nào.');
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">${emptyText}</td></tr>`;
      return;
    }

    imports.forEach(item => {
      const dateStr = new Date(item.import_date).toLocaleString('vi-VN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      let displayName = item.product_name || '';
      if (displayName.startsWith('Sản phẩm #')) {
        const prodId = displayName.replace('Sản phẩm #', '');
        displayName = (currentLang === 'en' ? 'Product #' : (currentLang === 'zh' ? '商品 #' : 'Sản phẩm #')) + prodId;
      } else if (displayName.startsWith('Sản phẩm ')) {
        const suffix = displayName.replace('Sản phẩm ', '');
        displayName = (currentLang === 'en' ? 'Product ' : (currentLang === 'zh' ? '商品 ' : 'Sản phẩm ')) + suffix;
      }

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
      tr.innerHTML = `
        <td style="padding: 10px; font-size: 11px; color: var(--text-muted);">${dateStr}</td>
        <td style="padding: 10px;">
          <div style="font-weight: 500;"><code>${item.sku}</code></div>
          <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${displayName}</div>
        </td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: var(--primary-light);">+${item.quantity}</td>
        <td style="padding: 10px; font-size: 12px; color: var(--text-light);">${item.supplier}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading inventory imports:', err);
    const errorText = currentLang === 'en' ? 'Failed to load import history.' : (currentLang === 'zh' ? '加载入库历史失败。' : 'Lỗi tải lịch sử nhập hàng.');
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${errorText}</td></tr>`;
  }
}

function setupInventoryEvents(stores) {
  const modal = document.getElementById('inventory-import-modal');
  const btnOpen = document.getElementById('btn-open-import');
  const btnCancel = document.getElementById('btn-cancel-import');
  const form = document.getElementById('inventory-import-form');
  
  const storeInput = document.getElementById('import-store-input');
  const skuInput = document.getElementById('import-sku-input');

  // Populate store dropdown inside modal
  storeInput.innerHTML = '';
  stores.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.store_id;
    opt.textContent = s.store_name;
    storeInput.appendChild(opt);
  });

  const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
  if (!hasAllStores) {
    storeInput.value = currentUser.store_id || '';
    document.querySelector('.import-store-container').style.display = 'none';
  }

  // Handle Radio Option Selector Toggle
  const radioExisting = document.getElementById('import-type-existing');
  const radioNew = document.getElementById('import-type-new');
  const blockExisting = document.getElementById('import-existing-block');
  const blockNew = document.getElementById('import-new-block');

  const nameNewInput = document.getElementById('import-new-name-input');
  const catNewInput = document.getElementById('import-new-cat-input');
  const skuSearchInput = document.getElementById('import-sku-search');

  function toggleImportBlocks() {
    if (radioNew.checked) {
      blockExisting.style.display = 'none';
      blockNew.style.display = 'block';
      nameNewInput.required = true;
      skuInput.required = false;
    } else {
      blockExisting.style.display = 'block';
      blockNew.style.display = 'none';
      nameNewInput.required = false;
      skuInput.required = true;
    }
  }

  if (radioExisting && radioNew) {
    radioExisting.addEventListener('change', toggleImportBlocks);
    radioNew.addEventListener('change', toggleImportBlocks);
  }

  let cachedImportProducts = [];

  function renderImportSkuOptions(products) {
    skuInput.innerHTML = '';
    if (products.length === 0) {
      skuInput.innerHTML = `<option value="">${currentLang === 'en' ? 'No products found' : (currentLang === 'zh' ? '未找到任何商品' : 'Không tìm thấy sản phẩm nào')}</option>`;
      return;
    }
    
    // Limit to 100 to prevent browser select overload
    const limit = 100;
    const toRender = products.slice(0, limit);
    toRender.forEach(p => {
      const opt = document.createElement('option');
      const sku = p.sku || `SKU-${p.product_id}`;
      opt.value = sku;
      opt.textContent = `${sku} - ${p.product_name}`;
      skuInput.appendChild(opt);
    });

    if (products.length > limit) {
      const opt = document.createElement('option');
      opt.disabled = true;
      const moreText = currentLang === 'en' ? 'more products, search to filter' : (currentLang === 'zh' ? '更多商品，输入搜索以过滤' : 'sản phẩm khác, hãy gõ tìm kiếm để lọc');
      opt.textContent = `... ${products.length - limit} ${moreText} ...`;
      skuInput.appendChild(opt);
    }
  }

  // Handle Search inside SKU Selector
  if (skuSearchInput) {
    skuSearchInput.addEventListener('input', () => {
      const q = skuSearchInput.value.toLowerCase();
      const filtered = cachedImportProducts.filter(p => {
        const sku = (p.sku || `SKU-${p.product_id}`).toLowerCase();
        const name = p.product_name.toLowerCase();
        return sku.includes(q) || name.includes(q);
      });
      renderImportSkuOptions(filtered);
    });
  }

  async function loadImportSkuList() {
    const storeId = storeInput.value || currentUser.store_id || '';
    if (!storeId) {
      skuInput.innerHTML = `<option value="">${currentLang === 'en' ? 'Select a store first' : (currentLang === 'zh' ? '请先选择门店' : 'Vui lòng chọn cửa hàng trước')}</option>`;
      return;
    }
    if (skuSearchInput) {
      skuSearchInput.disabled = true;
      skuSearchInput.placeholder = currentLang === 'en' ? 'Loading products...' : (currentLang === 'zh' ? '正在加载商品...' : 'Đang tải danh sách...');
    }
    skuInput.innerHTML = `<option value="">${currentLang === 'en' ? 'Loading products...' : (currentLang === 'zh' ? '正在加载商品...' : 'Đang tải danh sách sản phẩm...')}</option>`;
    try {
      cachedImportProducts = await fetchAPI(`/api/inventory?store_id=${storeId}`);
      renderImportSkuOptions(cachedImportProducts);
    } catch (e) {
      console.warn('Failed to load store inventory for import:', e);
      skuInput.innerHTML = `<option value="">${currentLang === 'en' ? 'Error loading products' : (currentLang === 'zh' ? '加载商品失败' : 'Lỗi tải danh sách sản phẩm')}</option>`;
    } finally {
      if (skuSearchInput) {
        skuSearchInput.disabled = false;
        skuSearchInput.placeholder = currentLang === 'en' ? 'Type SKU or name to search...' : (currentLang === 'zh' ? '搜索 SKU / 商品名称...' : 'Tìm kiếm SKU / Tên sản phẩm...');
      }
    }
  }

  if (storeInput) {
    storeInput.addEventListener('change', loadImportSkuList);
  }

  // Open modal
  btnOpen.addEventListener('click', async () => {
    form.reset();
    if (skuSearchInput) {
      skuSearchInput.value = '';
      skuSearchInput.disabled = true;
    }
    if (radioExisting) radioExisting.checked = true;
    toggleImportBlocks();
    
    if (!hasAllStores) {
      storeInput.value = currentUser.store_id || '';
    }

    modal.classList.add('active');
    await loadImportSkuList();
  });

  // Cancel/Close modal
  const closeModal = () => modal.classList.remove('active');
  btnCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Form submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let finalSku = '';
    const isNewProduct = radioNew ? radioNew.checked : false;

    try {
      if (isNewProduct) {
        // Step 1: Create new product first
        const newProductPayload = {
          product_name: nameNewInput.value,
          category: catNewInput.value,
          sub_category: 'New Import',
          color_type: 'Cor Unica',
          description_en: nameNewInput.value
        };

        const createRes = await fetchAPI('/api/products', {
          method: 'POST',
          body: JSON.stringify(newProductPayload)
        });

        const createdProduct = createRes.product || createRes;
        finalSku = createdProduct.sku || `SKU-${createdProduct.product_id}`;
      } else {
        // Use selected existing product SKU
        finalSku = skuInput.value;
      }

      if (!finalSku) {
        alert('Vui lòng chọn hoặc tạo mặt hàng trước khi nhập kho.');
        return;
      }

      // Step 2: Post the stock import
      const payload = {
        store_id: storeInput.value,
        sku: finalSku,
        quantity: document.getElementById('import-qty-input').value,
        supplier: document.getElementById('import-supplier-input').value
      };

      const res = await fetchAPI('/api/inventory/imports', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      closeModal();
      alert(res.message || 'Nhập kho thành công!');
      
      // Reload both lists
      loadInventoryStock();
      loadInventoryImports();
    } catch (err) {
      console.error('Error importing inventory:', err);
      alert(err.message || 'Lỗi nhập hàng. Vui lòng thử lại.');
    }
  });
}

// ================= PAGINATION COMPONENT =================
function renderPagination(tab, total, page, limit) {
  const container = document.getElementById(`${tab}-pagination`);
  container.innerHTML = '';

  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return; // No pagination needed

  // Prev Button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.disabled = page === 1;
  prevBtn.addEventListener('click', () => {
    pagState[tab].page = page - 1;
    loadTabContent(tab);
  });
  container.appendChild(prevBtn);

  // Number Buttons (Max 5 shown)
  let startPage = Math.max(1, page - 2);
  let endPage = Math.min(totalPages, page + 2);

  for (let i = startPage; i <= endPage; i++) {
    const pBtn = document.createElement('button');
    pBtn.className = `page-btn ${i === page ? 'active' : ''}`;
    pBtn.textContent = i;
    pBtn.addEventListener('click', () => {
      pagState[tab].page = i;
      loadTabContent(tab);
    });
    container.appendChild(pBtn);
  }

  // Next Button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = page === totalPages;
  nextBtn.addEventListener('click', () => {
    pagState[tab].page = page + 1;
    loadTabContent(tab);
  });
  container.appendChild(nextBtn);
}

// Helper to dynamically set tooltips when sidebar is collapsed
function updateSidebarTooltips() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.contains('collapsed');
  document.querySelectorAll('.nav-item').forEach(item => {
    const span = item.querySelector('span');
    if (span) {
      if (isCollapsed) {
        item.setAttribute('title', span.textContent.trim());
      } else {
        item.removeAttribute('title');
      }
    }
  });
}

// Restore sidebar state from localStorage on page load
(function restoreSidebarState() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && window.innerWidth > 1024) {
    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      updateSidebarTooltips();
    }
  }
})();

// Mobile/Desktop Sidebar Toggle event listeners
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    if (window.innerWidth > 1024) {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed') ? 'true' : 'false');
      updateSidebarTooltips();
    } else {
      sidebar.classList.toggle('sidebar-open');
      overlay.style.display = sidebar.classList.contains('sidebar-open') ? 'block' : 'none';
    }
  }
});

document.getElementById('sidebar-overlay').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.remove('sidebar-open');
    overlay.style.display = 'none';
  }
});

// Sidebar Navigation click handlers
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const tabName = item.getAttribute('data-tab');
    switchTab(tabName);
  });
});

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  
  const usernameVal = document.getElementById('username').value.trim();
  const passwordVal = document.getElementById('password').value;
  const otpCodeVal = document.getElementById('otp-code').value.trim();

  try {
    if (mfaStepActive) {
      if (!otpCodeVal || otpCodeVal.length !== 6) {
        throw new Error('Vui lòng nhập mã OTP gồm 6 chữ số');
      }
      
      const data = await fetchAPI('/api/auth/verify-mfa', {
        method: 'POST',
        body: JSON.stringify({ ticket: mfaTicket, code: otpCodeVal })
      });
      
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      resetLoginFormState();
      showApp();
    } else {
      const data = await fetchAPI('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: usernameVal, password: passwordVal })
      });

      if (data.mfa_required) {
        mfaStepActive = true;
        mfaTicket = data.ticket;
        document.getElementById('credentials-group').classList.add('hidden');
        document.getElementById('mfa-group').classList.remove('hidden');
        document.getElementById('btn-login-text').textContent = 'Xác nhận OTP';
        document.getElementById('otp-code').required = true;
        document.getElementById('otp-code').focus();
        return;
      }

      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      resetLoginFormState();
      showApp();
    }
  } catch (err) {
    loginError.textContent = err.message || 'Đăng nhập thất bại. Vui lòng thử lại.';
  }
});

function resetLoginFormState() {
  mfaStepActive = false;
  mfaTicket = null;
  document.getElementById('credentials-group').classList.remove('hidden');
  document.getElementById('mfa-group').classList.add('hidden');
  document.getElementById('btn-login-text').textContent = 'Đăng Nhập';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('otp-code').value = '';
  document.getElementById('otp-code').required = false;
}

// ================= CRUD SYSTEM ACTIONS & HANDS =================

// Helper: Populate store dropdowns in CRUD modals
async function populateModalStoreDropdowns() {
  try {
    const stores = await fetchAPI('/api/stores');
    
    discountStoreInput.innerHTML = '';
    employeeStoreInput.innerHTML = '';

    stores.forEach(s => {
      const opt1 = document.createElement('option');
      opt1.value = s.store_id;
      opt1.textContent = s.store_name;
      discountStoreInput.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = s.store_id;
      opt2.textContent = s.store_name;
      employeeStoreInput.appendChild(opt2);
    });

    const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
    if (!hasAllStores) {
      discountStoreInput.value = currentUser.store_id || '';
      discountStoreInput.disabled = true;
      employeeStoreInput.value = currentUser.store_id || '';
      employeeStoreInput.disabled = true;
    } else {
      discountStoreInput.disabled = false;
      employeeStoreInput.disabled = false;
    }
  } catch (err) {
    console.error('Error populating store dropdowns in modals:', err);
  }
}

// Customers CRUD
btnAddCustomer.addEventListener('click', () => {
  customerModal.classList.add('active');
});
btnCancelCustomer.addEventListener('click', () => {
  customerModal.classList.remove('active');
  customerForm.reset();
});
customerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customer_name = document.getElementById('customer-name-input').value.trim();
  const age = parseInt(document.getElementById('customer-age-input').value);
  const gender = document.getElementById('customer-gender-input').value;
  const country = document.getElementById('customer-country-input').value.trim();
  
  const storeSelect = document.getElementById('customers-store-filter');
  const store_id = storeSelect && storeSelect.value ? storeSelect.value : (currentUser.store_id || 1);

  try {
    const data = await fetchAPI('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ customer_name, age, gender, country, store_id })
    });
    alert(data.message || 'Thêm khách hàng thành công!');
    customerModal.classList.remove('active');
    customerForm.reset();
    loadCustomersTab();
  } catch (err) {
    console.error('Error creating customer:', err);
    alert(err.message || 'Lỗi khi thêm khách hàng.');
  }
});

window.deleteCustomer = async function(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa khách hàng này không?')) return;
  try {
    const data = await fetchAPI(`/api/customers/${id}`, { method: 'DELETE' });
    alert(data.message || 'Xóa khách hàng thành công!');
    loadCustomersTab();
  } catch (err) {
    console.error('Error deleting customer:', err);
  }
};

// Discounts CRUD (Create)
btnAddDiscount.addEventListener('click', async () => {
  await populateModalStoreDropdowns();
  discountCreateModal.classList.add('active');
});
btnCancelCreateDiscount.addEventListener('click', () => {
  discountCreateModal.classList.remove('active');
  discountCreateForm.reset();
});
discountCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const store_id = parseInt(discountStoreInput.value);
  const season_name = document.getElementById('discount-season-input').value.trim();
  const total_discount_avg = parseFloat(document.getElementById('discount-avg-input').value);
  const start_date = document.getElementById('discount-start-input').value;
  const end_date = document.getElementById('discount-end-input').value;

  try {
    const data = await fetchAPI('/api/discounts', {
      method: 'POST',
      body: JSON.stringify({ store_id, season_name, total_discount_avg, start_date, end_date })
    });
    alert(data.message || 'Tạo khuyến mãi mới thành công!');
    discountCreateModal.classList.remove('active');
    discountCreateForm.reset();
    loadDiscountsTab();
  } catch (err) {
    console.error('Error creating discount:', err);
    alert(err.message || 'Lỗi khi tạo khuyến mãi.');
  }
});

window.deleteDiscount = async function(id, btn) {
  if (!confirm(currentLang === 'en' ? 'Are you sure you want to delete this discount?' : (currentLang === 'zh' ? '你确定要删除这个优惠吗？' : 'Bạn có chắc chắn muốn xóa khuyến mãi này không?'))) return;

  // Dynamically inject style once
  if (!document.getElementById('shimmer-style-injection')) {
    const style = document.createElement('style');
    style.id = 'shimmer-style-injection';
    style.innerHTML = `
      @keyframes shimmerPulse {
        0% { background-color: rgba(255, 255, 255, 0.01); }
        50% { background-color: rgba(255, 255, 255, 0.08); }
        100% { background-color: rgba(255, 255, 255, 0.01); }
      }
      .shimmer-row td {
        animation: shimmerPulse 1.2s infinite ease-in-out !important;
        color: var(--text-muted) !important;
      }
    `;
    document.head.appendChild(style);
  }

  const row = btn ? btn.closest('tr') : null;
  if (row) {
    // Disable row buttons to prevent double submission
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    row.classList.add('shimmer-row');
    row.style.opacity = '0.7';

    // Show loading spinner on delete button
    if (btn) {
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${currentLang === 'en' ? 'Deleting...' : (currentLang === 'zh' ? '删除中...' : 'Đang xóa...')}`;
    }
  }

  try {
    const data = await fetchAPI(`/api/discounts/${id}`, { method: 'DELETE' });
    
    if (row) {
      // Slide-out and fade-out animation for premium feel
      row.style.transition = 'all 0.4s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    
    loadDiscountsTab();
  } catch (err) {
    console.error('Error deleting discount:', err);
    alert(currentLang === 'en' ? 'Failed to delete discount!' : (currentLang === 'zh' ? '删除优惠失败！' : 'Xóa khuyến mãi thất bại!'));
    
    if (row) {
      row.classList.remove('shimmer-row');
      row.style.opacity = '1';
      row.querySelectorAll('button').forEach(b => b.disabled = false);
      if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> ${currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa')}`;
      }
    }
  }
};

// Employees CRUD (Create)
btnAddEmployee.addEventListener('click', async () => {
  await populateModalStoreDropdowns();
  employeeCreateModal.classList.add('active');
});
btnCancelCreateEmployee.addEventListener('click', () => {
  employeeCreateModal.classList.remove('active');
  employeeCreateForm.reset();
});
employeeCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const store_id = parseInt(employeeStoreInput.value);
  const name = document.getElementById('employee-name-input').value.trim();
  const role = document.getElementById('employee-role-input').value;

  try {
    const data = await fetchAPI('/api/employees', {
      method: 'POST',
      body: JSON.stringify({ store_id, name, role })
    });
    alert(data.message || 'Thêm nhân viên mới thành công!');
    employeeCreateModal.classList.remove('active');
    employeeCreateForm.reset();
    loadEmployeesTab();
  } catch (err) {
    console.error('Error creating employee:', err);
    alert(err.message || 'Lỗi khi thêm nhân viên.');
  }
});

window.deleteEmployee = async function(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa nhân viên này không?')) return;
  try {
    const data = await fetchAPI(`/api/employees/${id}`, { method: 'DELETE' });
    alert(data.message || 'Xóa nhân viên thành công!');
    loadEmployeesTab();
  } catch (err) {
    console.error('Error deleting employee:', err);
  }
};

// Products CRUD (Create & Edit)
btnAddProduct.addEventListener('click', () => {
  activeEditProduct = null;
  productModalTitle.setAttribute('data-i18n', 'modal_add_product_title');
  document.getElementById('btn-save-product-submit').setAttribute('data-i18n', 'modal_btn_create');
  translatePage();
  document.getElementById('product-id-input').value = '';
  productForm.reset();
  productModal.classList.add('active');
});
btnCancelProduct.addEventListener('click', () => {
  productModal.classList.remove('active');
  productForm.reset();
});

window.openEditProduct = function(id, name, category, subCategory, color, description, imageUrl) {
  activeEditProduct = id;
  productModalTitle.setAttribute('data-i18n', 'modal_edit_product_title');
  document.getElementById('btn-save-product-submit').setAttribute('data-i18n', 'modal_prod_btn_save');
  translatePage();
  document.getElementById('product-id-input').value = id;
  
  document.getElementById('product-name-input').value = name;
  document.getElementById('product-category-input').value = category;
  document.getElementById('product-subcategory-input').value = subCategory;
  document.getElementById('product-color-input').value = color;
  document.getElementById('product-description-input').value = description;
  document.getElementById('product-image-input').value = imageUrl;

  productModal.classList.add('active');
};

window.deleteProduct = async function(id, btn) {
  if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này không?')) return;

  // Dynamically inject style once
  if (!document.getElementById('shimmer-style-injection')) {
    const style = document.createElement('style');
    style.id = 'shimmer-style-injection';
    style.innerHTML = `
      @keyframes shimmerPulse {
        0% { background-color: rgba(255, 255, 255, 0.01); }
        50% { background-color: rgba(255, 255, 255, 0.08); }
        100% { background-color: rgba(255, 255, 255, 0.01); }
      }
      .shimmer-row td {
        animation: shimmerPulse 1.2s infinite ease-in-out !important;
        color: var(--text-muted) !important;
      }
    `;
    document.head.appendChild(style);
  }

  const row = btn ? btn.closest('tr') : null;
  if (row) {
    // Disable row buttons to prevent double submission
    row.querySelectorAll('button').forEach(b => b.disabled = true);
    row.classList.add('shimmer-row');
    row.style.opacity = '0.7';

    // Show loading spinner on delete button
    if (btn) {
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${currentLang === 'en' ? 'Deleting...' : (currentLang === 'zh' ? '删除中...' : 'Đang xóa...')}`;
    }
  }

  try {
    const data = await fetchAPI(`/api/products/${id}`, { method: 'DELETE' });
    
    if (row) {
      // Slide-out and fade-out animation for premium feel
      row.style.transition = 'all 0.4s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    
    loadProductsTab();
  } catch (err) {
    console.error('Error deleting product:', err);
    alert(currentLang === 'en' ? 'Failed to delete product!' : (currentLang === 'zh' ? '删除商品失败！' : 'Xóa sản phẩm thất bại!'));
    
    if (row) {
      row.classList.remove('shimmer-row');
      row.style.opacity = '1';
      row.querySelectorAll('button').forEach(b => b.disabled = false);
      if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> ${currentLang === 'en' ? 'Delete' : (currentLang === 'zh' ? '删除' : 'Xóa')}`;
      }
    }
  }
};

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const product_name = document.getElementById('product-name-input').value.trim();
  const category = document.getElementById('product-category-input').value;
  const sub_category = document.getElementById('product-subcategory-input').value.trim();
  const color_type = document.getElementById('product-color-input').value.trim();
  const description_en = document.getElementById('product-description-input').value.trim();
  const image_url = document.getElementById('product-image-input').value.trim() || null;

  const payload = { product_name, category, sub_category, color_type, description_en, image_url };

  try {
    let data;
    if (activeEditProduct) {
      data = await fetchAPI(`/api/products/${activeEditProduct}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      alert(data.message || 'Cập nhật sản phẩm thành công!');
    } else {
      data = await fetchAPI('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      alert(data.message || 'Thêm sản phẩm mới thành công!');
    }
    
    productModal.classList.remove('active');
    productForm.reset();
    loadProductsTab();
  } catch (err) {
    console.error('Error saving product:', err);
    alert(err.message || 'Lỗi khi lưu sản phẩm.');
  }
});

// Logout click handler
btnLogout.addEventListener('click', () => {
  const msg = currentLang === 'en' ? 'Are you sure you want to log out?' : (currentLang === 'zh' ? '您确定要退出登录吗？' : 'Bạn có chắc chắn muốn đăng xuất?');
  if (confirm(msg)) {
    logout();
  }
});

// ================= IT ADMIN MANAGEMENT & MFA CLIENT FUNCTIONS =================

async function loadAdminUsersTab() {
  try {
    const users = await fetchAPI('/api/admin/users');
    const stores = await fetchAPI('/api/stores');
    
    const storeSelect = document.getElementById('admin-user-store-input');
    storeSelect.innerHTML = `<option value="">${currentLang === 'en' ? 'None (Global)' : (currentLang === 'zh' ? '无 (全局)' : 'Không gán (Global)')}</option>`;
    stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.store_id;
      opt.textContent = s.store_name;
      storeSelect.appendChild(opt);
    });

    const tbody = document.querySelector('#admin-users-table tbody');
    tbody.innerHTML = '';
    
    users.forEach(u => {
      const tr = document.createElement('tr');
      const storeName = u.store_id ? (stores.find(s => s.store_id === u.store_id)?.store_name || `Store #${u.store_id}`) : (currentLang === 'en' ? 'Global (All)' : (currentLang === 'zh' ? '全局 (所有)' : 'Global (Tất cả)'));
      const mfaText = u.mfa_enabled ? `<span class="mfa-status-active"><i class="fa-solid fa-circle-check"></i> ${currentLang === 'en' ? 'Enabled' : (currentLang === 'zh' ? '已启用' : 'Đang bật')}</span>` : `<span class="mfa-status-inactive"><i class="fa-solid fa-circle-xmark"></i> ${currentLang === 'en' ? 'Disabled' : (currentLang === 'zh' ? '未启用' : 'Chưa bật')}</span>`;
      
      tr.innerHTML = `
        <td>${u.id}</td>
        <td><strong>${u.username}</strong></td>
        <td><span class="badge">${u.role}</span></td>
        <td>${storeName}</td>
        <td>${mfaText}</td>
        <td>
          <button class="btn-action-edit" onclick="openEditAdminUser(${u.id}, '${u.username}', '${u.role}', ${u.store_id || 'null'})" title="Sửa"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-action-delete" onclick="deleteAdminUser(${u.id})" title="Xóa"><i class="fa-solid fa-trash"></i></button>
          ${u.mfa_enabled ? `<button class="btn-action-edit" style="background:var(--danger-color); margin-left: 5px;" onclick="resetAdminUserMfa(${u.id})" title="Tắt & Reset MFA"><i class="fa-solid fa-key"></i> Reset MFA</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading admin users tab:', err);
  }
}

window.openEditAdminUser = function(id, username, role, storeId) {
  document.getElementById('admin-user-modal-title').textContent = currentLang === 'en' ? 'Update Account' : (currentLang === 'zh' ? '更新账户' : 'Cập nhật tài khoản');
  document.getElementById('admin-user-id-input').value = id;
  document.getElementById('admin-user-username-input').value = username;
  document.getElementById('admin-user-username-input').disabled = true;
  document.getElementById('admin-user-password-input').placeholder = currentLang === 'en' ? 'Leave blank to keep password' : (currentLang === 'zh' ? '留空以保留密码' : 'Bỏ trống nếu giữ nguyên mật khẩu');
  document.getElementById('admin-user-password-input').required = false;
  document.getElementById('admin-user-role-input').value = role;
  document.getElementById('admin-user-store-input').value = storeId || '';
  document.getElementById('admin-user-modal').classList.add('active');
};

window.deleteAdminUser = async function(id) {
  if (id === currentUser.id) {
    alert(currentLang === 'en' ? 'Cannot delete your own account!' : (currentLang === 'zh' ? '无法删除您自己的账户！' : 'Không thể tự xóa tài khoản của chính bạn!'));
    return;
  }
  const msg = currentLang === 'en' ? 'Are you sure you want to delete this account?' : (currentLang === 'zh' ? '您确定要删除此账户吗？' : 'Bạn có chắc chắn muốn xóa tài khoản này không?');
  if (!confirm(msg)) return;
  try {
    const data = await fetchAPI(`/api/admin/users/${id}`, { method: 'DELETE' });
    alert(data.message || (currentLang === 'en' ? 'Deleted successfully' : (currentLang === 'zh' ? '删除成功' : 'Xóa thành công')));
    loadAdminUsersTab();
  } catch (err) {
    console.error('Error deleting user:', err);
  }
};

window.resetAdminUserMfa = async function(id) {
  const msg = currentLang === 'en' ? 'Are you sure you want to disable and reset MFA for this account?' : (currentLang === 'zh' ? '您确定要禁用并重置此账户的MFA吗？' : 'Bạn có chắc muốn tắt và reset MFA cho tài khoản này không?');
  if (!confirm(msg)) return;
  try {
    const data = await fetchAPI(`/api/admin/users/${id}/reset-mfa`, { method: 'POST' });
    alert(data.message || (currentLang === 'en' ? 'Reset MFA successfully' : (currentLang === 'zh' ? '重置MFA成功' : 'Reset MFA thành công')));
    loadAdminUsersTab();
  } catch (err) {
    console.error('Error resetting MFA:', err);
  }
};

const permissionTranslations = {
  vi: {
    'Dashboard & Cửa hàng': 'Dashboard & Cửa hàng',
    'Xem Dashboard & Bản đồ': 'Xem Dashboard & Bản đồ',
    'Xem Toàn bộ Cửa hàng (Global)': 'Xem Toàn bộ Cửa hàng (Global)',
    'Xem Cửa hàng được gán (Local)': 'Xem Cửa hàng được gán (Local)',
    'Khách hàng': 'Khách hàng',
    'Xem danh sách Khách hàng': 'Xem danh sách Khách hàng',
    'Thêm Khách hàng': 'Thêm Khách hàng',
    'Xóa Khách hàng': 'Xóa Khách hàng',
    'Khuyến mãi & Giảm giá': 'Khuyến mãi & Giảm giá',
    'Xem danh sách Khuyến mãi': 'Xem danh sách Khuyến mãi',
    'Thao tác Khuyến mãi (CRUD)': 'Thao tác Khuyến mãi (CRUD)',
    'Nhân sự': 'Nhân sự',
    'Xem danh sách Nhân sự': 'Xem danh sách Nhân sự',
    'Thao tác Nhân sự (CRUD)': 'Thao tác Nhân sự (CRUD)',
    'Sản phẩm': 'Sản phẩm',
    'Xem danh mục Sản phẩm': 'Xem danh mục Sản phẩm',
    'Thao tác Sản phẩm (CRUD)': 'Thao tác Sản phẩm (CRUD)',
    'Giao dịch': 'Giao dịch',
    'Xem lịch sử Giao dịch': 'Xem lịch sử Giao dịch',
    'Quản trị hệ thống (IT Admin)': 'Quản trị hệ thống (IT Admin)',
    'Quản lý Tài khoản': 'Quản lý Tài khoản',
    'Thiết lập Phân quyền': 'Thiết lập Phân quyền',
    'Xem Nhật ký Hoạt động (Audit Logs)': 'Xem Nhật ký Hoạt động (Audit Logs)',
    'Quyền Hạn / Vai trò': 'Quyền Hạn / Vai trò',
    'Lưu cấu hình thành công!': 'Lưu cấu hình thành công!',
    'Lỗi lưu phân quyền: ': 'Lỗi lưu phân quyền: ',
    'Quản lý Kho': 'Quản lý Kho',
    'Xem danh sách Tồn kho / Nhập kho': 'Xem danh sách Tồn kho / Nhập kho',
    'Thao tác Nhập kho (CRUD)': 'Thao tác Nhập kho (CRUD)'
  },
  en: {
    'Dashboard & Cửa hàng': 'Dashboard & Stores',
    'Xem Dashboard & Bản đồ': 'View Dashboard & Map',
    'Xem Toàn bộ Cửa hàng (Global)': 'View All Stores (Global)',
    'Xem Cửa hàng được gán (Local)': 'View Assigned Store (Local)',
    'Khách hàng': 'Customers',
    'Xem danh sách Khách hàng': 'View Customer List',
    'Thêm Khách hàng': 'Add Customer',
    'Xóa Khách hàng': 'Delete Customer',
    'Khuyến mãi & Giảm giá': 'Promotions & Discounts',
    'Xem danh sách Khuyến mãi': 'View Promotions',
    'Thao tác Khuyến mãi (CRUD)': 'Manage Promotions (CRUD)',
    'Nhân sự': 'Staff',
    'Xem danh sách Nhân sự': 'View Staff List',
    'Thao tác Nhân sự (CRUD)': 'Manage Staff (CRUD)',
    'Sản phẩm': 'Products',
    'Xem danh mục Sản phẩm': 'View Product Catalog',
    'Thao tác Sản phẩm (CRUD)': 'Manage Products (CRUD)',
    'Giao dịch': 'Transactions',
    'Xem lịch sử Giao dịch': 'View Transaction History',
    'Quản trị hệ thống (IT Admin)': 'System Admin (IT Admin)',
    'Quản lý Tài khoản': 'System User Management',
    'Thiết lập Phân quyền': 'RBAC Configuration',
    'Xem Nhật ký Hoạt động (Audit Logs)': 'View Audit Logs',
    'Quyền Hạn / Vai trò': 'Permission / Role',
    'Lưu cấu hình thành công!': 'Configuration saved successfully!',
    'Lỗi lưu phân quyền: ': 'Error saving permissions: ',
    'Quản lý Kho': 'Inventory Management',
    'Xem danh sách Tồn kho / Nhập kho': 'View Inventory & Stock Imports',
    'Thao tác Nhập kho (CRUD)': 'Manage Stock Imports (CRUD)'
  },
  zh: {
    'Dashboard & Cửa hàng': '地图与门店',
    'Xem Dashboard & Bản đồ': '查看地图仪表盘',
    'Xem Toàn bộ Cửa hàng (Global)': '查看所有门店 (全局)',
    'Xem Cửa hàng được gán (Local)': '查看受管辖门店 (本地)',
    'Khách hàng': '客户管理',
    'Xem danh sách Khách hàng': '查看客户列表',
    'Thêm Khách hàng': '添加客户',
    'Xóa Khách hàng': '删除客户',
    'Khuyến mãi & Giảm giá': '促销与折扣',
    'Xem danh sách Khuyến mãi': '查看促销信息',
    'Thao tác Khuyến mãi (CRUD)': '操作促销信息 (CRUD)',
    'Nhân sự': '员工管理',
    'Xem danh sách Nhân sự': '查看员工列表',
    'Thao tác Nhân sự (CRUD)': '操作员工信息 (CRUD)',
    'Sản phẩm': '商品管理',
    'Xem danh mục Sản phẩm': '查看商品名册',
    'Thao tác Sản phẩm (CRUD)': '操作商品信息 (CRUD)',
    'Giao dịch': '交易历史',
    'Xem lịch sử Giao dịch': '查看交易历史记录',
    'Quản trị hệ thống (IT Admin)': '系统管理 (IT Admin)',
    'Quản lý Tài khoản': '账户管理',
    'Thiết lập Phân quyền': '系统权限设置',
    'Xem Nhật ký Hoạt động (Audit Logs)': '查看操作日志 (审计日志)',
    'Quyền Hạn / Vai trò': '权限 / 角色',
    'Lưu cấu hình thành công!': '配置保存成功！',
    'Lỗi lưu phân quyền: ': '保存权限出错: ',
    'Quản lý Kho': '库存管理',
    'Xem danh sách Tồn kho / Nhập kho': '查看库存与入库单列表',
    'Thao tác Nhập kho (CRUD)': '操作入库单 (CRUD)'
  }
};

let currentPermissionsMap = {};

let selectedRoleForPermissions = '';

function saveCurrentRolePermissionsFromUI() {
  if (!selectedRoleForPermissions) return;
  const checkboxes = document.querySelectorAll('.permission-checkbox');
  const activePerms = [];
  checkboxes.forEach(cb => {
    const role = cb.getAttribute('data-role');
    const perm = cb.getAttribute('data-perm');
    if (role === selectedRoleForPermissions && cb.checked) {
      activePerms.push(perm);
    }
  });
  currentPermissionsMap[selectedRoleForPermissions] = activePerms;
}

async function loadAdminPermissionsTab() {
  try {
    currentPermissionsMap = await fetchAPI('/api/admin/permissions');
    
    // Get visible roles (excluding Director)
    const visibleRoles = Object.keys(currentPermissionsMap).filter(role => role !== 'Director');
    
    // Set default selected role if not set or invalid
    if (!selectedRoleForPermissions || !visibleRoles.includes(selectedRoleForPermissions)) {
      selectedRoleForPermissions = visibleRoles[0] || '';
    }

    // 1. Render Left Role List
    const roleList = document.getElementById('role-selector-list');
    roleList.innerHTML = '';
    visibleRoles.forEach(role => {
      const btn = document.createElement('div');
      btn.className = `role-select-card ${role === selectedRoleForPermissions ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${role}</span>
        <i class="fa-solid fa-chevron-right" style="font-size: 11px; opacity: 0.5;"></i>
      `;
      btn.addEventListener('click', () => {
        // Save current changes of the previous role in memory
        saveCurrentRolePermissionsFromUI();
        
        selectedRoleForPermissions = role;
        loadAdminPermissionsTab();
      });
      roleList.appendChild(btn);
    });

    // 2. Update Badge Name
    document.getElementById('editing-role-badge').textContent = selectedRoleForPermissions;

    // 3. Render Right Permission Cards Grouped by Category
    const permissionGroups = [
      {
        category: 'Dashboard & Cửa hàng',
        color: '#3b82f6',
        icon: 'fa-chart-line',
        perms: [
          { key: 'view_dashboard', name: 'Xem Dashboard & Bản đồ' },
          { key: 'view_all_stores', name: 'Xem Toàn bộ Cửa hàng (Global)' },
          { key: 'view_own_store', name: 'Xem Cửa hàng được gán (Local)' }
        ]
      },
      {
        category: 'Quản lý Kho',
        color: '#10b981',
        icon: 'fa-warehouse',
        perms: [
          { key: 'view_inventory', name: 'Xem danh sách Tồn kho / Nhập kho' },
          { key: 'manage_inventory', name: 'Thao tác Nhập kho (CRUD)' }
        ]
      },
      {
        category: 'Khách hàng',
        color: '#10b981',
        icon: 'fa-users',
        perms: [
          { key: 'view_customers', name: 'Xem danh sách Khách hàng' },
          { key: 'create_customer', name: 'Thêm Khách hàng' },
          { key: 'delete_customer', name: 'Xóa Khách hàng' }
        ]
      },
      {
        category: 'Khuyến mãi & Giảm giá',
        color: '#f59e0b',
        icon: 'fa-tags',
        perms: [
          { key: 'view_discounts', name: 'Xem danh sách Khuyến mãi' },
          { key: 'edit_discounts', name: 'Thao tác Khuyến mãi (CRUD)' }
        ]
      },
      {
        category: 'Nhân sự',
        color: '#ec4899',
        icon: 'fa-user-tie',
        perms: [
          { key: 'view_employees', name: 'Xem danh sách Nhân sự' },
          { key: 'edit_employees', name: 'Thao tác Nhân sự (CRUD)' }
        ]
      },
      {
        category: 'Sản phẩm',
        color: '#8b5cf6',
        icon: 'fa-box-open',
        perms: [
          { key: 'view_products', name: 'Xem danh mục Sản phẩm' },
          { key: 'edit_products', name: 'Thao tác Sản phẩm (CRUD)' }
        ]
      },
      {
        category: 'Giao dịch',
        color: '#06b6d4',
        icon: 'fa-receipt',
        perms: [
          { key: 'view_transactions', name: 'Xem lịch sử Giao dịch' }
        ]
      },
      {
        category: 'Quản trị hệ thống (IT Admin)',
        color: '#ef4444',
        icon: 'fa-users-gear',
        perms: [
          { key: 'manage_users', name: 'Quản lý Tài khoản' },
          { key: 'manage_permissions', name: 'Thiết lập Phân quyền' },
          { key: 'view_audit_logs', name: 'Xem Nhật ký Hoạt động (Audit Logs)' }
        ]
      }
    ];

    const container = document.getElementById('permissions-groups-container');
    container.innerHTML = '';

    permissionGroups.forEach(group => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(255,255,255,0.01);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 10px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        border-top: 3px solid ${group.color};
      `;

      const catName = (permissionTranslations[currentLang] && permissionTranslations[currentLang][group.category]) || group.category;
      
      let headerHtml = `
        <div style="display: flex; align-items: center; gap: 8px; color: ${group.color}; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="fa-solid ${group.icon}"></i> <span>${catName}</span>
        </div>
      `;
      card.innerHTML = headerHtml;

      const itemsList = document.createElement('div');
      itemsList.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 12px;
      `;

      group.perms.forEach(perm => {
        const item = document.createElement('div');
        item.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 8px 0;
          border-bottom: 1px dashed rgba(255,255,255,0.03);
        `;
        if (group.perms[group.perms.length - 1] === perm) {
          item.style.borderBottom = 'none';
        }

        const permName = (permissionTranslations[currentLang] && permissionTranslations[currentLang][perm.name]) || perm.name;
        const checked = currentPermissionsMap[selectedRoleForPermissions].includes(perm.key) ? 'checked' : '';

        item.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 13px; font-weight: 500; color: var(--text-main);">${permName}</span>
            <code style="font-size: 9px; color: var(--text-muted);">${perm.key}</code>
          </div>
          <label class="switch">
            <input type="checkbox" class="permission-checkbox" data-role="${selectedRoleForPermissions}" data-perm="${perm.key}" ${checked}>
            <span class="slider"></span>
          </label>
        `;
        itemsList.appendChild(item);
      });

      card.appendChild(itemsList);
      container.appendChild(card);
    });

    // Update Toggle All Button Text
    const toggleAllBtn = document.getElementById('btn-toggle-all-perms');
    if (toggleAllBtn) {
      let allChecked = true;
      const checkboxes = document.querySelectorAll('.permission-checkbox');
      checkboxes.forEach(cb => {
        if (!cb.checked) allChecked = false;
      });
      
      toggleAllBtn.innerHTML = allChecked ? 
        `<i class="fa-solid fa-square-minus"></i> ${currentLang === 'en' ? 'Deselect All' : (currentLang === 'zh' ? '取消全选' : 'Bỏ chọn tất cả')}` : 
        `<i class="fa-solid fa-square-check"></i> ${currentLang === 'en' ? 'Select All' : (currentLang === 'zh' ? '全选' : 'Chọn tất cả')}`;
    }

  } catch (err) {
    console.error('Error loading permissions tab:', err);
  }
}

document.getElementById('btn-toggle-all-perms').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.permission-checkbox');
  let allChecked = true;
  checkboxes.forEach(cb => {
    if (!cb.checked) allChecked = false;
  });
  
  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
  });
  
  const toggleAllBtn = document.getElementById('btn-toggle-all-perms');
  toggleAllBtn.innerHTML = !allChecked ? 
    `<i class="fa-solid fa-square-minus"></i> ${currentLang === 'en' ? 'Deselect All' : (currentLang === 'zh' ? '取消全选' : 'Bỏ chọn tất cả')}` : 
    `<i class="fa-solid fa-square-check"></i> ${currentLang === 'en' ? 'Select All' : (currentLang === 'zh' ? '全选' : 'Chọn tất cả')}`;
});

document.getElementById('btn-save-permissions').addEventListener('click', async () => {
  saveCurrentRolePermissionsFromUI();
  
  // Clone currentPermissionsMap to keep roles like Director completely unmodified
  const updatedPermissions = JSON.parse(JSON.stringify(currentPermissionsMap));

  try {
    const data = await fetchAPI('/api/admin/permissions', {
      method: 'PUT',
      body: JSON.stringify(updatedPermissions)
    });
    const successMsg = (permissionTranslations[currentLang] && permissionTranslations[currentLang]['Lưu cấu hình thành công!']) || 'Lưu cấu hình thành công!';
    alert(data.message || successMsg);
    
    if (updatedPermissions[currentUser.role]) {
      currentUser.permissions = updatedPermissions[currentUser.role];
      localStorage.setItem('user', JSON.stringify(currentUser));
      configurePermissionBasedVisibility();
    }
    
    loadAdminPermissionsTab();
  } catch (err) {
    const errorPrefix = (permissionTranslations[currentLang] && permissionTranslations[currentLang]['Lỗi lưu phân quyền: ']) || 'Lỗi lưu phân quyền: ';
    alert(errorPrefix + err.message);
  }
});

function translateLogDetails(details) {
  if (!details) return '';
  if (currentLang === 'vi') return details;
  
  let translated = details;
  const mappings = {
    en: [
      { regex: /Đăng nhập thành công/g, replacement: 'Logged in successfully' },
      { regex: /Đăng nhập MFA thành công/g, replacement: 'MFA login successful' },
      { regex: /Tạo khách hàng/g, replacement: 'Created customer' },
      { regex: /Xóa khách hàng/g, replacement: 'Deleted customer' },
      { regex: /Tạo khuyến mãi/g, replacement: 'Created promotion' },
      { regex: /Cập nhật khuyến mãi/g, replacement: 'Updated promotion' },
      { regex: /Xóa khuyến mãi/g, replacement: 'Deleted promotion' },
      { regex: /Thêm nhân viên/g, replacement: 'Added employee' },
      { regex: /Cập nhật nhân viên/g, replacement: 'Updated employee' },
      { regex: /Xóa nhân viên/g, replacement: 'Deleted employee' },
      { regex: /Tạo sản phẩm/g, replacement: 'Created product' },
      { regex: /Cập nhật sản phẩm/g, replacement: 'Updated product' },
      { regex: /Xóa sản phẩm/g, replacement: 'Deleted product' },
      { regex: /Tạo tài khoản/g, replacement: 'Created system account' },
      { regex: /Cập nhật tài khoản/g, replacement: 'Updated system account' },
      { regex: /Xóa tài khoản/g, replacement: 'Deleted system account' },
      { regex: /Bật MFA thành công/g, replacement: 'Enabled MFA successfully' },
      { regex: /Tắt MFA thành công/g, replacement: 'Disabled MFA successfully' },
      { regex: /Reset MFA thành công/g, replacement: 'Reset MFA successfully' },
      { regex: /Nhập kho hàng thành công/g, replacement: 'Imported stock successfully' },
      { regex: /Tạo giao dịch thành công/g, replacement: 'Created transaction successfully' },
      { regex: /Cửa hàng/g, replacement: 'Store' },
      { regex: /Vai trò/g, replacement: 'Role' },
      { regex: /Mật khẩu/g, replacement: 'Password' },
      { regex: /không thay đổi/g, replacement: 'unchanged' },
      { regex: /thành/g, replacement: 'to' }
    ],
    zh: [
      { regex: /Đăng nhập thành công/g, replacement: '登录成功' },
      { regex: /Đăng nhập MFA thành công/g, replacement: 'MFA登录成功' },
      { regex: /Tạo khách hàng/g, replacement: '创建客户' },
      { regex: /Xóa khách hàng/g, replacement: '删除客户' },
      { regex: /Tạo khuyến mãi/g, replacement: '创建促销' },
      { regex: /Cập nhật khuyến mãi/g, replacement: '更新促销' },
      { regex: /Xóa khuyến mãi/g, replacement: '删除促销' },
      { regex: /Thêm nhân viên/g, replacement: '添加员工' },
      { regex: /Cập nhật nhân viên/g, replacement: '更新员工' },
      { regex: /Xóa nhân viên/g, replacement: '删除员工' },
      { regex: /Tạo sản phẩm/g, replacement: '创建商品' },
      { regex: /Cập nhật sản phẩm/g, replacement: '更新商品' },
      { regex: /Xóa sản phẩm/g, replacement: '删除商品' },
      { regex: /Tạo tài khoản/g, replacement: '创建系统账户' },
      { regex: /Cập nhật tài khoản/g, replacement: '更新系统账户' },
      { regex: /Xóa tài khoản/g, replacement: '删除系统账户' },
      { regex: /Bật MFA thành công/g, replacement: '启用MFA成功' },
      { regex: /Tắt MFA thành công/g, replacement: '禁用MFA成功' },
      { regex: /Reset MFA thành công/g, replacement: '重置MFA成功' },
      { regex: /Nhập kho hàng thành công/g, replacement: '成功入库商品' },
      { regex: /Tạo giao dịch thành công/g, replacement: '交易创建成功' },
      { regex: /Cửa hàng/g, replacement: '门店' },
      { regex: /Vai trò/g, replacement: '角色' },
      { regex: /Mật khẩu/g, replacement: '密码' },
      { regex: /không thay đổi/g, replacement: '未更改' },
      { regex: /thành/g, replacement: '为' }
    ]
  };

  const list = mappings[currentLang] || [];
  list.forEach(m => {
    translated = translated.replace(m.regex, m.replacement);
  });
  return translated;
}

async function loadAdminLogsTab() {
  const filterAction = document.getElementById('admin-logs-action-filter').value;
  try {
    const logs = await fetchAPI('/api/admin/audit-logs');
    const tbody = document.querySelector('#admin-logs-table tbody');
    tbody.innerHTML = '';
    
    let filteredLogs = logs;
    if (filterAction) {
      filteredLogs = logs.filter(l => l.action === filterAction);
    }

    filteredLogs.forEach(l => {
      const tr = document.createElement('tr');
      const formattedTime = new Date(l.timestamp).toLocaleString(currentLang === 'en' ? 'en-US' : (currentLang === 'zh' ? 'zh-CN' : 'vi-VN'));
      
      let badgeClass = 'default';
      const actionLower = l.action.toLowerCase();
      if (actionLower.includes('login')) badgeClass = 'login';
      else if (actionLower.includes('create')) badgeClass = 'create';
      else if (actionLower.includes('update')) badgeClass = 'update';
      else if (actionLower.includes('delete')) badgeClass = 'delete';
      else if (actionLower.includes('mfa')) badgeClass = 'mfa';

      tr.innerHTML = `
        <td style="white-space:nowrap;"><code>${formattedTime}</code></td>
        <td><strong>${l.username}</strong></td>
        <td><span class="badge">${l.role}</span></td>
        <td><span class="badge-action ${badgeClass}">${l.action}</span></td>
        <td>${translateLogDetails(l.details)}</td>
        <td><code>${l.ip}</code></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

document.getElementById('admin-logs-action-filter').addEventListener('change', loadAdminLogsTab);
document.getElementById('btn-refresh-admin-logs').addEventListener('click', loadAdminLogsTab);

// --- MFA CLIENT HANDLERS ---
const mfaSetupModal = document.getElementById('mfa-setup-modal');
const mfaCurrentStatusText = document.getElementById('mfa-current-status-text');
const mfaEnablePanel = document.getElementById('mfa-enable-panel');
const mfaDisablePanel = document.getElementById('mfa-disable-panel');

let mfaSetupSecret = '';

document.getElementById('btn-user-profile').addEventListener('click', async () => {
  try {
    const data = await fetchAPI('/api/auth/me');
    currentUser.mfa_enabled = data.user.mfa_enabled;
    localStorage.setItem('user', JSON.stringify(currentUser));
  } catch (err) {
    console.error('Error fetching profile detail:', err);
  }

  if (currentUser.mfa_enabled) {
    mfaCurrentStatusText.textContent = 'Đang Bật';
    mfaCurrentStatusText.className = 'mfa-status-active';
    mfaCurrentStatusText.style.color = '#10b981';
    mfaEnablePanel.classList.add('hidden');
    mfaDisablePanel.classList.remove('hidden');
  } else {
    mfaCurrentStatusText.textContent = 'Đang Tắt';
    mfaCurrentStatusText.className = 'mfa-status-inactive';
    mfaCurrentStatusText.style.color = '#ef4444';
    mfaDisablePanel.classList.add('hidden');
    mfaEnablePanel.classList.remove('hidden');
    
    try {
      const data = await fetchAPI('/api/auth/mfa/setup', { method: 'POST' });
      mfaSetupSecret = data.secret;
      document.getElementById('mfa-secret-key').value = data.secret;
      
      const qrCanvas = document.getElementById('mfa-qr-canvas');
      if (qrCanvas && typeof QRious !== 'undefined') {
        const username = currentUser.username || 'User';
        const label = `GlobalFashion:${username}`;
        const issuer = 'GlobalFashion';
        const otpauthUrl = `otpauth://totp/${label}?secret=${data.secret}&issuer=${issuer}`;
        
        new QRious({
          element: qrCanvas,
          value: otpauthUrl,
          size: 148,
          level: 'M'
        });
      }
    } catch (err) {
      alert('Không thể tạo secret cho MFA: ' + err.message);
    }
  }
  
  mfaSetupModal.classList.add('active');
});

document.getElementById('btn-copy-mfa-secret').addEventListener('click', () => {
  const secretKeyInput = document.getElementById('mfa-secret-key');
  secretKeyInput.select();
  navigator.clipboard.writeText(secretKeyInput.value);
  alert('Đã sao chép khóa bí mật!');
});

document.getElementById('btn-confirm-enable-mfa').addEventListener('click', async () => {
  const code = document.getElementById('mfa-verify-code').value.trim();
  if (!code || code.length !== 6) {
    alert('Vui lòng nhập mã OTP gồm 6 chữ số');
    return;
  }

  try {
    const data = await fetchAPI('/api/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ secret: mfaSetupSecret, code })
    });
    alert(data.message || 'Đã bật MFA thành công!');
    currentUser.mfa_enabled = true;
    localStorage.setItem('user', JSON.stringify(currentUser));
    mfaSetupModal.classList.remove('active');
    document.getElementById('mfa-verify-code').value = '';
  } catch (err) {
    alert('Lỗi kích hoạt MFA: ' + err.message);
  }
});

document.getElementById('btn-confirm-disable-mfa').addEventListener('click', async () => {
  const code = document.getElementById('mfa-disable-code').value.trim();
  if (!code || code.length !== 6) {
    alert('Vui lòng nhập mã OTP gồm 6 chữ số');
    return;
  }

  try {
    const data = await fetchAPI('/api/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    alert(data.message || 'Đã hủy MFA thành công!');
    currentUser.mfa_enabled = false;
    localStorage.setItem('user', JSON.stringify(currentUser));
    mfaSetupModal.classList.remove('active');
    document.getElementById('mfa-disable-code').value = '';
  } catch (err) {
    alert('Lỗi hủy kích hoạt MFA: ' + err.message);
  }
});

document.getElementById('btn-close-mfa-setup').addEventListener('click', () => mfaSetupModal.classList.remove('active'));
document.getElementById('btn-close-mfa-disable').addEventListener('click', () => mfaSetupModal.classList.remove('active'));

// --- ADMIN USER CRUD DIALOG LOGIC ---
const adminUserModal = document.getElementById('admin-user-modal');
const adminUserForm = document.getElementById('admin-user-form');
const btnCancelAdminUser = document.getElementById('btn-cancel-admin-user');

document.getElementById('btn-admin-add-user').addEventListener('click', async () => {
  document.getElementById('admin-user-modal-title').textContent = currentLang === 'en' ? 'Add New Account' : (currentLang === 'zh' ? '添加新账户' : 'Thêm Tài Khoản Mới');
  document.getElementById('admin-user-id-input').value = '';
  document.getElementById('admin-user-username-input').value = '';
  document.getElementById('admin-user-username-input').disabled = false;
  document.getElementById('admin-user-password-input').value = '';
  document.getElementById('admin-user-password-input').placeholder = currentLang === 'en' ? 'Enter password...' : (currentLang === 'zh' ? '输入密码...' : 'Nhập mật khẩu...');
  document.getElementById('admin-user-password-input').required = true;
  document.getElementById('admin-user-role-input').value = 'Sales Staff';
  
  try {
    const stores = await fetchAPI('/api/stores');
    const storeSelect = document.getElementById('admin-user-store-input');
    storeSelect.innerHTML = `<option value="">${currentLang === 'en' ? 'None (Global)' : (currentLang === 'zh' ? '无 (全局)' : 'Không gán (Global)')}</option>`;
    stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.store_id;
      opt.textContent = s.store_name;
      storeSelect.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
  }

  adminUserModal.classList.add('active');
});

btnCancelAdminUser.addEventListener('click', () => {
  adminUserModal.classList.remove('active');
  adminUserForm.reset();
});

adminUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('admin-user-id-input').value;
  const username = document.getElementById('admin-user-username-input').value.trim();
  const password = document.getElementById('admin-user-password-input').value;
  const role = document.getElementById('admin-user-role-input').value;
  const store_id = document.getElementById('admin-user-store-input').value ? parseInt(document.getElementById('admin-user-store-input').value) : null;

  try {
    if (id) {
      await fetchAPI(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ role, store_id, password })
      });
      alert('Cập nhật tài khoản thành công!');
    } else {
      await fetchAPI('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role, store_id })
      });
      alert('Tạo tài khoản thành công!');
    }
    
    adminUserModal.classList.remove('active');
    adminUserForm.reset();
    loadAdminUsersTab();
  } catch (err) {
    alert(err.message || 'Lỗi lưu tài khoản');
  }
});

// ================= CREATE TRANSACTION MODAL =================
const txModal = document.getElementById('transaction-create-modal');
const btnAddTx = document.getElementById('btn-add-transaction');
const btnCancelTx = document.getElementById('btn-cancel-tx');
const txForm = document.getElementById('transaction-create-form');

const txStoreInput = document.getElementById('tx-store-input');
const txCustomerInput = document.getElementById('tx-customer-input');
const txSkuInput = document.getElementById('tx-sku-input');
const txQtyInput = document.getElementById('tx-qty-input');
const txPriceInput = document.getElementById('tx-price-input');
const txPaymentInput = document.getElementById('tx-payment-input');

const txCustomerSearch = document.getElementById('tx-customer-search');
const txSkuSearch = document.getElementById('tx-sku-search');

let activeTxCustomers = [];
let activeTxInventory = [];
let txCart = [];

function renderTxCustomerOptions(items) {
  txCustomerInput.innerHTML = `<option value="">${currentLang === 'en' ? '-- Select customer --' : (currentLang === 'zh' ? '-- 选择客户 --' : '-- Chọn khách hàng --')}</option>`;
  items.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.customer_id;
    opt.textContent = `#${c.customer_id} - ${c.customer_name} (${c.country})`;
    txCustomerInput.appendChild(opt);
  });
}

function renderTxSkuOptions(items) {
  txSkuInput.innerHTML = '';
  if (items.length === 0) {
    txSkuInput.innerHTML = `<option value="">${currentLang === 'en' ? 'No products found' : (currentLang === 'zh' ? '未找到任何商品' : 'Không tìm thấy sản phẩm nào')}</option>`;
    return;
  }
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.sku;
    const stockLabel = currentLang === 'en' ? 'Stock' : (currentLang === 'zh' ? '库存' : 'Tồn kho');
    opt.textContent = `${item.sku} - ${item.product_name} (${stockLabel}: ${item.stock_quantity})`;
    txSkuInput.appendChild(opt);
  });
}

// Store input change listener
if (txStoreInput) {
  txStoreInput.addEventListener('change', () => {
    txSkuSearch.value = '';
    const placeholderText = currentLang === 'en' ? '-- Enter keyword to search products --' : (currentLang === 'zh' ? '-- 输入关键字以搜索商品 --' : '-- Nhập từ khóa để tìm sản phẩm --');
    txSkuInput.innerHTML = `<option value="">${placeholderText}</option>`;
    activeTxInventory = [];
  });
}

// Customer search input listener
if (txCustomerSearch) {
  txCustomerSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = activeTxCustomers.filter(c => 
      c.customer_name.toLowerCase().includes(query) || 
      c.customer_id.toString().includes(query) ||
      (c.country && c.country.toLowerCase().includes(query))
    );
    renderTxCustomerOptions(filtered);
  });
}

// SKU dynamic search input listener with debounce
let txSkuSearchTimeout = null;
if (txSkuSearch) {
  txSkuSearch.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(txSkuSearchTimeout);
    if (query.length < 2) {
      const placeholderText = currentLang === 'en' ? '-- Enter keyword to search products --' : (currentLang === 'zh' ? '-- 输入关键字以搜索商品 --' : '-- Nhập từ khóa để tìm sản phẩm --');
      txSkuInput.innerHTML = `<option value="">${placeholderText}</option>`;
      return;
    }
    const searchingText = currentLang === 'en' ? 'Searching...' : (currentLang === 'zh' ? '正在搜索...' : 'Đang tìm kiếm...');
    txSkuInput.innerHTML = `<option value="">${searchingText}</option>`;
    txSkuSearchTimeout = setTimeout(async () => {
      try {
        const storeId = txStoreInput.value;
        const results = await fetchAPI(`/api/inventory?store_id=${storeId}&search=${encodeURIComponent(query)}`);
        activeTxInventory = results || [];
        renderTxSkuOptions(activeTxInventory);
      } catch (err) {
        console.error('Error searching SKUs:', err);
        const errorText = currentLang === 'en' ? 'Error searching products' : (currentLang === 'zh' ? '搜索商品出错' : 'Lỗi tìm kiếm sản phẩm');
        txSkuInput.innerHTML = `<option value="">${errorText}</option>`;
      }
    }, 300);
  });
}

// Cart table renderer
function renderTxCartTable() {
  const tbody = document.getElementById('tx-cart-tbody');
  const totalSpan = document.getElementById('tx-cart-total');
  
  if (txCart.length === 0) {
    const emptyMsg = currentLang === 'en' ? 'No products added to cart yet.' : (currentLang === 'zh' ? '尚未选择任何商品。' : 'Chưa có sản phẩm nào được chọn.');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">${emptyMsg}</td></tr>`;
    totalSpan.textContent = '$0.00';
    return;
  }
  
  tbody.innerHTML = '';
  let grandTotal = 0;
  
  txCart.forEach((item, idx) => {
    const lineTotal = item.quantity * item.price;
    grandTotal += lineTotal;
    
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
    tr.innerHTML = `
      <td style="padding: 8px 10px;">
        <div style="font-weight: 600;"><code>${item.sku}</code></div>
        <div style="font-size: 11px; color: var(--text-muted);">${item.product_name}</div>
      </td>
      <td style="padding: 8px 10px; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px 10px; text-align: right;">$${item.price.toFixed(2)}</td>
      <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: var(--primary-light);">$${lineTotal.toFixed(2)}</td>
      <td style="padding: 8px 10px; text-align: center;">
        <button type="button" class="btn-delete-cart-item" data-index="${idx}" style="background: none; border: none; color: var(--danger-color); cursor: pointer; padding: 5px;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  totalSpan.textContent = `$${grandTotal.toFixed(2)}`;
  
  // Attach delete listeners
  tbody.querySelectorAll('.btn-delete-cart-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      txCart.splice(idx, 1);
      renderTxCartTable();
    });
  });
}

// "Add to Cart" button event listener
const btnAddItemToCart = document.getElementById('btn-add-item-to-cart');
if (btnAddItemToCart) {
  btnAddItemToCart.addEventListener('click', () => {
    const selectedSku = txSkuInput.value;
    const qty = parseInt(txQtyInput.value);
    const price = parseFloat(txPriceInput.value);

    if (!selectedSku) {
      alert(currentLang === 'en' ? 'Please select a product.' : (currentLang === 'zh' ? '请选择商品。' : 'Vui lòng chọn sản phẩm.'));
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      alert(currentLang === 'en' ? 'Invalid quantity.' : (currentLang === 'zh' ? '无效数量。' : 'Số lượng không hợp lệ.'));
      return;
    }
    if (isNaN(price) || price <= 0) {
      alert(currentLang === 'en' ? 'Invalid price.' : (currentLang === 'zh' ? '无效单价。' : 'Đơn giá không hợp lệ.'));
      return;
    }

    const invItem = activeTxInventory.find(i => i.sku === selectedSku);
    const productName = invItem ? invItem.product_name : `Sản phẩm ${selectedSku}`;
    const stockLimit = invItem ? invItem.stock_quantity : 0;

    if (qty > stockLimit) {
      alert(currentLang === 'en' ? `Insufficient stock. Current stock: ${stockLimit}` : (currentLang === 'zh' ? `库存不足。当前库存: ${stockLimit}` : `Không đủ hàng tồn kho. Số lượng tồn hiện tại: ${stockLimit}`));
      return;
    }

    const existing = txCart.find(item => item.sku === selectedSku);
    if (existing) {
      if (existing.quantity + qty > stockLimit) {
        alert(currentLang === 'en' ? `Total quantity exceeds stock. Max stock: ${stockLimit}` : (currentLang === 'zh' ? `总数量超出库存。最大库存: ${stockLimit}` : `Tổng số lượng vượt quá tồn kho. Tồn kho tối đa: ${stockLimit}`));
        return;
      }
      existing.quantity += qty;
      existing.price = price;
    } else {
      txCart.push({
        sku: selectedSku,
        product_name: productName,
        quantity: qty,
        price: price
      });
    }

    txSkuSearch.value = '';
    const placeholderText = currentLang === 'en' ? '-- Enter keyword to search products --' : (currentLang === 'zh' ? '-- 输入关键字以搜索商品 --' : '-- Nhập từ khóa để tìm sản phẩm --');
    txSkuInput.innerHTML = `<option value="">${placeholderText}</option>`;
    txQtyInput.value = 1;
    txPriceInput.value = '';

    renderTxCartTable();
  });
}

// Initialize transaction modal triggers
let isTxModalLoading = false;

if (btnAddTx) {
  btnAddTx.addEventListener('click', async () => {
    txForm.reset();
    txCart = [];
    renderTxCartTable();
    if (txCustomerSearch) txCustomerSearch.value = '';
    if (txSkuSearch) txSkuSearch.value = '';

    txModal.classList.add('active');
    txStoreInput.innerHTML = `<option value="">${currentLang === 'en' ? 'Loading stores...' : (currentLang === 'zh' ? '正在加载门店...' : 'Đang tải cửa hàng...')}</option>`;
    txCustomerInput.innerHTML = `<option value="">${currentLang === 'en' ? 'Loading customers...' : (currentLang === 'zh' ? '正在加载客户...' : 'Đang tải khách hàng...')}</option>`;
    
    const placeholderText = currentLang === 'en' ? '-- Enter keyword to search products --' : (currentLang === 'zh' ? '-- 输入关键字以搜索商品 --' : '-- Nhập từ khóa để tìm sản phẩm --');
    txSkuInput.innerHTML = `<option value="">${placeholderText}</option>`;
    isTxModalLoading = true;

    try {
      const [stores, customersRes] = await Promise.all([
        fetchAPI('/api/stores'),
        fetchAPI('/api/customers?page=1&limit=300')
      ]);

      txStoreInput.innerHTML = '';
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.store_id;
        opt.textContent = s.store_name;
        txStoreInput.appendChild(opt);
      });

      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      if (!hasAllStores) {
        txStoreInput.value = currentUser.store_id || '';
        document.querySelector('.tx-store-container').style.display = 'none';
      } else {
        document.querySelector('.tx-store-container').style.display = 'block';
      }

      activeTxCustomers = customersRes.data || [];
      renderTxCustomerOptions(activeTxCustomers);

      isTxModalLoading = false;
    } catch (err) {
      console.error('Error opening transaction modal:', err);
      alert(currentLang === 'en' ? 'Cannot open transaction creation modal. Please check your access permissions.' : (currentLang === 'zh' ? '无法打开交易创建弹窗。请检查您的访问权限。' : 'Không thể mở màn hình tạo giao dịch. Vui lòng kiểm tra quyền truy cập.'));
      txModal.classList.remove('active');
      isTxModalLoading = false;
    }
  });
}

if (btnCancelTx) {
  btnCancelTx.addEventListener('click', () => {
    txModal.classList.remove('active');
  });
}

if (txModal) {
  txModal.addEventListener('click', (e) => {
    if (e.target === txModal) txModal.classList.remove('active');
  });
}

if (txForm) {
  txForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (txCart.length === 0) {
      alert(currentLang === 'en' ? 'Please add at least one product to the cart.' : (currentLang === 'zh' ? '请在订单中至少添加一个商品。' : 'Vui lòng thêm ít nhất một sản phẩm vào đơn hàng.'));
      return;
    }

    if (!txCustomerInput.value) {
      alert(currentLang === 'en' ? 'Please select a customer.' : (currentLang === 'zh' ? '请选择客户。' : 'Vui lòng chọn khách hàng.'));
      return;
    }

    const storeId = parseInt(txStoreInput.value);
    const customerId = parseInt(txCustomerInput.value);
    const paymentMethod = txPaymentInput.value;

    const payload = txCart.map(item => ({
      store_id: storeId,
      customer_id: customerId,
      sku: item.sku,
      quantity: item.quantity,
      price: item.price,
      payment_method: paymentMethod
    }));

    try {
      const res = await fetchAPI('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      txModal.classList.remove('active');
      alert(res.message || (currentLang === 'en' ? 'Transaction created successfully!' : (currentLang === 'zh' ? '交易创建成功！' : 'Tạo giao dịch thành công!')));
      
      txCart = [];
      renderTxCartTable();
      
      // Reload Transactions tab if active
      if (activeTab === 'transactions') {
        loadTransactionsTab();
      }
      
      // Reload Inventory if active
      if (activeTab === 'inventory') {
        loadInventoryTab();
      }
      
      // Reload dashboard cache/warnings
      if (activeForecastStoreId === storeId) {
        try {
          activeStoreInventoryData = await fetchAPI(`/api/inventory?store_id=${activeForecastStoreId}`);
          const selector = document.getElementById('forecast-sku-selector');
          if (selector && selector.value) {
            renderForecastChart(selector.value);
          }
        } catch (err) {
          console.warn('Failed to refresh dashboard warning:', err);
        }
      }
    } catch (err) {
      console.error('Error creating transaction:', err);
      alert(err.message || (currentLang === 'en' ? 'Error creating transaction. Please verify stock availability.' : (currentLang === 'zh' ? '创建交易时出错。请重新检查库存。' : 'Lỗi khi tạo giao dịch. Vui lòng kiểm tra lại tồn kho.')));
    }
  });
}

// ================= INTERACTIVE THEME TOGGLER =================
const themeToggleBtn = document.getElementById('theme-toggle');

function updateThemeToggleIcon() {
  if (!themeToggleBtn) return;
  const isLight = document.body.classList.contains('light-theme');
  const icon = themeToggleBtn.querySelector('i');
  if (icon) {
    if (isLight) {
      icon.className = 'fa-solid fa-sun';
      themeToggleBtn.style.color = '#f59e0b'; // Gold sun color
    } else {
      icon.className = 'fa-solid fa-moon';
      themeToggleBtn.style.color = 'var(--text-main)';
    }
  }
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.add('no-transition');
    const wasLight = document.body.classList.contains('light-theme');
    if (wasLight) {
      document.body.classList.remove('light-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
    }
    updateThemeToggleIcon();
    updateThemeCharts();
    
    // Force reflow
    document.body.offsetHeight;
    
    setTimeout(() => {
      document.body.classList.remove('no-transition');
    }, 50);
  });
}

function updateThemeCharts() {
  if (activeTab === 'dashboard' && activeForecastStoreId) {
    const selector = document.getElementById('forecast-sku-selector');
    if (selector && selector.value) {
      renderForecastChart(selector.value);
    }
  } else if (activeTab === 'stores') {
    loadStoresTab();
  } else if (activeTab === 'discounts') {
    loadDiscountsTab();
  }
}

// Call update theme icon initially
updateThemeToggleIcon();

// ================= MULTI-LANGUAGE (i18n) SYSTEM =================
const langSelect = document.getElementById('lang-select');
let currentLang = localStorage.getItem('preferred-language') || 'vi';

const translations = {
  vi: {
    sidebar_dashboard: "Dashboard Bản đồ",
    sidebar_customers: "Khách hàng",
    sidebar_discounts: "Khuyến mãi",
    sidebar_employees: "Nhân viên",
    sidebar_products: "Sản phẩm",
    sidebar_stores: "Cửa hàng",
    sidebar_transactions: "Giao dịch",
    sidebar_inventory: "Quản lý Kho",
    sidebar_admin_users: "Quản lý User",
    sidebar_admin_perms: "Phân quyền Vai trò",
    sidebar_admin_logs: "Nhật ký Hoạt động",
    sidebar_logout: "Đăng xuất",

    // Dashboard Tab
    db_instruction_title: "Chỉ dẫn",
    db_instruction_desc: "Nhấp vào một cửa hàng (icon cửa hàng) để xem dữ liệu dự báo nhu cầu thời trang theo tuần sinh ra từ mô hình học máy LightGBM.",
    db_total_skus: "Tổng SKU dự báo",
    db_next_week_demand: "Dự kiến tuần tới",
    db_select_sku: "Chọn SKU sản phẩm:",
    db_chart_type: "Loại biểu đồ:",
    db_chart_line: "Đường (Line)",
    db_chart_column: "Cột (Column)",
    db_time_group: "Gom nhóm:",
    db_group_week: "Tuần (Week)",
    db_group_month: "Tháng (Month)",

    // Customers Tab
    cust_btn_add: "Thêm Khách Hàng",
    cust_search_placeholder: "Tìm theo tên hoặc mã KH...",
    cust_filter_gender: "Tất cả",
    cust_gender_male: "Nam (Male)",
    cust_gender_female: "Nữ (Female)",
    cust_gender_nonbinary: "Khác (Non-binary)",
    cust_col_id: "Mã Khách Hàng",
    cust_col_name: "Họ và Tên",
    cust_col_age: "Tuổi",
    cust_col_gender: "Giới tính",
    cust_col_country: "Quốc gia",
    cust_col_actions: "Hành động",
    cust_chart_title: "Phân tích Cơ cấu Khách hàng",

    // Discounts Tab
    disc_filter_store: "Lọc theo cửa hàng:",
    disc_btn_add: "Thêm Khuyến Mãi",
    disc_col_id: "Mã Khuyến Mãi",
    disc_col_season: "Tên Chương Trình",
    disc_col_avg: "Chiết khấu Trung Bình (total_discount_avg)",
    disc_col_start: "Ngày Bắt Đầu",
    disc_col_end: "Ngày Kết Thúc",
    disc_col_actions: "Hành động",
    disc_chart_title: "So sánh Mức chiết khấu trung bình giữa các đợt",

    // Employees Tab
    emp_filter_store: "Lọc theo cửa hàng:",
    emp_btn_add: "Thêm Nhân Viên",
    emp_col_id: "Mã Nhân Viên",
    emp_col_name: "Họ và Tên",
    emp_col_store: "Cửa hàng",
    emp_col_role: "Vai trò",
    emp_col_actions: "Hành động",
    emp_chart_title: "Thống kê Quy mô Nhân sự",

    // Products Tab
    prod_search_placeholder: "Tìm tên sản phẩm hoặc mô tả...",
    prod_filter_cat: "Danh mục:",
    prod_filter_store: "Cửa hàng:",
    prod_filter_all: "Tất cả",
    prod_btn_add: "Thêm Sản Phẩm",
    prod_col_visual: "Xem",
    prod_col_name: "Tên Sản Phẩm",
    prod_col_category: "Danh mục",
    prod_col_subcategory: "Phân loại phụ",
    prod_col_color: "Kiểu màu",
    prod_col_stock: "Tồn kho",
    prod_col_actions: "Hành động",

    // Stores Tab
    store_col_id: "Mã Store",
    store_col_name: "Tên Cửa Hàng",
    store_col_lat: "Vĩ độ (Lat)",
    store_col_lng: "Kinh độ (Lng)",
    store_col_country: "Quốc gia",
    store_col_skus: "Tổng số SKU duy nhất",
    store_col_products: "Tổng số dòng sản phẩm",
    store_chart_title: "Phân bố số lượng sản phẩm & SKU theo Cửa hàng",

    // Transactions Tab
    tx_filter_store: "Lọc theo cửa hàng:",
    tx_filter_payment: "Hình thức thanh toán:",
    tx_btn_create: "Tạo Giao Dịch Mới",
    tx_col_id: "Mã Giao Dịch",
    tx_col_store: "Cửa hàng",
    tx_col_salesperson: "Người thực hiện",
    tx_col_time: "Thời gian",
    tx_col_sku: "SKU",
    tx_col_product: "Sản phẩm",
    tx_col_payment: "Thanh toán",
    tx_col_price: "Đơn giá",
    tx_col_qty: "SL",
    tx_col_total: "Tổng tiền (USD)",
    tx_btn_add: "Tạo Giao Dịch Mới",

    // Inventory Tab
    inv_title: "Quản lý Kho & Tồn Kho (Stock)",
    inv_desc: "Theo dõi lượng hàng tồn kho thực tế và nhật ký nhập hàng từ nhà cung cấp.",
    inv_btn_import: "Nhập Hàng Mới",
    inv_filter_store: "Cửa hàng:",
    inv_filter_cat: "Danh mục:",
    inv_all_stores: "Tất cả Cửa hàng",
    inv_search_placeholder: "Tìm kiếm SKU, tên sản phẩm hoặc danh mục...",
    inv_lbl_search: "Tìm kiếm:",
    inv_stock_status: "Trạng thái Tồn kho Thực tế",
    inv_import_history: "Nhật ký Nhập hàng Gần đây",
    inv_col_sku: "SKU",
    inv_col_product: "Tên sản phẩm",
    inv_col_cat: "Danh mục",
    inv_col_qty: "Tồn kho",
    inv_col_date: "Ngày nhập",
    inv_col_sku_prod: "SKU / Sản phẩm",
    inv_col_qty_added: "S.Lượng",
    inv_col_supplier: "Nhà cung cấp",

    // Admin & Modals Extra Translations
    admin_users_title: "Quản lý Tài khoản Hệ thống",
    admin_users_btn_add: "Thêm Tài Khoản",
    admin_users_col_id: "ID",
    admin_users_col_username: "Tên Đăng Nhập",
    admin_users_col_role: "Vai trò",
    admin_users_col_store: "Cửa hàng phụ trách",
    admin_users_col_mfa: "Trạng thái MFA",
    admin_users_col_actions: "Hành động",
    admin_perms_title: "Thiết lập Phân quyền (Vai trò x Quyền hạn)",
    admin_perms_btn_save: "Lưu Cấu Hình Phân Quyền",
    admin_logs_title: "Nhật ký Hoạt động (Audit Logs)",
    admin_logs_lbl_filter: "Lọc hành động:",
    admin_logs_opt_all: "Tất cả",
    admin_logs_opt_login: "Đăng nhập (Thường)",
    admin_logs_opt_login_mfa: "Đăng nhập (MFA)",
    admin_logs_opt_customer_create: "Tạo KH",
    admin_logs_opt_customer_delete: "Xóa KH",
    admin_logs_opt_discount_create: "Tạo Khuyến mãi",
    admin_logs_opt_discount_update: "Sửa Khuyến mãi",
    admin_logs_opt_discount_delete: "Xóa Khuyến mãi",
    admin_logs_opt_employee_create: "Thêm Nhân viên",
    admin_logs_opt_employee_update: "Sửa Nhân viên",
    admin_logs_opt_employee_delete: "Xóa Nhân viên",
    admin_logs_opt_product_create: "Tạo Sản phẩm",
    admin_logs_opt_product_update: "Sửa Sản phẩm",
    admin_logs_opt_product_delete: "Xóa Sản phẩm",
    admin_logs_opt_user_create: "Tạo User",
    admin_logs_opt_user_update: "Sửa User",
    admin_logs_opt_user_delete: "Xóa User",
    admin_logs_opt_mfa_enable: "Bật MFA",
    admin_logs_opt_mfa_disable: "Tắt MFA",
    admin_logs_btn_refresh: "Tải lại",
    admin_logs_col_time: "Thời gian",
    admin_logs_col_user: "Người dùng",
    admin_logs_col_role: "Vai trò",
    admin_logs_col_action: "Hành động",
    admin_logs_col_details: "Chi tiết hoạt động",
    admin_logs_col_ip: "Địa chỉ IP",
    modal_add_customer_title: "Thêm Khách Hàng Mới",
    modal_cust_name: "Họ và Tên:",
    modal_cust_name_placeholder: "Nhập họ và tên...",
    modal_cust_age: "Tuổi:",
    modal_cust_age_placeholder: "Nhập tuổi...",
    modal_cust_gender: "Giới tính:",
    modal_cust_gender_male: "Nam (Male)",
    modal_cust_gender_female: "Nữ (Female)",
    modal_cust_gender_other: "Khác (Non-binary)",
    modal_cust_country: "Quốc gia:",
    modal_cust_country_placeholder: "Ví dụ: Vietnam, USA...",
    modal_btn_create: "Thêm mới",
    modal_btn_cancel: "Hủy",
    modal_create_discount_title: "Tạo Khuyến Mãi Mới",
    modal_edit_discount_title: "Cập nhật Chiết khấu Khuyến mãi",
    modal_disc_store: "Cửa hàng:",
    modal_disc_season: "Tên chương trình:",
    modal_disc_season_placeholder: "Ví dụ: Summer Sale, Winter Sale...",
    modal_disc_avg: "Mức chiết khấu trung bình (0.00 - 1.00):",
    modal_disc_avg_placeholder: "Ví dụ: 0.15",
    modal_disc_start: "Ngày bắt đầu:",
    modal_disc_end: "Ngày kết thúc:",
    modal_add_employee_title: "Thêm Nhân Viên Mới",
    modal_edit_employee_title: "Cập nhật thông tin Nhân viên",
    modal_emp_store: "Cửa hàng:",
    modal_emp_name: "Họ và Tên:",
    modal_emp_name_placeholder: "Nhập họ và tên...",
    modal_emp_role: "Vai trò:",
    modal_emp_role_staff: "Sales Staff (Nhân viên bán hàng)",
    modal_emp_role_associate: "Sales Associate (Nhân viên bán hàng)",
    modal_emp_role_manager: "Store Manager (Quản lý cửa hàng)",
    modal_emp_role_assistant: "Assistant Manager (Trợ lý quản lý)",
    modal_emp_role_cashier: "Cashier (Thu ngân)",
    modal_emp_role_stock_clerk: "Stock Clerk (Nhân viên kho)",
    modal_emp_role_director: "Director (Giám đốc)",
    modal_emp_role_inventory: "Inventory Manager (Quản lý kho)",
    modal_emp_role_marketing: "Marketing Manager (Quản lý Marketing)",
    modal_emp_role_finance: "Finance/Auditor (Tài chính / Kiểm toán)",
    modal_emp_role_it: "IT Admin (Quản trị IT)",
    modal_add_product_title: "Thêm Sản Phẩm Mới",
    modal_edit_product_title: "Cập nhật Sản Phẩm",
    modal_prod_name: "Tên sản phẩm:",
    modal_prod_name_placeholder: "Ví dụ: Áo thun Polo nam...",
    modal_prod_cat: "Danh mục:",
    modal_prod_cat_clothing: "Quần áo (Clothing)",
    modal_prod_cat_shoes: "Giày dép (Shoes)",
    modal_prod_cat_accessories: "Phụ kiện (Accessories)",
    modal_prod_cat_children: "Trẻ em (Children)",
    modal_prod_cat_masculine: "Nam giới (Masculine)",
    modal_prod_cat_feminine: "Nữ giới (Feminine)",
    modal_import_item_type: "Loại mặt hàng:",
    modal_import_type_existing: "Mặt hàng đã có sẵn",
    modal_import_type_new: "Mặt hàng mới",
    modal_import_search_label: "Tìm kiếm SKU / Tên sản phẩm:",
    modal_import_search_placeholder: "Gõ để tìm kiếm mặt hàng có sẵn...",
    modal_import_new_name: "Tên sản phẩm mới:",
    modal_import_new_name_placeholder: "Ví dụ: Áo len cổ lọ nam...",
    modal_import_new_cat: "Danh mục sản phẩm:",
    modal_prod_subcat: "Danh mục phụ:",
    modal_prod_subcat_placeholder: "Ví dụ: T-Shirts, Sneakers...",
    modal_prod_color: "Kiểu màu:",
    modal_prod_color_placeholder: "Ví dụ: Black, White, Multi...",
    modal_prod_desc: "Mô tả (tiếng Anh):",
    modal_prod_desc_placeholder: "Mô tả chi tiết sản phẩm...",
    modal_prod_image: "URL hình ảnh (Tùy chọn):",
    modal_prod_image_placeholder: "Bỏ trống để tự động sinh ảnh...",
    modal_prod_btn_save: "Lưu thay đổi",
    modal_admin_user_title_add: "Thêm Tài Khoản Mới",
    modal_admin_user_title_edit: "Cập nhật tài khoản",
    modal_admin_user_username: "Tên đăng nhập:",
    modal_admin_user_username_placeholder: "Nhập tên đăng nhập...",
    modal_admin_user_password: "Mật khẩu:",
    modal_admin_user_password_placeholder: "Nhập mật khẩu...",
    modal_admin_user_password_placeholder_edit: "Bỏ trống nếu giữ nguyên mật khẩu",
    modal_admin_user_role: "Vai trò:",
    modal_admin_user_store: "Cửa hàng được gán (Nếu có):",
    modal_admin_user_store_global: "Không gán (Global)",
    modal_admin_user_btn_save: "Lưu",
    modal_mfa_title: "Thiết lập Xác thực 2 lớp (MFA)",
    modal_mfa_status: "Trạng thái hiện tại:",
    modal_mfa_status_on: "Đang Bật",
    modal_mfa_status_off: "Đã Tắt",
    modal_mfa_desc_enable: "Hãy nhập mã khóa bên dưới vào ứng dụng Google Authenticator trên điện thoại để lấy mã xác nhận.",
    modal_mfa_secret: "Khóa bí mật (Secret Key):",
    modal_mfa_verify_code: "Nhập mã OTP xác thực (6 chữ số):",
    modal_mfa_verify_placeholder: "Ví dụ: 123456",
    modal_mfa_btn_enable: "Xác nhận Bật",
    modal_mfa_desc_disable: "Nhập mã OTP hiện tại từ điện thoại để hủy kích hoạt bảo mật MFA.",
    modal_mfa_btn_disable: "Hủy kích hoạt",
    modal_import_title: "Nhập Kho Hàng Mới",
    modal_import_store: "Cửa hàng nhận:",
    modal_import_sku: "Chọn SKU sản phẩm:",
    modal_import_qty: "Số lượng nhập (sản phẩm):",
    modal_import_qty_placeholder: "Ví dụ: 100",
    modal_import_supplier: "Nhà cung cấp / Đối tác:",
    modal_import_supplier_placeholder: "Nhập tên nhà cung cấp...",
    modal_import_btn: "Nhập kho",
    modal_tx_title: "Tạo Giao Dịch Bán Hàng Mới",
    modal_tx_store: "Cửa hàng thực hiện:",
    modal_tx_customer: "Chọn Khách Hàng:",
    modal_tx_customer_search: "Tìm nhanh khách hàng (nhập tên, ID, quốc gia)...",
    modal_tx_sku: "Chọn SKU sản phẩm bán:",
    modal_tx_sku_search: "Tìm nhanh sản phẩm (nhập SKU, tên)...",
    modal_tx_qty: "Số lượng mua:",
    modal_tx_price: "Đơn giá bán (USD):",
    modal_tx_price_placeholder: "Nhập đơn giá...",
    modal_tx_payment: "Hình thức thanh toán:",
    modal_tx_payment_cc: "Thẻ tín dụng (Credit Card)",
    modal_tx_payment_paypal: "PayPal",
    modal_tx_payment_cash: "Tiền mặt (Cash)",
    modal_tx_payment_apple: "Apple Pay",
    modal_tx_btn_create: "Tạo giao dịch",
    modal_tx_cart_add_title: "Thêm sản phẩm vào đơn",
    modal_tx_sku_search_placeholder: "Ví dụ: FEAC, CHAC, Đầm...",
    modal_tx_cart_list: "Danh sách sản phẩm trong đơn hàng:",
    modal_tx_col_product: "Sản phẩm / SKU",
    modal_tx_col_qty: "Số lượng",
    modal_tx_col_price: "Đơn giá",
    modal_tx_col_total: "Thành tiền",
    modal_tx_col_action: "Xóa",
    modal_tx_cart_empty: "Chưa có sản phẩm nào được chọn.",
    modal_tx_cart_grand_total: "Tổng cộng:",
    modal_tx_sku_select_placeholder: "-- Nhập từ khóa để tìm sản phẩm --",
    modal_tx_btn_add: "Thêm",
    user_profile_title: "Cài đặt Bảo mật / MFA",
    btn_logout: "Đăng xuất",
    role_it_admin: "IT Admin (Quản trị viên)",
    role_director: "Director (Giám đốc)",
    role_finance: "Finance/Auditor (Kế toán)",
    role_inventory: "Inventory Manager (Quản lý Kho)",
    role_marketing: "Marketing Manager (Quản lý Marketing)",
    role_store_manager: "Store Manager (Quản lý Cửa hàng)",
    role_sales_staff: "Sales Staff (Nhân viên bán hàng)",
    modal_tx_alert_stock: "Cảnh báo thiếu hàng tồn kho!",
    modal_tx_alert_stock_desc: "Số lượng dự báo tuần tới vươt quá số lượng hàng còn lại trong kho.",
    db_view_forecast: "Xem Dự Báo",
    db_sovereignty: "Chủ quyền",
    db_products_abbr: "Sp"
  },
  en: {
    sidebar_dashboard: "Map Dashboard",
    sidebar_customers: "Customers",
    sidebar_discounts: "Discounts",
    sidebar_employees: "Employees",
    sidebar_products: "Product",
    sidebar_stores: "Stores",
    sidebar_transactions: "Transactions",
    sidebar_inventory: "Stock Management",
    sidebar_admin_users: "System Users",
    sidebar_admin_perms: "Role Permissions",
    sidebar_admin_logs: "System Audit Logs",
    sidebar_logout: "Log Out",

    // Dashboard Tab
    db_instruction_title: "Instructions",
    db_instruction_desc: "Click on any store icon to view weekly fashion demand forecasting generated by the LightGBM machine learning model.",
    db_total_skus: "Total Forecasted SKUs",
    db_next_week_demand: "Next Week Demand",
    db_select_sku: "Select Product SKU:",
    db_chart_type: "Chart Type:",
    db_chart_line: "Line Chart",
    db_chart_column: "Column Chart",
    db_time_group: "Group By:",
    db_group_week: "Week",
    db_group_month: "Month",

    // Customers Tab
    cust_btn_add: "Add Customer",
    cust_search_placeholder: "Search by name or ID...",
    cust_filter_gender: "All Genders",
    cust_gender_male: "Male",
    cust_gender_female: "Female",
    cust_gender_nonbinary: "Non-binary",
    cust_col_id: "Customer ID",
    cust_col_name: "Full Name",
    cust_col_age: "Age",
    cust_col_gender: "Gender",
    cust_col_country: "Country",
    cust_col_actions: "Actions",
    cust_chart_title: "Customer Profile Analysis",

    // Discounts Tab
    disc_filter_store: "Filter by store:",
    disc_btn_add: "Add Promotion",
    disc_col_id: "Promo ID",
    disc_col_season: "Program Name",
    disc_col_avg: "Average Discount",
    disc_col_start: "Start Date",
    disc_col_end: "End Date",
    disc_col_actions: "Actions",
    disc_chart_title: "Average Discount Comparison Across Seasons",

    // Employees Tab
    emp_filter_store: "Filter by store:",
    emp_btn_add: "Add Employee",
    emp_col_id: "Staff ID",
    emp_col_name: "Full Name",
    emp_col_store: "Store",
    emp_col_role: "Role",
    emp_col_actions: "Actions",
    emp_chart_title: "Staff Scale Statistics",

    // Products Tab
    prod_search_placeholder: "Search by product name or description...",
    prod_filter_cat: "Category:",
    prod_filter_store: "Store:",
    prod_filter_all: "All Categories",
    prod_btn_add: "Add Product",
    prod_col_visual: "Preview",
    prod_col_name: "Product Name",
    prod_col_category: "Category",
    prod_col_subcategory: "Sub-category",
    prod_col_color: "Color Type",
    prod_col_stock: "Stock Remaining",
    prod_col_actions: "Actions",

    // Stores Tab
    store_col_id: "Store ID",
    store_col_name: "Store Name",
    store_col_lat: "Latitude (Lat)",
    store_col_lng: "Longitude (Lng)",
    store_col_country: "Country",
    store_col_skus: "Total Unique SKUs",
    store_col_products: "Total Product Lines",
    store_chart_title: "Product & SKU Distribution across Stores",

    // Transactions Tab
    tx_filter_store: "Filter by store:",
    tx_filter_payment: "Payment method:",
    tx_btn_create: "Create Transaction",
    tx_col_id: "Transaction ID",
    tx_col_store: "Store",
    tx_col_salesperson: "Salesperson",
    tx_col_time: "Time",
    tx_col_sku: "SKU",
    tx_col_product: "Product",
    tx_col_payment: "Payment",
    tx_col_price: "Price",
    tx_col_qty: "Qty",
    tx_col_total: "Total (USD)",
    tx_btn_add: "Create New Transaction",

    // Inventory Tab
    inv_title: "Inventory & Stock Management",
    inv_desc: "Track real-time stock levels and import logs from suppliers.",
    inv_btn_import: "Import Stock",
    inv_filter_store: "Store:",
    inv_filter_cat: "Category:",
    inv_all_stores: "All Stores",
    inv_search_placeholder: "Search by SKU, product name, or category...",
    inv_lbl_search: "Search:",
    inv_stock_status: "Real-time Stock Levels",
    inv_import_history: "Recent Stock Imports",
    inv_col_sku: "SKU",
    inv_col_product: "Product Name",
    inv_col_cat: "Category",
    inv_col_qty: "In-Stock",
    inv_col_date: "Import Date",
    inv_col_sku_prod: "SKU / Product",
    inv_col_qty_added: "Qty",
    inv_col_supplier: "Supplier",

    // Admin & Modals Extra Translations
    admin_users_title: "System User Accounts Management",
    admin_users_btn_add: "Add New User",
    admin_users_col_id: "User ID",
    admin_users_col_username: "Username",
    admin_users_col_role: "Role",
    admin_users_col_store: "Managed Store Location",
    admin_users_col_mfa: "MFA Status",
    admin_users_col_actions: "Actions",
    admin_perms_title: "Access Permissions Grid (RBAC Matrix)",
    admin_perms_btn_save: "Save RBAC Grid Configurations",
    admin_logs_title: "System Audit Activity Logs",
    admin_logs_lbl_filter: "Filter Actions:",
    admin_logs_opt_all: "All Actions",
    admin_logs_opt_login: "Login (Standard)",
    admin_logs_opt_login_mfa: "Login (MFA)",
    admin_logs_opt_customer_create: "Create Customer",
    admin_logs_opt_customer_delete: "Delete Customer",
    admin_logs_opt_discount_create: "Create Promotion",
    admin_logs_opt_discount_update: "Update Promotion",
    admin_logs_opt_discount_delete: "Delete Promotion",
    admin_logs_opt_employee_create: "Add Employee",
    admin_logs_opt_employee_update: "Update Employee",
    admin_logs_opt_employee_delete: "Delete Employee",
    admin_logs_opt_product_create: "Create Product",
    admin_logs_opt_product_update: "Update Product",
    admin_logs_opt_product_delete: "Delete Product",
    admin_logs_opt_user_create: "Create User",
    admin_logs_opt_user_update: "Update User",
    admin_logs_opt_user_delete: "Delete User",
    admin_logs_opt_mfa_enable: "Enable MFA",
    admin_logs_opt_mfa_disable: "Disable MFA",
    admin_logs_btn_refresh: "Refresh Logs",
    admin_logs_col_time: "Timestamp",
    admin_logs_col_user: "User Account",
    admin_logs_col_role: "Account Role",
    admin_logs_col_action: "Activity Type",
    admin_logs_col_details: "Detailed Context",
    admin_logs_col_ip: "IP Address",
    modal_add_customer_title: "Add New Customer",
    modal_cust_name: "Full Name:",
    modal_cust_name_placeholder: "Enter full name...",
    modal_cust_age: "Age:",
    modal_cust_age_placeholder: "Enter age...",
    modal_cust_gender: "Gender:",
    modal_cust_gender_male: "Male",
    modal_cust_gender_female: "Female",
    modal_cust_gender_other: "Non-binary",
    modal_cust_country: "Country:",
    modal_cust_country_placeholder: "e.g., USA, UK, Vietnam...",
    modal_btn_create: "Add New",
    modal_btn_cancel: "Cancel",
    modal_create_discount_title: "Configure New Season Promotion",
    modal_edit_discount_title: "Update Promotion Discount",
    modal_disc_store: "Store:",
    modal_disc_season: "Promotion Name:",
    modal_disc_season_placeholder: "e.g., Summer Clearance, New Year Discount...",
    modal_disc_avg: "Average Discount Ratio (0.00 - 1.00):",
    modal_disc_avg_placeholder: "e.g., 0.15",
    modal_disc_start: "Start Date:",
    modal_disc_end: "End Date:",
    modal_add_employee_title: "Add New Employee Profile",
    modal_edit_employee_title: "Update Employee Profile",
    modal_emp_store: "Assigned Store Location:",
    modal_emp_name: "Full Name:",
    modal_emp_name_placeholder: "Enter full name...",
    modal_emp_role: "Role Designation:",
    modal_emp_role_staff: "Sales Staff",
    modal_emp_role_associate: "Sales Associate",
    modal_emp_role_manager: "Store Manager",
    modal_emp_role_assistant: "Assistant Manager",
    modal_emp_role_cashier: "Cashier",
    modal_emp_role_stock_clerk: "Stock Clerk",
    modal_emp_role_director: "Director",
    modal_emp_role_inventory: "Inventory Manager",
    modal_emp_role_marketing: "Marketing Manager",
    modal_emp_role_finance: "Finance/Auditor",
    modal_emp_role_it: "IT Admin",
    modal_add_product_title: "Add New Product Entry",
    modal_edit_product_title: "Update Product Details",
    modal_prod_name: "Product Name:",
    modal_prod_name_placeholder: "e.g., Men's Polo Shirt...",
    modal_prod_cat: "Parent Category:",
    modal_prod_cat_clothing: "Clothing",
    modal_prod_cat_shoes: "Shoes",
    modal_prod_cat_accessories: "Accessories",
    modal_prod_cat_children: "Children",
    modal_prod_cat_masculine: "Masculine",
    modal_prod_cat_feminine: "Feminine",
    modal_import_item_type: "Item Type:",
    modal_import_type_existing: "Existing Product",
    modal_import_type_new: "New Product",
    modal_import_search_label: "Search SKU / Product Name:",
    modal_import_search_placeholder: "Type to search existing products...",
    modal_import_new_name: "New Product Name:",
    modal_import_new_name_placeholder: "e.g., Men's turtleneck sweater...",
    modal_import_new_cat: "Product Category:",
    modal_prod_subcat: "Sub-category:",
    modal_prod_subcat_placeholder: "e.g., T-Shirts, Sneakers...",
    modal_prod_color: "Color Pattern:",
    modal_prod_color_placeholder: "e.g., Black, White, Multi...",
    modal_prod_desc: "Detailed Description (English):",
    modal_prod_desc_placeholder: "Enter product details and specs...",
    modal_prod_image: "Media Image URL (Optional):",
    modal_prod_image_placeholder: "Leave empty to auto-generate image...",
    modal_prod_btn_save: "Save Changes",
    modal_admin_user_title_add: "Create System Account",
    modal_admin_user_title_edit: "Update System Account",
    modal_admin_user_username: "Username:",
    modal_admin_user_username_placeholder: "Enter username...",
    modal_admin_user_password: "Password:",
    modal_admin_user_password_placeholder: "Enter password...",
    modal_admin_user_password_placeholder_edit: "Leave blank to keep current password",
    modal_admin_user_role: "System Role:",
    modal_admin_user_store: "Assigned Store (If applicable):",
    modal_admin_user_store_global: "None (Global Access)",
    modal_admin_user_btn_save: "Save",
    modal_mfa_title: "Configure 2-Factor Authentication (MFA)",
    modal_mfa_status: "Current MFA Status:",
    modal_mfa_status_on: "Enabled (Active)",
    modal_mfa_status_off: "Disabled (Inactive)",
    modal_mfa_desc_enable: "Enter the secret key below into your Google Authenticator mobile app to retrieve verification OTPs.",
    modal_mfa_secret: "MFA Secret Key:",
    modal_mfa_verify_code: "Enter 6-Digit Authenticator OTP:",
    modal_mfa_verify_placeholder: "e.g., 123456",
    modal_mfa_btn_enable: "Confirm Activation",
    modal_mfa_desc_disable: "Enter your current 6-Digit Authenticator OTP to disable MFA protection.",
    modal_mfa_btn_disable: "Deactivate MFA",
    modal_import_title: "Import New Inventory Stock",
    modal_import_store: "Receiving Store Location:",
    modal_import_sku: "Select Target SKU:",
    modal_import_qty: "Quantity to Import (items):",
    modal_import_qty_placeholder: "e.g., 100",
    modal_import_supplier: "Supplier / Partner:",
    modal_import_supplier_placeholder: "Enter supplier name...",
    modal_import_btn: "Import",
    modal_tx_title: "Register New Sales Transaction",
    modal_tx_store: "Originating Store:",
    modal_tx_customer: "Select Customer profile:",
    modal_tx_customer_search: "Quick search customer (name, ID, country)...",
    modal_tx_sku: "Select SKU to sell:",
    modal_tx_sku_search: "Quick search product (SKU, name)...",
    modal_tx_qty: "Purchase Quantity:",
    modal_tx_price: "Selling Unit Price (USD):",
    modal_tx_price_placeholder: "Enter selling price...",
    modal_tx_payment: "Payment Method:",
    modal_tx_payment_cc: "Credit Card",
    modal_tx_payment_paypal: "PayPal",
    modal_tx_payment_cash: "Cash",
    modal_tx_payment_apple: "Apple Pay",
    modal_tx_btn_create: "Create Transaction",
    modal_tx_cart_add_title: "Add Product to Cart",
    modal_tx_sku_search_placeholder: "e.g. FEAC, CHAC, Dress...",
    modal_tx_cart_list: "Products in sales transaction:",
    modal_tx_col_product: "Product / SKU",
    modal_tx_col_qty: "Quantity",
    modal_tx_col_price: "Unit Price",
    modal_tx_col_total: "Subtotal",
    modal_tx_col_action: "Delete",
    modal_tx_cart_empty: "No products added to cart yet.",
    modal_tx_cart_grand_total: "Grand Total:",
    modal_tx_sku_select_placeholder: "-- Enter keyword to search products --",
    modal_tx_btn_add: "Add",
    user_profile_title: "Security Settings / MFA",
    btn_logout: "Log Out",
    role_it_admin: "IT Admin",
    role_director: "Director",
    role_finance: "Finance / Auditor",
    role_inventory: "Inventory Manager",
    role_marketing: "Marketing Manager",
    role_store_manager: "Store Manager",
    role_sales_staff: "Sales Staff",
    modal_tx_alert_stock: "Out of Stock Warning!",
    modal_tx_alert_stock_desc: "Weekly forecasted demand exceeds the remaining in-stock quantity.",
    db_view_forecast: "View Forecast",
    db_sovereignty: "Sovereignty",
    db_products_abbr: "Prod"
  },
  zh: {
    sidebar_dashboard: "地图仪表盘",
    sidebar_customers: "客户管理",
    sidebar_discounts: "折扣优惠",
    sidebar_employees: "员工名册",
    sidebar_products: "商品列表",
    sidebar_stores: "门店列表",
    sidebar_transactions: "交易流水",
    sidebar_inventory: "库存管理",
    sidebar_admin_users: "用户管理",
    sidebar_admin_perms: "角色与权限",
    sidebar_admin_logs: "操作日志",
    sidebar_logout: "退出登录",

    // Dashboard Tab
    db_instruction_title: "操作指南",
    db_instruction_desc: "点击地图上的门店图标，查看由 LightGBM 机器学习模型生成的每周服装需求预测数据。",
    db_total_skus: "预测 SKU 总数",
    db_next_week_demand: "下周需求预测",
    db_select_sku: "选择商品 SKU:",
    db_chart_type: "图表类型:",
    db_chart_line: "折线图",
    db_chart_column: "柱状图",
    db_time_group: "时间分组:",
    db_group_week: "按周",
    db_group_month: "按月",

    // Customers Tab
    cust_btn_add: "新增客户",
    cust_search_placeholder: "按姓名或客户编号搜索...",
    cust_filter_gender: "所有性别",
    cust_gender_male: "男",
    cust_gender_female: "女",
    cust_gender_nonbinary: "其他",
    cust_col_id: "客户编号",
    cust_col_name: "姓名",
    cust_col_age: "年龄",
    cust_col_gender: "性别",
    cust_col_country: "国家",
    cust_col_actions: "操作",
    cust_chart_title: "客户结构分析",

    // Discounts Tab
    disc_filter_store: "按门店过滤:",
    disc_btn_add: "新增促销",
    disc_col_id: "优惠编号",
    disc_col_season: "活动名称",
    disc_col_avg: "平均折扣",
    disc_col_start: "开始日期",
    disc_col_end: "结束日期",
    disc_col_actions: "操作",
    disc_chart_title: "各季度平均折扣对比",

    // Employees Tab
    emp_filter_store: "按门店过滤:",
    emp_btn_add: "新增员工",
    emp_col_id: "员工编号",
    emp_col_name: "姓名",
    emp_col_store: "所属门店",
    emp_col_role: "职位",
    emp_col_actions: "操作",
    emp_chart_title: "员工规模构成统计",

    // Products Tab
    prod_search_placeholder: "搜索商品名称或描述...",
    prod_filter_cat: "商品类别:",
    prod_filter_store: "门店:",
    prod_filter_all: "所有类别",
    prod_btn_add: "新增商品",
    prod_col_visual: "预览",
    prod_col_name: "商品名称",
    prod_col_category: "商品类别",
    prod_col_subcategory: "子分类",
    prod_col_color: "颜色款式",
    prod_col_stock: "库存量",
    prod_col_actions: "操作",

    // Stores Tab
    store_col_id: "门店编号",
    store_col_name: "门店名称",
    store_col_lat: "纬度 (Lat)",
    store_col_lng: "经度 (Lng)",
    store_col_country: "国家",
    store_col_skus: "单品 SKU 总数",
    store_col_products: "款式总数",
    store_chart_title: "各门店商品与 SKU 数量分布图",

    // Transactions Tab
    tx_filter_store: "按门店过滤:",
    tx_filter_payment: "支付方式:",
    tx_btn_create: "创建交易",
    tx_col_id: "交易单号",
    tx_col_store: "门店",
    tx_col_salesperson: "经办人",
    tx_col_time: "交易时间",
    tx_col_sku: "商品 SKU",
    tx_col_product: "商品名称",
    tx_col_payment: "支付方式",
    tx_col_price: "单价",
    tx_col_qty: "数量",
    tx_col_total: "总计 (USD)",
    tx_btn_add: "登记新交易",

    // Inventory Tab
    inv_title: "库存与进销存管理",
    inv_desc: "实时追踪库存水平及来自供应商的入库日志。",
    inv_btn_import: "办理商品入库",
    inv_filter_store: "门店:",
    inv_filter_cat: "品类:",
    inv_all_stores: "所有门店",
    inv_search_placeholder: "按 SKU、商品名称或品类搜索...",
    inv_lbl_search: "搜索:",
    inv_stock_status: "实时库存状态",
    inv_import_history: "最近入库日志",
    inv_col_sku: "商品 SKU",
    inv_col_product: "商品名称",
    inv_col_cat: "品类",
    inv_col_qty: "库存余量",
    inv_col_date: "入库时间",
    inv_col_sku_prod: "SKU / 商品",
    inv_col_qty_added: "数量",
    inv_col_supplier: "供货商",

    // Admin & Modals Extra Translations
    admin_users_title: "系统账户与权限管理",
    admin_users_btn_add: "新增系统账户",
    admin_users_col_id: "账户 ID",
    admin_users_col_username: "登录账号",
    admin_users_col_role: "所属角色",
    admin_users_col_store: "负责管理门店",
    admin_users_col_mfa: "MFA 状态",
    admin_users_col_actions: "操作",
    admin_perms_title: "动态角色权限配置矩阵 (RBAC Matrix)",
    admin_perms_btn_save: "保存 RBAC 矩阵配置",
    admin_logs_title: "系统操作审计日志 (Audit Logs)",
    admin_logs_lbl_filter: "按操作过滤:",
    admin_logs_opt_all: "所有操作",
    admin_logs_opt_login: "登录 (普通)",
    admin_logs_opt_login_mfa: "登录 (MFA)",
    admin_logs_opt_customer_create: "创建客户",
    admin_logs_opt_customer_delete: "删除客户",
    admin_logs_opt_discount_create: "创建促销",
    admin_logs_opt_discount_update: "更新促销",
    admin_logs_opt_discount_delete: "删除促销",
    admin_logs_opt_employee_create: "添加员工",
    admin_logs_opt_employee_update: "更新员工",
    admin_logs_opt_employee_delete: "删除员工",
    admin_logs_opt_product_create: "创建商品",
    admin_logs_opt_product_update: "更新商品",
    admin_logs_opt_product_delete: "删除商品",
    admin_logs_opt_user_create: "创建用户",
    admin_logs_opt_user_update: "更新用户",
    admin_logs_opt_user_delete: "删除用户",
    admin_logs_opt_mfa_enable: "开启 MFA",
    admin_logs_opt_mfa_disable: "关闭 MFA",
    admin_logs_btn_refresh: "刷新日志",
    admin_logs_col_time: "日志时间",
    admin_logs_col_user: "操作用户",
    admin_logs_col_role: "用户角色",
    admin_logs_col_action: "操作动作",
    admin_logs_col_details: "操作详情",
    admin_logs_col_ip: "客户端 IP",
    modal_add_customer_title: "添加新客户",
    modal_cust_name: "客户姓名:",
    modal_cust_name_placeholder: "请输入姓名...",
    modal_cust_age: "年龄:",
    modal_cust_age_placeholder: "请输入年龄...",
    modal_cust_gender: "性别:",
    modal_cust_gender_male: "男",
    modal_cust_gender_female: "女",
    modal_cust_gender_other: "其他 (Non-binary)",
    modal_cust_country: "所属国家/地区:",
    modal_cust_country_placeholder: "例如: 中国, 美国, 越南...",
    modal_btn_create: "新增创建",
    modal_btn_cancel: "取消",
    modal_create_discount_title: "新增季度折扣配置",
    modal_edit_discount_title: "更新折扣力度",
    modal_disc_store: "门店:",
    modal_disc_season: "促销计划名称:",
    modal_disc_season_placeholder: "例如: 夏季清仓, 冬季酬宾...",
    modal_disc_avg: "平均折扣力度 (0.00 - 1.00):",
    modal_disc_avg_placeholder: "例如: 0.15",
    modal_disc_start: "开始时间:",
    modal_disc_end: "结束时间:",
    modal_add_employee_title: "添加新员工档案",
    modal_edit_employee_title: "更新员工信息",
    modal_emp_store: "所属门店:",
    modal_emp_name: "员工姓名:",
    modal_emp_name_placeholder: "请输入员工姓名...",
    modal_emp_role: "岗位职称:",
    modal_emp_role_staff: "销售员工",
    modal_emp_role_associate: "销售助理 (Sales Associate)",
    modal_emp_role_manager: "门店经理",
    modal_emp_role_assistant: "助理经理 (Assistant Manager)",
    modal_emp_role_cashier: "收银员 (Cashier)",
    modal_emp_role_stock_clerk: "理货员 (Stock Clerk)",
    modal_emp_role_director: "总监 (Director)",
    modal_emp_role_inventory: "库存经理 (Inventory Manager)",
    modal_emp_role_marketing: "营销经理 (Marketing Manager)",
    modal_emp_role_finance: "财务审计 (Finance/Auditor)",
    modal_emp_role_it: "IT管理员 (IT Admin)",
    modal_add_product_title: "添加新商品名录",
    modal_edit_product_title: "更新商品属性",
    modal_prod_name: "商品名称:",
    modal_prod_name_placeholder: "例如: 男式高档 Polo 衫...",
    modal_prod_cat: "主类别:",
    modal_prod_cat_clothing: "服装",
    modal_prod_cat_shoes: "鞋履",
    modal_prod_cat_accessories: "配饰",
    modal_prod_cat_children: "儿童 (Children)",
    modal_prod_cat_masculine: "男装 (Masculine)",
    modal_prod_cat_feminine: "女装 (Feminine)",
    modal_import_item_type: "商品类型:",
    modal_import_type_existing: "已有商品",
    modal_import_type_new: "新商品",
    modal_import_search_label: "搜索 SKU / 商品名称:",
    modal_import_search_placeholder: "输入以过滤已有商品...",
    modal_import_new_name: "新商品名称:",
    modal_import_new_name_placeholder: "例如: 男装高领毛衣...",
    modal_import_new_cat: "商品品类:",
    modal_prod_subcat: "子类别:",
    modal_prod_subcat_placeholder: "例如: T恤, 运动鞋...",
    modal_prod_color: "商品颜色:",
    modal_prod_color_placeholder: "例如: 黑色, 白色, 彩色...",
    modal_prod_desc: "详细描述 (英文):",
    modal_prod_desc_placeholder: "请输入详细的商品描述与规格...",
    modal_prod_image: "商品图片 URL (选填):",
    modal_prod_image_placeholder: "留空将自动生成图片...",
    modal_prod_btn_save: "保存更改",
    modal_admin_user_title_add: "创建系统账号",
    modal_admin_user_title_edit: "更新系统账号",
    modal_admin_user_username: "登录账号:",
    modal_admin_user_username_placeholder: "请输入账号...",
    modal_admin_user_password: "登录密码:",
    modal_admin_user_password_placeholder: "请输入密码...",
    modal_admin_user_password_placeholder_edit: "留空将保持当前密码不变",
    modal_admin_user_role: "系统角色:",
    modal_admin_user_store: "管辖门店 (若有):",
    modal_admin_user_store_global: "无 (全局访问权)",
    modal_admin_user_btn_save: "保存",
    modal_mfa_title: "双重身份验证设置 (MFA)",
    modal_mfa_status: "当前 MFA 状态:",
    modal_mfa_status_on: "已开启 (Active)",
    modal_mfa_status_off: "未开启 (Inactive)",
    modal_mfa_desc_enable: "请在手机上的 Google Authenticator 应用程序中输入以下密钥以获取验证码。",
    modal_mfa_secret: "MFA 密匙 (Secret Key):",
    modal_mfa_verify_code: "输入 6 位数双重验证码 (OTP):",
    modal_mfa_verify_placeholder: "例如: 123456",
    modal_mfa_btn_enable: "确认开启",
    modal_mfa_desc_disable: "请输入手机上当前的 6 位数验证码以禁用双重身份验证保护。",
    modal_mfa_btn_disable: "解除 MFA 保护",
    modal_import_title: "办理新商品入库",
    modal_import_store: "收货门店:",
    modal_import_sku: "选择入库 SKU:",
    modal_import_qty: "入库数量 (件):",
    modal_import_qty_placeholder: "例如: 100",
    modal_import_supplier: "供货商 / 合作伙伴:",
    modal_import_supplier_placeholder: "请输入供货商名称...",
    modal_import_btn: "入库",
    modal_tx_title: "登记销售交易流水",
    modal_tx_store: "发生门店:",
    modal_tx_customer: "选择客户档案:",
    modal_tx_customer_search: "快速搜索客户 (姓名、ID、国家)...",
    modal_tx_sku: "选择销售 SKU:",
    modal_tx_sku_search: "快速搜索商品 (SKU、名称)...",
    modal_tx_qty: "购买数量:",
    modal_tx_price: "销售单价 (USD):",
    modal_tx_price_placeholder: "请输入单价...",
    modal_tx_payment: "付款方式:",
    modal_tx_payment_cc: "信用卡 (Credit Card)",
    modal_tx_payment_paypal: "PayPal",
    modal_tx_payment_cash: "现金 (Cash)",
    modal_tx_payment_apple: "Apple Pay",
    modal_tx_btn_create: "创建销售单",
    modal_tx_cart_add_title: "添加商品到购物车",
    modal_tx_sku_search_placeholder: "例如：FEAC, CHAC, 连衣裙...",
    modal_tx_cart_list: "订单中的商品列表:",
    modal_tx_col_product: "商品 / SKU",
    modal_tx_col_qty: "数量",
    modal_tx_col_price: "单价",
    modal_tx_col_total: "小计",
    modal_tx_col_action: "删除",
    modal_tx_cart_empty: "尚未选择任何商品。",
    modal_tx_cart_grand_total: "总计:",
    modal_tx_sku_select_placeholder: "-- 输入关键字以搜索商品 --",
    modal_tx_btn_add: "添加",
    user_profile_title: "安全设置 / MFA",
    btn_logout: "登出",
    role_it_admin: "IT管理员",
    role_director: "董事 / 总经理",
    role_finance: "财务 / 审计员",
    role_inventory: "仓库经理",
    role_marketing: "营销经理",
    role_store_manager: "门店经理",
    role_sales_staff: "销售店员",
    modal_tx_alert_stock: "库存不足警告！",
    modal_tx_alert_stock_desc: "下周需求预测数量超出了目前该商品的剩余库存量。",
    db_view_forecast: "查看预测",
    db_sovereignty: "主权",
    db_products_abbr: "商品"
  }
};

const dynamicTitles = {
  dashboard: { vi: 'Dashboard Bản đồ Cửa hàng', en: 'Store Map Dashboard', zh: '门店地图仪表盘' },
  customers: { vi: 'Quản lý Khách hàng', en: 'Customer Management', zh: '客户管理' },
  discounts: { vi: 'Cơ chế Khuyến mãi', en: 'Discount Configuration', zh: '促销折扣配置' },
  employees: { vi: 'Danh sách Nhân sự', en: 'Staff Directory', zh: '员工名册' },
  products: { vi: 'Sản phẩm', en: 'Product Catalog', zh: '商品目录' },
  stores: { vi: 'Danh sách Cửa hàng Toàn cầu', en: 'Global Store Locations', zh: '全球门店列表' },
  transactions: { vi: 'Lịch sử Giao dịch', en: 'Transaction History', zh: '交易历史记录' },
  inventory: { vi: 'Quản lý Kho hàng & Nhập kho', en: 'Inventory & Stock Management', zh: '库存与进销存管理' },
  'admin-users': { vi: 'Quản lý Tài khoản Hệ thống', en: 'System Users', zh: '系统用户管理' },
  'admin-permissions': { vi: 'Thiết lập Phân quyền Dynamic', en: 'RBAC Dynamic Permissions', zh: 'RBAC动态权限配置' },
  'admin-logs': { vi: 'Nhật ký Hoạt động Hệ thống', en: 'System Audit Logs', zh: '系统审计日志' }
};

const elementSelectors = {
  // Dashboard
  '#tab-dashboard .map-overlay-info h3': 'db_instruction_title',
  '#tab-dashboard .map-overlay-info p': 'db_instruction_desc',
  '#tab-dashboard .stat-card:nth-child(1) .stat-label': 'db_total_skus',
  '#tab-dashboard .stat-card:nth-child(2) .stat-label': 'db_next_week_demand',
  '#tab-dashboard label[for="forecast-sku-selector"]': 'db_select_sku',
  '#tab-dashboard label[for="forecast-chart-type"]': 'db_chart_type',
  '#tab-dashboard #forecast-chart-type option[value="line"]': 'db_chart_line',
  '#tab-dashboard #forecast-chart-type option[value="column"]': 'db_chart_column',
  
  // Customers
  '#tab-customers #btn-add-customer': 'cust_btn_add',
  '#tab-customers #customers-search': 'cust_search_placeholder',
  '#tab-customers label': 'cust_col_gender',
  '#tab-customers #customers-gender-filter option[value=""]': 'cust_filter_gender',
  '#tab-customers #customers-gender-filter option[value="Male"]': 'cust_gender_male',
  '#tab-customers #customers-gender-filter option[value="Female"]': 'cust_gender_female',
  '#tab-customers #customers-gender-filter option[value="Non-binary"]': 'cust_gender_nonbinary',
  '#customers-table th:nth-child(1)': 'cust_col_id',
  '#customers-table th:nth-child(2)': 'cust_col_name',
  '#customers-table th:nth-child(3)': 'cust_col_age',
  '#customers-table th:nth-child(4)': 'cust_col_gender',
  '#customers-table th:nth-child(5)': 'cust_col_country',
  '#customers-table th:nth-child(6)': 'cust_col_actions',
  '#tab-customers h3': 'cust_chart_title',

  // Discounts
  '#tab-discounts label': 'disc_filter_store',
  '#tab-discounts #btn-add-discount': 'disc_btn_add',
  '#discounts-table th:nth-child(1)': 'disc_col_id',
  '#discounts-table th:nth-child(2)': 'disc_col_season',
  '#discounts-table th:nth-child(3)': 'disc_col_avg',
  '#discounts-table th:nth-child(4)': 'disc_col_start',
  '#discounts-table th:nth-child(5)': 'disc_col_end',
  '#discounts-table th:nth-child(6)': 'disc_col_actions',
  '#tab-discounts .discount-chart-card h3': 'disc_chart_title',

  // Employees
  '#tab-employees label': 'emp_filter_store',
  '#tab-employees #btn-add-employee': 'emp_btn_add',
  '#employees-table th:nth-child(1)': 'emp_col_id',
  '#employees-table th:nth-child(2)': 'emp_col_name',
  '#employees-table th:nth-child(3)': 'emp_col_store',
  '#employees-table th:nth-child(4)': 'emp_col_role',
  '#employees-table th:nth-child(5)': 'emp_col_actions',
  '#tab-employees h3': 'emp_chart_title',

  // Products
  '#tab-products #products-search': 'prod_search_placeholder',
  '#products-category-filter-label': 'prod_filter_cat',
  '#products-store-filter-label': 'prod_filter_store',
  '#tab-products #products-category-filter option[value=""]': 'prod_filter_all',
  '#tab-products #products-category-filter option[value="Children"]': 'modal_prod_cat_children',
  '#tab-products #products-category-filter option[value="Masculine"]': 'modal_prod_cat_masculine',
  '#tab-products #products-category-filter option[value="Feminine"]': 'modal_prod_cat_feminine',
  '#tab-products #btn-add-product': 'prod_btn_add',

  // Stores
  '#stores-table th:nth-child(1)': 'store_col_id',
  '#stores-table th:nth-child(2)': 'store_col_name',
  '#stores-table th:nth-child(3)': 'store_col_lat',
  '#stores-table th:nth-child(4)': 'store_col_lng',
  '#stores-table th:nth-child(5)': 'store_col_country',
  '#stores-table th:nth-child(6)': 'store_col_skus',
  '#stores-table th:nth-child(7)': 'store_col_products',
  '#tab-stores h3': 'store_chart_title',

  // Transactions
  '#tab-transactions label[for="transactions-store-filter"]': 'tx_filter_store',
  '#tab-transactions label[for="transactions-payment-filter"]': 'tx_filter_payment',
  '#tab-transactions #btn-add-transaction': 'tx_btn_create',
  '#transactions-table th:nth-child(1)': 'tx_col_id',
  '#transactions-table th:nth-child(2)': 'tx_col_store',
  '#transactions-table th:nth-child(3)': 'tx_col_salesperson',
  '#transactions-table th:nth-child(4)': 'tx_col_time',
  '#transactions-table th:nth-child(5)': 'tx_col_sku',
  '#transactions-table th:nth-child(6)': 'tx_col_product',
  '#transactions-table th:nth-child(7)': 'tx_col_payment',
  '#transactions-table th:nth-child(8)': 'tx_col_price',
  '#transactions-table th:nth-child(9)': 'tx_col_qty',
  '#transactions-table th:nth-child(10)': 'tx_col_total',

  // Inventory
  '#tab-inventory h1.page-title': 'inv_title',
  '#tab-inventory .inventory-header p.text-muted': 'inv_desc',
  '#tab-inventory #btn-open-import': 'inv_btn_import',
  '#tab-inventory label[for="inventory-store-select"]': 'inv_filter_store',
  '#inventory-store-select option[value=""]': 'inv_all_stores',
  '#discounts-store-filter option[value=""]': 'inv_all_stores',
  '#employees-store-filter option[value=""]': 'inv_all_stores',
  '#transactions-store-filter option[value=""]': 'inv_all_stores',
  '#tab-inventory #inventory-search': 'inv_search_placeholder',
  '#tab-inventory .grid-container > div:nth-child(1) h3': 'inv_stock_status',
  '#tab-inventory .grid-container > div:nth-child(2) h3': 'inv_import_history',
  '#tab-inventory .grid-container > div:nth-child(1) th:nth-child(1)': 'inv_col_sku',
  '#tab-inventory .grid-container > div:nth-child(1) th:nth-child(2)': 'inv_col_product',
  '#tab-inventory .grid-container > div:nth-child(1) th:nth-child(3)': 'inv_col_cat',
  '#tab-inventory .grid-container > div:nth-child(1) th:nth-child(4)': 'inv_col_qty',
  '#tab-inventory .grid-container > div:nth-child(2) th:nth-child(1)': 'inv_col_date',
  '#tab-inventory .grid-container > div:nth-child(2) th:nth-child(2)': 'inv_col_sku_prod',
  '#tab-inventory .grid-container > div:nth-child(2) th:nth-child(3)': 'inv_col_qty_added',
  '#tab-inventory .grid-container > div:nth-child(2) th:nth-child(4)': 'inv_col_supplier'
};

function setElementTranslatedText(el, text) {
  if (!el) return;
  const icon = el.querySelector('i');
  if (icon) {
    const newIcon = icon.cloneNode(true);
    el.innerHTML = '';
    el.appendChild(newIcon);
    el.appendChild(document.createTextNode(' ' + text));
  } else {
    el.textContent = text;
  }
}

function translatePage() {
  // Translate standard data-i18n attributes
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[currentLang] && translations[currentLang][key]) {
      const text = translations[currentLang][key];
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.hasAttribute('placeholder')) {
        el.placeholder = text;
      } else if (el.hasAttribute('title')) {
        el.title = text;
      } else {
        setElementTranslatedText(el, text);
      }
    }
  });

  // Translate tab contents using CSS selectors mapping
  for (const [selector, key] of Object.entries(elementSelectors)) {
    const el = document.querySelector(selector);
    if (el && translations[currentLang] && translations[currentLang][key]) {
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type === 'text') {
        el.placeholder = translations[currentLang][key];
      } else {
        setElementTranslatedText(el, translations[currentLang][key]);
      }
    }
  }

  // Update dynamic page title
  const pageTitle = document.getElementById('page-title');
  if (pageTitle && dynamicTitles[activeTab]) {
    pageTitle.textContent = dynamicTitles[activeTab][currentLang];
  }

  // Translate DB Mode badge
  const dbModeText = document.getElementById('db-mode-text');
  if (dbModeText) {
    const isMock = dbModeText.textContent.includes('Mock') || dbModeText.textContent.includes('mô phỏng') || dbModeText.textContent.includes('模拟');
    if (isMock) {
      dbModeText.textContent = currentLang === 'vi' ? 'Chế độ mô phỏng (JSON)' : (currentLang === 'en' ? 'Mock Mode (JSON)' : '模拟模式 (JSON)');
    } else {
      dbModeText.textContent = currentLang === 'vi' ? 'Cơ sở dữ liệu đám mây (RDS)' : (currentLang === 'en' ? 'Cloud Database (RDS)' : '云数据库 (RDS)');
    }
  }

  // Synchronize sidebar tooltips if collapsed
  if (typeof updateSidebarTooltips === 'function') {
    updateSidebarTooltips();
  }

  // Update open forecast panel elements and chart translations
  if (typeof updateForecastPanelLanguage === 'function') {
    updateForecastPanelLanguage();
  }
}

if (langSelect) {
  langSelect.value = currentLang;
  langSelect.addEventListener('change', (e) => {
    currentLang = e.target.value;
    localStorage.setItem('preferred-language', currentLang);
    translatePage();
    switchTab(activeTab);
  });
}

// Call translatePage initially
translatePage();

// Run auth check on page load
checkAuth();
