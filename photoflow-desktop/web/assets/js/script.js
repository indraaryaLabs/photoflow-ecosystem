// Initialize Lucide Icons
lucide.createIcons();

// ---------------------------------------------------------
// HYBRID SAAS: LOGIN SYSTEM & OFFLINE DETECTION
// ---------------------------------------------------------
let appIsOffline = false;

/**
 * Show or hide the login overlay.
 */
function setLoginOverlayVisible(visible) {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    if (visible) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
    } else {
        overlay.classList.add('hidden');
        // After transition completes, remove from flow
        setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }
    lucide.createIcons();
}

/**
 * Show the offline badge & apply feature gating.
 */
function applyOfflineMode(offline) {
    appIsOffline = offline;
    const badge = document.getElementById('offline-badge');
    if (badge) {
        badge.style.display = offline ? 'flex' : 'none';
        lucide.createIcons();
    }

    // Feature Gating: style cloud buttons but keep them clickable for interceptor
    const cloudButtons = [
        'btn-drive-upload', 'btn-sync-selections', 'nav-cloud-workspace', 'btn-drive-account',
        'btn-fetch-selections', 'btn-open-web-admin'
    ];

    cloudButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;

        if (offline) {
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.style.filter = 'grayscale(80%)';
            btn.dataset.requiresOnline = 'true';
        } else {
            btn.style.opacity = '';
            btn.style.cursor = '';
            btn.style.filter = '';
            delete btn.dataset.requiresOnline;
        }
    });
}

/**
 * Handle the login button click.
 */
async function handleLogin() {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const loginBtn = document.getElementById('btn-login');
    const loginBtnText = document.getElementById('login-btn-text');
    const loginError = document.getElementById('login-error');
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = 'Mohon isi email dan password.';
        loginError.style.display = 'block';
        return;
    }

    // Disable button and show loading
    loginBtn.disabled = true;
    loginBtnText.textContent = 'Signing in...';
    loginError.style.display = 'none';

    try {
        const result = await eel.login_to_server(email, password)();

        if (result && result.success) {
            // Save token to localStorage for offline fallback
            // Penanda saja, bukan tokennya. Access token JWT tidak pernah
            // menyeberang ke konteks browser: yang memegangnya Python, dan
            // refresh token-nya ada di keyring OS. Yang dibutuhkan di sini
            // hanya satu hal — apakah pernah ada sesi yang berhasil, supaya
            // mode offline tahu boleh melanjutkan tanpa login.
            localStorage.setItem('has_session', '1');
            localStorage.setItem('user_id', result.user_id);
            localStorage.setItem('user_email', email);

            // Hide login overlay
            setLoginOverlayVisible(false);
            applyOfflineMode(false);
            showAdvancedToast(`Welcome back, ${email}!`, 'success');

            // Sync Drive indicator now that we have a valid session
            await updateDriveAuthUI();
        } else if (result && result.error === 'offline') {
            // OFFLINE: Try local token fallback
            const savedToken = localStorage.getItem('has_session');
            if (savedToken) {
                setLoginOverlayVisible(false);
                applyOfflineMode(true);
                showAdvancedToast('Mode Offline: Menggunakan sesi tersimpan. Beberapa fitur cloud dinonaktifkan.', 'warning');
            } else {
                loginError.textContent = 'Tidak ada koneksi internet dan tidak ada sesi tersimpan. Hubungkan internet untuk login pertama kali.';
                loginError.style.display = 'block';
            }
        } else {
            loginError.textContent = result?.message || 'Login gagal. Periksa email dan password Anda.';
            loginError.style.display = 'block';
        }
    } catch (err) {
        console.error('[PhotoFlow] Login error:', err);
        // If Eel call itself fails, try offline fallback
        const savedToken = localStorage.getItem('has_session');
        if (savedToken) {
            setLoginOverlayVisible(false);
            applyOfflineMode(true);
            showAdvancedToast('Mode Offline: Menggunakan sesi tersimpan.', 'warning');
        } else {
            loginError.textContent = 'Koneksi ke backend gagal. Pastikan aplikasi berjalan dengan benar.';
            loginError.style.display = 'block';
        }
    } finally {
        loginBtn.disabled = false;
        loginBtnText.textContent = 'Sign In';
    }
}

/**
 * Initialize the Hybrid SaaS auth system on page load.
 */
async function initHybridAuth() {
    try {
        // Check if we're offline
        const isOffline = await eel.check_offline_status()();
        
        if (!isOffline) {
            // ONLINE: Check if already logged in on the backend
            const loginState = await eel.get_login_state()();
            if (loginState && loginState.is_logged_in) {
                // Sesi dipulihkan Python dari refresh token di keyring OS, jadi
                // identitas yang tersimpan di sini disamakan dengan sesi yang
                // benar-benar berjalan alih-alih dibiarkan sebagai sisa login
                // sebelumnya.
                if (loginState.user_id) localStorage.setItem('user_id', loginState.user_id);
                if (loginState.email) localStorage.setItem('user_email', loginState.email);
                setLoginOverlayVisible(false);
                applyOfflineMode(false);
                return;
            }
            // Not logged in — show login overlay
            setLoginOverlayVisible(true);
        } else {
            // OFFLINE: Check localStorage for saved token
            const savedToken = localStorage.getItem('has_session');
            if (savedToken) {
                setLoginOverlayVisible(false);
                applyOfflineMode(true);
            } else {
                // No saved token + offline = must show login (will fail, but user sees the form)
                setLoginOverlayVisible(true);
                applyOfflineMode(true);
            }
        }
    } catch (err) {
        console.error('[PhotoFlow] Auth init error:', err);
        // Fallback: try localStorage
        const savedToken = localStorage.getItem('has_session');
        if (savedToken) {
            setLoginOverlayVisible(false);
            applyOfflineMode(true);
        } else {
            setLoginOverlayVisible(true);
        }
    }
}

/**
 * Manually enable Offline Mode — bypasses login and shows floating widget.
 */
function enableOfflineMode() {
    appIsOffline = true;
    setLoginOverlayVisible(false);

    // Style cloud features as disabled but keep clickable for interceptor
    const cloudFeatures = ['nav-cloud-workspace', 'btn-fetch-selections', 'btn-open-web-admin', 'btn-drive-account', 'btn-sync-selections'];
    cloudFeatures.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.opacity = '0.4';
            el.style.cursor = 'not-allowed';
            el.style.filter = 'grayscale(80%)';
            el.dataset.requiresOnline = 'true';
        }
    });

    // Show the floating offline widget (use animated version if available)
    if (typeof window._showOfflineWidget === 'function') {
        window._showOfflineWidget();
    } else {
        const widget = document.getElementById('offline-widget');
        if (widget) {
            widget.classList.remove('hidden');
            widget.classList.add('show-widget');
        }
    }
    lucide.createIcons();
}

// Wire up login button, Enter key, and Offline Mode
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('btn-login');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }

    const loginPassword = document.getElementById('login-password');
    const loginEmail = document.getElementById('login-email');
    
    if (loginPassword) {
        loginPassword.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }
    if (loginEmail) {
        loginEmail.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }

    // Offline Mode bypass button
    const btnOfflineMode = document.getElementById('btn-offline-mode');
    if (btnOfflineMode) {
        btnOfflineMode.addEventListener('click', enableOfflineMode);
    }

    // ── Offline Widget Setup ───────────────────────────────
    const offlineWidget = document.getElementById('offline-widget');
    const widgetHeader = document.getElementById('offline-widget-header');

    // Show widget with bounce-in animation
    function showOfflineWidget() {
        if (!offlineWidget) return;
        offlineWidget.classList.remove('hidden');
        setTimeout(() => {
            offlineWidget.classList.add('show-widget');
        }, 10);
    }

    // Hide widget with fade-out, then add hidden class
    function hideOfflineWidget() {
        if (!offlineWidget) return;
        offlineWidget.classList.remove('show-widget');
        setTimeout(() => {
            offlineWidget.classList.add('hidden');
        }, 400);
    }

    // Make showOfflineWidget available to enableOfflineMode
    window._showOfflineWidget = showOfflineWidget;

    // ── Drag Logic ────────────────────────────────────────
    let isDraggingWidget = false, dragOffsetX, dragOffsetY;

    if (widgetHeader && offlineWidget) {
        widgetHeader.addEventListener('mousedown', (e) => {
            isDraggingWidget = true;
            widgetHeader.style.cursor = 'grabbing';
            const rect = offlineWidget.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDraggingWidget) return;
            offlineWidget.style.left = (e.clientX - dragOffsetX) + 'px';
            offlineWidget.style.top = (e.clientY - dragOffsetY) + 'px';
            offlineWidget.style.right = 'auto';
            offlineWidget.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            isDraggingWidget = false;
            if (widgetHeader) widgetHeader.style.cursor = 'grab';
        });
    }

    // ── Close Button ──────────────────────────────────────
    document.getElementById('btn-close-offline-widget')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideOfflineWidget();
    });

    // ── Relogin Button ────────────────────────────────────
    document.getElementById('btn-relogin-offline')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideOfflineWidget();
        appIsOffline = false;
        applyOfflineMode(false);
        setLoginOverlayVisible(true);
    });

    // ── Offline Click Interceptor (capture phase) ─────────
    document.addEventListener('click', (e) => {
        if (!appIsOffline) return;
        const requiresOnlineEl = e.target.closest('[data-requires-online="true"]');
        if (requiresOnlineEl) {
            e.preventDefault();
            e.stopPropagation();
            showOfflineWidget();
            if (offlineWidget) {
                offlineWidget.classList.add('shake-anim');
                setTimeout(() => offlineWidget.classList.remove('shake-anim'), 300);
            }
        }
    }, true);
});

// ---------------------------------------------------------
// THEME MANAGEMENT (Light / Dark Mode)
// ---------------------------------------------------------
const themeBtn = document.getElementById('btn-theme-toggle');
const themeIcon = themeBtn.querySelector('i');

// Check local storage or system preference
const savedTheme = localStorage.getItem('theme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    updateThemeIcon('dark');
}

themeBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    if (newTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
});

function updateThemeIcon(theme) {
    // Re-render icon based on theme
    themeBtn.innerHTML = theme === 'dark'
        ? '<i data-lucide="sun"></i>'
        : '<i data-lucide="moon"></i>';
    lucide.createIcons();
}

// ---------------------------------------------------------
// STATE & DATA
// ---------------------------------------------------------
const state = {
    selectedPhotos: new Set(),
    totalPhotos: 0,
    sourcePath: '',
    destPath: '',
    scannedFiles: [],       // all files discovered so far
    validFiles: [],         // filtered files awaiting rendering
    isScanning: false,      // true while a scan is in progress
    fileCount: 0,           // running counter during scan
    thumbnailQueue: [],     // slots waiting for thumbnail fetch
    currentPage: 1,
    pageSize: 100,
    isGlobalSelected: false
};

const gridContainer = document.getElementById('photo-grid');
const counterText = document.getElementById('selection-counter');
const btnCopy = document.getElementById('btn-copy');
const btnMove = document.getElementById('btn-move');
const btnDriveUpload = document.getElementById('btn-drive-upload');
const btnSelectAll = document.getElementById('btn-select-all');
const navLocalWorkspace = document.getElementById('nav-local-workspace');
const navCloudWorkspace = document.getElementById('nav-cloud-workspace');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-message');



    // New UI Elements for Tabs and Status
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const bulkTextarea = document.getElementById('bulk-textarea');

// New Elements for Refinements
const zoomSlider = document.getElementById('zoom-slider');
const btnClearBulk = document.getElementById('btn-clear-bulk');
const bulkValidation = document.getElementById('bulk-validation');
const btnCancel = document.getElementById('btn-cancel');
let processTimeout = null;

