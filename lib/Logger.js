"use strict";

const LOG_TYPES = {
    INFO: 'info',
    ERROR: 'error',
    DEBUG: 'debug',
    WARNING: 'warning'
};

const CONFIG = {
    RATE_LIMIT: 2000,           // 2 sekundy mezi stejnými logy
    MAX_LOG_SIZE: 500,         // Maximální počet logů v historii
    MAX_AGE: 12 * 60 * 60 * 1000,  // 24 hodin
    CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hodina
    LOG_BUFFER_SIZE: 50,           // Počet logů před flush
    LOG_BUFFER_TIMEOUT: 10000,       // Max čas v bufferu
    MAX_KEY_LENGTH: 100,            // Maximální délka klíče logu
    EXCLUDED_OBJECTS: ['Homey', 'MyApp', 'Device'] // Objekty k vyfiltrování
};

class Logger {
    #homey;
    #context;
    #enabled = false;
    #logQueue;
    #logHistory;
    #logBuffer;
    #lastFlush;
    #cleanupInterval;

    /**
     * @param {Object} homey - Instance Homey
     * @param {string} context - Kontext loggeru
     */
    constructor(homey, context) {
        if (!homey) throw new Error('Homey instance is required');
        if (!context) throw new Error('Context is required');
    
        this.#homey = homey;
        this.#context = context;
        this.#enabled = true;
        this.#logQueue = new Map();
        this.#logHistory = [];
        this.#logBuffer = [];
        this.#lastFlush = Date.now();
    
        if (typeof this.#homey.debug !== 'function') {
            this.#homey.debug = (...args) => this.#homey.log('[DEBUG]', ...args);
        }
    
        this.#setupCleanup();
        this.info(`Logger inicializován pro kontext: ${context}`);
    }

