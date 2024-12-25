'use strict';

const DEFAULT_SETTINGS = {
    MIN_INTERVAL: 5,
    DEFAULT_INTERVAL: 10,
    MAX_INTERVAL: 60,         // Maximální interval při chybách
    ERROR_MULTIPLIER: 1.5,    // Násobitel pro prodloužení intervalu při chybách
    SUCCESS_THRESHOLD: 300000 // 5 minut bez úspěchu -> zvýšení intervalu
};

class IntervalManager {
    constructor(device) {
        this.device = device;
        this.interval = null;
        this.currentInterval = DEFAULT_SETTINGS.DEFAULT_INTERVAL;
        this.lastSuccess = Date.now();
        this.consecutiveErrors = 0;
    }

    async startPolling() {
        const settings = this.device.getSettings();
        let interval = Math.max(
            settings.update_interval || DEFAULT_SETTINGS.DEFAULT_INTERVAL,
            DEFAULT_SETTINGS.MIN_INTERVAL
        );
    
        if (this.interval) {
            this.device.logger.debug('Resetuji existující polling interval');
            clearInterval(this.interval);
        }

        // Adaptivní polling při chybách
        if (Date.now() - this.lastSuccess > DEFAULT_SETTINGS.SUCCESS_THRESHOLD) {
            interval = Math.min(
                interval * Math.pow(DEFAULT_SETTINGS.ERROR_MULTIPLIER, this.consecutiveErrors),
                DEFAULT_SETTINGS.MAX_INTERVAL
            );
            this.device.logger.warn(`Adaptuji polling interval kvůli chybám: ${interval}s`);
        }
    
        this.currentInterval = interval;
        this.device.logger.debug(`Nastavuji nový polling interval: ${interval}s`);
        
        this.interval = setInterval(async () => {
            this.device.logger.debug('Spouštím polling cyklus');
            try {
                await Promise.all([
                    this.device.fetchAndUpdateGridValues(),
                    this.device.fetchAndUpdateBatteryValues()
                ]);
                this.handleSuccess();
                this.device.logger.debug('Polling cyklus dokončen');
            } catch (error) {
                this.handleError(error);
            }
        }, interval * 1000);
    
        this.device.logger.info(`Polling spuštěn s intervalem ${interval}s`);
    }

    handleSuccess() {
        this.lastSuccess = Date.now();
        this.consecutiveErrors = 0;
        
        // Vrátit na normální interval po úspěchu
        if (this.currentInterval > this.device.getSettings().update_interval) {
            this.updateInterval(this.device.getSettings().update_interval);
        }
    }

    handleError(error) {
        this.consecutiveErrors++;
        this.device.logger.error('Chyba při polling datech:', error);
        
        if (this.consecutiveErrors > 3) {
            this.startPolling(); // Přepočítat interval
        }
    }

    updateInterval(newInterval) {
        const interval = Math.max(newInterval, DEFAULT_SETTINGS.MIN_INTERVAL);
        if (interval !== this.currentInterval) {
            this.startPolling();
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

module.exports = IntervalManager;