const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser'); 

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- DATABASE INITIALIZATION ---
const db = new sqlite3.Database('./shop.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, stock INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, total REAL, billing_address TEXT
            )`);

            db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
                if (!row) {
                    db.run("INSERT INTO users (username, password) VALUES ('admin', 'password123')");
                }
            });
        });
    }
});

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) res.json({ success: true, user: row });
        else res.json({ success: false, message: 'Invalid credentials' });
    });
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Registration successful' });
    });
});

// --- INVENTORY ---
app.get('/api/products', (req, res) => {
    db.all('SELECT * FROM products', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/products', (req, res) => {
    const { name, price, stock } = req.body;
    db.run('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [name, price, stock], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Stock added' });
    });
});

app.delete('/api/products/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM products WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Stock deleted' });
    });
});

// --- BILLING (UPDATED FOR INVENTORY DEDUCTION) ---
app.post('/api/billing', (req, res) => {

    const { userId, total, address, cartItems } = req.body;
    
    db.run('INSERT INTO orders (user_id, total, billing_address) VALUES (?, ?, ?)', 
    [userId, total, address], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const orderId = this.lastID;

        // Group the cart items to see how many of each product were bought
        const itemCounts = {};
        cartItems.forEach(item => {
            itemCounts[item.id] = (itemCounts[item.id] || 0) + 1;
        });

        // Deduct the purchased quantities from the products table
        const itemIds = Object.keys(itemCounts);
        let completed = 0;

        if (itemIds.length === 0) return res.json({ success: true, orderId });

        itemIds.forEach(id => {
            const qtyBought = itemCounts[id];
            db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [qtyBought, id], (err) => {
                completed++;
                // Once all items are deducted, send the success response to React
                if (completed === itemIds.length) {
                    res.json({ success: true, orderId });
                }
            });
        });
    });
});

// --- NEW: GET ORDER HISTORY ---
app.get('/api/orders/:userId', (req, res) => {
    const { userId } = req.params;
    // Fetch orders for this user, newest first
    db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

//  Get all registered users (excluding passwords for security!)
app.get('/api/admin/users', (req, res) => {
    db.all('SELECT id, username FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

//  Get all orders across the entire platform
app.get('/api/admin/orders', (req, res) => {
    // We use a LEFT JOIN to combine the orders table with the users table
    const query = `
        SELECT orders.id, orders.total, orders.billing_address, users.username 
        FROM orders 
        LEFT JOIN users ON orders.user_id = users.id
        ORDER BY orders.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});