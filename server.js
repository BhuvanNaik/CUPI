const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static('public'));

// Enhanced session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'stock-broker-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'sessionId', // Don't use default session name
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  }
}));

// Rate limiting for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// MongoDB Connection
let isMongoConnected = false;

// In-memory storage as fallback
// Shape: { email, subscriptions: string[], portfolio: { cashBalance, holdings[] }, alerts: { thresholds[] } }
const inMemoryUsers = new Map();

mongoose.connect('mongodb://localhost:27017/stockbroker', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  isMongoConnected = true;
}).catch(err => {
  console.error('MongoDB connection error:', err);
  console.error('Using in-memory storage (data will be lost on server restart)');
  console.error('To use MongoDB, install it and make sure it\'s running on localhost:27017');
  isMongoConnected = false;
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
  isMongoConnected = false;
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected');
  isMongoConnected = true;
});

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  subscriptions: [{ type: String }],
  // Virtual portfolio simulation
  portfolio: {
    cashBalance: { type: Number, default: 100000 }, // starting virtual balance
    holdings: [{
      ticker: String,
      quantity: Number,
      avgPrice: Number
    }]
  },
  // Simple alert configuration per ticker
  alerts: {
    thresholds: [{
      ticker: String,
      above: Number, // alert when price >= above
      below: Number  // (optional) alert when price <= below
    }]
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Supported stocks
const SUPPORTED_STOCKS = ['GOOG', 'TSLA', 'AMZN', 'META', 'NVDA'];

// Stock price storage (in-memory for simplicity)
const stockPrices = {};
const userSockets = new Map(); // Map email to socket ID

// Initialize stock prices with random values
SUPPORTED_STOCKS.forEach(ticker => {
  stockPrices[ticker] = {
    price: (Math.random() * 1000 + 100).toFixed(2),
    change: (Math.random() * 20 - 10).toFixed(2),
    changePercent: ((Math.random() * 4 - 2)).toFixed(2)
  };
});

// Update stock prices every second
setInterval(() => {
  SUPPORTED_STOCKS.forEach(ticker => {
    const currentPrice = parseFloat(stockPrices[ticker].price);
    const change = (Math.random() * 10 - 5); // Random change between -5 and +5
    const newPrice = Math.max(10, currentPrice + change); // Ensure price doesn't go below 10
    const changePercent = ((change / currentPrice) * 100);
    
    stockPrices[ticker] = {
      price: newPrice.toFixed(2),
      change: change.toFixed(2),
      changePercent: changePercent.toFixed(2)
    };
  });

  // Broadcast updates and alerts to all connected users based on their subscriptions
  userSockets.forEach((socketId, email) => {
    if (isMongoConnected) {
      User.findOne({ email }).then(user => {
        if (user && user.subscriptions && user.subscriptions.length > 0) {
          const subscribedStocks = {};
          user.subscriptions.forEach(ticker => {
            const priceInfo = stockPrices[ticker];
            if (priceInfo) {
              subscribedStocks[ticker] = priceInfo;

              const changePercent = parseFloat(priceInfo.changePercent);

              // Sudden change alert (> 5% in one update)
              if (Math.abs(changePercent) > 5) {
                io.to(socketId).emit('priceAlert', {
                  ticker,
                  type: 'sudden-change',
                  changePercent,
                  price: parseFloat(priceInfo.price)
                });
              }

              // Threshold alerts
              const thresholds = user.alerts?.thresholds || [];
              const thresholdCfg = thresholds.find(t => t.ticker === ticker);
              if (thresholdCfg) {
                const price = parseFloat(priceInfo.price);
                if (typeof thresholdCfg.above === 'number' && price >= thresholdCfg.above) {
                  io.to(socketId).emit('priceAlert', {
                    ticker,
                    type: 'threshold-above',
                    threshold: thresholdCfg.above,
                    price
                  });
                }
                if (typeof thresholdCfg.below === 'number' && price <= thresholdCfg.below) {
                  io.to(socketId).emit('priceAlert', {
                    ticker,
                    type: 'threshold-below',
                    threshold: thresholdCfg.below,
                    price
                  });
                }
              }
            }
          });
          io.to(socketId).emit('stockUpdate', subscribedStocks);
        }
      }).catch(err => console.error('Error fetching user subscriptions:', err));
    } else {
      const user = inMemoryUsers.get(email);
      if (user && user.subscriptions && user.subscriptions.length > 0) {
        const subscribedStocks = {};
        user.subscriptions.forEach(ticker => {
          const priceInfo = stockPrices[ticker];
          if (priceInfo) {
            subscribedStocks[ticker] = priceInfo;

            const changePercent = parseFloat(priceInfo.changePercent);

            if (Math.abs(changePercent) > 5) {
              io.to(socketId).emit('priceAlert', {
                ticker,
                type: 'sudden-change',
                changePercent,
                price: parseFloat(priceInfo.price)
              });
            }

            const thresholds = user.alerts?.thresholds || [];
            const thresholdCfg = thresholds.find(t => t.ticker === ticker);
            if (thresholdCfg) {
              const price = parseFloat(priceInfo.price);
              if (typeof thresholdCfg.above === 'number' && price >= thresholdCfg.above) {
                io.to(socketId).emit('priceAlert', {
                  ticker,
                  type: 'threshold-above',
                  threshold: thresholdCfg.above,
                  price
                });
              }
              if (typeof thresholdCfg.below === 'number' && price <= thresholdCfg.below) {
                io.to(socketId).emit('priceAlert', {
                  ticker,
                  type: 'threshold-below',
                  threshold: thresholdCfg.below,
                  price
                });
              }
            }
          }
        });
        io.to(socketId).emit('stockUpdate', subscribedStocks);
      }
    }
  });
}, 1000);

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.userEmail) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Input sanitization helper
function sanitizeEmail(email) {
  if (!email) return '';
  return email.trim().toLowerCase().slice(0, 100); // Limit length
}