// Comprehensive list of pro formats for the mock generator
const formats = ['ARW', 'CR2', 'CR3', 'NEF', 'NRW', 'RAF', 'RW2', 'ORF', 'PEF', 'DNG', 'JPG'];

// ---------------------------------------------------------
// UI CONTROL LOGIC (ZOOM, CLEAR, FILTER PANEL)
// ---------------------------------------------------------
zoomSlider.addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--grid-min-width', `${e.target.value}px`);
});

btnClearBulk.addEventListener('click', () => {
    bulkTextarea.value = '';
    bulkTextarea.dispatchEvent(new Event('input')); // trigger validation update
});

const btnClearLog = document.getElementById('btn-clear-log');
if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
        const statusList = document.getElementById('bulk-status-list');
        if (statusList) {
            statusList.innerHTML = '';
        }
    });
}

// Toggle Filter Dropdown
const btnFormatFilter = document.getElementById('btn-format-filter');
const formatFilterPanel = document.getElementById('format-filter-panel');

btnFormatFilter.addEventListener('click', (e) => {
    e.stopPropagation();
    formatFilterPanel.classList.toggle('show');
});

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (!formatFilterPanel.contains(e.target) && e.target !== btnFormatFilter) {
        formatFilterPanel.classList.remove('show');
    }
});

// Prevent panel from closing when clicking inside
formatFilterPanel.addEventListener('click', (e) => {
    e.stopPropagation();
});

// ---------------------------------------------------------
// FORMAT FILTERING LOGIC
// ---------------------------------------------------------
const formatCheckboxes = document.querySelectorAll('#format-checkboxes input[type="checkbox"]');

function applyFormatFilters() {
    // Get array of currently checked format values
    const checkedFormats = Array.from(formatCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

    const searchInput = document.getElementById('main-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Local grid filtering (Triggers full data pipeline rebuild)
    const driveExplorerView = document.getElementById('drive-explorer-view');
    if (!driveExplorerView || driveExplorerView.style.display === 'none') {
        state.currentPage = 1;
        renderVisualSelect();
        return; // Early return for Local Grid
    }

    // Cloud Drive grid filtering
    if (driveExplorerView && driveExplorerView.style.display !== 'none') {
        const driveRows = document.querySelectorAll('.drive-row');
        driveRows.forEach(row => {
            const isFile = row.dataset.isFolder !== 'true';
            const nameEl = row.querySelector('span[style*="font-weight: 500"]');
            const name = nameEl ? nameEl.textContent.toLowerCase() : '';
            const matchesQuery = query === '' || name.includes(query);
            
            if (isFile) {
                const format = row.dataset.format;
                const matchesFormat = checkedFormats.includes(format) || format === 'IMAGE';
                
                if (matchesFormat && matchesQuery) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                    if (state.selectedDriveFiles.has(row.dataset.id)) {
                        state.selectedDriveFiles.delete(row.dataset.id);
                        row.classList.remove('selected');
                    }
                }
            } else {
                // Folder logic (doesn't have format filter, but CAN be searched)
                if (matchesQuery) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            }
        });
    }
}

// Attach listeners to all checkboxes in the panel
formatCheckboxes.forEach(cb => {
    cb.addEventListener('change', applyFormatFilters);
});

const mainSearchInput = document.getElementById('main-search-input');
if (mainSearchInput) {
    mainSearchInput.addEventListener('input', () => {
        applyFormatFilters();
        updateActionState();
    });
}

// ---------------------------------------------------------
// TAB LOGIC
// ---------------------------------------------------------
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        document.getElementById('drive-explorer-view').style.display = 'none';
        
        const zoomControl = document.querySelector('.zoom-control');
        if (zoomControl) zoomControl.style.display = '';
        
        // Hide trash button when leaving Drive mode
        const btnTrash = document.getElementById('btn-trash-selected');
        if (btnTrash) btnTrash.style.display = 'none';

        // Master Sidebar integration
        if (navLocalWorkspace) navLocalWorkspace.classList.add('active');
        if (navCloudWorkspace) navCloudWorkspace.classList.remove('active');

        // Show tabs header
        const tabsHeader = document.querySelector('.tabs-header');
        if (tabsHeader) tabsHeader.style.display = '';

        btn.classList.add('active');
        const targetId = btn.dataset.target;
        document.getElementById(targetId).classList.add('active');
        
        const tabVisual = document.getElementById('tab-visual');
        const tabBulk = document.getElementById('tab-bulk');
        
        if (targetId === 'tab-visual') {
            if (tabVisual) tabVisual.style.display = 'flex';
            if (tabBulk) tabBulk.style.display = 'none';
        } else if (targetId === 'tab-bulk') {
            if (tabVisual) tabVisual.style.display = 'none';
            if (tabBulk) tabBulk.style.display = 'flex';
        }

        // Reset UI to Local mode
        document.getElementById('btn-dest-folder').style.display = 'flex';
        document.getElementById('copy-text-main').innerText = 'Copy';
        document.getElementById('copy-text-sub').innerText = 'Selected';
        document.getElementById('move-text-main').innerText = 'Move';
        document.getElementById('move-text-sub').innerText = 'Selected';

        // Reset Sync button UI to Upload mode
        const syncText = document.getElementById('btn-sync-text');
        const syncIcon = document.getElementById('btn-sync-icon');
        if (syncText && syncIcon) {
            syncText.innerText = "Upload to Google Drive";
            syncIcon.setAttribute('data-lucide', 'cloud-upload');
            lucide.createIcons();
        }

        // Refresh action state when switching modes
        updateActionState();
    });
});

bulkTextarea.addEventListener('input', () => {
    let rawLines = bulkTextarea.value.split('\n');
    let cleanLines = [];
    let validCount = 0;
    let invalidCount = 0;
    
    if (rawLines.length === 1 && rawLines[0].trim() === '') {
        bulkValidation.textContent = 'Waiting for input...';
        bulkValidation.className = 'validation-text';
        if (document.querySelector('.tab-btn[data-target="tab-bulk"]')?.classList.contains('active')) {
            updateActionState();
        }
        return;
    }

    rawLines.forEach(line => {
        // 1. Bersihkan numbering (1., 2), -, *) dan spasi awal/akhir
        let cleanName = line.replace(/^(\d+[\.\)]\s*|[-\*]\s*)/, '').trim();
        
        if (!cleanName) return; // Lewati baris kosong
        
        // 2. Abaikan baris "Junk" (size metadata atau ektensi tanpa file)
        if (cleanName.match(/^\d+(\.\d+)?\s*(kb|mb|gb)$/i) || cleanName.match(/^[a-z0-9]{2,4}$/i)) {
            return; 
        }
        
        cleanLines.push(cleanName);
        
        // 3. Validasi Eksistensi (Cross-reference dengan file lokal yang sudah di-scan)
        // state.scannedFiles holds {filename, path}
        const fileExists = state.scannedFiles && state.scannedFiles.some(f => f.filename.toLowerCase() === cleanName.toLowerCase());
        
        if (fileExists) {
            validCount++;
        } else {
            invalidCount++;
        }
    });

    if (invalidCount > 0) {
        bulkValidation.innerHTML = `Found <span style="color:#10b981; font-weight: 500;">${validCount} valid files</span>, <span style="color:#ef4444; font-weight: 500;">${invalidCount} not found</span>.`;
        bulkValidation.className = 'validation-text warning';
    } else {
        bulkValidation.innerHTML = `Found <span style="color:#10b981; font-weight: 500;">${validCount} valid files</span> in workspace.`;
        bulkValidation.className = 'validation-text success';
    }
    
    // (Opsional) Langsung bersihkan isi text area:
    // Peringatan: Aktifkan ini bisa menggeser kursor user saat mengetik manual
    // bulkTextarea.value = cleanLines.join('\n');

    if (document.querySelector('.tab-btn[data-target="tab-bulk"]')?.classList.contains('active')) {
        updateActionState();
    }
});

function formatBulkText() {
    let rawLines = bulkTextarea.value.split('\n');
    let cleanLines = [];
    
    rawLines.forEach(line => {
        // Bersihkan angka penomoran (1., 2), -, *)
        let cleanName = line.replace(/^(\d+[\.\)]\s*|[-\*]\s*)/, '').trim();
        if (!cleanName) return; 
        // Abaikan baris size (MB/KB) atau ekstensi kosong
        if (cleanName.match(/^\d+(\.\d+)?\s*(kb|mb|gb)$/i) || cleanName.match(/^[a-z0-9]{2,4}$/i)) return; 
        
        cleanLines.push(cleanName);
    });
    
    // Update textarea value dengan teks bersih
    bulkTextarea.value = cleanLines.join('\n');
    
    // Trigger event input untuk mengupdate hitungan indikator
    bulkTextarea.dispatchEvent(new Event('input'));
}

// Eksekusi format sesaat setelah user paste (gunakan setTimeout kecil agar teks masuk dulu)
bulkTextarea.addEventListener('paste', () => {
    setTimeout(formatBulkText, 10);
});

// Eksekusi juga saat kotak kehilangan fokus (jaga-jaga)
bulkTextarea.addEventListener('blur', formatBulkText);

// ---------------------------------------------------------
// SELECTION LOGIC
// ---------------------------------------------------------
function toggleSelection(id, cardElement) {
    if (state.selectedPhotos.has(id)) {
        state.selectedPhotos.delete(id);
        cardElement.classList.remove('selected');
    } else {
        state.selectedPhotos.add(id);
        cardElement.classList.add('selected');
    }
    updateActionState();
}

function updateActionState() {
    const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
    const driveExplorerView = document.getElementById('drive-explorer-view');
    const isDriveMode = driveExplorerView && driveExplorerView.style.display !== 'none';
    
    let hasSelection = false;
    let countText = "";

    if (isDriveMode) {
        const count = state.selectedDriveFiles.size;
        hasSelection = count > 0;
        countText = `Actions (${count} Selected)`;
    } else if (isBulkMode) {
        const text = bulkTextarea.value.trim();
        // Count non-empty items separated by comma or newline
        const rawItems = text ? text.split(/[\n,]+/).map(i => i.trim()).filter(i => i) : [];
        const count = new Set(rawItems).size;
        hasSelection = count > 0;
        countText = `Actions (${count} Parsed)`;
    } else {
        const count = state.selectedPhotos.size;
        hasSelection = count > 0;
        countText = `Actions (${count} Selected)`;
        // Update Select All button text based on visible cards
        const visibleCards = document.querySelectorAll('.photo-card:not([style*="display: none"])');
        const allVisibleSelected = visibleCards.length > 0 &&
            Array.from(visibleCards).every(c => state.selectedPhotos.has(c.dataset.id));
        btnSelectAll.textContent = allVisibleSelected ? "Deselect All" : "Select All";
    }

    counterText.textContent = countText;
    btnCopy.disabled = !hasSelection;
    btnMove.disabled = !hasSelection;
    btnDriveUpload.disabled = !hasSelection;
    
    const btnTrash = document.getElementById('btn-trash-selected');
    if (btnTrash) btnTrash.disabled = !hasSelection;

    if (typeof renderGlobalBanner === 'function') renderGlobalBanner();
}

btnSelectAll.addEventListener('click', () => {
    // Only operate on VISIBLE cards (respects active format filters)
    const allCards = document.querySelectorAll('.photo-card');
    const visibleCards = Array.from(allCards).filter(c => c.style.display !== 'none');
    
    // Check if all visible cards are already selected
    const allVisibleSelected = visibleCards.length > 0 &&
        visibleCards.every(c => state.selectedPhotos.has(c.dataset.id));

    visibleCards.forEach(card => {
        const id = card.dataset.id;
        if (allVisibleSelected) {
            state.selectedPhotos.delete(id);
            card.classList.remove('selected');
        } else {
            state.selectedPhotos.add(id);
            card.classList.add('selected');
        }
    });

    if (allVisibleSelected) {
        state.isGlobalSelected = false; // clear global track
    }

    updateActionState();
});

