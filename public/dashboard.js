let socket;
let currentUser = null;
let stockPrices = {}; // Store latest prices for animation and highlights
const priceHistory = {}; // Track history for sparklines
const stockNames = {
    'GOOG': 'Google',
    'TSLA': 'Tesla',
    'AMZN': 'Amazon',
    'META': 'Meta',
    'NVDA': 'NVIDIA'
};

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();

    // Check authentication
    try {
        const response = await fetch('/api/user');
        if (!response.ok) {
            window.location.href = '/';
            return;
        }
        currentUser = await response.json();
        document.getElementById('userEmail').textContent = currentUser.email;
        updateSubscriptionCount();
    } catch (error) {
        console.error('Error fetching user:', error);
        window.location.href = '/';
        return;
    }

    // Initialize socket connection
    socket = io();
    
    // Socket connection status
    socket.on('connect', () => {
        updateConnectionStatus(true);
        socket.emit('register', currentUser.email);
    });

    socket.on('disconnect', () => {
        updateConnectionStatus(false);
    });

    socket.on('connect_error', () => {
        updateConnectionStatus(false);
    });

    // Load supported stocks
    await loadSupportedStocks();
    
    // Load user subscriptions
    await loadSubscriptions();

    // Setup event listeners
    document.getElementById('subscribeBtn').addEventListener('click', subscribeToStock);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Stock search functionality
    const searchInput = document.getElementById('stockSearch');
    searchInput.addEventListener('input', filterStocks);
    
    // Enter key to subscribe
    document.getElementById('stockSelect').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            subscribeToStock();
        }
    });

    // Portfolio actions
    document.getElementById('buyBtn').addEventListener('click', () => executeTrade('buy'));
    document.getElementById('sellBtn').addEventListener('click', () => executeTrade('sell'));

    // Alerts
    document.getElementById('saveAlertBtn').addEventListener('click', saveAlertConfig);

    // Live alerts from server
    socket.on('priceAlert', handlePriceAlert);

    // Load portfolio & alerts
    await Promise.all([loadPortfolio(), loadAlerts()]);
});

function updateConnectionStatus(connected) {
    const statusIndicator = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = 'Live';
    } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Disconnected';
    }
}

function updateSubscriptionCount() {
    const count = currentUser?.subscriptions?.length || 0;
    document.getElementById('subscriptionCount').textContent = count;
    document.getElementById('overviewTotal').textContent = count;
}

function initTheme() {
    const root = document.documentElement;
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);

    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
        });
    }
}

function setTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
}

async function loadSupportedStocks() {
    try {
        const response = await fetch('/api/stocks');
        const data = await response.json();
        const select = document.getElementById('stockSelect');
        const tradeSelect = document.getElementById('tradeTicker');
        const alertSelect = document.getElementById('alertTicker');
        const tagsContainer = document.getElementById('stockTags');
        
        // Clear existing options except the first one
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }
        tagsContainer.innerHTML = '';
        while (tradeSelect.children.length > 1) {
            tradeSelect.removeChild(tradeSelect.lastChild);
        }
        while (alertSelect.children.length > 1) {
            alertSelect.removeChild(alertSelect.lastChild);
        }
        
        data.stocks.forEach(ticker => {
            // Add to select dropdown
            const option = document.createElement('option');
            option.value = ticker;
            option.textContent = `${ticker} - ${stockNames[ticker] || ticker}`;
            select.appendChild(option);

            const tradeOption = document.createElement('option');
            tradeOption.value = ticker;
            tradeOption.textContent = ticker;
            tradeSelect.appendChild(tradeOption);

            const alertOption = document.createElement('option');
            alertOption.value = ticker;
            alertOption.textContent = ticker;
            alertSelect.appendChild(alertOption);
            
            // Add to tags
            const tag = document.createElement('span');
            tag.className = 'stock-tag';
            tag.textContent = ticker;
            tag.dataset.ticker = ticker;
            tag.addEventListener('click', () => {
                select.value = ticker;
                select.focus();
            });
            tagsContainer.appendChild(tag);
        });
    } catch (error) {
        console.error('Error loading stocks:', error);
    }
}

function filterStocks(e) {
    const searchTerm = e.target.value.toLowerCase();
    const tags = document.querySelectorAll('.stock-tag');
    const options = document.querySelectorAll('#stockSelect option');
    
    tags.forEach(tag => {
        const ticker = tag.dataset.ticker.toLowerCase();
        if (ticker.includes(searchTerm)) {
            tag.style.display = 'inline-block';
        } else {
            tag.style.display = 'none';
        }
    });
    
    // Filter dropdown options
    options.forEach((option, index) => {
        if (index === 0) return; // Skip first option
        const text = option.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });
}