// Login endpoint with security enhancements
app.post('/api/login', loginLimiter, [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .isLength({ max: 100 })
    .withMessage('Email is too long')
    .normalizeEmail()
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const email = sanitizeEmail(req.body.email);
    
    // Additional validation
    if (!email || email.length < 5 || !email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Prevent email enumeration by using consistent timing
    await new Promise(resolve => setTimeout(resolve, 100)); // Add small delay

    if (isMongoConnected) {
      // Use MongoDB
      let user = await User.findOne({ email });
      
      if (!user) {
        user = new User({ 
          email, 
          subscriptions: [], 
          portfolio: { cashBalance: 100000, holdings: [] },
          alerts: { thresholds: [] }
        });
        await user.save();
      }

      req.session.userEmail = email;
      res.json({ success: true, email: user.email, subscriptions: user.subscriptions });
    } else {
      // Use in-memory storage
      if (!inMemoryUsers.has(email)) {
        inMemoryUsers.set(email, { 
          email, 
          subscriptions: [], 
          portfolio: { cashBalance: 100000, holdings: [] },
          alerts: { thresholds: [] }
        });
      }

      const user = inMemoryUsers.get(email);
      req.session.userEmail = email;
      res.json({ success: true, email: user.email, subscriptions: user.subscriptions });
    }
  } catch (error) {
    console.error('Login error:', error);
    if (error.name === 'MongoServerError' || error.name === 'MongooseError') {
      res.status(503).json({ 
        error: 'Database error. Please check if MongoDB is running and try again.' 
      });
    } else {
      res.status(500).json({ error: 'Login failed: ' + error.message });
    }
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/user', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (isMongoConnected) {
      const user = await User.findOne({ email: req.session.userEmail });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ 
        email: user.email, 
        subscriptions: user.subscriptions,
        portfolio: user.portfolio,
        alerts: user.alerts
      });
    } else {
      const user = inMemoryUsers.get(req.session.userEmail);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ 
        email: user.email, 
        subscriptions: user.subscriptions,
        portfolio: user.portfolio,
        alerts: user.alerts
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  }
});

// Get supported stocks
app.get('/api/stocks', (req, res) => {
  res.json({ stocks: SUPPORTED_STOCKS });
});

// Get current portfolio
app.get('/api/portfolio', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (isMongoConnected) {
      const user = await User.findOne({ email: req.session.userEmail });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user.portfolio || { cashBalance: 100000, holdings: [] });
    } else {
      const user = inMemoryUsers.get(req.session.userEmail);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user.portfolio || { cashBalance: 100000, holdings: [] });
    }
  } catch (err) {
    console.error('Get portfolio error:', err);
    return res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

// Execute virtual trade (buy/sell)
app.post('/api/trade', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { ticker, side, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!SUPPORTED_STOCKS.includes(ticker)) {
      return res.status(400).json({ error: 'Unsupported stock ticker' });
    }
    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: 'Invalid trade side' });
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    const priceInfo = stockPrices[ticker];
    if (!priceInfo) {
      return res.status(400).json({ error: 'No price available for this ticker' });
    }
    const currentPrice = parseFloat(priceInfo.price);
    const tradeValue = currentPrice * qty;

    let user;
    if (isMongoConnected) {
      user = await User.findOne({ email: req.session.userEmail });
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.portfolio) {
        user.portfolio = { cashBalance: 100000, holdings: [] };
      }
    } else {
      user = inMemoryUsers.get(req.session.userEmail);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.portfolio) {
        user.portfolio = { cashBalance: 100000, holdings: [] };
      }
    }

    const portfolio = user.portfolio;
    let holding = portfolio.holdings.find(h => h.ticker === ticker);

    if (side === 'buy') {
      if (portfolio.cashBalance < tradeValue) {
        return res.status(400).json({ error: 'Insufficient virtual balance' });
      }
      portfolio.cashBalance -= tradeValue;

      if (!holding) {
        holding = { ticker, quantity: qty, avgPrice: currentPrice };
        portfolio.holdings.push(holding);
      } else {
        const totalCost = holding.avgPrice * holding.quantity + tradeValue;
        const totalQty = holding.quantity + qty;
        holding.quantity = totalQty;
        holding.avgPrice = totalCost / totalQty;
      }
    } else if (side === 'sell') {
      if (!holding || holding.quantity < qty) {
        return res.status(400).json({ error: 'Not enough shares to sell' });
      }
      holding.quantity -= qty;
      portfolio.cashBalance += tradeValue;
      if (holding.quantity === 0) {
        portfolio.holdings = portfolio.holdings.filter(h => h.ticker !== ticker);
      }
    }

    if (isMongoConnected) {
      await user.save();
    } else {
      inMemoryUsers.set(user.email, user);
    }

    return res.json(portfolio);
  } catch (err) {
    console.error('Trade error:', err);
    return res.status(500).json({ error: 'Trade failed' });
  }
});

