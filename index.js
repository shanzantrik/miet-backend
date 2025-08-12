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
app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = 'your_jwt_secret'; // Change this in production
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
}

(async () => {
  await setupDatabase();
  if (INIT_DB) {
    console.log('Database initialized.');
    process.exit(0);
  }
  // ... existing code ...
})();

// --- Auth Middleware ---
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

// --- Start server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
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
// Serve uploads statically
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

// --- Dynamic Products API with File Uploads ---

// Ensure products table exists with all required fields
async function ensureProductsTableV2() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT,
      name TEXT,
      description TEXT,
      price REAL,
      author TEXT,
      video_url TEXT,
      download_link TEXT,
      purchase_link TEXT,
      pdf_file TEXT,
      image TEXT,
      status TEXT CHECK(status IN ('active', 'inactive')) NOT NULL DEFAULT 'active',
      featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Multer setup for product uploads
const productUploadsDir = path.join(process.cwd(), 'uploads', 'products');
if (!fs.existsSync(productUploadsDir)) {
  fs.mkdirSync(productUploadsDir, { recursive: true });
}
const productStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productUploadsDir);
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
const productUpload = multer({ storage: productStorage });

// Serve product uploads statically
app.use('/uploads/products', express.static(productUploadsDir));

// POST /api/products - create a new product with dynamic fields and file uploads
app.post('/api/products', productUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'pdf_file', maxCount: 1 }
]), async (req, res) => {
  await ensureProductsTableV2();
  const data = req.body;
  const files = req.files || {};

  // Dynamic field mapping based on type
  const type = data.type;
  let title = data.title || null;
  let name = data.name || null;
  let description = data.description || null;
  let price = data.price ? parseFloat(data.price) : null;
  let author = data.author || null;
  let video_url = data.video_url || null;
  let download_link = data.download_link || null;
  let purchase_link = data.purchase_link || null;
  let status = data.status || 'active';
  let featured = data.featured === 'true' || data.featured === '1' ? 1 : 0;

  // File fields
  let image = null;
  let pdf_file = null;

  // Map file fields based on type
  if (type === 'course') {
    image = files.thumbnail ? '/uploads/products/' + files.thumbnail[0].filename : null;
    title = data.title;
  } else if (type === 'ebook') {
    image = files.image ? '/uploads/products/' + files.image[0].filename : null;
    pdf_file = files.pdf_file ? '/uploads/products/' + files.pdf_file[0].filename : null;
    title = data.title;
  } else if (type === 'app') {
    image = files.icon ? '/uploads/products/' + files.icon[0].filename : null;
    name = data.name;
  } else if (type === 'gadget') {
    image = files.image ? '/uploads/products/' + files.image[0].filename : null;
    name = data.name;
  } else {
    // fallback: use any image field
    image = files.image ? '/uploads/products/' + files.image[0].filename : null;
  }
  if (!type || (!title && !name)) {
    return res.status(400).json({ error: 'Type and title/name are required.' });
  }
  try {
    const result = await db.run(
      `INSERT INTO products (type, title, name, description, price, author, video_url, download_link, purchase_link, pdf_file, image, status, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      type, title, name, description, price, author, video_url, download_link, purchase_link, pdf_file, image, status, featured
    );
    res.json({
      id: result.lastID,
      type, title, name, description, price, author, video_url, download_link, purchase_link, pdf_file, image, status, featured
    });
  } catch (err) {
    console.error('Error inserting product:', err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// GET /api/products - fetch all products
app.get('/api/products', async (req, res) => {
  await ensureProductsTableV2();
  try {
    const products = await db.all('SELECT * FROM products ORDER BY created_at DESC');
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Database error.' });
  }
});

// --- Catch-all 404 and error handler for JSON responses ---
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