    /**
     * Nastavení intervalu pro čištění starých logů
     * @private
     */
    #setupCleanup() {
        this.#cleanupInterval = setInterval(() => {
            const cutoff = Date.now() - CONFIG.MAX_AGE;
            this.#logHistory = this.#logHistory.filter(log => log.timestamp >= cutoff);
        }, CONFIG.CLEANUP_INTERVAL);
    }

    /**
     * Čištění citlivých dat z objektu
     * @private
     */
    #sanitizeData(data) {
        if (!data || typeof data !== "object") return data;

        if (Array.isArray(data)) {
            return data.map(item => this.#sanitizeData(item));
        }

        const clean = {};
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object") {
                if (CONFIG.EXCLUDED_OBJECTS.includes(value.constructor.name)) {
                    clean[key] = `[${value.constructor.name}]`;
                    continue;
                }
                clean[key] = this.#sanitizeData(value);
            } else {
                clean[key] = value;
            }
        }
        return clean;
    }

    /**
     * Vytvoření klíče pro log
     * @private
     */
    #createLogKey(type, message, data = {}) {
        try {
            const cleanData = this.#sanitizeData(data);
            const dataStr = JSON.stringify(cleanData);
            return `${type}-${message}-${dataStr}`.substring(0, CONFIG.MAX_KEY_LENGTH);
        } catch (error) {
            return `${type}-${message}-[Data Error]`;
        }
    }

    /**
     * Kontrola zda se má log zaznamenat
     * @private
     */
    #shouldLog(key, type) {
        if (type === LOG_TYPES.ERROR) return true;
        if (!this.#enabled) return false;

        const lastLog = this.#logQueue.get(key);
        return !lastLog || (Date.now() - lastLog.timestamp >= CONFIG.RATE_LIMIT);
    }

    /**
     * Přidání logu do fronty
     * @private
     */
    #addToQueue(type, message, data = {}, error = null) {
        const key = this.#createLogKey(type, message, data);
        const now = Date.now();

        const existingEntry = this.#logQueue.get(key);
        if (existingEntry) {
            existingEntry.count++;
            existingEntry.lastOccurrence = now;
            if (error) existingEntry.errors.push(error);
            this.#logQueue.set(key, existingEntry);
        } else {
            const newEntry = {
                timestamp: now,
                lastOccurrence: now,
                type,
                message,
                data,
                count: 1,
                errors: error ? [error] : []
            };
            this.#logQueue.set(key, newEntry);
            this.#processLogEntry(newEntry);
        }

        // Okamžité zpracování error logů
        if (type === LOG_TYPES.ERROR) {
            this.#processLogEntry(this.#logQueue.get(key));
            this.#logQueue.delete(key);
        }
    }

    /**
     * Zpracování jednoho log záznamu
     * @private
     */
    async #processLogEntry(logEntry) {
        try {
            const cleanData = this.#sanitizeData(logEntry.data);
            const countSuffix = logEntry.count > 1 ? ` (${logEntry.count}x)` : '';
            const message = `[${this.#context}] ${logEntry.message}${countSuffix}`;
            
            const logData = {
                context: this.#context,
                timestamp: new Date().toISOString(),
                ...cleanData
            };

            if (logEntry.errors?.length > 0) {
                logData.errors = logEntry.errors.map(e => ({
                    message: e?.message,
                    stack: e?.stack
                }));
            }

            this.#addToHistory(logEntry.type, logEntry.message, logData);

            // Použití správných Homey logging metod
            switch(logEntry.type) {
                case LOG_TYPES.ERROR:
                    this.#homey.error(message, logData);
                    break;
                case LOG_TYPES.WARNING:
                    this.#homey.warn(message, logData);
                    break;
                case LOG_TYPES.DEBUG:
                    this.#homey.debug(message, logData);
                    break;
                default:
                    this.#homey.log(message, logData);
            }
        } catch (error) {
            this.#homey.error('Chyba při zpracování logu:', error);
        }
    }

    /**
     * Přidání logu do historie přes buffer
     * @private
     */
    #addToHistory(type, message, data = {}) {
        const logEntry = {
            timestamp: Date.now(),
            type,
            context: this.#context,
            message,
            data
        };

        this.#logBuffer.push(logEntry);
        this.#logHistory.push(logEntry);

        if (this.#logBuffer.length >= CONFIG.LOG_BUFFER_SIZE || 
            Date.now() - this.#lastFlush >= CONFIG.LOG_BUFFER_TIMEOUT) {
            this.#flushBuffer();
        }
    }

    /**
     * Flush log bufferu do historie
     * @private
     */
    #flushBuffer() {
        if (this.#logBuffer.length === 0) return;

        // Kontrola velikosti historie před přidáním nových záznamů
        const totalSize = this.#logHistory.length + this.#logBuffer.length;
        if (totalSize > CONFIG.MAX_LOG_SIZE) {
            this.rotateLogs();
        }

        this.#logBuffer = [];
        this.#lastFlush = Date.now();
    }

    // Veřejné metody
    setEnabled(enabled = true) {
        this.#enabled = enabled;
        this.info(`Logování ${enabled ? "zapnuto" : "vypnuto"}`);
    }

    log(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.INFO, message, data);
        if (this.#shouldLog(key, LOG_TYPES.INFO)) {
            this.#addToQueue(LOG_TYPES.INFO, message, data);
        }
    }

    info(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.INFO, message, data);
        if (this.#shouldLog(key, LOG_TYPES.INFO)) {
            this.#addToQueue(LOG_TYPES.INFO, message, data);
        }
    }

    debug(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.DEBUG, message, data);
        if (this.#shouldLog(key, LOG_TYPES.DEBUG)) {
            this.#addToQueue(LOG_TYPES.DEBUG, message, data);
        }
    }

    error(message, error, data = {}) {
        this.#addToQueue(LOG_TYPES.ERROR, message, data, error);
    }

    warn(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.WARNING, message, data);
        if (this.#shouldLog(key, LOG_TYPES.WARNING)) {
            this.#addToQueue(LOG_TYPES.WARNING, message, data);
        }
    }

    getLogHistory() {
        return [...this.#logHistory];
    }

    clearHistory() {
        const count = this.#logHistory.length;
        this.#logHistory = [];
        this.#logBuffer = [];
        this.#lastFlush = Date.now();
        this.info(`Historie logů vyčištěna (${count} záznamů)`);
    }

    getLogStats() {
        return {
            total: this.#logHistory.length,
            queueSize: this.#logQueue.size,
            bufferSize: this.#logBuffer.length,
            byType: this.#getLogTypeStats(),
            oldestLog: this.#logHistory[0]?.timestamp,
            newestLog: this.#logHistory[this.#logHistory.length - 1]?.timestamp,
            lastFlush: this.#lastFlush,
            enabled: this.#enabled,
            rateLimitMs: CONFIG.RATE_LIMIT,
            maxLogSize: CONFIG.MAX_LOG_SIZE,
            maxAge: CONFIG.MAX_AGE
        };
    }

    /**
     * Získání statistik podle typu logů
     * @private
     */
    #getLogTypeStats() {
        return this.#logHistory.reduce((stats, log) => {
            stats[log.type] = (stats[log.type] || 0) + 1;
            return stats;
        }, {});
    }

    rotateLogs() {
        try {
            const cutoff = Date.now() - CONFIG.MAX_AGE;
            this.#logHistory = this.#logHistory.filter(log => log.timestamp >= cutoff);
            
            // Vyčištění staré fronty
            for (const [key, entry] of this.#logQueue.entries()) {
                if (entry.lastOccurrence < cutoff) {
                    this.#logQueue.delete(key);
                }
            }
        } catch (error) {
            this.#homey.error("Chyba při rotaci logů:", error);
        }
    }

    destroy() {
        clearInterval(this.#cleanupInterval);
        this.#logQueue.clear();
        this.#logHistory = [];
        this.#logBuffer = [];
    }
}

module.exports = Logger;