// ---------------------------------------------------------
// MOCK FOLDER SELECTION & ACTIONS
// ---------------------------------------------------------

const toastHeader = document.getElementById('toast-header');
const toastIcon = document.getElementById('toast-icon');
const toastBody = document.getElementById('toast-body');
const toastList = document.getElementById('toast-list');
let toastTimeout;

function showAdvancedToast(title, type = 'info', items = []) {
    clearTimeout(toastTimeout);

    toastMsg.textContent = title;
    toastList.innerHTML = '';

    toastHeader.className = 'toast-header';
    toastHeader.classList.add(type);

    if (type === 'warning') {
        toastIcon.setAttribute('data-lucide', 'alert-triangle');
    } else if (type === 'success') {
        toastIcon.setAttribute('data-lucide', 'check-circle-2');
    } else {
        toastIcon.setAttribute('data-lucide', 'info');
    }
    lucide.createIcons();

    if (items.length > 0) {
        toastBody.classList.add('has-content');
        items.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            toastList.appendChild(li);
        });
    } else {
        toastBody.classList.remove('has-content');
    }

    toastEl.classList.add('show');

    // Auto hide: longer for success (6000ms) and warnings/errors (12000ms) so users have time to read
    let duration = 6000;
    if (type === 'warning' || type === 'error') {
        duration = 12000;
    } else if (type === 'info') {
        duration = 3000;
    }
    
    toastTimeout = setTimeout(() => {
        toastEl.classList.remove('show');
    }, duration);
}

document.getElementById('btn-close-toast').addEventListener('click', () => {
    toastEl.classList.remove('show');
    clearTimeout(toastTimeout);
});



document.getElementById('btn-source-folder').addEventListener('click', async () => {
    try {
        const path = await eel.choose_folder()();
        if (!path) return; // user cancelled the dialog

        state.sourcePath = path;
        const pathEl = document.getElementById('source-path');
        pathEl.setAttribute('title', path);
        pathEl.textContent = path.length > 35 ? '...' + path.slice(-32) : path;

        // ── Prepare for streamed scan ──
        state.scannedFiles = [];
        state.selectedPhotos.clear();
        state.totalPhotos = 0;
        state.fileCount = 0;
        state.isScanning = true;
        state.thumbnailQueue = [];
        gridContainer.innerHTML = '';

        updateScanStatus();  // show "Scanning..." indicator
        showAdvancedToast("Source folder selected. Scanning recursive files...", "info");

        // Fire-and-forget: the backend will push chunks via receive_scan_chunk()
        eel.scan_directory(path)();
    } catch (err) {
        console.error('[PhotoFlow] Source folder error:', err);
        showAdvancedToast("Failed to open folder picker.", "warning");
    }
});

// ---------------------------------------------------------
// STREAMING SCAN: Exposed handlers called FROM Python
// ---------------------------------------------------------
const gridSubtitle = document.getElementById('grid-subtitle');

function updateScanStatus() {
    if (state.isScanning) {
        gridSubtitle.innerHTML = `<span class="scan-pulse">●</span> Scanning… <strong>${state.fileCount}</strong> files found`;
    } else {
        gridSubtitle.textContent = `Displaying ${state.fileCount} files from source folder`;
    }
}

// Called by Python for every batch of ~50 files
eel.expose(receive_scan_chunk);
function receive_scan_chunk(chunk) {
    try {
        state.scannedFiles.push(...chunk);
        state.fileCount += chunk.length;
        updateScanStatus();

        // Render if we are still filling the current page bounds
        if (!state.validFiles || state.validFiles.length < state.pageSize * state.currentPage) {
            renderVisualSelect();
        }
        return true;
    } catch (e) {
        console.error('[PhotoFlow] JS Error in receive_scan_chunk:', e);
        return false;
    }
}

// Called by Python when the scan is fully complete
eel.expose(scan_complete);
function scan_complete(totalCount) {
    try {
        state.isScanning = false;
        state.fileCount = totalCount;
        updateScanStatus();

        console.log(`[PhotoFlow] Scan complete — ${totalCount} files found.`);

        if (totalCount > 0) {
            showAdvancedToast(`Found ${totalCount} supported files.`, 'success');
            // Guarantee final UI is matched to state layout boundaries
            renderVisualSelect();

            // Reset scroll position after render
            const gridContainer = document.querySelector('.photo-grid-container');
            if (gridContainer) {
                gridContainer.scrollTop = 0;
            }
        } else {
            showAdvancedToast('No supported image files found in this folder.', 'warning');
            renderVisualSelect(); // Force empty state redraw
        }
        return true;
    } catch (e) {
        console.error('[PhotoFlow] JS Error in scan_complete:', e);
        return false;
    }
}

document.getElementById('btn-dest-folder').addEventListener('click', async () => {
    try {
        const path = await eel.choose_folder()();
        if (!path) return;

        state.destPath = path;
        const pathEl = document.getElementById('dest-path');
        pathEl.setAttribute('title', path);
        pathEl.textContent = path.length > 35 ? '...' + path.slice(-32) : path;

        showAdvancedToast("Destination folder set.", "success");
        // Reset top sync status if user is doing local operations
        const syncStatus = document.getElementById('top-sync-status');
        if (syncStatus) syncStatus.innerHTML = '☁️ Standby';
    } catch (err) {
        console.error('[PhotoFlow] Dest folder error:', err);
        showAdvancedToast("Failed to open folder picker.", "warning");
    }
});

// ---------------------------------------------------------
// PROCESS ABORT / SIMULATION LOGIC
// ---------------------------------------------------------
function toggleProcessMode(isProcessing) {
    btnCopy.style.display = isProcessing ? 'none' : 'flex';
    btnMove.style.display = isProcessing ? 'none' : 'flex';
    btnDriveUpload.style.display = isProcessing ? 'none' : 'flex';
    btnCancel.style.display = isProcessing ? 'flex' : 'none';
}

btnCancel.addEventListener('click', () => {
    clearTimeout(processTimeout);
    toggleProcessMode(false);
    showAdvancedToast("Process aborted by user.", "warning");
});

btnCopy.addEventListener('click', async () => {
    // ── Branch to Drive Modal if explorer is active ──
    const driveExplorerView = document.getElementById('drive-explorer-view');
    if (driveExplorerView && driveExplorerView.style.display !== 'none') {
        if (state.selectedDriveFiles.size === 0) return;
        state.modalActionType = 'copy';
        document.querySelector('#drive-move-modal h2').textContent = "Select Copy Destination";
        document.getElementById('btn-modal-move').textContent = "Copy Here";
        openDriveMoveModal();
        return;
    }

    // ── Validate destination ──
    if (!state.destPath) {
        showAdvancedToast("Please select a Destination Folder first.", "warning");
        return;
    }

    const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
    let filePaths = [];

    if (isBulkMode) {
        filePaths = getBulkFilePaths();
    } else {
        // Collect absolute paths directly from the Set (fixes multi-page selections and CSS escaping issues)
        filePaths = Array.from(state.selectedPhotos);
    }

    if (filePaths.length === 0) return;

    // ── Execute real backend copy ──
    toggleProcessMode(true);
    showAdvancedToast("Copying files...", "info");

    try {
        const result = await eel.execute_file_action("copy", filePaths, state.destPath)();
        toggleProcessMode(false);

        const { success_count, failed_files } = result;


        const noun = success_count === 1 ? 'file' : 'files';
        if (failed_files.length > 0) {
            showAdvancedToast(
                `Copied ${success_count} ${noun}. ${failed_files.length} failed.`,
                'warning', failed_files
            );
        } else {
            showAdvancedToast(`Successfully copied ${success_count} ${noun}.`, 'success');
        }

        if (isBulkMode) {
            const failedSet = new Set(failed_files);
            const statusList = document.getElementById('bulk-status-list');
            if (statusList) {
                statusList.innerHTML = ''; // Kosongkan daftar sebelum eksekusi baru
                filePaths.forEach(fp => {
                    const fname = fp.split(/[\\/]/).pop();
                    if (failedSet.has(fname)) {
                        statusList.innerHTML += `<div class="log-item"><i data-lucide="x-circle" style="color: #ef4444; width: 16px;"></i> <span style="color: #ef4444;">${fname} (Not Found)</span></div>`;
                    } else {
                        statusList.innerHTML += `<div class="log-item"><i data-lucide="check-circle" style="color: #10b981; width: 16px;"></i> <span>${fname}</span></div>`;
                    }
                });
                lucide.createIcons();
            }
        }

        // Clear bulk textarea after operation -- BUT DONT CLEAR RIGHT COLUMN LOG
        if (isBulkMode) {
            bulkTextarea.value = '';
            bulkTextarea.dispatchEvent(new Event('input'));
            updateActionState();
        }
    } catch (err) {
        toggleProcessMode(false);
        console.error('[PhotoFlow] Copy error:', err);
        showAdvancedToast("Copy operation failed unexpectedly.", "warning");
    }
});

btnMove.addEventListener('click', async () => {
    // ── Branch to Drive Modal if explorer is active ──
    const driveExplorerView = document.getElementById('drive-explorer-view');
    if (driveExplorerView && driveExplorerView.style.display !== 'none') {
        if (state.selectedDriveFiles.size === 0) return;
        state.modalActionType = 'move';
        document.querySelector('#drive-move-modal h2').textContent = "Select Move Destination";
        document.getElementById('btn-modal-move').textContent = "Move Here";
        openDriveMoveModal();
        return;
    }

    // ── Validate destination (Local OS Moving) ──
    if (!state.destPath) {
        showAdvancedToast("Please select a Destination Folder first.", "warning");
        return;
    }

    const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
    let filePaths = [];

    if (isBulkMode) {
        filePaths = getBulkFilePaths();
    } else {
        filePaths = Array.from(state.selectedPhotos);
    }

    if (filePaths.length === 0) return;

    // ── Execute real backend move ──
    toggleProcessMode(true);
    showAdvancedToast("Moving files...", "info");

    try {
        const result = await eel.execute_file_action("move", filePaths, state.destPath)();
        toggleProcessMode(false);

        const { success_count, failed_files } = result;


        const noun = success_count === 1 ? 'file' : 'files';
        if (failed_files.length > 0) {
            showAdvancedToast(
                `Moved ${success_count} ${noun}. ${failed_files.length} failed.`,
                'warning', failed_files
            );
        } else {
            showAdvancedToast(`Successfully moved ${success_count} ${noun}.`, 'success');
        }

        if (isBulkMode) {
            const failedSet = new Set(failed_files);
            const statusList = document.getElementById('bulk-status-list');
            if (statusList) {
                statusList.innerHTML = '';
                filePaths.forEach(fp => {
                    const fname = fp.split(/[\\/]/).pop();
                    if (failedSet.has(fname)) {
                        statusList.innerHTML += `<div class="log-item"><i data-lucide="x-circle" style="color: #ef4444; width: 16px;"></i> <span style="color: #ef4444;">${fname} (Not Found)</span></div>`;
                    } else {
                        statusList.innerHTML += `<div class="log-item"><i data-lucide="check-circle" style="color: #10b981; width: 16px;"></i> <span>${fname}</span></div>`;
                    }
                });
                lucide.createIcons();
            }
        }

        // In visual mode, remove successfully moved cards from the grid
        if (!isBulkMode) {
            const failedSet = new Set(failed_files);
            Array.from(state.selectedPhotos).forEach(id => {
                const card = Array.from(document.querySelectorAll('.photo-card')).find(c => c.dataset.id === id);
                if (!card) return;
                const filename = card.querySelector('.filename').textContent;
                // Only remove cards that were NOT in the failed list
                if (!failedSet.has(filename)) {
                    card.style.transform = 'scale(0.8)';
                    card.style.opacity = '0';
                    setTimeout(() => card.remove(), 300);
                    state.selectedPhotos.delete(id);
                    state.totalPhotos -= 1;
                }
            });
            setTimeout(updateActionState, 350);
        } else {
            bulkTextarea.value = '';
            bulkTextarea.dispatchEvent(new Event('input'));
            updateActionState();
        }
    } catch (err) {
        toggleProcessMode(false);
        console.error('[PhotoFlow] Move error:', err);
        showAdvancedToast("Move operation failed unexpectedly.", "warning");
    }
});

