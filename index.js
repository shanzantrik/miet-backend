import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
app.use(cors());

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
    await db.run('INSERT INTO admin (username, password) VALUES (?, ?)', 'admin', hash);
    console.log('Seeded default admin: admin/admin123');
  }
  // Seed superadmin user in users table if not exists
  const superadminUser = await db.get('SELECT * FROM users WHERE username = ?', 'admin');
  if (!superadminUser) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 'admin', hash, 'superadmin');
    console.log('Seeded superadmin user: admin/admin123');
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
// Get all consultants (superadmin only)
app.get('/api/consultants', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const consultants = await db.all('SELECT * FROM consultants');
  res.json(consultants);
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
  const { username, password, name, email, phone, image, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status } = req.body;
  if (!username || !password || !name || !email) return res.status(400).json({ error: 'Missing required fields' });
  // Create user
  const hash = await bcrypt.hash(password, 10);
  const userResult = await db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', username, hash, 'consultant');
  const user_id = userResult.lastID;
  // Create consultant profile
  const result = await db.run(
    `INSERT INTO consultants (user_id, name, email, phone, image, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user_id, name, email, phone, image, description, tagline, location_lat, location_lng, address, speciality, id_proof_type, id_proof_url, aadhar, bank_account, bank_ifsc, status || 'offline'
  );
  res.json({ id: result.lastID, user_id });
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
    'name', 'email', 'phone', 'image', 'description', 'tagline', 'location_lat', 'location_lng', 'address', 'speciality', 'id_proof_type', 'id_proof_url', 'aadhar', 'bank_account', 'bank_ifsc', 'status'
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
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
  const consultants = await db.all('SELECT c.* FROM consultants c JOIN services_consultants sc ON c.id = sc.consultant_id WHERE sc.service_id = ?', id);
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
  const consultants = await db.all('SELECT c.* FROM consultants c JOIN services_consultants sc ON c.id = sc.consultant_id WHERE sc.service_id = ?', id);
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
