import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import bodyParser from 'body-parser';


const app = express();
app.use(express.json());
// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost and common development ports
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5173'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Log blocked origins for debugging
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

app.use(bodyParser.json());

// Environment variables with defaults
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const PAYMENT_GATEWAY_API_KEY = process.env.PAYMENT_GATEWAY_API_KEY || 'test_key';
const PAYMENT_GATEWAY_SECRET = process.env.PAYMENT_GATEWAY_SECRET || 'test_secret';
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER || 'test@example.com';
const SMTP_PASS = process.env.SMTP_PASS || 'test_password';

const INIT_DB = process.argv.includes('--initdb');

// --- SQLite setup ---
let db;



async function setupDatabase() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });
  // Create tables if not exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT CHECK(role IN ('superadmin', 'consultant')) NOT NULL DEFAULT 'consultant',
      status TEXT CHECK(status IN ('active', 'inactive')) NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS consultants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      image TEXT,
      description TEXT,
      tagline TEXT,
      location_lat REAL,
      location_lng REAL,
      address TEXT,
      speciality TEXT,
      id_proof_type TEXT,
      id_proof_url TEXT,
      aadhar TEXT,
      bank_account TEXT,
      bank_ifsc TEXT,
      status TEXT CHECK(status IN ('online', 'offline')) NOT NULL DEFAULT 'offline',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS consultant_categories (
      consultant_id INTEGER,
      category_id INTEGER,
      PRIMARY KEY (consultant_id, category_id),
      FOREIGN KEY(consultant_id) REFERENCES consultants(id),
      FOREIGN KEY(category_id) REFERENCES ailments_category(id)
    );
    CREATE TABLE IF NOT EXISTS consultant_subcategories (
      consultant_id INTEGER,
      subcategory_id INTEGER,
      PRIMARY KEY (consultant_id, subcategory_id),
      FOREIGN KEY(consultant_id) REFERENCES consultants(id),
      FOREIGN KEY(subcategory_id) REFERENCES ailments_subcategory(id)
    );
    CREATE TABLE IF NOT EXISTS consultant_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultant_id INTEGER,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY(consultant_id) REFERENCES consultants(id)
    );
    -- Services tables
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      delivery_mode TEXT CHECK(delivery_mode IN ('online', 'offline')) NOT NULL,
      service_type TEXT CHECK(service_type IN ('appointment', 'subscription', 'event', 'test')) NOT NULL,
      appointment_type TEXT,
      event_type TEXT,
      test_type TEXT,
      revenue_type TEXT CHECK(revenue_type IN ('paid', 'promotional')) NOT NULL,
      price REAL,
      renewal_date TEXT,
      center TEXT,
      test_redirect_url TEXT,
      subscription_start TEXT,
      subscription_end TEXT,
      discount REAL,
      monthly_price REAL,
      yearly_price REAL,
      center_address TEXT,
      center_lat REAL,
      center_lng REAL,
      event_start TEXT,
      event_end TEXT,
      event_image TEXT,
      event_meet_link TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS service_ailment_categories (
      service_id INTEGER,
      category_id INTEGER,
      PRIMARY KEY (service_id, category_id),
      FOREIGN KEY(service_id) REFERENCES services(id),
      FOREIGN KEY(category_id) REFERENCES ailments_category(id)
    );
    CREATE TABLE IF NOT EXISTS service_ailment_subcategories (
      service_id INTEGER,
      subcategory_id INTEGER,
      PRIMARY KEY (service_id, subcategory_id),
      FOREIGN KEY(service_id) REFERENCES services(id),
      FOREIGN KEY(subcategory_id) REFERENCES ailments_subcategory(id)
    );
    CREATE TABLE IF NOT EXISTS service_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      title TEXT,
      description TEXT,
      redirect_url TEXT,
      slot INTEGER,
      FOREIGN KEY(service_id) REFERENCES services(id)
    );
    -- Many-to-many: services <-> consultants
    CREATE TABLE IF NOT EXISTS services_consultants (
      service_id INTEGER,
      consultant_id INTEGER,
      PRIMARY KEY (service_id, consultant_id),
      FOREIGN KEY(service_id) REFERENCES services(id),
      FOREIGN KEY(consultant_id) REFERENCES consultants(id)
    );
  `);
  // Seed admin if not exists
  const admin = await db.get('SELECT * FROM admin WHERE username = ?', 'admin');
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    try {
      await db.run('INSERT INTO admin (username, password) VALUES (?, ?)', 'admin', hash);
      console.log('Seeded default admin: admin/admin123');
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        console.log('Admin user already exists, skipping insert.');
      } else {
        throw err;
      }
    }
  }
  // Seed superadmin user in users table if not exists
  const superadminUser = await db.get('SELECT * FROM users WHERE username = ?', 'admin');
  if (!superadminUser) {
    const hash = await bcrypt.hash('admin123', 10);
    try {
      await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 'admin', hash, 'superadmin');
      console.log('Seeded superadmin user: admin/admin123');
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        console.log('Superadmin user already exists, skipping insert.');
      } else {
        throw err;
      }
    }
  }

  // --- MIGRATION: Add status column to users if missing ---
  const userCols = await db.all("PRAGMA table_info(users)");
  if (!userCols.some(col => col.name === 'status')) {
    await db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
    await db.exec("UPDATE users SET status = 'active' WHERE status IS NULL");
    console.log('Migrated: Added status column to users table.');
  }
  // Ensure all users have status
  await db.exec("UPDATE users SET status = 'active' WHERE status IS NULL");

  // --- MIGRATION: Add name and email columns to users if missing ---
  if (!userCols.some(col => col.name === 'name')) {
    await db.exec("ALTER TABLE users ADD COLUMN name TEXT");
    console.log('Migrated: Added name column to users table.');
  }
  if (!userCols.some(col => col.name === 'email')) {
    await db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    console.log('Migrated: Added email column to users table.');
  }

  // --- MIGRATION: Add new service fields if missing ---
  const serviceCols = await db.all("PRAGMA table_info(services)");
  const addCol = async (col, type) => {
    if (!serviceCols.some(c => c.name === col)) {
      await db.exec(`ALTER TABLE services ADD COLUMN ${col} ${type}`);
      console.log(`Migrated: Added ${col} column to services table.`);
    }
  };
  await addCol('subscription_start', 'TEXT');
  await addCol('subscription_end', 'TEXT');
  await addCol('discount', 'REAL');
  await addCol('monthly_price', 'REAL');
  await addCol('yearly_price', 'REAL');
  await addCol('center_address', 'TEXT');
  await addCol('center_lat', 'REAL');
  await addCol('center_lng', 'REAL');
  await addCol('event_start', 'TEXT');
  await addCol('event_end', 'TEXT');
  await addCol('event_image', 'TEXT');
  await addCol('event_meet_link', 'TEXT');

  // --- MIGRATION: Add city column to consultants if missing ---
  const consultantCols = await db.all("PRAGMA table_info(consultants)");
  if (!consultantCols.some(col => col.name === 'city')) {
    await db.exec("ALTER TABLE consultants ADD COLUMN city TEXT");
    console.log('Migrated: Added city column to consultants table.');
  }
  
  // --- MIGRATION: Add featured column to consultants if missing ---
  if (!consultantCols.some(col => col.name === 'featured')) {
    await db.exec("ALTER TABLE consultants ADD COLUMN featured INTEGER DEFAULT 0");
    console.log('Migrated: Added featured column to consultants table.');
  }
  
  // --- MIGRATION: Update products table schema if needed ---
  try {
    const productsCols = await db.all("PRAGMA table_info(products)");
    if (productsCols.length > 0) {
      // Check if we need to migrate from old schema
      const hasOldType = productsCols.some(col => col.name === 'type');
      const hasNewProductType = productsCols.some(col => col.name === 'product_type');
      
      if (hasOldType && !hasNewProductType) {
        // Migrate old 'type' column to 'product_type'
        await db.exec("ALTER TABLE products RENAME COLUMN type TO product_type");
        console.log('Migrated: Renamed type column to product_type in products table.');
      }
      
      // Add new columns if they don't exist
      const addCol = async (col, type) => {
        if (!productsCols.some(c => c.name === col)) {
          await db.exec(`ALTER TABLE products ADD COLUMN ${col} ${type}`);
          console.log(`Migrated: Added ${col} column to products table.`);
        }
      };
      
      await addCol('thumbnail', 'TEXT');
      await addCol('product_image', 'TEXT');
      await addCol('icon', 'TEXT');
      await addCol('video_url', 'TEXT');
      await addCol('author', 'TEXT');
      await addCol('pdf_file', 'TEXT');
      await addCol('purchase_link', 'TEXT');
      await addCol('download_link', 'TEXT');
      
      // If the table exists but doesn't have product_type, add it
      if (!hasNewProductType && !hasOldType) {
        await db.exec("ALTER TABLE products ADD COLUMN product_type TEXT");
        console.log('Migrated: Added product_type column to products table.');
      }
    }
  } catch (err) {
    console.log('Products table migration check skipped (table may not exist yet).');
  }
}

(async () => {
  await setupDatabase();
  if (INIT_DB) {
    console.log('Database initialized.');
    process.exit(0);
  }
  // ... existing code ...
})();

// --- Enhanced Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Enhanced authentication middleware for e-commerce
function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      message: 'Access token required' 
    });
  }
  
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ 
        success: false,
        message: 'Invalid or expired token' 
      });
    }
    
    try {
      // Get user from database
      const user = await db.get('SELECT id, first_name, last_name, email, phone FROM users_auth WHERE id = ?', decoded.userId);
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: 'User not found' 
        });
      }
      
      req.user = user;
      next();
    } catch (error) {
      console.error('Error authenticating user:', error);
      return res.status(500).json({ 
        success: false,
        message: 'Authentication error' 
      });
    }
  });
}

// Simple rate limiting middleware
const checkoutLimiter = (req, res, next) => {
  // Simple in-memory rate limiting (in production, use Redis or similar)
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 10;
  
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const clientData = req.app.locals.rateLimit.get(clientIP) || { count: 0, resetTime: now + windowMs };
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + windowMs;
  } else {
    clientData.count++;
  }
  
  req.app.locals.rateLimit.set(clientIP, clientData);
  
  if (clientData.count > maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Too many checkout attempts, please try again later'
    });
  }
  
  next();
};

// --- Auth API ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM admin WHERE username = ?', username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  // Fetch corresponding user from users table for role/id
  const userRow = await db.get('SELECT * FROM users WHERE username = ?', username);
  const token = jwt.sign({ id: userRow?.id, username: user.username, role: userRow?.role || 'superadmin' }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token });
});

// --- E-commerce User Authentication API ---

// POST /api/auth/register - User registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;
    
    // Validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and password are required'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }
    
    // Check if user already exists
    const existingUser = await db.get('SELECT id FROM users_auth WHERE email = ?', email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create user
    const result = await db.run(`
      INSERT INTO users_auth (first_name, last_name, email, password_hash, phone)
      VALUES (?, ?, ?, ?, ?)
    `, [firstName, lastName, email, passwordHash, phone || null]);
    
    const userId = result.lastID;
    
    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Get created user (without password)
    const newUser = await db.get('SELECT id, first_name, last_name, email, phone, created_at FROM users_auth WHERE id = ?', userId);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: newUser,
      token
    });
    
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user account'
    });
  }
});

// POST /api/auth/login - User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find user
    const user = await db.get('SELECT * FROM users_auth WHERE email = ?', email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Return user data (without password)
    const userData = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      created_at: user.created_at
    };
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userData,
      token
    });
    
  } catch (error) {
    console.error('Error logging in user:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login'
    });
  }
});

// GET /api/auth/profile - Get user profile
app.get('/api/auth/profile', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user profile
    const user = await db.get('SELECT id, first_name, last_name, email, phone, created_at FROM users_auth WHERE id = ?', userId);
    
    // Get user addresses
    const addresses = await db.all('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', userId);
    
    res.json({
      success: true,
      user: {
        ...user,
        addresses
      }
    });
    
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user profile'
    });
  }
});

// PUT /api/auth/profile - Update user profile
app.put('/api/auth/profile', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, phone } = req.body;
    
    // Validation
    if (!first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }
    
    // Update user profile
    await db.run(`
      UPDATE users_auth 
      SET first_name = ?, last_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [first_name, last_name, phone || null, userId]);
    
    // Get updated user
    const updatedUser = await db.get('SELECT id, first_name, last_name, email, phone, created_at, updated_at FROM users_auth WHERE id = ?', userId);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
});