async function loadSubscriptions() {
    if (!currentUser || !currentUser.subscriptions) {
        return;
    }

    const container = document.getElementById('stocksContainer');
    
    // Remove no-stocks card if subscriptions exist
    if (currentUser.subscriptions.length > 0) {
        const noStocksCard = container.querySelector('.no-stocks-card');
        if (noStocksCard) {
            noStocksCard.remove();
        }
    } else {
        container.innerHTML = `
            <div class="no-stocks-card">
                <div class="no-stocks-icon">📈</div>
                <p class="no-stocks-title">No Subscriptions Yet</p>
                <p class="no-stocks-desc">Subscribe to stocks above to see real-time price updates</p>
            </div>
        `;
        return;
    }

    // Create placeholder cards for subscribed stocks
    currentUser.subscriptions.forEach(ticker => {
        createStockCard(ticker, { price: '0.00', change: '0.00', changePercent: '0.00' }, false);
    });

    // Clear highlights until real data arrives
    updateHighlights();
}

async function subscribeToStock() {
    const select = document.getElementById('stockSelect');
    const ticker = select.value;

    if (!ticker) {
        showToast('Please select a stock to subscribe to', 'warning');
        return;
    }

    if (currentUser.subscriptions.includes(ticker)) {
        showToast(`You are already subscribed to ${ticker}`, 'info');
        return;
    }

    const btn = document.getElementById('subscribeBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>Subscribing...</span>';

    try {
        const response = await fetch('/api/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ticker })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            currentUser.subscriptions = data.subscriptions;
            await loadSubscriptions();
            select.value = '';
            document.getElementById('stockSearch').value = '';
            updateSubscriptionCount();
            
            // Re-register with socket to get updates
            socket.emit('register', currentUser.email);
            showToast(`Successfully subscribed to ${ticker}`, 'success');
        } else {
            showToast(data.error || 'Failed to subscribe to stock', 'error');
        }
    } catch (error) {
        console.error('Subscribe error:', error);
        showToast('Network error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function unsubscribeFromStock(ticker) {
    if (!confirm(`Are you sure you want to unsubscribe from ${ticker}?`)) {
        return;
    }

    try {
        const response = await fetch('/api/unsubscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ticker })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            currentUser.subscriptions = data.subscriptions;
            
            // Animate card removal
            const card = document.getElementById(`stock-${ticker}`);
            if (card) {
                card.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => {
                    loadSubscriptions();
                    updateSubscriptionCount();
                    socket.emit('register', currentUser.email);
                }, 300);
            } else {
                await loadSubscriptions();
                updateSubscriptionCount();
                socket.emit('register', currentUser.email);
            }
            
            showToast(`Unsubscribed from ${ticker}`, 'info');
        } else {
            showToast(data.error || 'Failed to unsubscribe from stock', 'error');
        }
    } catch (error) {
        console.error('Unsubscribe error:', error);
        showToast('Network error. Please try again.', 'error');
    }
}

function createStockCard(ticker, stockData, animate = true) {
    const container = document.getElementById('stocksContainer');
    
    // Remove no-stocks card if present
    const noStocksCard = container.querySelector('.no-stocks-card');
    if (noStocksCard) {
        noStocksCard.remove();
    }

    // Check if card already exists
    let card = document.getElementById(`stock-${ticker}`);
    const isNew = !card;
    const priceNum = parseFloat(stockData.price);
    const changeNum = parseFloat(stockData.change);
    const changePercentNum = parseFloat(stockData.changePercent);
    const previousPrice = stockPrices[ticker]?.priceNum ?? priceNum;
    const priceChanged = previousPrice !== priceNum;
    
    if (!card) {
        card = document.createElement('div');
        card.id = `stock-${ticker}`;
        card.className = 'stock-card';
        if (animate) {
            card.style.animation = 'slideIn 0.4s ease-out';
        }
        container.appendChild(card);
    }

    const isPositive = changeNum >= 0;
    const companyName = stockNames[ticker] || ticker;
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Add price change animation class
    if (priceChanged && !isNew) {
        card.classList.add(isPositive ? 'price-up' : 'price-down');
        setTimeout(() => {
            card.classList.remove('price-up', 'price-down');
        }, 600);
    }

    card.innerHTML = `
        <div class="stock-card-header">
            <div class="stock-info">
                <div class="stock-ticker">${ticker}</div>
                <div class="stock-company">${companyName}</div>
            </div>
            <button class="unsubscribe-btn" onclick="unsubscribeFromStock('${ticker}')" title="Unsubscribe">
                <span>✕</span>
            </button>
        </div>
        <div class="stock-price-container">
            <div class="stock-price" data-price="${stockData.price}">$${priceNum.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div class="stock-change ${isPositive ? 'positive' : 'negative'}">
                <span class="change-icon">${isPositive ? '↗' : '↘'}</span>
                <span class="change-value">$${Math.abs(changeNum).toFixed(2)}</span>
                <span class="change-percent">(${Math.abs(changePercentNum).toFixed(2)}%)</span>
            </div>
        </div>
        <div class="sparkline-container">
            <canvas id="spark-${ticker}" width="140" height="50"></canvas>
        </div>
        <div class="stock-footer">
            <div class="update-time">Updated at ${timeString}</div>
        </div>
    `;

    // Store current price for next update and highlights
    stockPrices[ticker] = { ...stockData, priceNum, changeNum, changePercentNum };

    // Record price history for sparkline
    recordPriceHistory(ticker, priceNum);
    drawSparkline(ticker);
}

function updateStockPrices(stocks) {
    Object.keys(stocks).forEach(ticker => {
        createStockCard(ticker, stocks[ticker], false);
    });
    updateHighlights();
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function recordPriceHistory(ticker, price) {
    if (!priceHistory[ticker]) {
        priceHistory[ticker] = [];
    }
    const history = priceHistory[ticker];
    history.push(price);
    // Keep roughly last 30 seconds (assuming 1 update per second)
    if (history.length > 30) {
        history.shift();
    }
}

function drawSparkline(ticker) {
    const history = priceHistory[ticker];
    const canvas = document.getElementById(`spark-${ticker}`);
    if (!canvas || !history || history.length < 2) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const w = width;
    const h = height;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    history.forEach((value, idx) => {
        const x = (idx / (history.length - 1)) * (w - 4) + 2;
        const y = h - ((value - min) / range) * (h - 6) - 3;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(237, 152, 95, 0.35)');
    gradient.addColorStop(1, 'rgba(237, 152, 95, 0)');
    ctx.lineTo(w - 2, h);
    ctx.lineTo(2, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
}

function updateHighlights() {
    const total = currentUser?.subscriptions?.length || 0;
    document.getElementById('overviewTotal').textContent = total;

    const entries = Object.entries(stockPrices);
    if (entries.length === 0) {
        document.getElementById('overviewGainer').textContent = '—';
        document.getElementById('overviewLoser').textContent = '—';
        document.getElementById('overviewPulse').textContent = '—';
        document.getElementById('overviewGainerChange').textContent = 'Waiting for data';
        document.getElementById('overviewLoserChange').textContent = 'Waiting for data';
        document.getElementById('overviewPulseDesc').textContent = 'Awaiting updates';
        return;
    }

    let topGainer = null;
    let topLoser = null;
    let totalChange = 0;

    entries.forEach(([ticker, data]) => {
        const pct = data.changePercentNum ?? parseFloat(data.changePercent);
        if (isNaN(pct)) return;
        totalChange += pct;

        if (!topGainer || pct > topGainer.change) {
            topGainer = { ticker, change: pct };
        }
        if (!topLoser || pct < topLoser.change) {
            topLoser = { ticker, change: pct };
        }
    });

    const avgChange = totalChange / entries.length;

    if (topGainer) {
        document.getElementById('overviewGainer').textContent = topGainer.ticker;
        document.getElementById('overviewGainerChange').textContent = `+${topGainer.change.toFixed(2)}%`;
    }

    if (topLoser) {
        document.getElementById('overviewLoser').textContent = topLoser.ticker;
        document.getElementById('overviewLoserChange').textContent = `${topLoser.change.toFixed(2)}%`;
    }

    if (!isNaN(avgChange)) {
        const pulseEl = document.getElementById('overviewPulse');
        const descEl = document.getElementById('overviewPulseDesc');
        const sign = avgChange >= 0 ? '+' : '';
        pulseEl.textContent = `${sign}${avgChange.toFixed(2)}%`;
        descEl.textContent = avgChange >= 0 ? 'Overall trending up' : 'Overall trending down';
    }
}

async function loadPortfolio() {
    try {
        const res = await fetch('/api/portfolio');
        if (!res.ok) return;
        const portfolio = await res.json();
        currentUser.portfolio = portfolio;
        renderPortfolio();
    } catch (err) {
        console.error('Load portfolio error:', err);
    }
}

async function executeTrade(side) {
    const ticker = document.getElementById('tradeTicker').value;
    const quantity = parseInt(document.getElementById('tradeQuantity').value, 10);

    if (!ticker) {
        showToast('Select a stock to trade', 'warning');
        return;
    }
    if (!quantity || quantity <= 0) {
        showToast('Enter a positive quantity', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, side, quantity })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Trade failed', 'error');
            return;
        }
        currentUser.portfolio = data;
        renderPortfolio();
        document.getElementById('tradeQuantity').value = '';
        showToast(`Trade executed: ${side.toUpperCase()} ${quantity} ${ticker}`, 'success');
    } catch (err) {
        console.error('Trade error:', err);
        showToast('Network error while trading', 'error');
    }
}

function renderPortfolio() {
    const portfolio = currentUser.portfolio || { cashBalance: 0, holdings: [] };
    const cashEl = document.getElementById('cashBalance');
    const portfolioEl = document.getElementById('portfolioValue');
    const totalEl = document.getElementById('totalValue');
    const body = document.getElementById('holdingsBody');

    const holdings = portfolio.holdings || [];
    let portfolioValue = 0;

    body.innerHTML = '';

    if (holdings.length === 0) {
        const row = document.createElement('tr');
        row.className = 'no-holdings-row';
        row.innerHTML = '<td colspan="5">No positions yet. Buy a stock to start your portfolio.</td>';
        body.appendChild(row);
    } else {
        holdings.forEach(h => {
            const lastPrice = stockPrices[h.ticker]?.priceNum ?? stockPrices[h.ticker]?.price ?? 0;
            const lastPriceNum = parseFloat(lastPrice) || 0;
            const value = lastPriceNum * h.quantity;
            portfolioValue += value;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${h.ticker}</td>
                <td>${h.quantity}</td>
                <td>$${(h.avgPrice || 0).toFixed(2)}</td>
                <td>$${lastPriceNum.toFixed(2)}</td>
                <td>$${value.toFixed(2)}</td>
            `;
            body.appendChild(tr);
        });
    }

    const cash = portfolio.cashBalance || 0;
    cashEl.textContent = `$${cash.toFixed(2)}`;
    portfolioEl.textContent = `$${portfolioValue.toFixed(2)}`;
    totalEl.textContent = `$${(cash + portfolioValue).toFixed(2)}`;
}

async function loadAlerts() {
    try {
        const res = await fetch('/api/alerts');
        if (!res.ok) return;
        const alerts = await res.json();
        currentUser.alerts = alerts;
    } catch (err) {
        console.error('Load alerts error:', err);
    }
}

async function saveAlertConfig() {
    const ticker = document.getElementById('alertTicker').value;
    const aboveVal = document.getElementById('alertAbove').value;
    const belowVal = document.getElementById('alertBelow').value;

    if (!ticker) {
        showToast('Select a stock for alerts', 'warning');
        return;
    }

    const payload = { ticker };
    if (aboveVal) payload.above = parseFloat(aboveVal);
    if (belowVal) payload.below = parseFloat(belowVal);

    try {
        const res = await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Failed to save alert', 'error');
            return;
        }
        currentUser.alerts = data;
        showToast('Alert configuration saved', 'success');
    } catch (err) {
        console.error('Save alert error:', err);
        showToast('Network error while saving alert', 'error');
    }
}

function handlePriceAlert(payload) {
    const { ticker, type, changePercent, threshold, price } = payload;
    if (type === 'sudden-change') {
        showToast(`${ticker} moved ${changePercent.toFixed ? changePercent.toFixed(2) : changePercent}% in one tick`, 'warning');
    } else if (type === 'threshold-above') {
        showToast(`${ticker} crossed above $${threshold.toFixed(2)} (now $${price.toFixed(2)})`, 'info');
    } else if (type === 'threshold-below') {
        showToast(`${ticker} crossed below $${threshold.toFixed(2)} (now $${price.toFixed(2)})`, 'info');
    }
}

async function logout() {
    if (socket) {
        socket.disconnect();
    }
    try {
        await fetch('/api/logout', {
            method: 'POST'
        });
        window.location.href = '/';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/';
    }
}

// Make unsubscribeFromStock available globally for onclick handler
window.unsubscribeFromStock = unsubscribeFromStock;