// ---------------------------------------------------------
// BULK MODE: Resolve filenames to absolute paths
// ---------------------------------------------------------
function getBulkFilePaths() {
    const rawText = bulkTextarea.value.trim();
    if (!rawText) return [];

    const cleanFilenames = rawText.split(/[,\n]+/).map(name => {
        return name.replace(/^(\d+[\.\)]\s*|[-\*]\s*)/, '').trim();
    }).filter(name => name.length > 0);

    const uniqueNames = [...new Set(cleanFilenames)];

    // Match typed filenames against real scanned files to get full paths
    const pathMap = {};
    state.scannedFiles.forEach(f => { pathMap[f.filename.toLowerCase()] = f.path; });

    const resolved = [];
    uniqueNames.forEach(name => {
        const match = pathMap[name.toLowerCase()];
        if (match) resolved.push(match);
    });

    if (resolved.length < uniqueNames.length) {
        const missing = uniqueNames.length - resolved.length;
        console.warn(`[PhotoFlow] Bulk: ${missing} filename(s) could not be matched to scanned files.`);
    }

    return resolved;
}

// Initialize empty state — wait for real folder selection
renderVisualSelect();

// ---------------------------------------------------------
// RENDER REAL FILES FROM BACKEND SCAN
// ---------------------------------------------------------
function renderVisualSelect() {
    gridContainer.innerHTML = '';
    
    // Reset top sync status when doing new local operations
    const syncStatus = document.getElementById('top-sync-status');
    if (syncStatus) syncStatus.innerHTML = '☁️ Standby';

    const searchInput = document.getElementById('main-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const formatCheckboxes = document.querySelectorAll('#format-checkboxes input[type="checkbox"]');
    const checkedFormats = Array.from(formatCheckboxes).filter(cb => cb.checked).map(cb => cb.value);

    // 1. FILTER PIPELINE
    state.validFiles = state.scannedFiles.filter(file => {
        const matchesFormat = checkedFormats.includes(file.ext);
        const matchesQuery = query === '' || file.filename.toLowerCase().includes(query);
        return matchesFormat && matchesQuery;
    });

    state.totalPhotos = state.validFiles.length;
    
    if (!gridContainer) return; // Null safety check
    
    // Update Subtitle: True visual files total
    const gridSubtitle = document.getElementById('grid-subtitle');
    if (!state.isScanning && gridSubtitle) {
        if (state.sourcePath) {
            gridSubtitle.textContent = `Displaying ${state.validFiles.length} valid media files from the selected path.`;
        } else {
            gridSubtitle.textContent = `Displaying valid media files from the selected path.`;
        }
    }

    const tabVisual = document.getElementById('tab-visual');
    if (tabVisual) {
        if (!state.sourcePath) {
            tabVisual.classList.add('is-empty');
            const emptyState = document.getElementById('empty-state');
            if (emptyState) {
                emptyState.innerHTML = `
                    <i data-lucide="folder-open" style="width: 64px; height: 64px; margin-bottom: 16px;"></i>
                    <p style="font-size: 1rem; font-weight: 500;">No workspace selected. Please choose a Local Source Path to begin.</p>
                `;
                lucide.createIcons();
            }
        } else if (state.validFiles.length === 0 && !state.isScanning) {
            tabVisual.classList.add('is-empty');
            const emptyState = document.getElementById('empty-state');
            if (emptyState) {
                emptyState.innerHTML = `
                    <i data-lucide="folder-search" style="width: 64px; height: 64px; margin-bottom: 16px;"></i>
                    <p style="font-size: 1rem; font-weight: 500;">Folder is empty or no files match the current filters.</p>
                `;
                lucide.createIcons();
            }
        } else {
            tabVisual.classList.remove('is-empty');
        }
    }

    // 2. PAGINATION
    const totalPages = Math.ceil(state.validFiles.length / state.pageSize) || 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;

    const start = (state.currentPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageFiles = state.validFiles.slice(start, end);

    const fragment = document.createDocumentFragment();

    pageFiles.forEach((file) => {
        const id = file.path; // Absolute paths as stable global IDs
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.dataset.id = id;
        card.dataset.format = file.ext;
        card.dataset.filepath = file.path;
        
        if (state.selectedPhotos.has(id)) {
            card.classList.add('selected');
        }

        const encodedPath = encodeURIComponent(file.path);
        card.innerHTML = `
            <div class="img-wrapper">
                <img src="/thumb?path=${encodedPath}" loading="lazy" decoding="async">
                <div class="check-indicator">
                    <i data-lucide="check"></i>
                </div>
                <div class="format-badge">${file.ext}</div>
                <button class="card-open-os" title="Open in system viewer">
                    <i data-lucide="external-link" style="width:14px;height:14px;"></i>
                </button>
            </div>
            <div class="card-meta">
                <span class="filename" title="${file.filename}">${file.filename}</span>
                <span class="filesize">${file.size_mb} MB</span>
            </div>
        `;

        // Single click = selection toggle
        card.addEventListener('click', () => {
            if (state.isGlobalSelected) {
                state.isGlobalSelected = false; // Break global tracking
                state.selectedPhotos = new Set(); // Rehydrate explicit partial set
                state.validFiles.forEach(f => {
                    if (f.path !== id) {
                        state.selectedPhotos.add(f.path);
                    }
                });
                card.classList.remove('selected');
            } else {
                toggleSelection(id, card);
            }
            updateActionState();
        });

        // Double click = open lightbox HD preview
        card.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            openLightbox(file.path, file.filename);
        });

        // Open in OS button
        const openBtn = card.querySelector('.card-open-os');
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            eel.open_in_os(file.path)();
        });

        fragment.appendChild(card);
    });

    gridContainer.appendChild(fragment);
    lucide.createIcons();
    // Intentionally skipped applyFormatFilters() to avoid recursive loops
    updateActionState();
    renderPaginationBar();
    renderGlobalBanner();
}

function renderPaginationBar() {
    let paginationBar = document.getElementById('pagination-bar');
    if (!paginationBar) {
        paginationBar = document.createElement('div');
        paginationBar.id = 'pagination-bar';
        paginationBar.className = 'pagination-bar';
        gridContainer.parentNode.appendChild(paginationBar);
    }

    const totalPages = Math.ceil(state.validFiles.length / state.pageSize) || 1;
    
    paginationBar.innerHTML = `
        <button id="btn-prev-page" ${state.currentPage === 1 ? 'disabled' : ''}>Previous</button>
        <span class="pagination-info">
            Page <input type="number" id="page-jump-input" value="${state.currentPage}" min="1" max="${totalPages}" class="page-input"> of ${totalPages}
        </span>
        <button id="btn-next-page" ${state.currentPage === totalPages ? 'disabled' : ''}>Next</button>
    `;

    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            if (!state.isGlobalSelected) state.selectedPhotos.clear();
            renderVisualSelect();
        }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
        if (state.currentPage < totalPages) {
            state.currentPage++;
            if (!state.isGlobalSelected) state.selectedPhotos.clear();
            renderVisualSelect();
        }
    });

    const jumpInput = document.getElementById('page-jump-input');
    if (jumpInput) {
        jumpInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= totalPages) {
                state.currentPage = val;
                if (!state.isGlobalSelected) state.selectedPhotos.clear();
                renderVisualSelect();
            } else {
                e.target.value = state.currentPage;
            }
        });
    }
}

function renderGlobalBanner() {
    let banner = document.getElementById('global-select-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'global-select-banner';
        banner.className = 'global-select-banner';
        gridContainer.parentNode.insertBefore(banner, gridContainer);
    }

    const visibleCards = Array.from(document.querySelectorAll('.photo-card:not([style*="display: none"])'));
    const allVisibleSelected = visibleCards.length > 0 && visibleCards.every(c => state.selectedPhotos.has(c.dataset.id));

    if (allVisibleSelected && !state.isGlobalSelected && state.validFiles.length > state.pageSize) {
        banner.style.display = 'block';
        banner.innerHTML = `Semua foto di halaman ini terpilih. <a href="#" id="link-global-select">Pilih semua ${state.validFiles.length} foto di folder ini</a>`;
        document.getElementById('link-global-select').addEventListener('click', (e) => {
            e.preventDefault();
            state.isGlobalSelected = true;
            state.validFiles.forEach(f => state.selectedPhotos.add(f.path));
            renderVisualSelect(); 
        });
    } else if (state.isGlobalSelected) {
        banner.style.display = 'block';
        banner.innerHTML = `Semua ${state.validFiles.length} foto telah terpilih. <a href="#" id="link-global-clear">Bersihkan pilihan</a>`;
        document.getElementById('link-global-clear').addEventListener('click', (e) => {
            e.preventDefault();
            state.isGlobalSelected = false;
            state.selectedPhotos.clear();
            renderVisualSelect();
        });
    } else {
        banner.style.display = 'none';
    }
}

// ---------------------------------------------------------
// LIGHTBOX CONTROLLER (with Zoom & Pan)
// ---------------------------------------------------------
const lightboxOverlay = document.getElementById('lightbox-overlay');
const lightboxViewport = document.getElementById('lightbox-viewport');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxSpinner = document.getElementById('lightbox-spinner');
const lightboxFilename = document.getElementById('lightbox-filename');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxOpenOS = document.getElementById('lightbox-open-os');
const lightboxZoomIn = document.getElementById('lightbox-zoom-in');
const lightboxZoomOut = document.getElementById('lightbox-zoom-out');
const lightboxZoomReset = document.getElementById('lightbox-zoom-reset');
const lightboxZoomLevel = document.getElementById('lightbox-zoom-level');
let lightboxCurrentPath = '';

// ── Zoom state ──
let zoomScale = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.25;

function applyTransform() {
    lightboxImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    lightboxZoomLevel.textContent = `${Math.round(zoomScale * 100)}%`;
    lightboxViewport.classList.toggle('zoomed', zoomScale > 1);
}

function resetZoom() {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyTransform();
}

function zoomTo(newScale, centerX, centerY) {
    // Clamp
    newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

    if (centerX !== undefined && centerY !== undefined) {
        // Zoom towards cursor position
        const rect = lightboxViewport.getBoundingClientRect();
        const offsetX = centerX - rect.left - rect.width / 2;
        const offsetY = centerY - rect.top - rect.height / 2;
        const ratio = 1 - newScale / zoomScale;
        panX += (offsetX - panX) * ratio;
        panY += (offsetY - panY) * ratio;
    }

    zoomScale = newScale;

    // If zoomed back to fit, reset pan
    if (zoomScale <= 1) {
        panX = 0;
        panY = 0;
    }

    applyTransform();
}

// ── Scroll-wheel zoom ──
lightboxViewport.addEventListener('wheel', (e) => {
    if (!lightboxOverlay.classList.contains('active')) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomTo(zoomScale + delta, e.clientX, e.clientY);
}, { passive: false });

// ── Button zoom ──
lightboxZoomIn.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomTo(zoomScale + ZOOM_STEP);
});
lightboxZoomOut.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomTo(zoomScale - ZOOM_STEP);
});
lightboxZoomReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetZoom();
});

// ── Drag to pan ──
lightboxViewport.addEventListener('mousedown', (e) => {
    if (zoomScale <= 1) return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    lightboxViewport.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform();
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        lightboxViewport.classList.remove('panning');
    }
});

