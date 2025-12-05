const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Vercel Detection
const isVercel = process.env.VERCEL === '1';

let db, upload, sql, put, del;

// Conditional Imports
if (isVercel) {
    // Vercel Setup
    try {
        const postgres = require('@vercel/postgres');
        const blob = require('@vercel/blob');
        sql = postgres.sql;
        put = blob.put;
        del = blob.del;
        
        // Initialize Table (Lazy)
        // Note: In production, run this manually or via migration
        // sql`CREATE TABLE IF NOT EXISTS songs ...` 
    } catch (e) {
        console.warn("Vercel SDKs not found or configured:", e);
    }
    
    // Multer for Vercel (Memory Storage)
    upload = multer({ storage: multer.memoryStorage() });
} else {
    // Local Setup
    const sqlite3 = require('sqlite3').verbose();
    
    // Setup Uploads Directory
    const UPLOAD_DIR = path.join(__dirname, 'uploads');
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR);
    }

    // Setup Database
    const DB_PATH = path.join(__dirname, 'hitmaker.db');
    db = new sqlite3.Database(DB_PATH);

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

    // Multer Config (Disk Storage)
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
    upload = multer({ storage: storage });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve frontend files
if (!isVercel) {
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// API Routes

// GET All Songs
app.get('/api/songs', async (req, res) => {
    if (isVercel) {
        try {
            if (!sql) throw new Error("Database not configured");
            const { rows } = await sql`SELECT * FROM songs ORDER BY created_at DESC`;
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.json([]); // Return empty if DB fails
        }
    } else {
        db.all("SELECT * FROM songs ORDER BY created_at DESC", [], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        });
    }
});

// POST Upload Song
app.post('/api/upload', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
    if (!req.files || !req.files.audio) {
        return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const { title, artist, tempo, duration } = req.body;

    if (isVercel) {
        try {
            if (!put || !sql) throw new Error("Storage not configured");
            
            // Upload to Blob
            const audioFile = req.files.audio[0];
            const audioBlob = await put(audioFile.originalname, audioFile.buffer, { access: 'public' });
            
            let imageUrl = null;
            if (req.files.image) {
                const imageFile = req.files.image[0];
                const imageBlob = await put(imageFile.originalname, imageFile.buffer, { access: 'public' });
                imageUrl = imageBlob.url;
            }

            // Save to Postgres
            // Ensure table exists (Quick hack for demo)
            await sql`CREATE TABLE IF NOT EXISTS songs (
                id SERIAL PRIMARY KEY,
                title TEXT,
                artist TEXT,
                tempo INTEGER,
                duration_seconds REAL,
                filename TEXT,
                image_filename TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`;

            const result = await sql`INSERT INTO songs (title, artist, tempo, duration_seconds, filename, image_filename) 
                                     VALUES (${title}, ${artist}, ${tempo}, ${duration}, ${audioBlob.url}, ${imageUrl}) 
                                     RETURNING id`;
            
            res.json({ 
                id: result.rows[0].id, 
                url: audioBlob.url,
                imageUrl: imageUrl
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Vercel Storage Error: " + err.message });
        }
    } else {
        const audioFile = req.files.audio[0];
        const imageFile = req.files.image ? req.files.image[0] : null;
        
        const stmt = db.prepare(`INSERT INTO songs (title, artist, tempo, duration_seconds, filename, image_filename) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(title, artist, tempo, duration, audioFile.filename, imageFile ? imageFile.filename : null, function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                id: this.lastID, 
                url: '/uploads/' + audioFile.filename,
                imageUrl: imageFile ? '/uploads/' + imageFile.filename : null
            });
        });
        stmt.finalize();
    }
});

// DELETE Song
app.delete('/api/songs/:id', async (req, res) => {
    const id = req.params.id;
    
    if (isVercel) {
        try {
            // Note: Deleting the blob file is harder because we stored the URL, not the blob URL handle directly in a way that maps easily 
            // without querying first. For now, just delete the DB record.
            await sql`DELETE FROM songs WHERE id = ${id}`;
            res.json({ message: "Deleted" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } else {
        db.run("DELETE FROM songs WHERE id = ?", id, function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Deleted", changes: this.changes });
        });
    }
});

// Export for Vercel
module.exports = app;

if (!isVercel) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// DELETE Song
app.delete('/api/songs/:id', (req, res) => {
    const id = req.params.id;
    
    // First get filename to delete file
    db.get("SELECT filename FROM songs WHERE id = ?", [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: "Song not found" });
        }
        
        const filePath = path.join(UPLOAD_DIR, row.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        db.run("DELETE FROM songs WHERE id = ?", [id], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Deleted" });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
