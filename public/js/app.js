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

// ================= TAB MANAGEMENT =================
function switchTab(tabName) {
  activeTab = tabName;
  
  // Update Nav Active state
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update Page Title
  const titles = {
    dashboard: 'Dashboard Bản đồ Cửa hàng',
    customers: 'Quản lý Khách hàng',
    discounts: 'Cơ chế Khuyến mãi',
    employees: 'Danh sách Nhân sự',
    products: 'Lưới Sản phẩm (GenAI Showcase)',
    stores: 'Danh sách Cửa hàng Toàn cầu',
    transactions: 'Lịch sử Giao dịch',
    inventory: 'Quản lý Kho hàng & Nhập kho',
    'admin-users': 'Quản lý Tài khoản Hệ thống',
    'admin-permissions': 'Thiết lập Phân quyền Dynamic',
    'admin-logs': 'Nhật ký Hoạt động Hệ thống'
  };
  pageTitle.textContent = titles[tabName] || 'G-Fashion BI';

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
          <p style="margin: 0 0 8px 0; font-size: 11px; color: #9ca3af;"><i class="fa-solid fa-box"></i> SKU: ${store.num_distinct_skus} | Sp: ${store.num_distinct_products}</p>
          <button onclick="window.openForecastPanel(${store.store_id}, '${store.store_name.replace(/'/g, "\\'")}')" style="width: 100%; font-size: 11px; padding: 6px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; border-radius: 6px; cursor: pointer; transition: all 0.3s;" onmouseover="this.style.background='#6366f1'; this.style.color='white';" onmouseout="this.style.background='rgba(99, 102, 241, 0.15)'; this.style.color='#818cf8';">Xem Dự Báo</button>
        </div>
      `);

      new maplibregl.Marker({ element: el })
        .setLngLat([store.longitude, store.latitude])
        .setPopup(popup)
        .addTo(map);
    });

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
      selector.innerHTML = '<option value="">Không có dữ liệu dự báo</option>';
      document.getElementById('forecast-sku-count').textContent = '0';
      document.getElementById('forecast-next-week-qty').textContent = '0';
      Plotly.purge('forecast-chart');
      return;
    }

    document.getElementById('forecast-sku-count').textContent = activeForecastsData.length;

    activeForecastsData.forEach((f, idx) => {
      const option = document.createElement('option');
      option.value = f.sku;
      option.textContent = `${f.sku} - ${f.product_name}`;
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
    document.getElementById('alert-predicted-qty').textContent = nextWeekForecast;
    document.getElementById('alert-stock-qty').textContent = stockQty;
    document.getElementById('alert-needed-qty').textContent = nextWeekForecast - stockQty;
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
      const key = `Tháng ${month}/${t.year}`;
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
      const key = `Tuần ${t.week}/${t.year}`;
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
        name: 'Dự kiến (Predicted)',
        type: 'bar',
        offsetgroup: 'predicted',
        marker: { color: '#24ad4a' } // Green
      },
      {
        x: labels,
        y: actualVals,
        name: 'Thực tế (Actual)',
        type: 'bar',
        offsetgroup: 'actual_upcoming',
        marker: { color: '#3f51b5' } // Royal Blue
      },
      {
        x: labels,
        y: upcomingVals,
        base: actualVals,
        name: 'Sắp tới (Upcoming)',
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
        name: 'Thực tế (Actual)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#10b981', width: 3 }, // Green
        marker: { size: 6 }
      },
      {
        x: labels,
        y: predictedVals,
        name: 'Dự báo (Forecast)',
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
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', title: 'Số lượng sản phẩm' }
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

// ================= CUSTOMERS TAB LOGIC =================
async function loadCustomersTab() {
  const { page, limit, search, gender } = pagState.customers;
  
  try {
    const res = await fetchAPI(`/api/customers?page=${page}&limit=${limit}&search=${search}&gender=${gender}`);
    
    // Render Table
    const tbody = document.querySelector('#customers-table tbody');
    tbody.innerHTML = '';
    
    res.data.forEach(c => {
      const isDirector = currentUser.role === 'Director';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#${c.customer_id}</code></td>
        <td><strong>${c.customer_name}</strong></td>
        <td>${c.age}</td>
        <td><span class="badge badge-gender">${c.gender}</span></td>
        <td><i class="fa-solid fa-map-pin"></i> ${c.country}</td>
        <td>
          ${isDirector ? `<button class="btn-action-delete" onclick="deleteCustomer(${c.customer_id})"><i class="fa-solid fa-trash"></i> Xóa</button>` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> Khóa</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });

    pagState.customers.total = res.total;
    renderPagination('customers', res.total, page, limit);
    
    // Load Charts for Customers (Only do this once or on filter change)
    renderCustomerCharts(res.data); // In production we would query a stats endpoint, but we summarize page data or mock total for display

  } catch (err) {
    console.error('Error loading customers:', err);
  }
}

function renderCustomerCharts(pageData) {
  // To make charts beautiful and representative of the global dataset (since pageData is only 10 items)
  // We mock a nice overview for the BI display
  const genderData = [
    { values: [42, 53, 5], labels: ['Nam (Male)', 'Nữ (Female)', 'Khác (Non-binary)'], type: 'pie', hole: .4, marker: { colors: ['#6366f1', '#ec4899', '#f59e0b'] } }
  ];

  const genderLayout = {
    title: 'Phân bố Giới tính',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter' },
    margin: { t: 40, r: 10, b: 10, l: 10 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.1 }
  };

  Plotly.newPlot('customers-gender-chart', genderData, genderLayout, { displayModeBar: false });

  // Age Chart
  const ageTrace = {
    x: ['18-25', '26-35', '36-45', '46-55', '56+'],
    y: [28, 45, 34, 18, 12],
    type: 'bar',
    marker: {
      color: '#6366f1',
      opacity: 0.8
    }
  };

  const ageLayout = {
    title: 'Phân bố Độ tuổi',
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
      storeFilter.innerHTML = currentUser.role === 'Director' ? '<option value="">Tất cả Cửa hàng</option>' : '';
      
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
    const discounts = await fetchAPI(`/api/discounts?store_id=${storeId}`);
    
    // Render Table
    const tbody = document.querySelector('#discounts-table tbody');
    tbody.innerHTML = '';

    discounts.forEach(d => {
      const discountPct = (d.total_discount_avg * 100).toFixed(2);
      const isEditable = currentUser.role === 'Director' || currentUser.store_id === d.store_id;
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#DISC-${d.discount_id}</code></td>
        <td><strong>${d.season_name}</strong></td>
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
              <button class="btn-action-edit" onclick="openEditDiscount(${d.discount_id}, ${d.total_discount_avg})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
              <button class="btn-action-delete" onclick="deleteDiscount(${d.discount_id})"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
          ` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> Khóa</span>`}
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

  const xData = discounts.map(d => `${d.season_name} (Store ${d.store_id})`);
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
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', title: 'Phần trăm chiết khấu (%)' }
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
      storeFilter.innerHTML = currentUser.role === 'Director' ? '<option value="">Tất cả Cửa hàng</option>' : '';
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
    const employees = await fetchAPI(`/api/employees?store_id=${storeId}`);
    
    const tbody = document.querySelector('#employees-table tbody');
    tbody.innerHTML = '';

    employees.forEach(e => {
      const isEditable = currentUser.role === 'Director' || currentUser.store_id === e.store_id;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#EMP-${e.employee_id}</code></td>
        <td><strong>${e.name}</strong></td>
        <td>Store ${e.store_id}</td>
        <td><span class="badge" style="background:${e.role === 'Store Manager' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; color:${e.role === 'Store Manager' ? 'var(--secondary)' : 'var(--text-main)'}; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600;">${e.role}</span></td>
        <td>
          ${isEditable ? `
            <div style="display: flex; gap: 8px;">
              <button class="btn-action-edit" onclick="openEditEmployee(${e.employee_id}, '${e.name.replace(/'/g, "\\'")}', '${e.role}')"><i class="fa-solid fa-user-pen"></i> Sửa</button>
              <button class="btn-action-delete" onclick="deleteEmployee(${e.employee_id})"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
          ` : `<span class="text-muted"><i class="fa-solid fa-lock"></i> Khóa</span>`}
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
  const managers = employees.filter(e => e.role === 'Store Manager').length;
  const staff = employees.filter(e => e.role === 'Sales Staff').length;

  const data = [{
    values: [managers, staff],
    labels: ['Quản lý (Manager)', 'Nhân viên (Staff)'],
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
  document.getElementById('edit-employee-role').value = role;
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
  const category = document.getElementById('products-category-filter').value;
  const search = document.getElementById('products-search').value;

  try {
    const products = await fetchAPI(`/api/products?category=${category}&search=${search}`);
    
    const container = document.getElementById('products-grid');
    container.innerHTML = '';

    if (products.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">Không tìm thấy sản phẩm nào.</div>';
      return;
    }

    const hasAdminRights = currentUser.role === 'Director' || currentUser.role === 'Store Manager';
    products.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      
      const escName = p.product_name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const escCategory = p.category.replace(/'/g, "\\'");
      const escSubCategory = p.sub_category.replace(/'/g, "\\'");
      const escColor = p.color_type.replace(/'/g, "\\'");
      const escDesc = p.description_en.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const escImg = p.image_url ? p.image_url.replace(/'/g, "\\'") : '';

      card.innerHTML = `
        <div class="product-img-wrapper">
          <span class="product-category-badge">${p.category}</span>
          <img src="${p.image_url}" class="product-img" alt="${p.product_name}" onerror="this.src='https://placehold.co/300x300?text=Product+Image'">
        </div>
        <div class="product-info-wrapper" style="flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <h4 class="product-title">${p.product_name}</h4>
            <div class="product-details">
              <span><strong>Kiểu màu:</strong> ${p.color_type}</span>
              <span><strong>Phân loại phụ:</strong> ${p.sub_category}</span>
            </div>
            <p class="product-desc"><em>${p.description_en}</em></p>
          </div>
          ${hasAdminRights ? `
            <div style="display: flex; gap: 8px; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
              <button class="btn-action-edit" style="flex: 1;" onclick="openEditProduct(${p.product_id}, '${escName}', '${escCategory}', '${escSubCategory}', '${escColor}', '${escDesc}', '${escImg}')"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
              <button class="btn-action-delete" style="flex: 1;" onclick="deleteProduct(${p.product_id})"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
          ` : ''}
        </div>
      `;
      container.appendChild(card);
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
    name: 'Số SKU duy nhất',
    type: 'bar',
    marker: { color: '#6366f1' }
  };

  const traceProducts = {
    x: names,
    y: products,
    name: 'Dòng sản phẩm',
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
      storeFilter.innerHTML = hasAllStores ? '<option value="">Tất cả Cửa hàng</option>' : '';
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#TX-${t.transaction_id}</code></td>
        <td>Store ${t.store_id}</td>
        <td><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-light); font-weight: normal;">${t.salesperson || 'System'}</span></td>
        <td><span style="font-size: 12px; color: var(--text-muted);">${formattedDate}</span></td>
        <td><code>${t.sku}</code></td>
        <td>${t.product_name || 'Sản phẩm ' + t.product_id}</td>
        <td><span class="badge">${t.payment_method}</span></td>
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

async function loadInventoryTab() {
  const storeSelect = document.getElementById('inventory-store-select');
  const searchInput = document.getElementById('inventory-search');

  try {
    // 1. Populate store filter
    if (storeSelect.children.length === 0) {
      const stores = await fetchAPI('/api/stores');
      const hasAllStores = currentUser.permissions && currentUser.permissions.includes('view_all_stores');
      
      storeSelect.innerHTML = hasAllStores ? '<option value="">Tất cả Cửa hàng</option>' : '';
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

      searchInput.addEventListener('input', () => {
        clearTimeout(inventorySearchTimeout);
        inventorySearchTimeout = setTimeout(() => {
          loadInventoryStock();
        }, 300);
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
  const search = document.getElementById('inventory-search').value;
  const tbody = document.getElementById('inventory-stock-tbody');
  
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Đang tải dữ liệu kho...</td></tr>';
  
  try {
    const stockItems = await fetchAPI(`/api/inventory?store_id=${storeId}&search=${encodeURIComponent(search)}`);
    tbody.innerHTML = '';
    
    if (stockItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Không tìm thấy sản phẩm nào trong kho.</td></tr>';
      return;
    }

    stockItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
      tr.innerHTML = `
        <td style="padding: 10px;"><code>${item.sku}</code></td>
        <td style="padding: 10px; color: var(--text-light); font-weight: 500;">${item.product_name}</td>
        <td style="padding: 10px;"><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted);">${item.category}</span></td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: ${item.stock_quantity <= 15 ? '#ef4444' : '#10b981'}">
          ${item.stock_quantity}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading inventory stock:', err);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Lỗi tải dữ liệu kho.</td></tr>';
  }
}