// ── Open / Close ──
async function openLightbox(filePath, filename) {
    lightboxCurrentPath = filePath;
    lightboxFilename.textContent = filename;

    // Reset zoom + show overlay
    resetZoom();
    lightboxImage.classList.remove('loaded');
    lightboxImage.src = '';
    lightboxSpinner.classList.remove('hidden');
    lightboxOverlay.classList.add('active');
    lucide.createIcons();

    try {
        const b64 = await eel.get_high_res_image(filePath)();
        if (b64) {
            lightboxImage.src = `data:image/jpeg;base64,${b64}`;
            lightboxImage.onload = () => {
                lightboxSpinner.classList.add('hidden');
                lightboxImage.classList.add('loaded');
            };
        } else {
            lightboxSpinner.classList.add('hidden');
            showAdvancedToast('Could not generate preview for this file.', 'warning');
        }
    } catch (err) {
        lightboxSpinner.classList.add('hidden');
        console.error('[PhotoFlow] Lightbox error:', err);
        showAdvancedToast('Failed to load high-res preview.', 'warning');
    }
}

function closeLightbox() {
    lightboxOverlay.classList.remove('active');
    isPanning = false;
    // CRITICAL: free RAM after fade-out
    setTimeout(() => {
        lightboxImage.src = '';
        lightboxImage.classList.remove('loaded');
        lightboxImage.style.transform = '';
        lightboxCurrentPath = '';
        resetZoom();
    }, 300);
}

lightboxClose.addEventListener('click', closeLightbox);

// Close on backdrop click (not on viewport content)
lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) closeLightbox();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (!lightboxOverlay.classList.contains('active')) return;

    switch (e.key) {
        case 'Escape':
            closeLightbox();
            break;
        case '+':
        case '=':
            zoomTo(zoomScale + ZOOM_STEP);
            break;
        case '-':
            zoomTo(zoomScale - ZOOM_STEP);
            break;
        case '0':
            resetZoom();
            break;
    }
});

// Open in OS from the lightbox toolbar
lightboxOpenOS.addEventListener('click', () => {
    if (lightboxCurrentPath) {
        eel.open_in_os(lightboxCurrentPath)();
    }
});

// ---------------------------------------------------------
// EEL BACKEND CONNECTION TEST
// ---------------------------------------------------------
(async function testEelConnection() {
    try {
        // Call the Python backend function exposed via @eel.expose
        const response = await eel.test_connection()();
        console.log('[PhotoFlow] Eel response:', response);

        // Create a visual success banner at the top of the main content area
        const banner = document.createElement('div');
        banner.id = 'eel-connection-banner';
        banner.innerHTML = `
            <i data-lucide="check-circle-2" style="width:18px;height:18px;"></i>
            <span>${response}</span>
        `;

        // Style the banner
        Object.assign(banner.style, {
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%) translateY(-60px)',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            padding: '10px 24px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
            fontWeight: '600',
            fontFamily: "'Inter', sans-serif",
            boxShadow: '0 8px 24px rgba(16,185,129,0.35)',
            zIndex: '9999',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease',
            opacity: '0',
        });

        document.body.appendChild(banner);
        lucide.createIcons();

        // Animate in
        requestAnimationFrame(() => {
            banner.style.transform = 'translateX(-50%) translateY(0)';
            banner.style.opacity = '1';
        });

        // Auto-dismiss after 4 seconds
        setTimeout(() => {
            banner.style.transform = 'translateX(-50%) translateY(-60px)';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 600);
        }, 4000);

    } catch (err) {
        console.warn('[PhotoFlow] Eel backend not available (running in browser-only mode):', err.message);
    }
})();

// ---------------------------------------------------------
// DRIVE EXPLORER LOGIC
// ---------------------------------------------------------
const driveExplorerView = document.getElementById('drive-explorer-view');
const driveGrid = document.getElementById('drive-grid');
const driveBreadcrumbs = document.getElementById('drive-breadcrumbs');

state.currentDriveFolder = 'root';
state.driveHistory = [{ id: 'root', name: 'Root' }];
state.selectedDriveFiles = new Set();
state.currentDriveItems = [];
state.driveSortConfig = { key: 'name', dir: 'asc' };

// Modal States
state.modalCurrentFolder = 'root';
state.modalHistory = [{ id: 'root', name: 'Root' }];
state.modalActionType = null;

if (navLocalWorkspace) {
    navLocalWorkspace.addEventListener('click', () => {
        if (navCloudWorkspace) navCloudWorkspace.classList.remove('active');
        navLocalWorkspace.classList.add('active');

        // Show tabs header again
        const tabsHeader = document.querySelector('.tabs-header');
        if (tabsHeader) tabsHeader.style.display = '';

        // Simulate click on the Visual Select tab to trigger existing reset logic
        const visualTab = document.querySelector('.tab-btn[data-target="tab-visual"]');
        if (visualTab) visualTab.click();
    });
}

if (navCloudWorkspace) {
    navCloudWorkspace.addEventListener('click', () => {
        if (navLocalWorkspace) navLocalWorkspace.classList.remove('active');
        navCloudWorkspace.classList.add('active');

        // Hide standard tabs header & contents
        const tabsHeader = document.querySelector('.tabs-header');
        if (tabsHeader) tabsHeader.style.display = 'none';

        tabContents.forEach(c => c.classList.remove('active'));
        tabContents.forEach(c => c.style.display = 'none');
        tabBtns.forEach(b => b.classList.remove('active'));
        
        // Hide thumbnail size slider
        const zoomControl = document.querySelector('.zoom-control');
        if (zoomControl) zoomControl.style.display = 'none';
        
        // Show Drive Explorer layout block
        driveExplorerView.style.display = 'block';
        
        // Show trash button in Drive mode
        const btnTrash = document.getElementById('btn-trash-selected');
        if (btnTrash) btnTrash.style.display = 'flex';
        
        // Adjust lower UI to Drive mode
        document.getElementById('btn-dest-folder').style.display = 'none';
        document.getElementById('copy-text-main').innerText = 'Copy';
        document.getElementById('copy-text-sub').innerText = 'in Drive';
        document.getElementById('move-text-main').innerText = 'Move';
        document.getElementById('move-text-sub').innerText = 'in Drive';

        // Reset Sync button UI to Download mode
        const syncText = document.getElementById('btn-sync-text');
        const syncIcon = document.getElementById('btn-sync-icon');
        if (syncText && syncIcon) {
            syncText.innerText = "Download to Local";
            syncIcon.setAttribute('data-lucide', 'cloud-download');
            lucide.createIcons();
        }
        
        // Fetch root if empty
        if (driveGrid.children.length === 0) {
            openDriveFolder('root', 'Google Drive');
        }
    });
}

async function openDriveFolder(folderId, folderName) {
    // Update State
    state.currentDriveFolder = folderId;
    state.selectedDriveFiles.clear();
    
    // Check if we are navigating back or forward
    const existingIndex = state.driveHistory.findIndex(h => h.id === folderId);
    if (existingIndex !== -1) {
        state.driveHistory = state.driveHistory.slice(0, existingIndex + 1);
    } else {
        state.driveHistory.push({ id: folderId, name: folderName });
    }
    
    renderBreadcrumbs();
    
    // Show Loading
    driveGrid.innerHTML = `
        <div style="grid-column: 1 / -1; display: flex; justify-content: center; padding: 40px;">
            <div class="spinner-ring" style="border-color: rgba(96, 165, 250, 0.2); border-top-color: #60a5fa;"></div>
        </div>
    `;
    
    try {
        const items = await eel.get_drive_contents(folderId, localStorage.getItem('user_id'))();
        if (items && !items.error) {
            state.currentDriveItems = items;
            renderDriveContents();
        } else {
            driveGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ef4444;">Failed to load folder: ${items.error || 'Unknown error'}</div>`;
        }
    } catch (err) {
        driveGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ef4444;">Failed to load folder. See console.</div>`;
    }
}

function renderBreadcrumbs() {
    driveBreadcrumbs.innerHTML = '';
    
    state.driveHistory.forEach((crumb, index) => {
        const isLast = index === state.driveHistory.length - 1;
        
        const span = document.createElement('span');
        span.textContent = crumb.name;
        
        if (isLast) {
            span.className = 'breadcrumb-current';
        } else {
            span.className = 'breadcrumb-link';
            span.addEventListener('click', () => openDriveFolder(crumb.id, crumb.name));
        }
        
        driveBreadcrumbs.appendChild(span);
        
        if (!isLast) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.innerHTML = '<i data-lucide="chevron-right" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
            driveBreadcrumbs.appendChild(sep);
        }
    });
    
    lucide.createIcons();
}

