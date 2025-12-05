const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Uploads Directory
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// Setup Database
const DB_PATH = path.join(__dirname, 'hitmaker.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        artist TEXT,
        tempo INTEGER,
        duration_seconds REAL,
        filename TEXT,
        image_filename TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve frontend files
app.use('/uploads', express.static(UPLOAD_DIR)); // Serve uploaded MP3s

// Multer Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_');
        cb(null, uniqueSuffix + '-' + name + ext);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// API Routes

// GET All Songs
app.get('/api/songs', (req, res) => {
    db.all("SELECT * FROM songs ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// POST Upload Song
app.post('/api/upload', (req, res) => {
    upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: "Upload Error: " + err.message });
        } else if (err) {
            return res.status(500).json({ error: "Server Error: " + err.message });
        }

        if (!req.files || !req.files.audio) {
            return res.status(400).json({ error: 'No audio file uploaded' });
        }

        const audioFile = req.files.audio[0];
        const imageFile = req.files.image ? req.files.image[0] : null;
        
        const { title, artist, tempo, duration } = req.body;

        const stmt = db.prepare(`INSERT INTO songs (title, artist, tempo, duration_seconds, filename, image_filename) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(title, artist, tempo, duration, audioFile.filename, imageFile ? imageFile.filename : null, function(dbErr) {
            if (dbErr) {
                return res.status(500).json({ error: dbErr.message });
            }
            res.json({ 
                id: this.lastID, 
                url: '/uploads/' + audioFile.filename,
                imageUrl: imageFile ? '/uploads/' + imageFile.filename : null
            });
        });
        stmt.finalize();
    });
});

// DELETE Song
app.delete('/api/songs/:id', (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM songs WHERE id = ?", id, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Deleted", changes: this.changes });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