async function loadInventoryImports() {
  const storeId = document.getElementById('inventory-store-select').value;
  const tbody = document.getElementById('inventory-imports-tbody');
  
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Đang tải lịch sử nhập...</td></tr>';
  
  try {
    const imports = await fetchAPI(`/api/inventory/imports?store_id=${storeId}`);
    tbody.innerHTML = '';
    
    if (imports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Chưa có lịch sử nhập hàng nào.</td></tr>';
      return;
    }

    imports.forEach(item => {
      const dateStr = new Date(item.import_date).toLocaleDateString('vi-VN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
      tr.innerHTML = `
        <td style="padding: 10px; font-size: 11px; color: var(--text-muted);">${dateStr}</td>
        <td style="padding: 10px;">
          <div style="font-weight: 500;"><code>${item.sku}</code></div>
          <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${item.product_name}</div>
        </td>
        <td style="padding: 10px; text-align: right; font-weight: bold; color: var(--primary-light);">+${item.quantity}</td>
        <td style="padding: 10px; font-size: 12px; color: var(--text-light);">${item.supplier}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading inventory imports:', err);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Lỗi tải lịch sử nhập hàng.</td></tr>';
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

  // Populate SKU list inside modal dropdown
  skuInput.innerHTML = '<option value="">Đang tải danh sách SKU...</option>';
  
  fetchAPI('/api/products?page=1&limit=100')
    .then(res => {
      skuInput.innerHTML = '';
      if (res && res.data) {
        // Find unique SKUs
        const skus = [...new Set(res.data.map(p => `SKU-${p.product_id}`))];
        skus.forEach(sku => {
          const opt = document.createElement('option');
          opt.value = sku;
          opt.textContent = sku;
          skuInput.appendChild(opt);
        });
      }
      if (skuInput.children.length === 0) {
        // Fallback popular SKUs
        const popularSkus = ['SKU-10000', 'SKU-10001', 'SKU-10002', 'SKU-10003', 'SKU-21030', 'SKU-9803', 'SKU-9871', 'SKU-9896', 'SKU-10010'];
        popularSkus.forEach(sku => {
          const opt = document.createElement('option');
          opt.value = sku;
          opt.textContent = sku;
          skuInput.appendChild(opt);
        });
      }
    })
    .catch(e => {
      console.warn('Failed to load SKUs, using fallback:', e);
      skuInput.innerHTML = '';
      const popularSkus = ['SKU-10000', 'SKU-10001', 'SKU-10002', 'SKU-10003', 'SKU-21030', 'SKU-9803', 'SKU-9871', 'SKU-9896', 'SKU-10010'];
      popularSkus.forEach(sku => {
        const opt = document.createElement('option');
        opt.value = sku;
        opt.textContent = sku;
        skuInput.appendChild(opt);
      });
    });

  // Open modal
  btnOpen.addEventListener('click', () => {
    form.reset();
    if (!hasAllStores) {
      storeInput.value = currentUser.store_id || '';
    }
    modal.classList.add('active');
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
    
    const payload = {
      store_id: storeInput.value,
      sku: skuInput.value,
      quantity: document.getElementById('import-qty-input').value,
      supplier: document.getElementById('import-supplier-input').value
    };

    try {
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

// ================= INITIALIZATION & SETUP =================

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

  try {
    const data = await fetchAPI('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ customer_name, age, gender, country })
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

window.deleteDiscount = async function(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa khuyến mãi này không?')) return;
  try {
    const data = await fetchAPI(`/api/discounts/${id}`, { method: 'DELETE' });
    alert(data.message || 'Xóa khuyến mãi thành công!');
    loadDiscountsTab();
  } catch (err) {
    console.error('Error deleting discount:', err);
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
  productModalTitle.textContent = 'Thêm Sản Phẩm Mới';
  document.getElementById('btn-save-product-submit').textContent = 'Thêm mới';
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
  productModalTitle.textContent = 'Cập Nhật Sản Phẩm';
  document.getElementById('btn-save-product-submit').textContent = 'Lưu thay đổi';
  document.getElementById('product-id-input').value = id;
  
  document.getElementById('product-name-input').value = name;
  document.getElementById('product-category-input').value = category;
  document.getElementById('product-subcategory-input').value = subCategory;
  document.getElementById('product-color-input').value = color;
  document.getElementById('product-description-input').value = description;
  document.getElementById('product-image-input').value = imageUrl;

  productModal.classList.add('active');
};

window.deleteProduct = async function(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này không?')) return;
  try {
    const data = await fetchAPI(`/api/products/${id}`, { method: 'DELETE' });
    alert(data.message || 'Xóa sản phẩm thành công!');
    loadProductsTab();
  } catch (err) {
    console.error('Error deleting product:', err);
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
  if (confirm('Ông có chắc chắn muốn đăng xuất?')) {
    logout();
  }
});

// ================= IT ADMIN MANAGEMENT & MFA CLIENT FUNCTIONS =================

async function loadAdminUsersTab() {
  try {
    const users = await fetchAPI('/api/admin/users');
    const stores = await fetchAPI('/api/stores');
    
    const storeSelect = document.getElementById('admin-user-store-input');
    storeSelect.innerHTML = '<option value="">Không gán (Global)</option>';
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
      const storeName = u.store_id ? (stores.find(s => s.store_id === u.store_id)?.store_name || `Store #${u.store_id}`) : 'Global (Tất cả)';
      const mfaText = u.mfa_enabled ? '<span class="mfa-status-active"><i class="fa-solid fa-circle-check"></i> Đang bật</span>' : '<span class="mfa-status-inactive"><i class="fa-solid fa-circle-xmark"></i> Chưa bật</span>';
      
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
  document.getElementById('admin-user-modal-title').textContent = 'Cập nhật tài khoản';
  document.getElementById('admin-user-id-input').value = id;
  document.getElementById('admin-user-username-input').value = username;
  document.getElementById('admin-user-username-input').disabled = true;
  document.getElementById('admin-user-password-input').placeholder = 'Bỏ trống nếu giữ nguyên mật khẩu';
  document.getElementById('admin-user-password-input').required = false;
  document.getElementById('admin-user-role-input').value = role;
  document.getElementById('admin-user-store-input').value = storeId || '';
  document.getElementById('admin-user-modal').classList.add('active');
};

window.deleteAdminUser = async function(id) {
  if (id === currentUser.id) {
    alert('Không thể tự xóa tài khoản của chính bạn!');
    return;
  }
  if (!confirm('Bạn có chắc chắn muốn xóa tài khoản này không?')) return;
  try {
    const data = await fetchAPI(`/api/admin/users/${id}`, { method: 'DELETE' });
    alert(data.message || 'Xóa thành công');
    loadAdminUsersTab();
  } catch (err) {
    console.error('Error deleting user:', err);
  }
};

window.resetAdminUserMfa = async function(id) {
  if (!confirm('Bạn có chắc muốn tắt và reset MFA cho tài khoản này không?')) return;
  try {
    const data = await fetchAPI(`/api/admin/users/${id}/reset-mfa`, { method: 'POST' });
    alert(data.message || 'Reset MFA thành công');
    loadAdminUsersTab();
  } catch (err) {
    console.error('Error resetting MFA:', err);
  }
};

let currentPermissionsMap = {};

async function loadAdminPermissionsTab() {
  try {
    currentPermissionsMap = await fetchAPI('/api/admin/permissions');
    
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

    const roles = Object.keys(currentPermissionsMap);

    const headerRow = document.getElementById('permissions-table-header');
    headerRow.innerHTML = '<th style="text-align: left; padding: 15px;">Quyền Hạn / Vai trò</th>';
    roles.forEach(role => {
      const th = document.createElement('th');
      th.style.padding = '15px';
      th.style.textAlign = 'center';
      th.innerHTML = `<span class="badge">${role}</span>`;
      headerRow.appendChild(th);
    });

    const tbody = document.getElementById('permissions-table-body');
    tbody.innerHTML = '';

    permissionGroups.forEach(group => {
      // Category row
      const catTr = document.createElement('tr');
      catTr.innerHTML = `
        <td colspan="${roles.length + 1}" style="background: rgba(255,255,255,0.02); font-weight: 700; padding: 12px 18px; border-left: 4px solid ${group.color}; color: ${group.color}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="fa-solid ${group.icon}" style="margin-right: 8px;"></i> ${group.category}
        </td>
      `;
      tbody.appendChild(catTr);

      // Permission rows
      group.perms.forEach(perm => {
        const tr = document.createElement('tr');
        
        let html = `<td style="padding: 12px 18px; border-left: 4px solid ${group.color}44;">
          <div style="font-weight: 600; color: var(--text-main); font-size: 13px;">${perm.name}</div>
          <small style="color: var(--text-muted); font-family: monospace; font-size: 10px;">${perm.key}</small>
        </td>`;
        
        roles.forEach(role => {
          const checked = currentPermissionsMap[role].includes(perm.key) ? 'checked' : '';
          html += `<td style="text-align: center; padding: 12px;">
            <input type="checkbox" class="permission-checkbox" data-role="${role}" data-perm="${perm.key}" ${checked}>
          </td>`;
        });
        
        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    });

  } catch (err) {
    console.error('Error loading permissions tab:', err);
  }
}

document.getElementById('btn-save-permissions').addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('.permission-checkbox');
  const updatedPermissions = {};
  
  Object.keys(currentPermissionsMap).forEach(role => {
    updatedPermissions[role] = [];
  });

  checkboxes.forEach(cb => {
    const role = cb.getAttribute('data-role');
    const perm = cb.getAttribute('data-perm');
    if (cb.checked) {
      updatedPermissions[role].push(perm);
    }
  });

  try {
    const data = await fetchAPI('/api/admin/permissions', {
      method: 'PUT',
      body: JSON.stringify(updatedPermissions)
    });
    alert(data.message || 'Lưu cấu hình thành công!');
    
    if (updatedPermissions[currentUser.role]) {
      currentUser.permissions = updatedPermissions[currentUser.role];
      localStorage.setItem('user', JSON.stringify(currentUser));
      configurePermissionBasedVisibility();
    }
    
    loadAdminPermissionsTab();
  } catch (err) {
    alert('Lỗi lưu phân quyền: ' + err.message);
  }
});

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
      const formattedTime = new Date(l.timestamp).toLocaleString('vi-VN');
      
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
        <td>${l.details}</td>
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
  document.getElementById('admin-user-modal-title').textContent = 'Thêm Tài Khoản Mới';
  document.getElementById('admin-user-id-input').value = '';
  document.getElementById('admin-user-username-input').value = '';
  document.getElementById('admin-user-username-input').disabled = false;
  document.getElementById('admin-user-password-input').value = '';
  document.getElementById('admin-user-password-input').placeholder = 'Nhập mật khẩu...';
  document.getElementById('admin-user-password-input').required = true;
  document.getElementById('admin-user-role-input').value = 'Sales Staff';
  
  try {
    const stores = await fetchAPI('/api/stores');
    const storeSelect = document.getElementById('admin-user-store-input');
    storeSelect.innerHTML = '<option value="">Không gán (Global)</option>';
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

function renderTxCustomerOptions(items) {
  txCustomerInput.innerHTML = '<option value="">-- Chọn khách hàng --</option>';
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
    txSkuInput.innerHTML = '<option value="">Không tìm thấy sản phẩm nào trong kho</option>';
    return;
  }
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.sku;
    opt.textContent = `${item.sku} - ${item.product_name} (Tồn kho: ${item.stock_quantity})`;
    txSkuInput.appendChild(opt);
  });
}

async function loadStoreInventoryForTx(storeId) {
  txSkuInput.innerHTML = '<option value="">Đang tải hàng tồn kho...</option>';
  try {
    const inventory = await fetchAPI(`/api/inventory?store_id=${storeId}`);
    activeTxInventory = inventory || [];
    renderTxSkuOptions(activeTxInventory);
  } catch (err) {
    console.error('Failed to load store inventory for tx modal:', err);
    txSkuInput.innerHTML = '<option value="">Lỗi tải hàng tồn kho</option>';
  }
}

// Store input change listener
if (txStoreInput) {
  txStoreInput.addEventListener('change', (e) => {
    txSkuSearch.value = '';
    loadStoreInventoryForTx(e.target.value);
  });
}

// Search inputs event listeners
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

if (txSkuSearch) {
  txSkuSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = activeTxInventory.filter(item => 
      item.sku.toLowerCase().includes(query) || 
      item.product_name.toLowerCase().includes(query)
    );
    renderTxSkuOptions(filtered);
  });
}