function formatDriveDate(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDriveSize(bytesStr) {
    if (!bytesStr) return '--';
    let bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return '--';
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    else return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatDriveType(item) {
    if (!item) return 'Unknown';
    if (item.mimeType === 'application/vnd.google-apps.folder') return 'Folder';
    if (item.name && item.name.includes('.')) return item.name.split('.').pop().toUpperCase();
    return 'File';
}

// Attach a global sort handler so onclick from HTML string works
window.handleDriveSort = function(key) {
    if (state.driveSortConfig.key === key) {
        state.driveSortConfig.dir = state.driveSortConfig.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.driveSortConfig.key = key;
        state.driveSortConfig.dir = 'asc';
    }
    renderDriveContents();
}

function renderDriveContents() {
    driveGrid.innerHTML = '';
    
    // Sort Items
    let sortedItems = [...state.currentDriveItems];
    const { key, dir } = state.driveSortConfig;
    const mod = dir === 'asc' ? 1 : -1;
    
    sortedItems.sort((a, b) => {
        // ALWAYS keep folders at the top regardless of sort
        const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder';
        const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder';
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        
        let valA, valB;
        if (key === 'size') {
            valA = parseInt(a.size || 0, 10);
            valB = parseInt(b.size || 0, 10);
        } else if (key === 'modifiedTime') {
            valA = new Date(a.modifiedTime || 0).getTime();
            valB = new Date(b.modifiedTime || 0).getTime();
        } else { // default 'name'
            valA = (a.name || '').toLowerCase();
            valB = (b.name || '').toLowerCase();
            return valA.localeCompare(valB, undefined, {numeric: true}) * mod;
        }
        
        if (valA < valB) return -1 * mod;
        if (valA > valB) return 1 * mod;
        return 0;
    });

    if (sortedItems.length === 0) {
        driveGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">This folder is empty.</div>`;
        return;
    }
    
    const container = document.createElement('div');
    container.className = 'drive-table-container';
    
    const getSortIconHTML = (colKey) => {
        if (state.driveSortConfig.key !== colKey) return '';
        const iconName = state.driveSortConfig.dir === 'asc' ? 'chevron-up' : 'chevron-down';
        return `<i data-lucide="${iconName}" class="sort-icon"></i>`;
    };

    let tableHTML = `
        <table class="drive-table">
            <thead class="drive-header">
                <tr>
                    <th onclick="handleDriveSort('name')" style="cursor: pointer;">Name ${getSortIconHTML('name')}</th>
                    <th onclick="handleDriveSort('modifiedTime')">Date Modified ${getSortIconHTML('modifiedTime')}</th>
                    <th>Type</th>
                    <th onclick="handleDriveSort('size')" style="text-align: right;">Size ${getSortIconHTML('size')}</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    container.innerHTML = tableHTML;
    const tbody = document.createElement('tbody');
    
    sortedItems.forEach(item => {
        const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
        const row = document.createElement('tr');
        row.className = 'drive-row drive-file-card';
        row.dataset.id = item.id;
        if (isFolder) row.dataset.isFolder = 'true';
        
        let extension = '';
        if (item.name.includes('.')) {
            extension = item.name.split('.').pop().toUpperCase();
        } else if (item.mimeType && item.mimeType.toLowerCase().includes('image')) {
            extension = 'IMAGE';
        }
        row.dataset.format = extension;

        if (state.selectedDriveFiles.has(item.id)) {
            row.classList.add('selected');
        }
        
        const iconHtml = isFolder 
            ? '<i data-lucide="folder" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle; color: #60a5fa;"></i>'
            : '<i data-lucide="file" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>';

        row.innerHTML = `
            <td class="drive-cell">
                <div style="display:flex; align-items:center; justify-content: space-between;">
                    <div style="display:flex; align-items:center; overflow: hidden;">
                        ${iconHtml}
                        <span class="drive-item-name" style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</span>
                    </div>
                    <i data-lucide="edit-3" class="drive-rename-btn" title="Rename" style="width: 14px; height: 14px; cursor: pointer; transition: opacity 0.15s; margin-left: 8px;"></i>
                </div>
            </td>
            <td class="drive-cell drive-cell-date">${formatDriveDate(item.modifiedTime)}</td>
            <td class="drive-cell drive-cell-type">${isFolder ? 'Folder' : formatDriveType(item)}</td>
            <td class="drive-cell drive-cell-size">${formatDriveSize(item.size)}</td>
        `;
        
        // Selection click (works for BOTH files and folders)
        row.addEventListener('click', (e) => {
            // Don't select if rename button was clicked
            if (e.target.closest('.drive-rename-btn')) return;
            
            if (state.selectedDriveFiles.has(item.id)) {
                state.selectedDriveFiles.delete(item.id);
                row.classList.remove('selected');
            } else {
                state.selectedDriveFiles.add(item.id);
                row.classList.add('selected');
            }
            updateActionState();
        });
        
        // Double-click to navigate into folder
        if (isFolder) {
            row.addEventListener('dblclick', () => openDriveFolder(item.id, item.name));
        }
        
        // Rename button handler moved AFTER lucide conversion
        
        tbody.appendChild(row);
    });
    
    container.querySelector('table').appendChild(tbody);
    driveGrid.appendChild(container);
    lucide.createIcons();
    
    // Wire rename buttons AFTER lucide converts <i> to <svg>
    const renameBtns = document.querySelectorAll('.drive-rename-btn');
    renameBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent row selection
            const row = e.target.closest('.drive-row');
            if (!row) return;
            
            const fileId = row.dataset.id;
            const nameEl = row.querySelector('.drive-item-name');
            const currentName = nameEl ? nameEl.innerText : "";
            
            const newName = prompt("Masukkan nama baru:", currentName);
            if (newName && newName.trim() !== "" && newName.trim() !== currentName) {
                try {
                    const result = await eel.rename_drive_item(fileId, newName.trim(), localStorage.getItem('user_id'))();
                    if (result && result.success) {
                        showAdvancedToast(`Renamed to "${result.name}".`, "success");
                        openDriveFolder(state.currentDriveFolder, state.driveHistory[state.driveHistory.length - 1].name);
                    } else {
                        showAdvancedToast(`Rename failed: ${result.error}`, "warning");
                    }
                } catch (err) {
                    showAdvancedToast("Failed to rename item.", "error");
                }
            }
        });
    });

    // Re-apply format filters to the newly rendered drive rows
    applyFormatFilters();
}

// ---------------------------------------------------------
// GOOGLE DRIVE UPLOAD
// ---------------------------------------------------------
const uploadModal = document.getElementById('upload-modal');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadStatusText = document.getElementById('upload-status-text');
const uploadCounter = document.getElementById('upload-counter');

eel.expose(update_sync_progress);
function update_sync_progress(percent) {
    const btn = document.getElementById('btn-modal-move');
    const btnPreview = document.getElementById('btn-modal-preview');
    const btnBackup = document.getElementById('btn-modal-backup');
    if (state.modalActionType === 'sync') {
        // Update whichever sync button is visible
        if (btnPreview && btnPreview.style.display !== 'none') {
            btnPreview.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Uploading... ${percent}%`;
        }
        if (btnBackup && btnBackup.style.display !== 'none') {
            btnBackup.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Uploading... ${percent}%`;
        }
        // Also update legacy btn-modal-move if it's the one being used
        if (btn && btn.style.display !== 'none' && state.modalActionType === 'sync') {
            btn.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Uploading... ${percent}%`;
        }
        lucide.createIcons();
    }
}

eel.expose(sync_complete);
function sync_complete() {
    showAdvancedToast("Successfully uploaded files to Drive.", "success");
    closeDriveMoveModal();
    
    // Clear local selections after successful sync
    const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
    if (isBulkMode) {
        bulkTextarea.value = '';
        bulkTextarea.dispatchEvent(new Event('input'));
        updateActionState();
    } else {
        state.selectedPhotos.clear();
        document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
        updateActionState();
    }
    
    // Reset Modal Button logic moved to resetUploadState
}