// --- Category CRUD ---
app.get('/api/categories', authenticateToken, async (req, res) => {
  const rows = await db.all('SELECT * FROM ailments_category ORDER BY created_at DESC');
  res.json(rows);
});
app.post('/api/categories', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = await db.run('INSERT INTO ailments_category (name) VALUES (?)', name);
  res.json({ id: result.lastID, name });
});
app.put('/api/categories/:id', authenticateToken, async (req, res) => {
  const { name } = req.body;
  const { id } = req.params;
  await db.run('UPDATE ailments_category SET name = ? WHERE id = ?', name, id);
  res.json({ id, name });
});
app.delete('/api/categories/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM ailments_category WHERE id = ?', id);
  res.json({ success: true });
});

// --- Subcategory CRUD ---
app.get('/api/subcategories', authenticateToken, async (req, res) => {
  const rows = await db.all('SELECT * FROM ailments_subcategory ORDER BY created_at DESC');
  res.json(rows);
});
app.post('/api/subcategories', authenticateToken, async (req, res) => {
  const { name, category_id } = req.body;
  if (!name || !category_id) return res.status(400).json({ error: 'Name and category_id required' });
  const result = await db.run('INSERT INTO ailments_subcategory (name, category_id) VALUES (?, ?)', name, category_id);
  res.json({ id: result.lastID, name, category_id });
});
app.put('/api/subcategories/:id', authenticateToken, async (req, res) => {
  const { name, category_id } = req.body;
  const { id } = req.params;
  await db.run('UPDATE ailments_subcategory SET name = ?, category_id = ? WHERE id = ?', name, category_id, id);
  res.json({ id, name, category_id });
});
app.delete('/api/subcategories/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM ailments_subcategory WHERE id = ?', id);
  res.json({ success: true });
});

// --- Role Middleware ---
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// --- Consultant CRUD API ---
// Get all consultants (superadmin only) with optional city filter
app.get('/api/consultants', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { city } = req.query;
  let sql = 'SELECT * FROM consultants';
  let params = [];
  if (city) {
    sql += ' WHERE city = ?';
    params.push(city);
  }
  try {
    const consultants = await db.all(sql, params);
    res.json(consultants);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Public: Get all consultants (no auth required)
app.get('/api/consultants/public', async (req, res) => {
  const consultants = await db.all('SELECT DISTINCT * FROM consultants ORDER BY id');
  // Ensure city and location are valid for each consultant
  const result = consultants.map(c => {
    const city = (typeof c.city === 'string' && c.city.trim() !== '') ? c.city : 'Unknown';
    let location = 'Unknown';
    if (
      c.location_lat !== null && c.location_lat !== undefined && c.location_lat !== '' &&
      c.location_lng !== null && c.location_lng !== undefined && c.location_lng !== ''
    ) {
      location = `${c.location_lat},${c.location_lng}`;
    }
    // Convert featured from integer to boolean
    const featured = c.featured === 1;
    // Remove location_lat and location_lng from the response
    const { location_lat, location_lng, featured: featuredInt, ...rest } = c;
    return {
      ...rest,
      city,
      location,
      featured
    };
  });
  res.json(result);
});

// Public: Get featured consultants only (no auth required)
app.get('/api/consultants/featured', async (req, res) => {
  const consultants = await db.all('SELECT DISTINCT * FROM consultants WHERE featured = 1 ORDER BY id');
  // Ensure city and location are valid for each consultant
  const result = consultants.map(c => {
    const city = (typeof c.city === 'string' && c.city.trim() !== '') ? c.city : 'Unknown';
    let location = 'Unknown';
    if (
      c.location_lat !== null && c.location_lat !== undefined && c.location_lat !== '' &&
      c.location_lng !== null && c.location_lng !== undefined && c.location_lng !== ''
    ) {
      location = `${c.location_lat},${c.location_lng}`;
    }
    // Convert featured from integer to boolean
    const featured = c.featured === 1;
    // Remove location_lat and location_lng from the response
    const { location_lat, location_lng, featured: featuredInt, ...rest } = c;
    return {
      ...rest,
      city,
      location,
      featured
    };
  });
  res.json(result);
});
// Get consultant by id (superadmin or self)
app.get('/api/consultants/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(consultant);
});
// Create consultant (superadmin only)
app.post('/api/consultants', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { username, password, name, email, phone, image, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status, city, featured } = req.body;
  if (!username || !password || !name || !email || !city || city.trim() === '') return res.status(400).json({ error: 'Missing required fields (city is required)' });
  try {
    // Create user
    const hash = await bcrypt.hash(password, 10);
    const userResult = await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', username, hash, 'consultant');
    const user_id = userResult.lastID;
    // Ensure image path is correct
    let imagePath = image;
    if (imagePath && !imagePath.startsWith('/uploads/')) {
      imagePath = '/uploads/' + imagePath.replace(/^\\+|^\/+/,'');
    }
    // Create consultant profile
    const result = await db.run(
      `INSERT INTO consultants (user_id, name, email, phone, image, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status, city, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user_id, name, email, phone, imagePath, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status || 'offline', city, featured ? 1 : 0
    );
    res.json({ id: result.lastID, user_id });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      // Check if the error is for username or email
      if (err.message.includes('users.username')) {
        return res.status(400).json({ error: 'Username already exists. Please choose a different username.' });
      }
      if (err.message.includes('consultants.email')) {
        return res.status(400).json({ error: 'Email already exists. Please use a different email.' });
      }
      // Generic constraint error
      return res.status(400).json({ error: 'A unique constraint failed. Please check your input.' });
    }
    throw err;
  }
});
// Update consultant (superadmin or self)
app.put('/api/consultants/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Only update allowed fields
  const fields = [
    'name', 'email', 'phone', 'image', 'description', 'tagline', 'location_lat', 'location_lng', 'address', 'speciality', 'id_proof_type', 'id_proof_url', 'aadhar', 'bank_account', 'bank_ifsc', 'status', 'city', 'featured'
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      // Handle featured field as boolean to integer conversion
      if (field === 'featured') {
        values.push(req.body[field] ? 1 : 0);
      } else {
        values.push(req.body[field]);
      }
    }
  }
  // Require city for update as well
  if (!req.body.city || req.body.city.trim() === '') return res.status(400).json({ error: 'City is required' });
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  await db.run(`UPDATE consultants SET ${updates.join(', ')} WHERE id = ?`, ...values);
  res.json({ success: true });
});
// Delete consultant (superadmin only)
app.delete('/api/consultants/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM consultants WHERE id = ?', id);
  res.json({ success: true });
});
// Toggle consultant status (consultant or superadmin)
app.post('/api/consultants/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!['online', 'offline'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await db.run('UPDATE consultants SET status = ? WHERE id = ?', status, id);
  res.json({ success: true });
});

// Toggle consultant featured status (superadmin only)
app.post('/api/consultants/:id/featured', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { featured } = req.body;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (typeof featured !== 'boolean') return res.status(400).json({ error: 'Featured must be a boolean' });
  await db.run('UPDATE consultants SET featured = ? WHERE id = ?', featured ? 1 : 0, id);
  res.json({ success: true });
});
// Consultant availability CRUD (consultant or superadmin)
app.get('/api/consultants/:id/availability', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const slots = await db.all('SELECT * FROM consultant_availability WHERE consultant_id = ?', id);
  res.json(slots);
});
app.post('/api/consultants/:id/availability', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { date, start_time, end_time } = req.body;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await db.run('INSERT INTO consultant_availability (consultant_id, date, start_time, end_time) VALUES (?, ?, ?, ?)', id, date, start_time, end_time);
  res.json({ id: result.lastID });
});
app.delete('/api/consultants/:id/availability/:slotId', authenticateToken, async (req, res) => {
  const { id, slotId } = req.params;
  const consultant = await db.get('SELECT * FROM consultants WHERE id = ?', id);
  if (!consultant) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'superadmin' && req.user.id !== consultant.user_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await db.run('DELETE FROM consultant_availability WHERE id = ? AND consultant_id = ?', slotId, id);
  res.json({ success: true });
});

// --- Consultant Login API ---
app.post('/api/consultant-login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = ? AND role = ?', username, 'consultant');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token });
});

// --- Users CRUD API ---
app.get('/api/users', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const users = await db.all('SELECT id, username, role, status, created_at FROM users');
  res.json(users);
});
app.post('/api/users', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing required fields' });
  const hash = await bcrypt.hash(password, 10);
  const result = await db.run('INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, ?)', username, hash, role, 'active');
  res.json({ id: result.lastID });
});
app.put('/api/users/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  await db.run('UPDATE users SET role = ? WHERE id = ?', role, id);
  res.json({ success: true });
});
app.delete('/api/users/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM users WHERE id = ?', id);
  res.json({ success: true });
});
// Update user status
app.post('/api/users/:id/status', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await db.run('UPDATE users SET status = ? WHERE id = ?', status, id);
  res.json({ success: true });
});

// --- Services CRUD API ---
// Get all services
app.get('/api/services', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const services = await db.all('SELECT * FROM services ORDER BY created_at DESC');
  res.json(services);
});
// Get service by id (with consultants, categories, subcategories, suggestions)
app.get('/api/services/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const service = await db.get('SELECT * FROM services WHERE id = ?', id);
  if (!service) return res.status(404).json({ error: 'Not found' });
  // Get consultants
  const consultants = await db.all('SELECT DISTINCT c.* FROM consultants c JOIN services_consultants sc ON c.id = sc.consultant_id WHERE sc.service_id = ? ORDER BY c.id', id);
  // Get categories
  const categories = await db.all('SELECT ac.* FROM ailments_category ac JOIN service_ailment_categories sac ON ac.id = sac.category_id WHERE sac.service_id = ?', id);
  // Get subcategories
  const subcategories = await db.all('SELECT asc.* FROM ailments_subcategory asc JOIN service_ailment_subcategories sasc ON asc.id = sasc.subcategory_id WHERE sasc.service_id = ?', id);
  // Get suggestions
  const suggestions = await db.all('SELECT * FROM service_suggestions WHERE service_id = ? ORDER BY slot ASC', id);
  res.json({ ...service, consultants, categories, subcategories, suggestions });
});
// Create service
app.post('/api/services', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { name, description, delivery_mode, service_type, appointment_type, event_type, test_type, revenue_type, price, renewal_date, center, test_redirect_url, consultant_ids = [], category_ids = [], subcategory_ids = [], suggestions = [], subscription_start, subscription_end, discount, monthly_price, yearly_price, center_address, center_lat, center_lng, event_start, event_end, event_image, event_meet_link } = req.body;
  if (!name || !delivery_mode || !service_type || !revenue_type) return res.status(400).json({ error: 'Missing required fields' });
  // For appointment, must have at least one consultant
  if (service_type === 'appointment' && (!Array.isArray(consultant_ids) || consultant_ids.length === 0)) {
    return res.status(400).json({ error: 'Appointment service must have at least one consultant' });
  }
  // Insert service
  const result = await db.run(
    `INSERT INTO services (name, description, delivery_mode, service_type, appointment_type, event_type, test_type, revenue_type, price, renewal_date, center, test_redirect_url, subscription_start, subscription_end, discount, monthly_price, yearly_price, center_address, center_lat, center_lng, event_start, event_end, event_image, event_meet_link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    name, description, delivery_mode, service_type, appointment_type, event_type, test_type, revenue_type, price, renewal_date, center, test_redirect_url, subscription_start, subscription_end, discount, monthly_price, yearly_price, center_address, center_lat, center_lng, event_start, event_end, event_image, event_meet_link
  );
  const service_id = result.lastID;
  // Link consultants
  if (service_type === 'appointment') {
    for (const consultant_id of consultant_ids) {
      await db.run('INSERT INTO services_consultants (service_id, consultant_id) VALUES (?, ?)', service_id, consultant_id);
    }
  }
  // Link categories
  for (const category_id of category_ids) {
    await db.run('INSERT INTO service_ailment_categories (service_id, category_id) VALUES (?, ?)', service_id, category_id);
  }
  // Link subcategories
  for (const subcategory_id of subcategory_ids) {
    await db.run('INSERT INTO service_ailment_subcategories (service_id, subcategory_id) VALUES (?, ?)', service_id, subcategory_id);
  }
  // Add suggestions (up to 5)
  for (const [i, s] of suggestions.slice(0, 5).entries()) {
    await db.run('INSERT INTO service_suggestions (service_id, title, description, redirect_url, slot) VALUES (?, ?, ?, ?, ?)', service_id, s.title, s.description, s.redirect_url, i + 1);
  }
  res.json({ id: service_id });
});
// Update service
app.put('/api/services/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { name, description, delivery_mode, service_type, appointment_type, event_type, test_type, revenue_type, price, renewal_date, center, test_redirect_url, consultant_ids = [], category_ids = [], subcategory_ids = [], suggestions = [], subscription_start, subscription_end, discount, monthly_price, yearly_price, center_address, center_lat, center_lng, event_start, event_end, event_image, event_meet_link } = req.body;
  const service = await db.get('SELECT * FROM services WHERE id = ?', id);
  if (!service) return res.status(404).json({ error: 'Not found' });
  // For appointment, must have at least one consultant
  if (service_type === 'appointment' && (!Array.isArray(consultant_ids) || consultant_ids.length === 0)) {
    return res.status(400).json({ error: 'Appointment service must have at least one consultant' });
  }
  // Update service
  await db.run(
    `UPDATE services SET name = ?, description = ?, delivery_mode = ?, service_type = ?, appointment_type = ?, event_type = ?, test_type = ?, revenue_type = ?, price = ?, renewal_date = ?, center = ?, test_redirect_url = ?, subscription_start = ?, subscription_end = ?, discount = ?, monthly_price = ?, yearly_price = ?, center_address = ?, center_lat = ?, center_lng = ?, event_start = ?, event_end = ?, event_image = ?, event_meet_link = ? WHERE id = ?`,
    name, description, delivery_mode, service_type, appointment_type, event_type, test_type, revenue_type, price, renewal_date, center, test_redirect_url, subscription_start, subscription_end, discount, monthly_price, yearly_price, center_address, center_lat, center_lng, event_start, event_end, event_image, event_meet_link, id
  );
  // Update consultants
  await db.run('DELETE FROM services_consultants WHERE service_id = ?', id);
  if (service_type === 'appointment') {
    for (const consultant_id of consultant_ids) {
      await db.run('INSERT INTO services_consultants (service_id, consultant_id) VALUES (?, ?)', id, consultant_id);
    }
  }
  // Update categories
  await db.run('DELETE FROM service_ailment_categories WHERE service_id = ?', id);
  for (const category_id of category_ids) {
    await db.run('INSERT INTO service_ailment_categories (service_id, category_id) VALUES (?, ?)', id, category_id);
  }
  // Update subcategories
  await db.run('DELETE FROM service_ailment_subcategories WHERE service_id = ?', id);
  for (const subcategory_id of subcategory_ids) {
    await db.run('INSERT INTO service_ailment_subcategories (service_id, subcategory_id) VALUES (?, ?)', id, subcategory_id);
  }
  // Update suggestions
  await db.run('DELETE FROM service_suggestions WHERE service_id = ?', id);
  for (const [i, s] of suggestions.slice(0, 5).entries()) {
    await db.run('INSERT INTO service_suggestions (service_id, title, description, redirect_url, slot) VALUES (?, ?, ?, ?, ?)', id, s.title, s.description, s.redirect_url, i + 1);
  }
  res.json({ success: true });
});
// Delete service
app.delete('/api/services/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM services WHERE id = ?', id);
  await db.run('DELETE FROM services_consultants WHERE service_id = ?', id);
  await db.run('DELETE FROM service_ailment_categories WHERE service_id = ?', id);
  await db.run('DELETE FROM service_ailment_subcategories WHERE service_id = ?', id);
  await db.run('DELETE FROM service_suggestions WHERE service_id = ?', id);
  res.json({ success: true });
});
// Manage consultants for a service
app.get('/api/services/:id/consultants', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const consultants = await db.all('SELECT DISTINCT c.* FROM consultants c JOIN services_consultants sc ON c.id = sc.consultant_id WHERE sc.service_id = ? ORDER BY c.id', id);
  res.json(consultants);
});
app.post('/api/services/:id/consultants', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { consultant_id } = req.body;
  if (!consultant_id) return res.status(400).json({ error: 'Missing consultant_id' });
  await db.run('INSERT INTO services_consultants (service_id, consultant_id) VALUES (?, ?)', id, consultant_id);
  res.json({ success: true });
});
app.delete('/api/services/:id/consultants/:consultantId', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { id, consultantId } = req.params;
  await db.run('DELETE FROM services_consultants WHERE service_id = ? AND consultant_id = ?', id, consultantId);
  res.json({ success: true });
});