// Initialize transaction modal triggers
if (btnAddTx) {
  btnAddTx.addEventListener('click', async () => {
    txForm.reset();
    txQtyInput.value = 1;
    txPriceInput.value = '';
    if (txCustomerSearch) txCustomerSearch.value = '';
    if (txSkuSearch) txSkuSearch.value = '';

    try {
      // 1. Fetch stores
      const stores = await fetchAPI('/api/stores');
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

      // 2. Fetch customers (up to 300)
      const customersRes = await fetchAPI('/api/customers?page=1&limit=300');
      activeTxCustomers = customersRes.data || [];
      renderTxCustomerOptions(activeTxCustomers);

      // 3. Load SKUs for the initially selected store
      await loadStoreInventoryForTx(txStoreInput.value);

      txModal.classList.add('active');
    } catch (err) {
      console.error('Error opening transaction modal:', err);
      alert('Không thể mở màn hình tạo giao dịch. Vui lòng kiểm tra quyền truy cập.');
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

    if (!txCustomerInput.value) {
      alert('Vui lòng chọn khách hàng.');
      return;
    }
    if (!txSkuInput.value || txSkuInput.value === 'Không tìm thấy sản phẩm nào trong kho') {
      alert('Vui lòng chọn SKU sản phẩm hợp lệ.');
      return;
    }

    const payload = {
      store_id: parseInt(txStoreInput.value),
      customer_id: parseInt(txCustomerInput.value),
      sku: txSkuInput.value,
      quantity: parseInt(txQtyInput.value),
      price: parseFloat(txPriceInput.value),
      payment_method: txPaymentInput.value
    };

    try {
      const res = await fetchAPI('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      txModal.classList.remove('active');
      alert(res.message || 'Tạo giao dịch thành công!');
      
      // Reload Transactions tab if active
      if (activeTab === 'transactions') {
        loadTransactionsTab();
      }
      
      // Reload Inventory if active
      if (activeTab === 'inventory') {
        loadInventoryTab();
      }
      
      // Reload dashboard cache/warnings
      if (activeForecastStoreId === payload.store_id) {
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
      alert(err.message || 'Lỗi khi tạo giao dịch. Vui lòng kiểm tra lại tồn kho.');
    }
  });
}

// Run auth check on page load
checkAuth();