eel.expose(auto_gather_complete);
function auto_gather_complete(foundCount, missingCount) {
    const btn = document.getElementById('btn-consolidate-raws');
    if (btn) {
        btn.innerHTML = 'Consolidate RAW Files';
        btn.disabled = false;
        lucide.createIcons();
    }
    
    // Tutup modal
    const modal = document.getElementById('project-sync-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Tampilkan notifikasi pintar
    if (missingCount > 0) {
        showAdvancedToast(`Pemanenan Selesai: ${foundCount} file berhasil disalin. PERINGATAN: ${missingCount} file tidak ditemukan di Hardisk Anda.`, "warning");
    } else {
        showAdvancedToast(`Pemanenan Sukses! ${foundCount} file berhasil dikumpulkan.`, "success");
    }
}

eel.expose(resetUploadState);
function resetUploadState() {
    const btnMove = document.getElementById('btn-modal-move');
    const btnPreview = document.getElementById('btn-modal-preview');
    const btnBackup = document.getElementById('btn-modal-backup');
    if (btnMove) {
        btnMove.disabled = false;
        btnMove.innerHTML = "Upload Here";
    }
    if (btnPreview) {
        btnPreview.disabled = false;
        btnPreview.innerHTML = "Quick Preview (Kompres)";
    }
    if (btnBackup) {
        btnBackup.disabled = false;
        btnBackup.innerHTML = "Full Backup (RAW)";
    }
    if (window.lucide) lucide.createIcons();
}

if (btnDriveUpload) {
    btnDriveUpload.addEventListener('click', async () => {
        if (btnDriveUpload.disabled) return;
        
        const driveExplorerView = document.getElementById('drive-explorer-view');
        const isDriveMode = driveExplorerView && driveExplorerView.style.display !== 'none';
        
        if (isDriveMode) {
            // DOWNLOAD TO LOCAL
            if (state.selectedDriveFiles.size === 0) return;
            
            // Ask for local directory
            const syncText = document.getElementById('btn-sync-text');
            const originalText = syncText.innerText;
            syncText.innerText = "Preparing...";
            
            try {
                const localDest = await eel.choose_folder()();
                if (!localDest) {
                    syncText.innerText = originalText;
                    return; // user cancelled
                }
                
                syncText.innerText = "Downloading...";
                btnDriveUpload.disabled = true;
                
                const fileIds = Array.from(state.selectedDriveFiles);
                const result = await eel.download_drive_files(fileIds, localDest, localStorage.getItem('user_id'))();
                
                if (result && result.success) {
                    showAdvancedToast(`Successfully downloaded ${result.downloaded} files.`, 'success');
                    state.selectedDriveFiles.clear();
                    document.querySelectorAll('.drive-row.selected').forEach(c => c.classList.remove('selected'));
                    updateActionState();
                } else {
                    showAdvancedToast(`Download failed: ${result?.error}`, 'warning');
                }
            } catch (err) {
                showAdvancedToast("An error occurred during download.", 'error');
            } finally {
                syncText.innerText = originalText;
                btnDriveUpload.disabled = false;
            }
        } else {
            // UPLOAD TO CLOUD
            state.modalActionType = 'sync';
            document.querySelector('#drive-move-modal h2').innerHTML = '<i data-lucide="cloud-upload" style="width: 20px; height: 20px; vertical-align: bottom; margin-right: 8px;"></i> Select Upload Destination';
            document.getElementById('btn-modal-move').innerHTML = 'Upload Here';
            lucide.createIcons();
            openDriveMoveModal();
        }
    });
}

// ---------------------------------------------------------
// DRIVE MOVE MODAL LOGIC
// ---------------------------------------------------------
const driveMoveModal = document.getElementById('drive-move-modal');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalMove = document.getElementById('btn-modal-move');
const modalFolderList = document.getElementById('modal-folder-list');
const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');

async function openDriveMoveModal() {
    state.modalCurrentFolder = 'root';
    state.modalHistory = [{ id: 'root', name: 'Google Drive' }];
    driveMoveModal.style.display = 'flex';
    
    // Toggle button visibility based on action type
    const btnMoveEl = document.getElementById('btn-modal-move');
    const btnPreviewEl = document.getElementById('btn-modal-preview');
    const btnBackupEl = document.getElementById('btn-modal-backup');
    
    if (state.modalActionType === 'sync') {
        // Sync mode: show Preview & Backup, hide Move
        if (btnMoveEl) btnMoveEl.style.display = 'none';
        if (btnPreviewEl) { btnPreviewEl.style.display = ''; btnPreviewEl.disabled = false; btnPreviewEl.innerHTML = 'Quick Preview (Kompres)'; }
        if (btnBackupEl) { btnBackupEl.style.display = ''; btnBackupEl.disabled = false; btnBackupEl.innerHTML = 'Full Backup (RAW)'; }
    } else {
        // Move/Copy mode: show Move, hide Preview & Backup
        if (btnMoveEl) btnMoveEl.style.display = '';
        if (btnPreviewEl) btnPreviewEl.style.display = 'none';
        if (btnBackupEl) btnBackupEl.style.display = 'none';
    }
    
    // Small delay to allow display flex to apply before opacity transition
    setTimeout(() => { driveMoveModal.classList.add('active'); }, 10);
    await loadModalFolder(state.modalCurrentFolder);
}

function closeDriveMoveModal() {
    driveMoveModal.classList.remove('active');
    setTimeout(() => { driveMoveModal.style.display = 'none'; }, 300);
    // Reset the modal button state forcibly when closed
    const btnMove = document.getElementById('btn-modal-move');
    const btnPreview = document.getElementById('btn-modal-preview');
    const btnBackup = document.getElementById('btn-modal-backup');
    if (btnMove) {
        btnMove.disabled = false;
        btnMove.innerHTML = "Upload Here";
    }
    if (btnPreview) {
        btnPreview.disabled = false;
        btnPreview.innerHTML = "Quick Preview (Kompres)";
        btnPreview.style.display = 'none';
    }
    if (btnBackup) {
        btnBackup.disabled = false;
        btnBackup.innerHTML = "Full Backup (RAW)";
        btnBackup.style.display = 'none';
    }
    if (window.lucide) lucide.createIcons();
}

async function loadModalFolder(folderId) {
    state.modalCurrentFolder = folderId;
    renderModalBreadcrumbs();
    
    modalFolderList.innerHTML = `<div style="text-align:center; padding: 20px;"><div class="spinner-ring" style="border-color: rgba(96, 165, 250, 0.2); border-top-color: #60a5fa; width: 24px; height: 24px;"></div></div>`;
    
    try {
        const folders = await eel.get_drive_folders_only(folderId, localStorage.getItem('user_id'))();
        if (folders && folders.error) throw new Error(folders.error);
        renderModalFolderItems(folders || []);
    } catch (err) {
        modalFolderList.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Failed to load folders.</div>`;
    }
}

function renderModalBreadcrumbs() {
    modalBreadcrumbs.innerHTML = '';
    state.modalHistory.forEach((crumb, index) => {
        const isLast = index === state.modalHistory.length - 1;
        const span = document.createElement('span');
        span.textContent = crumb.name;
        
        if (isLast) {
            span.className = 'breadcrumb-current';
        } else {
            span.className = 'breadcrumb-link';
            span.addEventListener('click', () => {
                state.modalHistory = state.modalHistory.slice(0, index + 1);
                loadModalFolder(crumb.id);
            });
        }
        
        modalBreadcrumbs.appendChild(span);
        
        if (!isLast) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.innerHTML = '<i data-lucide="chevron-right" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
            modalBreadcrumbs.appendChild(sep);
        }
    });
    lucide.createIcons();
}

function renderModalFolderItems(folders) {
    modalFolderList.innerHTML = '';
    
    if (folders.length === 0) {
        modalFolderList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No folders found.</div>`;
        return;
    }
    
    folders.forEach(f => {
        const item = document.createElement('div');
        item.className = 'modal-folder-item';
        item.innerHTML = `
            <i data-lucide="folder" style="color: #60a5fa; fill: rgba(96, 165, 250, 0.1); width: 20px; height: 20px;"></i>
            <span>${f.name}</span>
        `;
        
        item.addEventListener('click', () => {
            // Remove previous active
            document.querySelectorAll('.modal-folder-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            // Wait to navigate so user can click "Move Here" OR double click.
            // Actually, Drive usually allows moving to the CURRENT folder (the one open).
        });
        
        // Double click navigates inward
        item.addEventListener('dblclick', () => {
            state.modalHistory.push({ id: f.id, name: f.name });
            loadModalFolder(f.id);
        });
        
        modalFolderList.appendChild(item);
    });
    lucide.createIcons();
}

if (btnModalCancel) {
    btnModalCancel.addEventListener('click', closeDriveMoveModal);
}

if (btnModalMove) {
    btnModalMove.addEventListener('click', async () => {
        const targetTarget = state.modalCurrentFolder;
        
        if (state.modalActionType === 'move' && targetTarget === state.currentDriveFolder) {
            showAdvancedToast("Files are already in this folder.", "warning");
            return;
        }

        btnModalMove.disabled = true;
        let verb = "Processing";
        if (state.modalActionType === 'move') verb = "Moving";
        else if (state.modalActionType === 'copy') verb = "Copying";
        else if (state.modalActionType === 'sync') verb = "Uploading";
        
        btnModalMove.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> ${verb}...`;
        lucide.createIcons();
        
        try {
            if (state.modalActionType === 'sync') {
                const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
                let filePaths = [];
                if (isBulkMode) {
                    filePaths = getBulkFilePaths();
                } else {
                    filePaths = Array.from(state.selectedPhotos);
                }
                
                if (filePaths.length === 0) throw new Error("No files selected.");
                
                // Fire and forget, the background thread handles UI unblocking via sync_complete callback
                await eel.upload_files_to_drive(filePaths, targetTarget, 'preview', localStorage.getItem('user_id'))();
                return;
            } 
            
            let result;
            if (state.modalActionType === 'copy') {
                const fileIdsToMove = Array.from(state.selectedDriveFiles);
                result = await eel.execute_drive_copy(fileIdsToMove, targetTarget, localStorage.getItem('user_id'))();
            } else {
                const fileIdsToMove = Array.from(state.selectedDriveFiles);
                result = await eel.execute_drive_move(fileIdsToMove, state.currentDriveFolder, targetTarget, localStorage.getItem('user_id'))();
            }
            
            if (result && result.success) {
                const count = result.moved || result.copied;
                let pastTense = "processed";
                if (state.modalActionType === 'move') pastTense = "moved";
                else if (state.modalActionType === 'copy') pastTense = "copied";
                
                showAdvancedToast(`Successfully ${pastTense} ${count} files.`, "success");
                closeDriveMoveModal();
                
                // Refresh main explore view smoothly without losing history
                openDriveFolder(state.currentDriveFolder, state.driveHistory[state.driveHistory.length-1].name);
            } else {
                let failWord = "process";
                if (state.modalActionType === 'move') failWord = "move";
                else if (state.modalActionType === 'copy') failWord = "copy";
                showAdvancedToast(`Failed to ${failWord}: ${result.error}`, "warning");
            }
        } catch (err) {
            console.error("UI Modal Move Error:", err);
            const errmsg = err.message ? err.message : String(err);
            showAdvancedToast(`Upload Error: ${errmsg}`, "error");
        } finally {
            if (state.modalActionType !== 'sync') {
                btnModalMove.disabled = false;
                let verbNormal = "Process Here";
                if (state.modalActionType === 'move') verbNormal = "Move Here";
                else if (state.modalActionType === 'copy') verbNormal = "Copy Here";
                btnModalMove.innerHTML = verbNormal;
            }
        }
    });
}


// ---------------------------------------------------------
// SYNC MODE: Preview & Backup Button Listeners
// ---------------------------------------------------------
function getSyncFilePaths() {
    const isBulkMode = document.querySelector('.tab-btn[data-target="tab-bulk"]').classList.contains('active');
    let filePaths = [];
    if (isBulkMode) {
        filePaths = getBulkFilePaths();
    } else {
        filePaths = Array.from(state.selectedPhotos);
    }
    return filePaths;
}

const btnModalPreview = document.getElementById('btn-modal-preview');
const btnModalBackup = document.getElementById('btn-modal-backup');

if (btnModalPreview) {
    btnModalPreview.addEventListener('click', async () => {
        const targetTarget = state.modalCurrentFolder;
        const filePaths = getSyncFilePaths();
        if (filePaths.length === 0) {
            showAdvancedToast("No files selected.", "warning");
            return;
        }
        
        // Disable both buttons to prevent double-click
        btnModalPreview.disabled = true;
        if (btnModalBackup) btnModalBackup.disabled = true;
        btnModalPreview.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Uploading...`;
        lucide.createIcons();
        
        try {
            await eel.upload_files_to_drive(filePaths, targetTarget, 'preview', localStorage.getItem('user_id'))();
            // Fire and forget — sync_complete callback handles UI reset
        } catch (err) {
            console.error("[PhotoFlow] Preview upload error:", err);
            showAdvancedToast(`Upload Error: ${err.message || err}`, "error");
            btnModalPreview.disabled = false;
            if (btnModalBackup) btnModalBackup.disabled = false;
            btnModalPreview.innerHTML = "Quick Preview (Kompres)";
        }
    });
}

if (btnModalBackup) {
    btnModalBackup.addEventListener('click', async () => {
        const targetTarget = state.modalCurrentFolder;
        const filePaths = getSyncFilePaths();
        if (filePaths.length === 0) {
            showAdvancedToast("No files selected.", "warning");
            return;
        }
        
        // Disable both buttons to prevent double-click
        btnModalBackup.disabled = true;
        if (btnModalPreview) btnModalPreview.disabled = true;
        btnModalBackup.innerHTML = `<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Uploading...`;
        lucide.createIcons();
        
        try {
            await eel.upload_files_to_drive(filePaths, targetTarget, 'backup', localStorage.getItem('user_id'))();
            // Fire and forget — sync_complete callback handles UI reset
        } catch (err) {
            console.error("[PhotoFlow] Backup upload error:", err);
            showAdvancedToast(`Upload Error: ${err.message || err}`, "error");
            btnModalBackup.disabled = false;
            if (btnModalPreview) btnModalPreview.disabled = false;
            btnModalBackup.innerHTML = "Full Backup (RAW)";
        }
    });
}

// ---------------------------------------------------------
// TEXT-BASED SELECT ALL (DRIVE)
// ---------------------------------------------------------
const driveSelectAllText = document.getElementById('drive-select-all-text');
if (driveSelectAllText) {
    driveSelectAllText.addEventListener('click', () => {
        const visibleRows = document.querySelectorAll('.drive-row:not([style*="display: none"])');
        if (visibleRows.length === 0) return;

        // Check BOTH format filter and text search
        const formatCheckboxes = document.querySelectorAll('#format-checkboxes input[type="checkbox"]');
        const isFormatFiltered = Array.from(formatCheckboxes).some(cb => !cb.checked);
        
        const searchInput = document.getElementById('main-search-input');
        const isTextFiltered = searchInput && searchInput.value.trim() !== '';
        
        const isFiltered = isFormatFiltered || isTextFiltered;

        let targetRows = Array.from(visibleRows);
        // If ANY filter is active, PREVENT folders from being selected by "Select All"
        if (isFiltered) {
            targetRows = targetRows.filter(row => row.dataset.isFolder !== 'true');
        }

        if (targetRows.length === 0) return;

        const allTargetSelected = targetRows.every(row => state.selectedDriveFiles.has(row.dataset.id));
        
        targetRows.forEach(row => {
            const id = row.dataset.id;
            if (allTargetSelected) {
                state.selectedDriveFiles.delete(id);
                row.classList.remove('selected');
            } else {
                state.selectedDriveFiles.add(id);
                row.classList.add('selected');
            }
        });
        
        driveSelectAllText.textContent = allTargetSelected ? "Select All" : "Deselect All";
        updateActionState();
    });
}

// ---------------------------------------------------------
// NEW FOLDER (DRIVE)
// ---------------------------------------------------------
const driveNewFolder = document.getElementById('drive-new-folder');
if (driveNewFolder) {
    driveNewFolder.addEventListener('click', async () => {
        const folderName = prompt("Enter new folder name:");
        if (!folderName || !folderName.trim()) return;
        
        try {
            const result = await eel.create_new_drive_folder(folderName.trim(), state.currentDriveFolder, localStorage.getItem('user_id'))();
            if (result && result.success) {
                showAdvancedToast(`Folder "${result.name}" created successfully.`, "success");
                // Refresh current view to show the new folder
                openDriveFolder(state.currentDriveFolder, state.driveHistory[state.driveHistory.length - 1].name);
            } else {
                showAdvancedToast(`Failed to create folder: ${result.error}`, "warning");
            }
        } catch (err) {
            showAdvancedToast("Failed to create folder.", "error");
        }
    });
}

// ---------------------------------------------------------
// MOVE TO TRASH (DRIVE)
// ---------------------------------------------------------
const btnTrashSelected = document.getElementById('btn-trash-selected');
if (btnTrashSelected) {
    btnTrashSelected.addEventListener('click', async () => {
        const driveExplorerView = document.getElementById('drive-explorer-view');
        const isDriveMode = driveExplorerView && driveExplorerView.style.display !== 'none';
        if (!isDriveMode || state.selectedDriveFiles.size === 0) return;
        
        const count = state.selectedDriveFiles.size;
        const noun = count === 1 ? 'item' : 'items';
        const confirmed = confirm(`Are you sure you want to move ${count} ${noun} to Trash?\n\nYou can recover them from Google Drive's Trash later.`);
        if (!confirmed) return;
        
        btnTrashSelected.disabled = true;
        btnTrashSelected.innerHTML = '<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Trashing...';
        lucide.createIcons();
        
        try {
            const fileIds = Array.from(state.selectedDriveFiles);
            const result = await eel.trash_drive_files(fileIds, localStorage.getItem('user_id'))();
            if (result && result.success) {
                showAdvancedToast(`Moved ${result.trashed} ${noun} to Trash.`, "success");
                state.selectedDriveFiles.clear();
                // Refresh the Drive view
                openDriveFolder(state.currentDriveFolder, state.driveHistory[state.driveHistory.length - 1].name);
            } else {
                showAdvancedToast(`Trash failed: ${result.error}`, "warning");
            }
        } catch (err) {
            showAdvancedToast("Failed to communicate with Google Drive.", "error");
        } finally {
            btnTrashSelected.disabled = false;
            btnTrashSelected.innerHTML = '<i data-lucide="trash-2"></i> Move to Trash';
            lucide.createIcons();
            updateActionState();
        }
    });
}

// ---------------------------------------------------------
// NOTIFICATION & AUTO-UPDATE ENGINE
// ---------------------------------------------------------
async function runUpdateCheck() {
    try {
        const updateInfo = await eel.check_for_updates()();
        if (updateInfo && updateInfo.latest_version) {
            const confirmed = confirm(`Versi baru tersedia (v${updateInfo.latest_version})!\nApakah Anda ingin mengunduhnya sekarang?`);
            if (confirmed && updateInfo.download_url) {
                eel.open_url(updateInfo.download_url)();
            }
        }
    } catch (err) {
        console.error("[PhotoFlow] Update check failed:", err);
    }
}

// Run the radar exactly once when the DOM finishes loading
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial State UI Fixes
    document.body.classList.add('dark-theme');
    const driveView = document.getElementById('drive-explorer-view');
    if (driveView) driveView.style.display = 'none';
    
    // Ensure the default local view is active
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-target="tab-visual"]').classList.add('active');
    document.getElementById('tab-visual').style.display = 'block';

    // 2. Poll for Software Updates
    runUpdateCheck();

    // 3. Initialize Hybrid SaaS Auth System
    initHybridAuth();

    // 4. Update Drive Auth UI state (Drive is now server-managed)
    updateDriveAuthUI();
});