// Default root endpoint to show server is running
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Test endpoint for frontend connection
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ 
    status: 'ok', 
    message: 'Backend API is working',
    timestamp: new Date().toISOString(),
    products_count: 0 // We'll update this dynamically
  });
});

// Health check endpoint for CORS testing
app.get('/api/health', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ 
    status: 'healthy', 
    message: 'Backend is running and CORS is configured',
    timestamp: new Date().toISOString(),
    cors: 'enabled'
  });
});

// --- Blog Routes ---

// Multer configuration for blog thumbnails
const blogStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const blogsDir = path.join(process.cwd(), 'uploads', 'blogs');
    if (!fs.existsSync(blogsDir)) {
      fs.mkdirSync(blogsDir, { recursive: true });
    }
    cb(null, blogsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let safeName = file.originalname
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x00-\x7F]/g, '') // Remove all non-ASCII characters
      .replace(/\s+/g, '_') // Replace whitespace with _
      .replace(/['"`]/g, '') // Remove apostrophes and quotes
      .replace(/[^a-z0-9._-]/g, '_'); // Replace all other non-safe chars with _
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const blogUpload = multer({ 
  storage: blogStorage,
  fileFilter: (req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for thumbnails'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Blog validation middleware
const validateBlog = (req, res, next) => {
  const { title, description, author, category } = req.body;
  
  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Title is required'
    });
  }
  
  if (!description || !description.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Description is required'
    });
  }
  
  if (!author || !author.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Author is required'
    });
  }
  
  if (!category || !category.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Category is required'
    });
  }
  
  // Validate category values
  const validCategories = ['Therapy', 'Mental Health', 'Education', 'Support', 'Technology'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({
      success: false,
      message: 'Category must be one of: Therapy, Mental Health, Education, Support, Technology'
    });
  }
  
  // Validate status if provided
  const validStatuses = ['active', 'inactive', 'published', 'draft', 'pending', 'archived', 'live', 'scheduled', 'private', 'public', 'review', 'approved', 'rejected', 'trash', 'deleted'];
  if (req.body.status && !validStatuses.includes(req.body.status)) {
    return res.status(400).json({
      success: false,
      message: `Status must be one of: ${validStatuses.join(', ')}`
    });
  }
  
  next();
};

