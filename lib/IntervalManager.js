// /lib/IntervalManager.js
'use strict';

const DEFAULT_SETTINGS = {
    MIN_INTERVAL: 5,
    DEFAULT_INTERVAL: 10
};

class IntervalManager {
    constructor(device) {
        this.device = device;
        this.interval = null;
        this.currentInterval = DEFAULT_SETTINGS.DEFAULT_INTERVAL;
    }

    async startPolling() {
        const settings = this.device.getSettings();
        const interval = Math.max(
            settings.update_interval || DEFAULT_SETTINGS.DEFAULT_INTERVAL,
            DEFAULT_SETTINGS.MIN_INTERVAL
        );
    
        if (this.interval) {
            this.device.logger.debug('Resetuji existující polling interval');
            clearInterval(this.interval);
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
                this.device.logger.debug('Polling cyklus dokončen');
            } catch (error) {
                this.device.logger.error('Chyba při polling datech:', error);
            }
        }, interval * 1000);
    
        this.device.logger.info(`Polling spuštěn s intervalem ${interval}s`);
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