async function updateDriveAuthUI() {
    const isConnected = await eel.check_drive_auth(localStorage.getItem('user_id'))();
    const btn = document.getElementById('btn-drive-account');
    if (!btn) return;
    
    const icon = document.getElementById('drive-auth-icon');
    const text = document.getElementById('drive-auth-text');
    
    if (isConnected) {
        text.textContent = 'Connected';
        icon.setAttribute('data-lucide', 'cloud-check');
        icon.style.color = 'var(--success, #10b981)';
    } else {
        text.textContent = 'Disconnected';
        icon.setAttribute('data-lucide', 'cloud-off');
        icon.style.color = '#ef4444';
    }
    
    lucide.createIcons();
    btn.dataset.connected = isConnected;
}

let isDrivePolling = false; // Guard flag to prevent overlapping OAuth attempts

const btnDriveAccount = document.getElementById('btn-drive-account');
if (btnDriveAccount) {
    btnDriveAccount.addEventListener('click', async () => {
        // Block if already polling
        if (isDrivePolling) return;

        const isConnected = btnDriveAccount.dataset.connected === 'true';
        const text = document.getElementById('drive-auth-text');
        const icon = document.getElementById('drive-auth-icon');

        if (isConnected) {
            // ─── DISCONNECT FLOW ───────────────────────────
            const logoutConfirm = confirm("Anda sudah terhubung. Apakah Anda ingin Logout dan mengganti akun Google Drive?");
            if (!logoutConfirm) return;

            await eel.logout_drive_account(localStorage.getItem('user_id'))();

            // Update button UI to disconnected
            text.textContent = 'Disconnected';
            icon.setAttribute('data-lucide', 'cloud-off');
            icon.style.color = '#ef4444';
            lucide.createIcons();
            btnDriveAccount.dataset.connected = 'false';

            // Clear Cloud Workspace UI so stale data from old account is gone
            const driveGridEl = document.getElementById('drive-grid');
            if (driveGridEl) {
                driveGridEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">
                    Silakan hubungkan Google Drive terlebih dahulu.
                </div>`;
            }
            const breadcrumbsEl = document.getElementById('drive-breadcrumbs');
            if (breadcrumbsEl) breadcrumbsEl.innerHTML = '';

            // Reset drive navigation state
            if (typeof state !== 'undefined' && state.driveHistory) {
                state.driveHistory = [];
                state.currentDriveFolder = 'root';
                state.currentDriveItems = [];
                state.selectedDriveFiles.clear();
            }

            showAdvancedToast("Google Drive berhasil di-disconnect.", "info");
            return;
        }

        // ─── CONNECT FLOW ──────────────────────────────
        isDrivePolling = true;
        btnDriveAccount.disabled = true;
        btnDriveAccount.style.opacity = '0.6';
        btnDriveAccount.style.pointerEvents = 'none';
        text.textContent = "Opening Google...";

        // Open browser ONCE (outside the polling loop)
        const userId = localStorage.getItem('user_id');
        await eel.open_google_login(userId)();

        showAdvancedToast("Browser dibuka untuk login Google Drive. Silakan selesaikan proses di browser Anda.", "info");

        // Poll: check every 3s, max 20 attempts (60s)
        let attempts = 0;
        const maxAttempts = 20;
        const pollInterval = setInterval(async () => {
            try {
                attempts++;
                const remaining = (maxAttempts - attempts) * 3;
                text.textContent = `Waiting... (${remaining}s)`;

                const authOk = await eel.check_drive_auth(localStorage.getItem('user_id'))();

                if (authOk) {
                    // ── SUCCESS ──
                    clearInterval(pollInterval);
                    isDrivePolling = false;
                    btnDriveAccount.disabled = false;
                    btnDriveAccount.style.opacity = '';
                    btnDriveAccount.style.pointerEvents = '';
                    await updateDriveAuthUI();
                    showAdvancedToast("Google Drive berhasil terhubung!", "success");

                    // Clear stale workspace and force-reload root
                    const driveGridReload = document.getElementById('drive-grid');
                    if (driveGridReload) {
                        driveGridReload.innerHTML = `<div style="grid-column: 1/-1; display: flex; justify-content: center; padding: 40px;">
                            <div class="spinner-ring" style="border-color: rgba(96, 165, 250, 0.2); border-top-color: #60a5fa;"></div>
                        </div>`;
                    }
                    if (typeof openDriveFolder === 'function') {
                        await openDriveFolder('root', 'Google Drive');
                    }
                } else if (attempts >= maxAttempts) {
                    // ── TIMEOUT ──
                    clearInterval(pollInterval);
                    isDrivePolling = false;
                    btnDriveAccount.disabled = false;
                    btnDriveAccount.style.opacity = '';
                    btnDriveAccount.style.pointerEvents = '';
                    text.textContent = 'Disconnected';
                    icon.setAttribute('data-lucide', 'cloud-off');
                    icon.style.color = '#ef4444';
                    lucide.createIcons();
                    btnDriveAccount.dataset.connected = 'false';
                    showAdvancedToast("Waktu login habis atau dibatalkan.", "warning");
                }
            } catch (error) {
                console.error("[PhotoFlow] Polling error, retrying...", error);
                // Don't clear interval — let it keep trying until maxAttempts
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    isDrivePolling = false;
                    btnDriveAccount.disabled = false;
                    btnDriveAccount.style.opacity = '';
                    btnDriveAccount.style.pointerEvents = '';
                    text.textContent = 'Disconnected';
                    icon.setAttribute('data-lucide', 'cloud-off');
                    icon.style.color = '#ef4444';
                    lucide.createIcons();
                    btnDriveAccount.dataset.connected = 'false';
                    showAdvancedToast("Koneksi ke server bermasalah. Coba lagi nanti.", "warning");
                }
            }
        }, 3000);
    });
}


// ---------------------------------------------------------
// SYNC CLIENT SELECTIONS LOGIC (Supabase)
// ---------------------------------------------------------
let selectedSyncProjectId = null;
let selectedSyncProjectName = null;

// Web Admin Portal shortcut
const btnOpenWebAdmin = document.getElementById('btn-open-web-admin');
if (btnOpenWebAdmin) {
    btnOpenWebAdmin.addEventListener('click', () => {
        eel.open_url('https://photoflow-ecosystem.vercel.app/admin')();
    });
}

const btnSyncSelections = document.getElementById('btn-sync-selections');
const projectSyncModal = document.getElementById('project-sync-modal');
const projectListContainer = document.getElementById('project-list-container');
const btnConsolidateRaws = document.getElementById('btn-consolidate-raws');
const btnProjectSyncCancel = document.getElementById('btn-project-sync-cancel');

async function openSyncSelectionsModal() {
    selectedSyncProjectId = null;
    selectedSyncProjectName = null;
    btnConsolidateRaws.disabled = true;
    
    projectSyncModal.style.display = 'flex';
    projectListContainer.innerHTML = '<div style="text-align:center; padding: 20px;"><div class="spinner-ring" style="border-color: rgba(96, 165, 250, 0.2); border-top-color: #60a5fa; width: 24px; height: 24px;"></div></div>';
    setTimeout(() => { projectSyncModal.classList.add('active'); }, 10);
    
    let res = await eel.get_submitted_projects()();
    
    if (res && res.success) {
        if (!res.data || res.data.length === 0) {
            projectListContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Waiting for Client / No submitted projects found.</div>`;
        } else {
            projectListContainer.innerHTML = '';
            res.data.forEach(proj => {
                const card = document.createElement('div');
                card.className = 'modal-folder-item';
                card.style.flexDirection = 'column';
                card.style.alignItems = 'flex-start';
                card.style.gap = '4px';
                card.innerHTML = `
                    <div style="font-weight: 500; font-size: 1.1em; color: var(--text-primary);"><i data-lucide="folder-check" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 6px; color: #60a5fa;"></i>${proj.project_name}</div>
                    <div style="color: var(--text-muted); font-size: 0.9em;">Client: ${proj.client_name}</div>
                    <div style="color: #60a5fa; font-size: 0.85em; font-weight: 500;">Shortlisted Assets: ${proj.selection_count || 0}</div>
                `;
                card.addEventListener('click', () => {
                    document.querySelectorAll('#project-list-container .modal-folder-item').forEach(el => el.classList.remove('active'));
                    card.classList.add('active');
                    selectedSyncProjectId = proj.id;
                    selectedSyncProjectName = proj.project_name;
                    btnConsolidateRaws.disabled = false;
                });
                projectListContainer.appendChild(card);
            });
            lucide.createIcons();
        }
    } else {
        projectListContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Failed to fetch projects.<br><small>${res.error}</small></div>`;
    }
}

function closeSyncSelectionsModal() {
    projectSyncModal.classList.remove('active');
    setTimeout(() => { projectSyncModal.style.display = 'none'; }, 300);
}

if (btnSyncSelections) {
    btnSyncSelections.addEventListener('click', openSyncSelectionsModal);
}

if (btnProjectSyncCancel) {
    btnProjectSyncCancel.addEventListener('click', closeSyncSelectionsModal);
}

if (btnConsolidateRaws) {
    btnConsolidateRaws.addEventListener('click', async () => {
        const btn = document.getElementById('btn-consolidate-raws');
        
        // Validasi Source Folder TERLEBIH DAHULU
        if (!state.sourcePath) {
            showAdvancedToast("Mohon klik tombol 'Source Folder' di sidebar kiri dan pilih folder Anda terlebih dahulu.", "warning");
            closeSyncSelectionsModal();
            return;
        }

        btn.innerHTML = '<i data-lucide="loader" style="animation: spin 1s linear infinite;"></i> Identifying...';
        btn.disabled = true;
        lucide.createIcons();
        
        // Tutup instan modal agar notifikasi proses terlihat tanpa tertutup modal
        closeSyncSelectionsModal();

        try {
            let fileRes = await eel.get_project_filenames(selectedSyncProjectId)();
            if (!fileRes || !fileRes.success || fileRes.data.length === 0) {
                showAdvancedToast("Tidak ada foto yang dipilih klien atau koneksi gagal.", "warning");
                throw new Error("No files");
            }

            // Hapus pemanggilan destFolder dari Frontend, dipindah ke OS Backend
            showAdvancedToast("Mohon pilih folder tujuan export di jendela yang muncul...", "info");
            
            const result = await eel.auto_gather_raws(fileRes.data, state.sourcePath, selectedSyncProjectName)();
            
            if (result && !result.success) {
                showAdvancedToast(result.message || "Proses dibatalkan.", "warning");
            }

        } catch (err) {
            console.error("[PhotoFlow] UI Consolidate Error:", err);
        } finally {
            btn.innerHTML = 'Consolidate RAW Files';
            btn.disabled = false;
        }
    });
}