// POST /api/blogs - Create a new blog
app.post('/api/blogs', blogUpload.single('thumbnail'), validateBlog, async (req, res) => {
  try {
    const { title, description, category, author, status } = req.body;
    const thumbnail = req.file ? `/uploads/blogs/${req.file.filename}` : null;
    
    // Ensure status is valid, default to 'draft' if not provided or invalid
    const validStatuses = ['active', 'inactive', 'published', 'draft', 'pending', 'archived', 'live', 'scheduled', 'private', 'public', 'review', 'approved', 'rejected', 'trash', 'deleted'];
    const validStatus = (status && validStatuses.includes(status)) ? status : 'draft';
    
    const result = await db.run(`
      INSERT INTO blogs (title, description, category, thumbnail, author, status, date)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [title.trim(), description.trim(), category, thumbnail, author.trim(), validStatus]);
    
    const blogId = result.lastID;
    
    // Fetch the created blog
    const newBlog = await db.get('SELECT * FROM blogs WHERE id = ?', blogId);
    
    res.status(201).json({
      success: true,
      message: 'Blog created successfully',
      blog: newBlog
    });
    
  } catch (error) {
    console.error('Error creating blog:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while creating blog'
    });
  }
});

// GET /api/blogs - Get all blogs with optional filtering
app.get('/api/blogs', async (req, res) => {
  try {
    let sql = 'SELECT * FROM blogs WHERE 1=1';
    let params = [];
    
    // Add filters
    if (req.query.category) {
      sql += ' AND LOWER(category) = LOWER(?)';
      params.push(req.query.category);
    }
    
    if (req.query.status) {
      sql += ' AND status = ?';
      params.push(req.query.status);
    }
    
    if (req.query.author) {
      sql += ' AND LOWER(author) LIKE LOWER(?)';
      params.push(`%${req.query.author}%`);
    }
    
    // Add search functionality
    if (req.query.search) {
      sql += ' AND (LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))';
      const searchTerm = `%${req.query.search}%`;
      params.push(searchTerm, searchTerm);
    }
    
    sql += ' ORDER BY date DESC';
    
    const blogs = await db.all(sql, params);
    
    res.json({
      success: true,
      blogs: blogs,
      count: blogs.length
    });
    
  } catch (error) {
    console.error('Error fetching blogs:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching blogs'
    });
  }
});

// GET /api/blogs/:id - Get a single blog by ID
app.get('/api/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const blog = await db.get('SELECT * FROM blogs WHERE id = ?', id);
    
    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }
    
    res.json({
      success: true,
      blog: blog
    });
    
  } catch (error) {
    console.error('Error fetching blog:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching blog'
    });
  }
});

// PUT /api/blogs/:id - Update a blog
app.put('/api/blogs/:id', blogUpload.single('thumbnail'), validateBlog, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, author, status } = req.body;
    
    // Check if blog exists
    const existingBlog = await db.get('SELECT * FROM blogs WHERE id = ?', id);
    if (!existingBlog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }
    
    let thumbnail = existingBlog.thumbnail;
    if (req.file) {
      // Delete old thumbnail if it exists
      if (existingBlog.thumbnail) {
        const oldThumbnailPath = path.join(process.cwd(), existingBlog.thumbnail);
        if (fs.existsSync(oldThumbnailPath)) {
          fs.unlinkSync(oldThumbnailPath);
        }
      }
      thumbnail = `/uploads/blogs/${req.file.filename}`;
    }
    
    // Ensure status is valid, default to 'draft' if not provided or invalid
    const validStatuses = ['active', 'inactive', 'published', 'draft', 'pending', 'archived', 'live', 'scheduled', 'private', 'public', 'review', 'approved', 'rejected', 'trash', 'deleted'];
    const validStatus = (status && validStatuses.includes(status)) ? status : 'draft';
    
    await db.run(`
      UPDATE blogs 
      SET title = ?, description = ?, category = ?, thumbnail = ?, author = ?, status = ?, date = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [title.trim(), description.trim(), category, thumbnail, author.trim(), validStatus, id]);
    
    // Fetch the updated blog
    const updatedBlog = await db.get('SELECT * FROM blogs WHERE id = ?', id);
    
    res.json({
      success: true,
      message: 'Blog updated successfully',
      blog: updatedBlog
    });
    
  } catch (error) {
    console.error('Error updating blog:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while updating blog'
    });
  }
});

// DELETE /api/blogs/:id - Delete a blog
app.delete('/api/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if blog exists
    const existingBlog = await db.get('SELECT * FROM blogs WHERE id = ?', id);
    if (!existingBlog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }
    
    // Delete thumbnail file if it exists
    if (existingBlog.thumbnail) {
      const oldThumbnailPath = path.join(process.cwd(), existingBlog.thumbnail);
      if (fs.existsSync(oldThumbnailPath)) {
        fs.unlinkSync(oldThumbnailPath);
      }
    }
    
    await db.run('DELETE FROM blogs WHERE id = ?', id);
    
    res.json({
      success: true,
      message: 'Blog deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting blog:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while deleting blog'
    });
  }
});

// --- Order Management API ---

// POST /api/orders - Create new order
app.post('/api/orders', authenticateUser, checkoutLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { items, deliveryAddress, paymentMethod } = req.body;
    
    // Validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order items are required'
      });
    }
    
    if (!deliveryAddress || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address and payment method are required'
      });
    }
    
    // Calculate total amount and validate inventory
    let totalAmount = 0;
    const orderItems = [];
    
    for (const item of items) {
      const { productId, quantity } = item;
      
      // Get product details
      const product = await db.get('SELECT * FROM products WHERE id = ?', productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${productId} not found`
        });
      }
      
      // Check inventory
      const inventory = await db.get('SELECT available_quantity FROM product_inventory WHERE product_id = ?', productId);
      if (!inventory || inventory.available_quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient inventory for product: ${product.title || product.name}`
        });
      }
      
      const itemTotal = (product.price || 0) * quantity;
      totalAmount += itemTotal;
      
      orderItems.push({
        productId,
        productType: product.product_type,
        productName: product.title || product.name,
        quantity,
        unitPrice: product.price || 0,
        totalPrice: itemTotal
      });
    }
    
    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Create order
    const orderResult = await db.run(`
      INSERT INTO orders_new (user_id, order_number, total_amount, payment_method, delivery_address)
      VALUES (?, ?, ?, ?, ?)
    `, [userId, orderNumber, totalAmount, paymentMethod, JSON.stringify(deliveryAddress)]);
    
    const orderId = orderResult.lastID;
    
    // Create order items
    for (const item of orderItems) {
      await db.run(`
        INSERT INTO order_items_new (order_id, product_id, product_type, product_name, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [orderId, item.productId, item.productType, item.productName, item.quantity, item.unitPrice, item.totalPrice]);
      
      // Update inventory
      await db.run(`
        UPDATE product_inventory 
        SET available_quantity = available_quantity - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `, [item.quantity, item.productId]);
    }
    
    // Create initial status history
    await db.run(`
      INSERT INTO order_status_history (order_id, status, notes)
      VALUES (?, ?, ?)
    `, [orderId, 'pending', 'Order created successfully']);
    
    // Get created order with items
    const order = await db.get('SELECT * FROM orders_new WHERE id = ?', orderId);
    const orderItemsData = await db.all('SELECT * FROM order_items_new WHERE order_id = ?', orderId);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        ...order,
        items: orderItemsData
      }
    });
    
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating order'
    });
  }
});

// GET /api/orders/user/:userId - Get all orders for a specific user
app.get('/api/orders/user/:userId', authenticateUser, async (req, res) => {
  try {
    const { userId } = req.params;
    const authenticatedUserId = req.user.id;
    
    // Ensure user can only access their own orders
    if (parseInt(userId) !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const orders = await db.all(`
      SELECT o.*, 
             COUNT(oi.id) as items_count
      FROM orders_new o
      LEFT JOIN order_items_new oi ON o.id = oi.order_id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      orders
    });
    
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders'
    });
  }
});

// GET /api/orders/:orderId - Get specific order details
app.get('/api/orders/:orderId', authenticateUser, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    // Get order
    const order = await db.get('SELECT * FROM orders_new WHERE id = ? AND user_id = ?', [orderId, userId]);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Get order items
    const orderItems = await db.all('SELECT * FROM order_items_new WHERE order_id = ?', orderId);
    
    // Get order status history
    const statusHistory = await db.all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC', orderId);
    
    res.json({
      success: true,
      order: {
        ...order,
        items: orderItems,
        statusHistory
      }
    });
    
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching order details'
    });
  }
});

// PUT /api/orders/:orderId/status - Update order status
app.put('/api/orders/:orderId/status', authenticateUser, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const userId = req.user.id;
    
    // Validation
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Get order
    const order = await db.get('SELECT * FROM orders_new WHERE id = ? AND user_id = ?', [orderId, userId]);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Update order status
    await db.run(`
      UPDATE orders_new 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [orderId, status]);
    
    // Add status history
    await db.run(`
      INSERT INTO order_status_history (order_id, status, notes)
      VALUES (?, ?, ?)
    `, [orderId, status, notes || null]);
    
    res.json({
      success: true,
      message: 'Order status updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status'
    });
  }
});

// --- Payment Integration API ---

// POST /api/payments/initialize - Initialize payment
app.post('/api/payments/initialize', authenticateUser, async (req, res) => {
  try {
    const { orderId, amount, paymentMethod, currency = 'INR' } = req.body;
    
    // Validation
    if (!orderId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Order ID, amount, and payment method are required'
      });
    }
    
    // Verify order exists and belongs to user
    const order = await db.get('SELECT * FROM orders_new WHERE id = ? AND user_id = ?', [orderId, req.user.id]);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Verify amount matches order total
    if (parseFloat(amount) !== parseFloat(order.total_amount)) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount does not match order total'
      });
    }
    
    // Generate transaction ID
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Create payment record
    const paymentResult = await db.run(`
      INSERT INTO payments (order_id, payment_method, amount, currency, transaction_id)
      VALUES (?, ?, ?, ?, ?)
    `, [orderId, paymentMethod, amount, currency, transactionId]);
    
    const paymentId = paymentResult.lastID;
    
    // Simulate payment gateway response (replace with actual gateway integration)
    const gatewayResponse = {
      payment_id: paymentId,
      transaction_id: transactionId,
      status: 'pending',
      gateway: 'test_gateway',
      timestamp: new Date().toISOString()
    };
    
    // Update payment with gateway response
    await db.run(`
      UPDATE payments 
      SET gateway_response = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [JSON.stringify(gatewayResponse), paymentId]);
    
    res.json({
      success: true,
      message: 'Payment initialized successfully',
      payment: {
        id: paymentId,
        transactionId,
        amount,
        currency,
        status: 'pending',
        gatewayResponse
      }
    });
    
  } catch (error) {
    console.error('Error initializing payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error initializing payment'
    });
  }
});

// POST /api/payments/webhook - Receive payment status updates
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const { transactionId, status, gatewayData } = req.body;
    
    // In production, verify webhook signature here
    // const signature = req.headers['x-webhook-signature'];
    // if (!verifyWebhookSignature(signature, req.body)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }
    
    if (!transactionId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID and status are required'
      });
    }
    
    // Find payment by transaction ID
    const payment = await db.get('SELECT * FROM payments WHERE transaction_id = ?', transactionId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Update payment status
    await db.run(`
      UPDATE payments 
      SET status = ?, gateway_response = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, JSON.stringify(gatewayData || {}), payment.id]);
    
    // Update order payment status
    const orderStatus = status === 'completed' ? 'paid' : 
                       status === 'failed' ? 'failed' : 'pending';
    
    await db.run(`
      UPDATE orders_new 
      SET payment_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [orderStatus, payment.order_id]);
    
    // Add order status history
    if (status === 'completed') {
      await db.run(`
        INSERT INTO order_status_history (order_id, status, notes)
        VALUES (?, ?, ?)
      `, [payment.order_id, 'confirmed', 'Payment completed successfully']);
    }
    
    res.json({
      success: true,
      message: 'Payment status updated successfully'
    });
    
  } catch (error) {
    console.error('Error processing payment webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook'
    });
  }
});

