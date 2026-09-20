// server.js - Entry point for Q-Less application
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const staffRoutes = require('./routes/staff');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'qless-mapua-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Attach IO to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Socket connection handling
io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);

  socket.on('join_user_room', (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on('join_department_room', (deptId) => {
    socket.join(`dept_${deptId}`);
  });

  socket.on('disconnect', () => {
    // disconnected
  });
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/admin', adminRoutes);

// Fallback for single-page routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Q-Less system running on http://localhost:${PORT}`);
  });
}

module.exports = app;
