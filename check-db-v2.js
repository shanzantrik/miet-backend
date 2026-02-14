
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function verify() {
    const db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    console.log('--- TABLE INFO: consultants ---');
    const cols = await db.all("PRAGMA table_info(consultants)");
    const colNames = cols.map(c => c.name);
    console.log('Columns:', colNames.join(', '));

    console.log('\n--- SAMPLE ROW ---');
    const sample = await db.get("SELECT * FROM consultants LIMIT 1");
    console.log(JSON.stringify(sample, null, 2));

    await db.close();
}

verify().catch(console.error);