// GET /api/payments/:paymentId/status - Get payment status
app.get('/api/payments/:paymentId/status', authenticateUser, async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await db.get(`
      SELECT p.*, o.order_number, o.total_amount 
      FROM payments p
      JOIN orders_new o ON p.order_id = o.id
      WHERE p.id = ? AND o.user_id = ?
    `, [paymentId, req.user.id]);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    res.json({
      success: true,
      payment
    });
    
  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status'
    });
  }
});

// --- Inventory Management API ---

// GET /api/inventory/check - Check product availability
app.get('/api/inventory/check', async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.query;
    
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }
    
    // Get product details
    const product = await db.get('SELECT * FROM products WHERE id = ?', productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Get inventory
    const inventory = await db.get('SELECT * FROM product_inventory WHERE product_id = ?', productId);
    
    if (!inventory) {
      return res.json({
        success: true,
        available: false,
        message: 'Product inventory not found',
        product: {
          id: product.id,
          name: product.title || product.name,
          type: product.product_type
        }
      });
    }
    
    const available = inventory.available_quantity >= quantity;
    const stockLevel = inventory.available_quantity;
    const lowStock = stockLevel <= inventory.min_stock_level;
    
    res.json({
      success: true,
      available,
      quantity: parseInt(quantity),
      stockLevel,
      lowStock,
      product: {
        id: product.id,
        name: product.title || product.name,
        type: product.product_type
      },
      inventory: {
        available: inventory.available_quantity,
        reserved: inventory.reserved_quantity,
        minStock: inventory.min_stock_level
      }
    });
    
  } catch (error) {
    console.error('Error checking inventory:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking inventory'
    });
  }
});

// PUT /api/inventory/update - Update inventory
app.put('/api/inventory/update', authenticateUser, async (req, res) => {
  try {
    const { productId, quantity, operation } = req.body;
    
    // Validation
    if (!productId || quantity === undefined || !operation) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, quantity, and operation are required'
      });
    }
    
    const validOperations = ['add', 'subtract', 'set'];
    if (!validOperations.includes(operation)) {
      return res.status(400).json({
        success: false,
        message: 'Operation must be one of: add, subtract, set'
      });
    }
    
    // Get current inventory
    let inventory = await db.get('SELECT * FROM product_inventory WHERE product_id = ?', productId);
    
    if (!inventory) {
      // Create inventory record if it doesn't exist
      const result = await db.run(`
        INSERT INTO product_inventory (product_id, product_type, available_quantity, reserved_quantity, min_stock_level)
        VALUES (?, ?, 0, 0, 5)
      `, [productId, 'product']);
      
      inventory = {
        id: result.lastID,
        product_id: productId,
        available_quantity: 0,
        reserved_quantity: 0,
        min_stock_level: 5
      };
    }
    
    let newQuantity;
    switch (operation) {
      case 'add':
        newQuantity = inventory.available_quantity + parseInt(quantity);
        break;
      case 'subtract':
        newQuantity = Math.max(0, inventory.available_quantity - parseInt(quantity));
        break;
      case 'set':
        newQuantity = parseInt(quantity);
        break;
    }
    
    // Update inventory
    await db.run(`
      UPDATE product_inventory 
      SET available_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ?
    `, [newQuantity, productId]);
    
    // Get updated inventory
    const updatedInventory = await db.get('SELECT * FROM product_inventory WHERE product_id = ?', productId);
    
    res.json({
      success: true,
      message: `Inventory ${operation}ed successfully`,
      inventory: updatedInventory,
      operation,
      quantity: parseInt(quantity),
      previousQuantity: inventory.available_quantity,
      newQuantity
    });
    
  } catch (error) {
    console.error('Error updating inventory:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating inventory'
    });
  }
});

// --- Email & Notification System API ---

// POST /api/notifications/email/order-confirmation - Send order confirmation email
app.post('/api/notifications/email/order-confirmation', authenticateUser, async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.id;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }
    
    // Get order details
    const order = await db.get(`
      SELECT o.*, u.first_name, u.last_name, u.email
      FROM orders_new o
      JOIN users_auth u ON o.user_id = u.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderId, userId]);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Get order items
    const orderItems = await db.all('SELECT * FROM order_items_new WHERE order_id = ?', orderId);
    
    // Simulate email sending (replace with actual SMTP integration)
    const emailData = {
      to: order.email,
      subject: `Order Confirmation - ${order.order_number}`,
      template: 'order-confirmation',
      data: {
        orderNumber: order.order_number,
        customerName: `${order.first_name} ${order.last_name}`,
        totalAmount: order.total_amount,
        items: orderItems,
        orderDate: order.created_at,
        deliveryAddress: JSON.parse(order.delivery_address)
      }
    };
    
    // In production, send actual email here
    // await sendEmail(emailData);
    
    console.log('Order confirmation email would be sent:', emailData);
    
    res.json({
      success: true,
      message: 'Order confirmation email sent successfully',
      emailData
    });
    
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending email'
    });
  }
});

// POST /api/notifications/email/shipping-update - Send shipping status updates
app.post('/api/notifications/email/shipping-update', authenticateUser, async (req, res) => {
  try {
    const { orderId, status, trackingNumber, estimatedDelivery } = req.body;
    const userId = req.user.id;
    
    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and status are required'
      });
    }
    
    // Get order details
    const order = await db.get(`
      SELECT o.*, u.first_name, u.last_name, u.email
      FROM orders_new o
      JOIN users_auth u ON o.user_id = u.id
      WHERE o.id = ? AND o.user_id = ?
    `, [orderId, userId]);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Simulate email sending (replace with actual SMTP integration)
    const emailData = {
      to: order.email,
      subject: `Shipping Update - Order ${order.order_number}`,
      template: 'shipping-update',
      data: {
        orderNumber: order.order_number,
        customerName: `${order.first_name} ${order.last_name}`,
        status,
        trackingNumber: trackingNumber || 'N/A',
        estimatedDelivery: estimatedDelivery || 'TBD',
        orderDate: order.created_at
      }
    };
    
    // In production, send actual email here
    // await sendEmail(emailData);
    
    console.log('Shipping update email would be sent:', emailData);
    
    res.json({
      success: true,
      message: 'Shipping update email sent successfully',
      emailData
    });
    
  } catch (error) {
    console.error('Error sending shipping update email:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending email'
    });
  }
});

// --- User Address Management API ---

// POST /api/auth/addresses - Add new address
app.post('/api/auth/addresses', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressLine1, city, state, zipCode, country = 'India', isDefault = false } = req.body;
    
    // Validation
    if (!addressLine1 || !city || !state || !zipCode) {
      return res.status(400).json({
        success: false,
        message: 'Address line 1, city, state, and zip code are required'
      });
    }
    
    // If this is the first address or marked as default, unset other defaults
    if (isDefault) {
      await db.run('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', userId);
    }
    
    // Create address
    const result = await db.run(`
      INSERT INTO user_addresses (user_id, address_line1, city, state, zip_code, country, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [userId, addressLine1, city, state, zipCode, country, isDefault ? 1 : 0]);
    
    const addressId = result.lastID;
    
    // Get created address
    const newAddress = await db.get('SELECT * FROM user_addresses WHERE id = ?', addressId);
    
    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      address: newAddress
    });
    
  } catch (error) {
    console.error('Error adding address:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding address'
    });
  }
});

// GET /api/auth/addresses - Get user addresses
app.get('/api/auth/addresses', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const addresses = await db.all(`
      SELECT * FROM user_addresses 
      WHERE user_id = ? 
      ORDER BY is_default DESC, created_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      addresses
    });
    
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching addresses'
    });
  }
});

// PUT /api/auth/addresses/:addressId - Update address
app.put('/api/auth/addresses/:addressId', authenticateUser, async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;
    const { addressLine1, city, state, zipCode, country, isDefault } = req.body;
    
    // Check if address exists and belongs to user
    const existingAddress = await db.get('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    
    // If setting as default, unset other defaults
    if (isDefault) {
      await db.run('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', userId);
    }
    
    // Update address
    await db.run(`
      UPDATE user_addresses 
      SET address_line1 = ?, city = ?, state = ?, zip_code = ?, country = ?, is_default = ?
      WHERE id = ? AND user_id = ?
    `, [addressLine1, city, state, zipCode, country, isDefault ? 1 : 0, addressId, userId]);
    
    // Get updated address
    const updatedAddress = await db.get('SELECT * FROM user_addresses WHERE id = ?', addressId);
    
    res.json({
      success: true,
      message: 'Address updated successfully',
      address: updatedAddress
    });
    
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating address'
    });
  }
});

// DELETE /api/auth/addresses/:addressId - Delete address
app.delete('/api/auth/addresses/:addressId', authenticateUser, async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user.id;
    
    // Check if address exists and belongs to user
    const existingAddress = await db.get('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    
    // Delete address
    await db.run('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    
    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting address'
    });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
  
  try {
    await setupDatabase();
    console.log('Database initialized.');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
});

// Ensure uploads directory exists and create organized subdirectories
const uploadsDir = path.join(process.cwd(), 'uploads');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');
const pdfsDir = path.join(uploadsDir, 'pdfs');
const iconsDir = path.join(uploadsDir, 'icons');
const productImagesDir = path.join(uploadsDir, 'product_images');
const instructorsDir = path.join(uploadsDir, 'instructors');
const coursesDir = path.join(uploadsDir, 'courses');
const blogsDir = path.join(uploadsDir, 'blogs');

// Create directories if they don't exist
[uploadsDir, thumbnailsDir, pdfsDir, iconsDir, productImagesDir, instructorsDir, coursesDir, blogsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let safeName = file.originalname
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x00-\x7F]/g, '') // Remove all non-ASCII characters (including â¯)
      .replace(/\s+/g, '_') // Replace whitespace with _
      .replace(/['"`]/g, '') // Remove apostrophes and quotes
      .replace(/[^a-z0-9._-]/g, '_'); // Replace all other non-safe chars with _
    cb(null, uniqueSuffix + '-' + safeName);
  }
});
const upload = multer({ storage });
// Serve uploads statically with organized directories
app.use('/uploads/thumbnails', express.static(thumbnailsDir));
app.use('/uploads/pdfs', express.static(pdfsDir));
app.use('/uploads/icons', express.static(iconsDir));
app.use('/uploads/product_images', express.static(productImagesDir));
app.use('/uploads/instructors', express.static(instructorsDir));
app.use('/uploads/courses', express.static(coursesDir));
app.use('/uploads/blogs', express.static(blogsDir));
app.use('/uploads', express.static(uploadsDir));
// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Return the public URL to the uploaded file
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

app.post('/submit-form', (req, res) => {
  console.log('Received /submit-form:', req.body);
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Name and email required.' });
  }
  db.run(
    'INSERT INTO users (name, email) VALUES (?, ?)',
    [name, email],
    function (err) {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ success: false, message: 'Database error.' });
      }
      console.log('User added with ID:', this.lastID);
      // Log all users after insert
      db.all('SELECT id, name, email FROM users', [], (err, rows) => {
        if (err) {
          console.error('Error fetching users:', err);
        } else {
          console.log('Current users:', rows);
        }
      });
      res.json({ success: true, message: 'User added!', userId: this.lastID });
    }
  );
});

