"use strict";

// Konstanty pro typy logů
const LOG_TYPES = {
    INFO: 'info',
    ERROR: 'error',
    DEBUG: 'debug',
    WARNING: 'warning'
};

// Konstanty pro konfiguraci
const CONFIG = {
    RATE_LIMIT: 1000,           // 1 sekunda mezi stejnými logy
    MAX_LOG_SIZE: 1000,         // Maximální počet logů v historii
    ROTATION_INTERVAL: 24 * 60 * 60 * 1000,  // 1 den
    RETENTION_PERIOD: 7 * 24 * 60 * 60 * 1000, // 7 dní
    FLUSH_INTERVAL: 5000,       // 5 sekund mezi flush
    ROTATION_CHECK: 5 * 60 * 1000, // 5 minut mezi kontrolami rotace
    MAX_KEY_LENGTH: 100,        // Maximální délka klíče logu
    EXCLUDED_OBJECTS: ['Homey', 'MyApp', 'Device'] // Objekty k vyfiltrování
};

class Logger {
    #homey;
    #context;
    #enabled = false;
    #logQueue;
    #logHistory;
    #lastRotation;
    #flushInterval;
    #rotationInterval;

    /**
     * @param {Object} homey - Instance Homey
     * @param {string} context - Kontext loggeru
     */
    constructor(homey, context) {
        if (!homey) throw new Error('Homey instance is required');
        if (!context) throw new Error('Context is required');

        this.#homey = homey;
        this.#context = context;
        this.#logQueue = new Map();
        this.#logHistory = [];
        this.#lastRotation = Date.now();

        this.#initializeIntervals();
    }

    /**
     * Inicializace intervalů pro flush a rotaci
     * @private
     */
    #initializeIntervals() {
        this.#flushInterval = setInterval(
            () => this.#flushLogs(), 
            CONFIG.FLUSH_INTERVAL
        );

        this.#rotationInterval = setInterval(
            () => this.#checkRotation(),
            CONFIG.ROTATION_CHECK
        );
    }

    /**
     * Kontrola potřeby rotace logů
     * @private
     */
    #checkRotation() {
        const now = Date.now();
        if (now - this.#lastRotation >= CONFIG.ROTATION_INTERVAL) {
            this.rotateLogs();
            this.#lastRotation = now;
        }
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
        if (!this.#enabled && type !== LOG_TYPES.ERROR) return false;

        const lastLog = this.#logQueue.get(key);
        if (!lastLog) return true;

        const timeSinceLastLog = Date.now() - lastLog.timestamp;
        return type === LOG_TYPES.ERROR || timeSinceLastLog >= CONFIG.RATE_LIMIT;
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
        } else {
            this.#logQueue.set(key, {
                timestamp: now,
                lastOccurrence: now,
                type,
                message,
                data,
                count: 1,
                errors: error ? [error] : []
            });
        }

        // Okamžité zpracování error logů
        if (type === LOG_TYPES.ERROR) {
            this.#processLogEntry(this.#logQueue.get(key));
            this.#logQueue.delete(key);
        }
    }

    /**
     * Flush logů z fronty
     * @private
     */
    async #flushLogs() {
        const now = Date.now();
        const entriesToProcess = Array.from(this.#logQueue.entries())
            .filter(([, entry]) => now - entry.lastOccurrence >= CONFIG.RATE_LIMIT);

        for (const [key, entry] of entriesToProcess) {
            await this.#processLogEntry(entry);
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
            const logData = {
                context: this.#context,
                type: logEntry.type,
                message: logEntry.message,
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

            const logMethod = logEntry.type === LOG_TYPES.ERROR ? 'error' : 'log';
            const countSuffix = logEntry.count > 1 ? ` (${logEntry.count}x)` : '';

            this.#homey[logMethod](JSON.stringify({
                ...logData,
                message: `${logEntry.message}${countSuffix}`
            }));
        } catch (error) {
            this.#homey.error('Chyba při zpracování logu:', error);
        }
    }

    /**
     * Přidání logu do historie
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

        this.#logHistory.push(logEntry);

        if (this.#logHistory.length > CONFIG.MAX_LOG_SIZE) {
            this.rotateLogs();
        }

        return logEntry;
    }

    // Veřejné metody

    setEnabled(enabled) {
        this.#enabled = enabled;
        this.log(`Logování ${enabled ? "zapnuto" : "vypnuto"}`);
    }

    log(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.INFO, message, data);
        if (this.#shouldLog(key, LOG_TYPES.INFO)) {
            this.#addToQueue(LOG_TYPES.INFO, message, data);
        }
    }

    info(message, data = {}) {
        this.log(message, data);
    }

    error(message, error, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.ERROR, message, data);
        this.#addToQueue(LOG_TYPES.ERROR, message, data, error);
    }

    debug(message, data = {}) {
        const key = this.#createLogKey(LOG_TYPES.DEBUG, message, data);
        if (this.#shouldLog(key, LOG_TYPES.DEBUG)) {
            this.#addToQueue(LOG_TYPES.DEBUG, message, data);
        }
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
        this.log(`Historie logů vyčištěna (${count} záznamů)`);
    }

    getLogStats() {
        return {
            total: this.#logHistory.length,
            queueSize: this.#logQueue.size,
            byType: this.#getLogTypeStats(),
            oldestLog: this.#logHistory[0]?.timestamp,
            newestLog: this.#logHistory[this.#logHistory.length - 1]?.timestamp,
            lastRotation: new Date(this.#lastRotation).toISOString(),
            enabled: this.#enabled,
            rateLimitMs: CONFIG.RATE_LIMIT,
            maxLogSize: CONFIG.MAX_LOG_SIZE
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
            const cutoff = Date.now() - CONFIG.RETENTION_PERIOD;
            const originalLength = this.#logHistory.length;
            this.#logHistory = this.#logHistory.filter(log => log.timestamp >= cutoff);

        } catch (error) {
            this.#homey.error("Chyba při rotaci logů:", error);
        }
    }

    destroy() {
        clearInterval(this.#flushInterval);
        clearInterval(this.#rotationInterval);
        this.#logQueue.clear();
        this.#logHistory = [];
    }
}

module.exports = Logger;