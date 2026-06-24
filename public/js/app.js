// ================= GLOBAL STATE =================
let token = localStorage.getItem('token') || null;
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let activeTab = 'dashboard';
let map = null;
let storesData = [];

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
  document.body.className = 'dark-mode role-' + currentUser.role.toLowerCase().replace(' ', '-');
  
  // Initialize UI components based on roles
  configureRoleBasedVisibility();
  
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
  
  showLogin();
}

// Hide elements depending on user role
function configureRoleBasedVisibility() {
  const role = currentUser.role;
  
  // Hide navbar tabs for Sales Staff
  const customersTab = document.getElementById('nav-customers');
  const discountsTab = document.getElementById('nav-discounts');
  const employeesTab = document.getElementById('nav-employees');
  const storesTab = document.getElementById('nav-stores');

  // CRUD buttons
  const btnAddCustomer = document.getElementById('btn-add-customer');
  const btnAddDiscount = document.getElementById('btn-add-discount');
  const btnAddEmployee = document.getElementById('btn-add-employee');
  const btnAddProduct = document.getElementById('btn-add-product');

  if (role === 'Sales Staff') {
    customersTab.classList.add('hidden');
    discountsTab.classList.add('hidden');
    employeesTab.classList.add('hidden');
    storesTab.classList.add('hidden');
    
    // Hide store filters in other views, as they only belong to their store
    document.querySelectorAll('.select-store-container').forEach(el => el.classList.add('hidden'));

    // Hide CRUD buttons
    btnAddCustomer && btnAddCustomer.classList.add('hidden');
    btnAddDiscount && btnAddDiscount.classList.add('hidden');
    btnAddEmployee && btnAddEmployee.classList.add('hidden');
    btnAddProduct && btnAddProduct.classList.add('hidden');
  } else if (role === 'Store Manager') {
    customersTab.classList.remove('hidden');
    discountsTab.classList.remove('hidden');
    employeesTab.classList.remove('hidden');
    storesTab.classList.add('hidden'); // Managers can't see store list/global overview
    
    document.querySelectorAll('.select-store-container').forEach(el => el.classList.add('hidden'));

    // Show CRUD buttons
    btnAddCustomer && btnAddCustomer.classList.remove('hidden');
    btnAddDiscount && btnAddDiscount.classList.remove('hidden');
    btnAddEmployee && btnAddEmployee.classList.remove('hidden');
    btnAddProduct && btnAddProduct.classList.remove('hidden');
  } else {
    // Director
    customersTab.classList.remove('hidden');
    discountsTab.classList.remove('hidden');
    employeesTab.classList.remove('hidden');
    storesTab.classList.remove('hidden');
    
    document.querySelectorAll('.select-store-container').forEach(el => el.classList.remove('hidden'));

    // Show CRUD buttons
    btnAddCustomer && btnAddCustomer.classList.remove('hidden');
    btnAddDiscount && btnAddDiscount.classList.remove('hidden');
    btnAddEmployee && btnAddEmployee.classList.remove('hidden');
    btnAddProduct && btnAddProduct.classList.remove('hidden');
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
    transactions: 'Lịch sử Giao dịch'
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
  
  const labels = timeline.map(t => `W${t.week}/${t.year}`);
  const predictedVals = timeline.map(t => t.predicted);
  const actualVals = timeline.map(t => t.actual); // Contains nulls for future weeks

  // Set stats card next week demand
  // Find first week where actual is null (this represents the immediate next week to be forecasted)
  const nextWeekIndex = timeline.findIndex(t => t.actual === null);
  const nextWeekForecast = nextWeekIndex !== -1 ? predictedVals[nextWeekIndex] : predictedVals[0];
  document.getElementById('forecast-next-week-qty').textContent = nextWeekForecast;

  const traceActual = {
    x: labels,
    y: actualVals,
    name: 'Thực tế (Actual)',
    type: 'scatter',
    mode: 'lines+markers',
    line: { color: '#10b981', width: 3 }, // Green
    marker: { size: 6 }
  };

  const tracePredicted = {
    x: labels,
    y: predictedVals,
    name: 'Dự báo (Forecast)',
    type: 'scatter',
    mode: 'lines+markers',
    line: { color: '#818cf8', width: 3, dash: 'dash' }, // Dotted Indigo
    marker: { size: 6 }
  };

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f3f4f6', family: 'Inter, sans-serif' },
    margin: { t: 30, r: 20, b: 40, l: 40 },
    legend: { orientation: 'h', y: -0.2 },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)', tickfont: { size: 10 } },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)', title: 'Số lượng sản phẩm' }
  };

  Plotly.newPlot('forecast-chart', [traceActual, tracePredicted], layout, { responsive: true, displayModeBar: false });
}

// Event handler for SKU selector change
document.getElementById('forecast-sku-selector').addEventListener('change', (e) => {
  renderForecastChart(e.target.value);
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

    const { page, limit, payment_method } = pagState.transactions;
    const storeId = storeFilter.value;
    
    const res = await fetchAPI(`/api/transactions?page=${page}&limit=${limit}&store_id=${storeId}&payment_method=${payment_method}`);
    
    const tbody = document.querySelector('#transactions-table tbody');
    tbody.innerHTML = '';

    res.data.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>#TX-${t.transaction_id}</code></td>
        <td>Store ${t.store_id}</td>
        <td><code>${t.sku}</code></td>
        <td>${t.product_name || 'Sản phẩm ' + t.product_id}</td>
        <td>${t.date}</td>
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

  try {
    const data = await fetchAPI('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: usernameVal, password: passwordVal })
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    
    // Clear form
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    
    showApp();
  } catch (err) {
    loginError.textContent = err.message || 'Đăng nhập thất bại. Vui lòng thử lại.';
  }
});

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

    if (currentUser.role !== 'Director') {
      discountStoreInput.value = currentUser.store_id;
      discountStoreInput.disabled = true;
      employeeStoreInput.value = currentUser.store_id;
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

// Run auth check on page load
checkAuth();