// --- Consultant Public API ---
// Get all consultants (public, no auth)
app.get('/api/consultants/public', async (req, res) => {
  const consultants = await db.all('SELECT * FROM consultants');
  res.json(consultants);
});

// --- Products API with File Uploads ---
// 
// POST /api/products - Create a new product
// - Content-Type: multipart/form-data
// - Supports 4 product types: course, ebook, app, gadget
// - File uploads: thumbnail, pdf_file, icon, product_image
// - Validation: Required fields based on product type
// - File size limit: 10MB
// - Response: { success: true, message: "Product created successfully", product: {...} }
//

// Ensure products table exists with all required fields including course-specific fields
async function ensureProductsTableV2() {
  try {
    // Check if products table exists and has the right structure
    const tableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
    
    if (tableExists) {
      // Table exists, check if it has the right columns
      const columns = await db.all("PRAGMA table_info(products)");
      const columnNames = columns.map(col => col.name);
      
      // Check if we have all required columns including new course fields
      const requiredColumns = [
        'product_type', 'title', 'name', 'description', 'price', 'video_url', 
        'thumbnail', 'author', 'pdf_file', 'product_image', 'purchase_link', 
        'download_link', 'icon', 'status', 'featured', 'created_at',
        // New course-specific fields
        'subtitle', 'instructor_name', 'instructor_title', 'instructor_bio',
        'instructor_image', 'duration', 'total_lectures', 'language', 'level',
        'rating', 'total_ratings', 'enrolled_students'
      ];
      
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
      
      if (missingColumns.length > 0) {
        console.log('Products table missing columns:', missingColumns);
        console.log('Adding missing columns to products table...');
        
        // Add missing columns one by one
        for (const col of missingColumns) {
          let columnType = 'TEXT';
          if (col === 'total_lectures' || col === 'total_ratings' || col === 'enrolled_students') {
            columnType = 'INTEGER DEFAULT 0';
          } else if (col === 'rating') {
            columnType = 'REAL DEFAULT 0.00';
          } else if (col === 'level') {
            columnType = 'TEXT DEFAULT "Beginner"';
          }
          
          try {
            await db.exec(`ALTER TABLE products ADD COLUMN ${col} ${columnType}`);
            console.log(`Added column: ${col}`);
          } catch (err) {
            if (err.message.includes('duplicate column name')) {
              console.log(`Column ${col} already exists`);
            } else {
              console.error(`Error adding column ${col}:`, err);
            }
          }
        }
        console.log('Products table updated with new course fields');
      } else {
        console.log('Products table already has all required columns');
      }
    } else {
      // Table doesn't exist, create it with all fields
  await db.exec(`
        CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_type TEXT NOT NULL,
      title TEXT,
      name TEXT,
      description TEXT,
      price REAL,
      video_url TEXT,
          thumbnail TEXT,
          author TEXT,
      pdf_file TEXT,
          product_image TEXT,
          purchase_link TEXT,
          download_link TEXT,
          icon TEXT,
      status TEXT CHECK(status IN ('active', 'inactive')) NOT NULL DEFAULT 'active',
      featured INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          -- Course-specific fields
          subtitle TEXT,
          instructor_name TEXT,
          instructor_title TEXT,
          instructor_bio TEXT,
          instructor_image TEXT,
          duration TEXT,
          total_lectures INTEGER DEFAULT 0,
          language TEXT,
          level TEXT DEFAULT 'Beginner',
          rating REAL DEFAULT 0.00,
          total_ratings INTEGER DEFAULT 0,
          enrolled_students INTEGER DEFAULT 0
    );
  `);
      console.log('Products table created with complete schema including course fields');
    }
    
    // Create course-related tables
    await ensureCourseTables();
    
    // Ensure cart tables are also created
    try {
      await ensureCartTables();
    } catch (error) {
      console.error('Error ensuring cart tables:', error);
    }
    
    // Ensure blogs table exists
    try {
      await ensureBlogsTable();
    } catch (error) {
      console.error('Error ensuring blogs table:', error);
    }
    
    // Ensure e-commerce tables exist
    try {
      await ensureEcommerceTables();
    } catch (error) {
      console.error('Error ensuring e-commerce tables:', error);
    }
    
  } catch (error) {
    console.error('Error ensuring products table:', error);
    throw error;
  }
}

// Ensure course-related tables exist
async function ensureCourseTables() {
  try {
    // Learning Objectives Table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS learning_objectives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        objective TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);
    
    // Requirements Table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        requirement TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);
    
    // Course Sections Table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS course_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        section_name TEXT NOT NULL,
        lectures_count INTEGER DEFAULT 0,
        duration TEXT,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);
    
    // Course Lectures Table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS course_lectures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL,
        lecture_title TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(section_id) REFERENCES course_sections(id) ON DELETE CASCADE
      );
    `);
    
    console.log('Course-related tables ensured');
  } catch (error) {
    console.error('Error ensuring course tables:', error);
    throw error;
  }
}

// Ensure cart tables exist
async function ensureCartTables() {
  try {
    // Cart table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    
    // Cart items table for better structure
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cart_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cart_id) REFERENCES cart(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    
    // Orders table for checkout
    await db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        billing_address TEXT,
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Order items table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    
    console.log('Cart tables ensured successfully');
  } catch (error) {
    console.error('Error creating cart tables:', error);
    throw error;
  }
}

// Ensure blogs table exists
async function ensureBlogsTable() {
  try {
    // Check if blogs table exists
    const tableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='blogs'");
    
    if (tableExists) {
      console.log('Blogs table already exists');
      return;
    }
    
    // Create blogs table
    await db.exec(`
      CREATE TABLE blogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT CHECK(category IN ('Therapy', 'Mental Health', 'Education', 'Support', 'Technology')) NOT NULL,
        thumbnail TEXT,
        author TEXT NOT NULL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT CHECK(status IN ('active', 'inactive', 'published', 'draft', 'pending', 'archived', 'live', 'scheduled', 'private', 'public', 'review', 'approved', 'rejected', 'trash', 'deleted')) NOT NULL DEFAULT 'draft'
      );
    `);
    
    console.log('Blogs table created successfully');
  } catch (error) {
    console.error('Error creating blogs table:', error);
    throw error;
  }
}

// Ensure e-commerce tables exist
async function ensureEcommerceTables() {
  try {
    // Create users table for authentication
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users_auth (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create user addresses table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        address_line1 TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        zip_code TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'India',
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users_auth(id) ON DELETE CASCADE
      );
    `);
    
    // Create orders table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        order_number TEXT UNIQUE NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status TEXT CHECK(status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')) NOT NULL DEFAULT 'pending',
        payment_method TEXT NOT NULL,
        payment_status TEXT CHECK(payment_status IN ('pending', 'paid', 'failed', 'refunded')) NOT NULL DEFAULT 'pending',
        delivery_address TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users_auth(id) ON DELETE CASCADE
      );
    `);
    
    // Create order items table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_type TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders_new(id) ON DELETE CASCADE
      );
    `);
    
    // Create order status history table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders_new(id) ON DELETE CASCADE
      );
    `);
    
    // Create payments table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'refunded')) NOT NULL DEFAULT 'pending',
        transaction_id TEXT,
        gateway_response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders_new(id) ON DELETE CASCADE
      );
    `);
    
    // Create product inventory table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS product_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        product_type TEXT NOT NULL,
        available_quantity INTEGER NOT NULL DEFAULT 0,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        min_stock_level INTEGER NOT NULL DEFAULT 5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );
    `);
    
    // Create indexes for performance
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders_new(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_new(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders_new(created_at);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items_new(order_id);
      CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
      CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id);
    `);
    
    console.log('E-commerce tables created successfully');
  } catch (error) {
    console.error('Error creating e-commerce tables:', error);
    throw error;
  }
}

// Helper functions for course management
async function createLearningObjectives(productId, objectives) {
  try {
    if (!Array.isArray(objectives) || objectives.length === 0) return;
    
    for (let i = 0; i < objectives.length; i++) {
      const objective = objectives[i];
      if (objective && objective.trim()) {
        await db.run(
          'INSERT INTO learning_objectives (product_id, objective, order_index) VALUES (?, ?, ?)',
          productId, objective.trim(), i
        );
      }
    }
  } catch (error) {
    console.error('Error creating learning objectives:', error);
    throw error;
  }
}

async function createRequirements(productId, requirements) {
  try {
    if (!Array.isArray(requirements) || requirements.length === 0) return;
    
    for (let i = 0; i < requirements.length; i++) {
      const requirement = requirements[i];
      if (requirement && requirement.trim()) {
        await db.run(
          'INSERT INTO requirements (product_id, requirement, order_index) VALUES (?, ?, ?)',
          productId, requirement.trim(), i
        );
      }
    }
  } catch (error) {
    console.error('Error creating requirements:', error);
    throw error;
  }
}