// Get alert thresholds
app.get('/api/alerts', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    if (isMongoConnected) {
      const user = await User.findOne({ email: req.session.userEmail });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user.alerts || { thresholds: [] });
    } else {
      const user = inMemoryUsers.get(req.session.userEmail);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user.alerts || { thresholds: [] });
    }
  } catch (err) {
    console.error('Get alerts error:', err);
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
});

// Set alert threshold for a ticker
app.post('/api/alerts', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { ticker, above, below } = req.body;
    if (!SUPPORTED_STOCKS.includes(ticker)) {
      return res.status(400).json({ error: 'Unsupported stock ticker' });
    }

    let user;
    if (isMongoConnected) {
      user = await User.findOne({ email: req.session.userEmail });
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.alerts) user.alerts = { thresholds: [] };
    } else {
      user = inMemoryUsers.get(req.session.userEmail);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.alerts) user.alerts = { thresholds: [] };
    }

    const numericAbove = above !== undefined && above !== null ? parseFloat(above) : null;
    const numericBelow = below !== undefined && below !== null ? parseFloat(below) : null;

    // Remove existing config for ticker
    user.alerts.thresholds = (user.alerts.thresholds || []).filter(a => a.ticker !== ticker);

    if (!isNaN(numericAbove) || !isNaN(numericBelow)) {
      user.alerts.thresholds.push({
        ticker,
        above: isNaN(numericAbove) ? undefined : numericAbove,
        below: isNaN(numericBelow) ? undefined : numericBelow
      });
    }

    if (isMongoConnected) {
      await user.save();
    } else {
      inMemoryUsers.set(user.email, user);
    }

    return res.json(user.alerts);
  } catch (err) {
    console.error('Set alerts error:', err);
    return res.status(500).json({ error: 'Failed to update alerts' });
  }
});

// Subscribe to stock
app.post('/api/subscribe', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { ticker } = req.body;
    
    if (!SUPPORTED_STOCKS.includes(ticker)) {
      return res.status(400).json({ error: 'Unsupported stock ticker' });
    }

    if (isMongoConnected) {
      const user = await User.findOne({ email: req.session.userEmail });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.subscriptions.includes(ticker)) {
        user.subscriptions.push(ticker);
        await user.save();
      }

      res.json({ success: true, subscriptions: user.subscriptions });
    } else {
      const user = inMemoryUsers.get(req.session.userEmail);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.subscriptions.includes(ticker)) {
        user.subscriptions.push(ticker);
      }

      res.json({ success: true, subscriptions: user.subscriptions });
    }
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

// Unsubscribe from stock
app.post('/api/unsubscribe', async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { ticker } = req.body;
    
    if (isMongoConnected) {
      const user = await User.findOne({ email: req.session.userEmail });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.subscriptions = user.subscriptions.filter(sub => sub !== ticker);
      await user.save();

      res.json({ success: true, subscriptions: user.subscriptions });
    } else {
      const user = inMemoryUsers.get(req.session.userEmail);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      user.subscriptions = user.subscriptions.filter(sub => sub !== ticker);

      res.json({ success: true, subscriptions: user.subscriptions });
    }
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Unsubscription failed' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', async (email) => {
    userSockets.set(email, socket.id);
    console.log(`User ${email} registered with socket ${socket.id}`);
    
    // Send initial stock prices for user's subscriptions
    try {
      let user;
      if (isMongoConnected) {
        user = await User.findOne({ email });
      } else {
        user = inMemoryUsers.get(email);
      }
      
      if (user && user.subscriptions && user.subscriptions.length > 0) {
        const subscribedStocks = {};
        user.subscriptions.forEach(ticker => {
          if (stockPrices[ticker]) {
            subscribedStocks[ticker] = stockPrices[ticker];
          }
        });
        socket.emit('stockUpdate', subscribedStocks);
      }
    } catch (error) {
      console.error('Error sending initial stock prices:', error);
    }
  });

  socket.on('disconnect', () => {
    // Remove user from map
    for (const [email, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(email);
        console.log(`User ${email} disconnected`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

