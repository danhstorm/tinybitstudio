const DB_NAME = "TinyBitStudioDB";
const DB_VERSION = 1;
const STORE_NAME = "songs";

export const db = {
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => reject("Database error: " + event.target.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
    });
  },

  async saveSong(songData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      
      // Add timestamp
      songData.updatedAt = new Date().toISOString();
      
      // If it has an ID, put (update), otherwise add (insert)
      const request = store.put(songData);

      request.onsuccess = (event) => resolve(event.target.result); // Returns key (id)
      request.onerror = (event) => reject("Save error: " + event.target.error);
    });
  },

  async getAllSongs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("updatedAt");
      const request = index.openCursor(null, "prev"); // Sort by newest first
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (event) => reject("Fetch error: " + event.target.error);
    });
  },

  async getSong(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject("Get error: " + event.target.error);
    });
  },

  async deleteSong(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject("Delete error: " + event.target.error);
    });
  }
};