async function createCourseContent(productId, content) {
  try {
    if (!Array.isArray(content) || content.length === 0) return;
    
    for (let i = 0; i < content.length; i++) {
      const section = content[i];
      if (section && section.section_name && section.lectures) {
        // Create section
        const sectionResult = await db.run(
          'INSERT INTO course_sections (product_id, section_name, lectures_count, duration, order_index) VALUES (?, ?, ?, ?, ?)',
          productId, section.section_name, section.lectures.length, section.duration || '', i
        );
        
        const sectionId = sectionResult.lastID;
        
        // Create lectures for this section
        for (let j = 0; j < section.lectures.length; j++) {
          const lecture = section.lectures[j];
          if (lecture && lecture.lecture_title) {
            await db.run(
              'INSERT INTO course_lectures (section_id, lecture_title, order_index) VALUES (?, ?, ?)',
              sectionId, lecture.lecture_title, j
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Error creating course content:', error);
    throw error;
  }
}

async function getLearningObjectives(productId) {
  try {
    return await db.all(
      'SELECT * FROM learning_objectives WHERE product_id = ? ORDER BY order_index ASC',
      productId
    );
  } catch (error) {
    console.error('Error getting learning objectives:', error);
    return [];
  }
}

async function getRequirements(productId) {
  try {
    return await db.all(
      'SELECT * FROM requirements WHERE product_id = ? ORDER BY order_index ASC',
      productId
    );
  } catch (error) {
    console.error('Error getting requirements:', error);
    return [];
  }
}

async function getCourseContent(productId) {
  try {
    const sections = await db.all(
      'SELECT * FROM course_sections WHERE product_id = ? ORDER BY order_index ASC',
      productId
    );
    
    const content = [];
    for (const section of sections) {
      const lectures = await db.all(
        'SELECT * FROM course_lectures WHERE section_id = ? ORDER BY order_index ASC',
        section.id
      );
      content.push({
        ...section,
        lectures: lectures
      });
    }
    
    return content;
  } catch (error) {
    console.error('Error getting course content:', error);
    return [];
  }
}

async function deleteLearningObjectives(productId) {
  try {
    await db.run('DELETE FROM learning_objectives WHERE product_id = ?', productId);
  } catch (error) {
    console.error('Error deleting learning objectives:', error);
    throw error;
  }
}

async function deleteRequirements(productId) {
  try {
    await db.run('DELETE FROM requirements WHERE product_id = ?', productId);
  } catch (error) {
    console.error('Error deleting requirements:', error);
    throw error;
  }
}

async function deleteCourseContent(productId) {
  try {
    // Get all sections for this product
    const sections = await db.all('SELECT id FROM course_sections WHERE product_id = ?', productId);
    
    // Delete lectures for each section
    for (const section of sections) {
      await db.run('DELETE FROM course_lectures WHERE section_id = ?', section.id);
    }
    
    // Delete sections
    await db.run('DELETE FROM course_sections WHERE product_id = ?', productId);
  } catch (error) {
    console.error('Error deleting course content:', error);
    throw error;
  }
}

// Product-specific multer setup using existing directories

const productStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Route files to appropriate directories based on field name
    if (file.fieldname === 'thumbnail') {
      cb(null, coursesDir); // Course thumbnails go to courses directory
    } else if (file.fieldname === 'pdf_file') {
      cb(null, pdfsDir);
    } else if (file.fieldname === 'icon') {
      cb(null, iconsDir);
    } else if (file.fieldname === 'product_image') {
      cb(null, productImagesDir);
    } else if (file.fieldname === 'instructor_image') {
      cb(null, instructorsDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let safeName = file.originalname
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

// File filter for validation
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'pdf_file') {
    // Only allow PDFs for pdf_file field
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for pdf_file field'), false);
    }
  } else {
    // Allow images for other fields
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for image fields'), false);
    }
  }
};

const productUpload = multer({ 
  storage: productStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});



// POST /api/products - create a new product with dynamic fields and file uploads
app.post('/api/products', productUpload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'product_image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'pdf_file', maxCount: 1 },
  { name: 'instructor_image', maxCount: 1 }
]), (err, req, res, next) => {
  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
}, async (req, res) => {
  await ensureProductsTableV2();
  const data = req.body;
  const files = req.files || {};

  // Debug logging for files
  console.log('Received files:', Object.keys(files));
  console.log('Files details:', files);

  // Get product type and validate required fields
  // Support multiple possible field names for product type
  let productType = data.productType || data.product_type || data.type || data.productType;
  
  // Clean and normalize the product type
  if (productType) {
    productType = productType.toString().toLowerCase().trim();
  }
  
  // Debug logging
  console.log('Received form data:', Object.keys(data));
  console.log('Product type received (raw):', data.productType || data.product_type || data.type);
  console.log('Product type received (cleaned):', productType);
  console.log('All form fields:', data);
  
  if (!productType) {
    return res.status(400).json({ 
      success: false, 
      message: 'Product type is required. Please send either "productType", "product_type", or "type" field.',
      receivedFields: Object.keys(data),
      example: {
        productType: 'course',
        title: 'Course Title',
        description: 'Course Description'
      }
    });
  }

  // Validate required fields based on product type
  let validationError = null;
  let requiredFields = [];

  // Normalize product type for flexible matching
  const normalizedType = productType.replace(/[^a-z]/g, ''); // Remove all non-letters
  
  if (normalizedType === 'course') {
    // Basic required fields
    if (!data.title || !data.description || !files.thumbnail) {
      validationError = 'Course requires: title, description, and thumbnail';
    }
    
    // Validate title length (3-255 characters)
    if (data.title && (data.title.length < 3 || data.title.length > 255)) {
      validationError = 'Title must be between 3 and 255 characters';
    }
    
    // Validate subtitle length (10-500 characters)
    if (data.subtitle && (data.subtitle.length < 10 || data.subtitle.length > 500)) {
      validationError = 'Subtitle must be between 10 and 500 characters';
    }
    
    // Validate description length (minimum 20 characters)
    if (data.description && data.description.length < 20) {
      validationError = 'Description must be at least 20 characters long';
    }
    
    // Validate price (optional, but if provided must be valid)
    if (data.price && data.price !== 'Free' && isNaN(parseFloat(data.price))) {
      validationError = 'Price must be "Free" or a valid number';
    }
    
    // Validate learning objectives (optional for now, max 20 items)
    if (data.learning_objectives && (!Array.isArray(data.learning_objectives) || data.learning_objectives.length > 20)) {
      validationError = 'Learning objectives must be an array with maximum 20 items';
    }
    
    // Validate requirements (optional, max 20 items)
    if (data.requirements && (!Array.isArray(data.requirements) || data.requirements.length > 20)) {
      validationError = 'Requirements must be an array with maximum 20 items';
    }
    
    // Validate course content (optional, max 50 sections)
    if (data.course_content && (!Array.isArray(data.course_content) || data.course_content.length > 50)) {
      validationError = 'Course content must be an array with maximum 50 sections';
    }
  } else if (normalizedType === 'ebook') {
    requiredFields = ['title', 'description', 'author', 'pdf_file', 'thumbnail'];
    if (!data.title || !data.description || !data.author || !files.pdf_file || !files.thumbnail) {
      validationError = 'E-Book requires: title, description, author, pdf_file, and thumbnail';
    }
  } else if (normalizedType === 'app') {
    requiredFields = ['name', 'description', 'download_link', 'icon'];
    if (!data.name || !data.description || !data.download_link || !files.icon) {
      validationError = 'App requires: name, description, download_link, and icon';
    }
  } else if (normalizedType === 'gadget') {
    requiredFields = ['name', 'description', 'price', 'product_image', 'purchase_link', 'download_link', 'icon'];
    if (!data.name || !data.description || !data.price || !files.product_image || !data.purchase_link || !data.download_link || !files.icon) {
      validationError = 'Gadget requires: name, description, price, product_image, purchase_link, download_link, and icon';
    }
    // Validate price is numeric
    if (data.price && isNaN(parseFloat(data.price))) {
      validationError = 'Price must be a valid number';
    }
  } else {
    return res.status(400).json({ 
      success: false, 
      message: `Invalid product type: "${productType}". Must be one of: course, e-book/ebook, app, or gadget. Received: "${productType}" (normalized: "${normalizedType}")` 
    });
  }

  if (validationError) {
    return res.status(400).json({ 
      success: false, 
      message: validationError 
    });
  }

  try {
    // Prepare data for insertion
    const title = data.title || null;
    const name = data.name || null;
    const description = data.description || null;
    const price = data.price === 'Free' ? null : (data.price ? parseFloat(data.price) : null);
    const video_url = data.video_url || null;
    const author = data.author || null;
    const purchase_link = data.purchase_link || null;
    const download_link = data.download_link || null;
    const status = data.status || 'active';
    const featured = data.featured === 'true' || data.featured === '1' ? 1 : 0;
    
    // Course-specific fields
    const subtitle = data.subtitle || null;
    const instructor_name = data.instructor_name || null;
    const instructor_title = data.instructor_title || null;
    const instructor_bio = data.instructor_bio || null;
    const instructor_image = files.instructor_image ? '/uploads/instructors/' + files.instructor_image[0].filename : null;
    const duration = data.duration || null;
    const total_lectures = data.total_lectures ? parseInt(data.total_lectures) : 0;
    const language = data.language || null;
    const level = data.level || 'Beginner';
    const rating = data.rating ? parseFloat(data.rating) : 0.00;
    const total_ratings = data.total_ratings ? parseInt(data.total_ratings) : 0;
    const enrolled_students = data.enrolled_students ? parseInt(data.enrolled_students) : 0;

    // Handle file uploads with organized directory structure
    const thumbnail = files.thumbnail ? '/uploads/courses/' + files.thumbnail[0].filename : null;
    const product_image = files.product_image ? '/uploads/product_images/' + files.product_image[0].filename : null;
    const icon = files.icon ? '/uploads/icons/' + files.icon[0].filename : null;
    const pdf_file = files.pdf_file ? '/uploads/pdfs/' + files.pdf_file[0].filename : null;

    // Insert into database
    const result = await db.run(
      `INSERT INTO products (product_type, title, name, description, price, video_url, thumbnail, author, pdf_file, product_image, purchase_link, download_link, icon, status, featured, subtitle, instructor_name, instructor_title, instructor_bio, instructor_image, duration, total_lectures, language, level, rating, total_ratings, enrolled_students) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      productType, title, name, description, price, video_url, thumbnail, author, pdf_file, product_image, purchase_link, download_link, icon, status, featured, subtitle, instructor_name, instructor_title, instructor_bio, instructor_image, duration, total_lectures, language, level, rating, total_ratings, enrolled_students
    );

    const productId = result.lastID;
    
    // If this is a course, create related data
    if (normalizedType === 'course') {
      try {
        // Create learning objectives
        if (data.learning_objectives && Array.isArray(data.learning_objectives)) {
          await createLearningObjectives(productId, data.learning_objectives);
        }
        
        // Create requirements
        if (data.requirements && Array.isArray(data.requirements)) {
          await createRequirements(productId, data.requirements);
        }
        
        // Create course content structure
        if (data.course_content && Array.isArray(data.course_content)) {
          await createCourseContent(productId, data.course_content);
        }
        
        console.log('Course-related data created successfully');
      } catch (error) {
        console.error('Error creating course-related data:', error);
        // Continue with response even if course data creation fails
      }
    }
    
    // Get the created product for response
    const createdProduct = await db.get('SELECT * FROM products WHERE id = ?', productId);
    
    res.status(200).json({
      success: true,
      message: "Product created successfully",
      product: createdProduct
    });

  } catch (err) {
    console.error('Error inserting product:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Database error occurred while creating product' 
    });
  }
});

// GET /api/products - fetch all products with optional filtering
app.get('/api/products', async (req, res) => {
  console.log('Products endpoint called with query:', req.query);
  
  try {
    let sql = 'SELECT * FROM products WHERE 1=1';
    let params = [];
    
    // Add filters
    if (req.query.type) {
      sql += ' AND LOWER(product_type) = LOWER(?)';
      params.push(req.query.type);
    }
    
    if (req.query.status) {
      sql += ' AND status = ?';
      params.push(req.query.status);
    }
    
    if (req.query.featured !== undefined) {
      sql += ' AND featured = ?';
      params.push(req.query.featured === 'true' ? 1 : 0);
    }
    
    sql += ' ORDER BY created_at DESC';
    console.log('Executing SQL:', sql, 'with params:', params);
    
    const products = await db.all(sql, params);
    console.log(`Found ${products.length} products`);
    
    // Enhance products with related data for courses
    const enhancedProducts = await Promise.all(products.map(async (product) => {
      if (product.product_type === 'course') {
        try {
          const [objectives, requirements, content] = await Promise.all([
            getLearningObjectives(product.id),
            getRequirements(product.id),
            getCourseContent(product.id)
          ]);
          
          return {
            ...product,
            learning_objectives: objectives.map(obj => obj.objective),
            requirements: requirements.map(req => req.requirement),
            course_content: content.map(section => ({
              section: section.section_name,
              lectures: section.lectures_count,
              duration: section.duration,
              items: section.lectures || []
            })),
            type: product.product_type, // Add type field for frontend compatibility
            updated_at: product.created_at // Add updated_at for frontend compatibility
          };
        } catch (error) {
          console.error('Error fetching related data for product:', product.id, error);
          return {
            ...product,
            learning_objectives: [],
            requirements: [],
            course_content: [],
            type: product.product_type,
            updated_at: product.created_at
          };
        }
      } else {
        return {
          ...product,
          type: product.product_type,
          updated_at: product.created_at
        };
      }
    }));
    
    res.json({
      success: true,
      products: enhancedProducts
    });
    
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching products'
    });
  }
});

// GET /api/products/:id - fetch a single product with all related data
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    // Get the main product
    const product = await db.get('SELECT * FROM products WHERE id = ?', id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // If it's a course, get related data
    if (product.product_type === 'course') {
      try {
        const [learningObjectives, requirements, courseContent] = await Promise.all([
          getLearningObjectives(id),
          getRequirements(id),
          getCourseContent(id)
        ]);

        res.json({
          success: true,
          product: {
            ...product,
            learning_objectives: learningObjectives,
            requirements: requirements,
            course_content: courseContent
          }
        });
      } catch (error) {
        console.error('Error fetching course-related data:', error);
        res.json({
          success: true,
          product: product
        });
      }
    } else {
      res.json({
        success: true,
        product: product
      });
    }

  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching product'
    });
  }
});

// PUT /api/products/:id - update a product
app.put('/api/products/:id', productUpload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'product_image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'pdf_file', maxCount: 1 },
  { name: 'instructor_image', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const files = req.files || {};
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    // Check if product exists
    const product = await db.get('SELECT * FROM products WHERE id = ?', id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Prepare update data
    const updateFields = [];
    const updateValues = [];
    
    // Basic fields
    const fields = ['title', 'name', 'description', 'price', 'video_url', 'author', 
                   'purchase_link', 'download_link', 'status', 'featured', 'subtitle',
                   'instructor_name', 'instructor_title', 'instructor_bio', 'duration',
                   'total_lectures', 'language', 'level', 'rating', 'total_ratings', 'enrolled_students'];
    
    for (const field of fields) {
      if (data[field] !== undefined) {
        let value = data[field];
        if (field === 'price' && value === 'Free') value = null;
        if (field === 'total_lectures' || field === 'total_ratings' || field === 'enrolled_students') {
          value = parseInt(value) || 0;
        }
        if (field === 'rating') value = parseFloat(value) || 0.00;
        if (field === 'featured') value = value === 'true' || value === '1' ? 1 : 0;
        
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    }
    
    // Handle file uploads
    if (files.thumbnail) {
      updateFields.push('thumbnail = ?');
      updateValues.push('/uploads/courses/' + files.thumbnail[0].filename);
    }
    if (files.instructor_image) {
      updateFields.push('instructor_image = ?');
      updateValues.push('/uploads/instructors/' + files.instructor_image[0].filename);
    }
    if (files.product_image) {
      updateFields.push('product_image = ?');
      updateValues.push('/uploads/product_images/' + files.product_image[0].filename);
    }
    if (files.icon) {
      updateFields.push('icon = ?');
      updateValues.push('/uploads/icons/' + files.icon[0].filename);
    }
    if (files.pdf_file) {
      updateFields.push('pdf_file = ?');
      updateValues.push('/uploads/pdfs/' + files.pdf_file[0].filename);
    }
    
    // Update main product
    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.run(`UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`, ...updateValues);
    }
    
    // If it's a course, update related data
    if (product.product_type === 'course') {
      try {
        // Update learning objectives
        if (data.learning_objectives && Array.isArray(data.learning_objectives)) {
          await deleteLearningObjectives(id);
          await createLearningObjectives(id, data.learning_objectives);
        }
        
        // Update requirements
        if (data.requirements && Array.isArray(data.requirements)) {
          await deleteRequirements(id);
          await createRequirements(id, data.requirements);
        }
        
        // Update course content
        if (data.course_content && Array.isArray(data.course_content)) {
          await deleteCourseContent(id);
          await createCourseContent(id, data.course_content);
        }
        
        console.log('Course-related data updated successfully');
      } catch (error) {
        console.error('Error updating course-related data:', error);
      }
    }
    
    // Get updated product
    const updatedProduct = await db.get('SELECT * FROM products WHERE id = ?', id);
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });

  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while updating product'
    });
  }
});

// DELETE /api/products/:id - delete a product by ID
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    // Check if product exists
    const product = await db.get('SELECT * FROM products WHERE id = ?', id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Delete the product (cascade will handle related data)
    await db.run('DELETE FROM products WHERE id = ?', id);
    
    res.json({
      success: true,
      message: 'Product deleted successfully',
      deletedProduct: product
    });

  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while deleting product'
    });
  }
});

// Cart Management Endpoints

// Add item to cart
app.post('/api/cart/add', async (req, res) => {
  try {
    console.log('Cart add endpoint called with:', req.body);
    const { product_id, user_id, quantity = 1 } = req.body;
    
    if (!product_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and User ID are required'
      });
    }
    
    // Check if product exists
    const product = await db.get('SELECT * FROM products WHERE id = ?', [product_id]);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    console.log('Product found:', product.id);
    
    // Check if cart table exists
    try {
      const tableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='cart'");
      console.log('Cart table check result:', tableCheck);
      
      if (!tableCheck) {
        console.log('Cart table does not exist, creating it now...');
        await ensureCartTables();
      }
    } catch (tableError) {
      console.error('Error checking cart table:', tableError);
    }
    
    // Check if item already exists in cart
    const existingItem = await db.get(
      'SELECT * FROM cart WHERE user_id = ? AND product_id = ?',
      [user_id, product_id]
    );
    
    if (existingItem) {
      // Update quantity
      await db.run(
        'UPDATE cart SET quantity = quantity + ? WHERE id = ?',
        [quantity, existingItem.id]
      );
    } else {
      // Add new item
      await db.run(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
        [user_id, product_id, quantity]
      );
    }
    
    res.json({
      success: true,
      message: 'Item added to cart successfully'
    });
    
  } catch (error) {
    console.error('Error adding item to cart:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while adding item to cart',
      error: error.message
    });
  }
});

// Get user's cart
app.get('/api/cart', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const cartItems = await db.all(`
      SELECT c.id, c.quantity, c.created_at, p.*
      FROM cart c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `, [user_id]);
    
    // Calculate total
    const total = cartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.price) * item.quantity);
    }, 0);
    
    res.json({
      success: true,
      cart: {
        items: cartItems,
        total: total.toFixed(2),
        item_count: cartItems.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching cart'
    });
  }
});

// Remove item from cart
app.delete('/api/cart/remove/:item_id', async (req, res) => {
  try {
    const { item_id } = req.params;
    
    const result = await db.run('DELETE FROM cart WHERE id = ?', [item_id]);
    
    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Item removed from cart successfully'
    });
    
  } catch (error) {
    console.error('Error removing item from cart:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while removing item from cart'
    });
  }
});

// Clear entire cart
app.delete('/api/cart/clear', async (req, res) => {
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    await db.run('DELETE FROM cart WHERE user_id = ?', [user_id]);
    
    res.json({
      success: true,
      message: 'Cart cleared successfully'
    });
    
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while clearing cart'
    });
  }
});

// Checkout endpoint
app.post('/api/cart/checkout', async (req, res) => {
  try {
    console.log('Checkout endpoint called with:', req.body);
    const { user_id, payment_method, billing_address, shipping_address } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Check if orders table exists, create it if not
    try {
      const tableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'");
      console.log('Orders table check result:', tableCheck);
      
      if (!tableCheck) {
        console.log('Orders table does not exist, creating it now...');
        
        // Create orders table directly
        await db.run('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, total_amount REAL NOT NULL, status TEXT, payment_method TEXT, billing_address TEXT, shipping_address TEXT, created_at TEXT, updated_at TEXT)');
        
        // Create order items table
        await db.run('CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL)');
        
        console.log('Orders tables created successfully');
      }
    } catch (tableError) {
      console.error('Error checking orders table:', tableError);
    }
    
    // Get cart items
    const cartItems = await db.all(`
      SELECT c.quantity, p.id, p.price
      FROM cart c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
    `, [user_id]);
    
    console.log('Cart items found:', cartItems);
    
    if (cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }
    
    // Calculate total
    const total = cartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.price) * item.quantity);
    }, 0);
    
    console.log('Total calculated:', total);
    
    // Create order
    const orderResult = await db.run(`
      INSERT INTO orders (user_id, total_amount, payment_method, billing_address, shipping_address)
      VALUES (?, ?, ?, ?, ?)
    `, [user_id, total.toFixed(2), payment_method, JSON.stringify(billing_address), JSON.stringify(shipping_address)]);
    
    const orderId = orderResult.lastID;
    console.log('Order created with ID:', orderId);
    
    // Create order items
    for (const item of cartItems) {
      await db.run(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `, [orderId, item.id, item.quantity, item.price]);
    }
    
    console.log('Order items created');
    
    // Clear cart
    await db.run('DELETE FROM cart WHERE user_id = ?', [user_id]);
    
    res.json({
      success: true,
      message: 'Checkout completed successfully',
      order_id: orderId,
      total: total.toFixed(2)
    });
    
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred during checkout',
      error: error.message
    });
  }
});

// Get order history
app.get('/api/orders', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const orders = await db.all(`
      SELECT o.*, 
             COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [user_id]);
    
    res.json({
      success: true,
      orders: orders
    });
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while fetching orders'
    });
  }
});

// Debug endpoint to check database tables
app.get('/api/debug/tables', async (req, res) => {
  try {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    res.json({
      success: true,
      tables: tables.map(t => t.name)
    });
  } catch (error) {
    console.error('Error checking tables:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while checking tables',
      error: error.message
    });
  }
});

// Manual table creation endpoint for debugging
app.post('/api/debug/create-orders-table', async (req, res) => {
  try {
    console.log('Creating orders table manually...');
    
    // Create orders table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        billing_address TEXT,
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create order items table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    
    console.log('Orders tables created successfully');
    res.json({
      success: true,
      message: 'Orders tables created successfully'
    });
    
  } catch (error) {
    console.error('Error creating orders tables:', error);
    res.status(500).json({
      success: false,
      message: 'Database error occurred while creating orders tables',
      error: error.message
    });
  }
});

// Simple test endpoint
app.get('/api/test-simple', (req, res) => {
  res.json({ message: 'Simple test endpoint works!' });
});

// --- Catch-all 404 and error handler for JSON responses ---
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});


