
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';

async function verify() {
    const db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    console.log('Checking consultants table...');
    const count = await db.get("SELECT COUNT(*) as total FROM consultants");
    console.log('Total Consultants:', count.total);

    if (count.total === 0) {
        console.log('Inserting dummy consultant...');
        const hash = await bcrypt.hash('password123', 10);

        // Create user first
        const userResult = await db.run(
            'INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, ?)',
            ['dummy_consultant', hash, 'consultant', 'active']
        );
        const userId = userResult.lastID;

        // Create consultant profile
        await db.run(
            `INSERT INTO consultants (user_id, name, email, city, approval_status, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, 'Dr. John Smith', 'john@example.com', 'Mumbai', 'approved', 'online']
        );
        console.log('Dummy consultant inserted.');
    } else {
        const consultants = await db.all("SELECT id, name, email, approval_status FROM consultants");
        consultants.forEach(c => {
            console.log(`ID: ${c.id}, Name: ${c.name}, Email: ${c.email}, Status: ${c.approval_status}`);
        });
    }

    await db.close();
}

verify().catch(console.error);
