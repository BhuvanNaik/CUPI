# NeonPulse Stocks

A real-time, neon-themed stock dashboard that allows users to subscribe to stocks and receive live price updates.

## Features

- **Secure User Authentication**: Login using email address with enhanced security features
- **Stock Subscriptions**: Subscribe to supported stocks (GOOG, TSLA, AMZN, META, NVDA)
- **Real-time Updates**: Stock prices update every second without page refresh
- **Multi-user Support**: Multiple users can subscribe to different stocks simultaneously
- **Live Price Updates**: Prices update asynchronously for each user based on their subscriptions
- **Dark Theme**: Modern dark theme UI with smooth transitions
- **Security Features**: Rate limiting, input validation, CSRF protection, and secure sessions

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **Real-time Communication**: Socket.io
- **Session Management**: Express-session

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (running on localhost:27017)

## Installation

1. Install dependencies:
```bash
npm install
```

2. (Optional) Make sure MongoDB is running on your system for persistent storage
   - The app will work with in-memory storage if MongoDB is not available
   - For production, MongoDB is recommended

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Login**: Enter your email address on the login page
2. **Subscribe**: Select a stock from the dropdown and click "Subscribe"
3. **View Updates**: Subscribed stocks will display with live prices updating every second
4. **Unsubscribe**: Click the "Unsubscribe" button on any stock card to remove it
5. **Multi-user**: Open multiple browser windows/tabs with different user accounts to see asynchronous updates

## Supported Stocks

- GOOG (Google)
- TSLA (Tesla)
- AMZN (Amazon)
- META (Meta/Facebook)
- NVDA (NVIDIA)

## Project Structure

```
├── server.js              # Express server and Socket.io setup
├── package.json           # Dependencies and scripts
├── public/
│   ├── login.html        # Login page
│   ├── dashboard.html    # Main dashboard
│   ├── login.js          # Login functionality
│   ├── dashboard.js      # Dashboard functionality
│   └── styles.css        # Styling
└── README.md             # This file
```

## Security Features

- **Rate Limiting**: Login attempts are limited to prevent brute force attacks
- **Input Validation**: Server-side and client-side email validation with sanitization
- **CSRF Protection**: Session cookies with SameSite attribute
- **Secure Headers**: Helmet.js for security headers
- **Session Security**: HttpOnly cookies, secure sessions, and proper session management
- **Input Sanitization**: Email inputs are sanitized and validated

## Notes

- Stock prices are generated using random number generators (not real market data)
- Prices update every second automatically
- Each user's dashboard only shows updates for their subscribed stocks
- The application uses session-based authentication
- Dark theme provides a modern, eye-friendly interface
- Data is stored in-memory if MongoDB is not available (data lost on restart)

