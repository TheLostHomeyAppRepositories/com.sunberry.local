'use strict';

const Homey = require('homey');
const Logger = require('../../lib/Logger');
const FlowCardManager = require('./FlowCardManager');
const sunberryAPI = require('./api'); 

// Konstanty pro capabilities
const CAPABILITIES = {
    MEASURE_L1: 'measure_L1',
    MEASURE_L2: 'measure_L2',
    MEASURE_L3: 'measure_L3',
    MEASURE_TOTAL: 'measure_total',
    MEASURE_BATTERY_KWH: 'measure_battery_kWh',
    MEASURE_BATTERY_PERCENT: 'measure_battery_percent',
    REMAINING_KWH_TO_FULL: 'remaining_kWh_to_full',
    BATTERY_MAX_CHARGING_POWER: 'battery_max_charging_power'
};

// Konstanty pro nastavení
const SETTINGS = {
    DEFAULT_UPDATE_INTERVAL: 10,
    MIN_UPDATE_INTERVAL: 5,
    DEFAULT_CHARGING_LIMIT: 5000
};

class SunberryDevice extends Homey.Device {
    /**
     * Výchozí hodnoty pro metriky
     */
    #cachedValues = {
        [CAPABILITIES.MEASURE_L1]: 0,
        [CAPABILITIES.MEASURE_L2]: 0,
        [CAPABILITIES.MEASURE_L3]: 0,
        [CAPABILITIES.MEASURE_TOTAL]: 0,
        [CAPABILITIES.MEASURE_BATTERY_KWH]: 0,
        [CAPABILITIES.MEASURE_BATTERY_PERCENT]: 0,
        [CAPABILITIES.REMAINING_KWH_TO_FULL]: 0,
        [CAPABILITIES.BATTERY_MAX_CHARGING_POWER]: 0
    };

    /**
     * Inicializace zařízení
     */
    async onInit() {
        try {
            await this.initializeLogger();
            await this.initializeCapabilities();
            await this.initializeFlowCards();
            await this.initializeAPI();
            await this.loadCachedValues();
            await this.startDataPolling();
            await this.registerCapabilityListeners();

            await this.setAvailable();
            this.logger.info('SunberryDevice byl úspěšně inicializován');
        } catch (error) {
            this.logger.error('Chyba při inicializaci zařízení:', error);
            await this.setUnavailable(error.message);
        }
    }

    /**
     * Inicializace loggeru
     */
    async initializeLogger() {
        if (!this.homey.appLogger) {
            this.logger = new Logger(this.homey, 'SunberryDevice');
            this.homey.appLogger = this.logger;
        } else {
            this.logger = this.homey.appLogger;
        }

        const enableDebugLogs = this.getSetting('enable_debug_logs');
        this.logger.setEnabled(enableDebugLogs);
        this.logger.info('Logger byl inicializován');
    }

    /**
     * Inicializace capabilities
     */
    async initializeCapabilities() {
        const capabilities = Object.values(CAPABILITIES);
        
        for (const capability of capabilities) {
            if (this.hasCapability(capability)) {
                await this.setCapabilityOptions(capability, {
                    title: this.homey.__(`capability.${capability}`),
                    preventInsights: false
                });
            }
        }
        this.logger.info('Capabilities byly inicializovány');
    }

    /**
     * Inicializace Flow karet
     */
    async initializeFlowCards() {
        this.flowCardManager = new FlowCardManager(this.homey, this);
        await this.flowCardManager.initialize();
        this.logger.info('Flow karty byly inicializovány');
    }

    /**
     * Inicializace API
     */
    async initializeAPI() {
        this.ipAddress = this.getSetting('ip_address');
        if (!this.ipAddress) {
            throw new Error('IP adresa není nastavena');
        }

        await sunberryAPI.setBaseUrl(this.ipAddress);
        this.logger.info('API bylo inicializováno s IP:', this.ipAddress);
    }

    /**
     * Načtení uložených hodnot
     */
    async loadCachedValues() {
        try {
            const storedValues = await this.getStoreValue('cachedMeasurements');
            if (storedValues) {
                this.#cachedValues = { ...this.#cachedValues, ...storedValues };
                await this.setInitialValues();
            }
        } catch (error) {
            this.logger.error('Chyba při načítání cache:', error);
        }
    }

    /**
     * Spuštění datových intervalů
     */
    async startDataPolling() {
        const interval = Math.max(
            this.getSetting('update_interval') || SETTINGS.DEFAULT_UPDATE_INTERVAL,
            SETTINGS.MIN_UPDATE_INTERVAL
        );

        this.startDataFetchInterval(interval);
        this.startBatteryFetchInterval(interval);
        this.logger.info('Datové intervaly byly spuštěny');
    }

    /**
     * Nastavení počátečních hodnot
     */
    async setInitialValues() {
        const setCapabilityIfValid = async (capability, value) => {
            if (this.hasCapability(capability) && this.validateCapabilityValue(capability, value)) {
                await this.setCapabilityValue(capability, value);
            }
        };

        for (const [capability, value] of Object.entries(this.#cachedValues)) {
            await setCapabilityIfValid(capability, value);
        }
    }

    async registerCapabilityListeners() {
        try {
            // Listener pro force_charging
            this.registerCapabilityListener('force_charging', async (value) => {
                this.logger.info('Změna force_charging na:', value);
                try {
                    if (value) {
                        const limit = this.getSetting('force_charging_limit') || 5000;
                        this.logger.debug('Zapínám force charging s limitem:', limit);
                        
                        // Nejdřív volat API, pak až změnit capability
                        await sunberryAPI.enableForceCharging(limit);
                        await this.setCapabilityValue('force_charging', true);
                        
                        this.logger.info('Force charging úspěšně zapnut');
                    } else {
                        this.logger.debug('Vypínám force charging');
                        
                        // Nejdřív volat API, pak až změnit capability
                        await sunberryAPI.disableForceCharging();
                        await this.setCapabilityValue('force_charging', false);
                        
                        this.logger.info('Force charging úspěšně vypnut');
                    }
                    return true;
                } catch (error) {
                    this.logger.error('Chyba při nastavení force_charging:', error);
                    
                    // V případě chyby vrátit capability do původního stavu
                    await this.setCapabilityValue('force_charging', !value).catch(this.logger.error);
                    throw error;
                }
            });
    
            // Listener pro block_battery_discharge
            this.registerCapabilityListener('block_battery_discharge', async (value) => {
                this.logger.info('Změna block_battery_discharge na:', value);
                try {
                    if (value) {
                        await sunberryAPI.blockBatteryDischarge();
                    } else {
                        await sunberryAPI.enableBatteryDischarge();
                    }
                    return true;
                } catch (error) {
                    this.logger.error('Chyba při nastavení block_battery_discharge:', error);
                    throw error;
                }
            });
    
            this.logger.info('Capability listeners byly úspěšně registrovány');
        } catch (error) {
            this.logger.error('Chyba při registraci capability listenerů:', error);
            throw error;
        }
    }

    /**
     * Zpracování změn nastavení
     */
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        try {
            if (changedKeys.includes('update_interval')) {
                const newInterval = Math.max(
                    newSettings.update_interval,
                    SETTINGS.MIN_UPDATE_INTERVAL
                );
                await this.startDataPolling(newInterval);
            }

            if (changedKeys.includes('ip_address')) {
                await sunberryAPI.setBaseUrl(newSettings.ip_address);
            }

            if (changedKeys.includes('enable_debug_logs')) {
                this.logger.setEnabled(newSettings.enable_debug_logs);
            }

            await this.fetchAndUpdateGridValues();
        } catch (error) {
            this.logger.error('Chyba při aktualizaci nastavení:', error);
            throw error;
        }
    }

    /**
     * Interval pro data ze sítě
     */
    startDataFetchInterval(interval) {
        if (this.dataFetchInterval) {
            this.homey.clearInterval(this.dataFetchInterval);
        }

        this.dataFetchInterval = this.homey.setInterval(
            () => this.fetchAndUpdateGridValues().catch(error => 
                this.logger.error('Chyba v intervalu grid values:', error)
            ),
            interval * 1000
        );
    }

    /**
     * Interval pro data z baterie
     */
    startBatteryFetchInterval(interval) {
        if (this.batteryFetchInterval) {
            this.homey.clearInterval(this.batteryFetchInterval);
        }

        this.batteryFetchInterval = this.homey.setInterval(
            () => this.fetchAndUpdateBatteryValues().catch(error => 
                this.logger.error('Chyba v intervalu battery values:', error)
            ),
            interval * 1000
        );
    }

    /**
     * Aktualizace hodnot ze sítě
     */
    async fetchAndUpdateGridValues() {
        try {
            const values = await sunberryAPI.getGridValues();
            if (!values) throw new Error('Nepodařilo se získat hodnoty ze sítě');

            const updates = [
                { capability: CAPABILITIES.MEASURE_L1, value: values.L1 },
                { capability: CAPABILITIES.MEASURE_L2, value: values.L2 },
                { capability: CAPABILITIES.MEASURE_L3, value: values.L3 },
                { capability: CAPABILITIES.MEASURE_TOTAL, value: values.Total }
            ];

            await this.processUpdates(updates);
            await this.updateCache('grid', values);
        } catch (error) {
            this.logger.error('Chyba při aktualizaci grid values:', error);
            throw error;
        }
    }

    /**
     * Aktualizace hodnot z baterie
     */
    async fetchAndUpdateBatteryValues() {
        try {
            const values = await sunberryAPI.getBatteryValues();
            this.logger.debug('Získané hodnoty z API:', values);
    
            if (!values) throw new Error('Nepodařilo se získat hodnoty z baterie');
    
            // Nejdřív získáme staré hodnoty
            const oldMaxChargingPower = this.getCapabilityValue(CAPABILITIES.BATTERY_MAX_CHARGING_POWER);
            const oldBatteryLevel = this.getCapabilityValue(CAPABILITIES.MEASURE_BATTERY_PERCENT);
            
            // Kontrola změny nabíjecího výkonu
            if (values.max_charging_power !== oldMaxChargingPower) {
                try {
                    const triggerCard = await this.homey.flow.getDeviceTriggerCard('battery_max_charging_power_changed');
                    if (!triggerCard) {
                        this.logger.error('Trigger karta battery_max_charging_power_changed nenalezena');
                    } else {
                        this.logger.debug('Spouštím trigger s hodnotami:', {
                            oldPower: oldMaxChargingPower,
                            newPower: values.max_charging_power
                        });
                        
                        await triggerCard.trigger(this, {
                            power: values.max_charging_power
                        });
                    }
                } catch (error) {
                    this.logger.error('Chyba při spouštění triggeru battery_max_charging_power_changed:', error);
                }
            }
            
            // Kontrola změny úrovně baterie
            if (values.actual_percent !== oldBatteryLevel) {
                try {
                    const triggerCard = await this.homey.flow.getDeviceTriggerCard('battery_level_changed');
                    if (!triggerCard) {
                        this.logger.error('Trigger karta battery_level_changed nenalezena');
                    } else {
                        this.logger.debug('Spouštím trigger s hodnotami:', {
                            oldLevel: oldBatteryLevel,
                            newLevel: values.actual_percent
                        });
                        
                        await triggerCard.trigger(this, {
                            battery_level: values.actual_percent
                        });
                    }
                } catch (error) {
                    this.logger.error('Chyba při spouštění triggeru battery_level_changed:', error);
                }
            }
    
            // Výpočet zbývající kapacity
            let remainingKwhToFull = null;
            if (values.actual_kWh && values.actual_percent) {
                if (values.actual_percent > 0 && values.actual_percent <= 100) {
                    const totalCapacity = values.actual_kWh / (values.actual_percent / 100);
                    remainingKwhToFull = Math.max(0, totalCapacity - values.actual_kWh);
                    
                    this.logger.debug('Výpočet remaining_kWh_to_full:', {
                        actualKwh: values.actual_kWh,
                        actualPercent: values.actual_percent,
                        totalCapacity,
                        remainingKwhToFull
                    });
                }
            }
    
            // Aktualizace capability hodnot
            const updates = [
                { capability: CAPABILITIES.MEASURE_BATTERY_KWH, value: values.actual_kWh },
                { capability: CAPABILITIES.MEASURE_BATTERY_PERCENT, value: values.actual_percent },
                { capability: CAPABILITIES.BATTERY_MAX_CHARGING_POWER, value: values.max_charging_power },
                { capability: CAPABILITIES.REMAINING_KWH_TO_FULL, value: remainingKwhToFull }
            ];
    
            await this.processUpdates(updates);
    
            // Aktualizace cache
            await this.updateCache('battery', {
                ...values,
                remaining_kWh_to_full: remainingKwhToFull
            });
        } catch (error) {
            this.logger.error('Chyba při aktualizaci battery values:', error);
            throw error;
        }
    }

    /**
     * Zpracování aktualizací capabilities
     */
    async processUpdates(updates) {
        await Promise.all(updates.map(async update => {
            try {
                if (this.validateCapabilityValue(update.capability, update.value)) {
                    await this.setCapabilityValue(update.capability, update.value);
                }
            } catch (error) {
                this.logger.error(`Chyba při aktualizaci ${update.capability}:`, error);
            }
        }));
    }

    /**
     * Aktualizace cache
     */
    async updateCache(type, values) {
        try {
            this.#cachedValues = {
                ...this.#cachedValues,
                ...(type === 'grid' ? {
                    [CAPABILITIES.MEASURE_L1]: values.L1,
                    [CAPABILITIES.MEASURE_L2]: values.L2,
                    [CAPABILITIES.MEASURE_L3]: values.L3,
                    [CAPABILITIES.MEASURE_TOTAL]: values.Total
                } : {
                    [CAPABILITIES.MEASURE_BATTERY_KWH]: values.actual_kWh,
                    [CAPABILITIES.MEASURE_BATTERY_PERCENT]: values.actual_percent,
                    [CAPABILITIES.BATTERY_MAX_CHARGING_POWER]: values.max_charging_power
                })
            };
    
            await this.setStoreValue('cachedMeasurements', this.#cachedValues);
        } catch (error) {
            this.logger.error('Chyba při aktualizaci cache:', error);
        }
    }

    /**
     * Validace hodnoty capability
     */
    validateCapabilityValue(capability, value) {
        if (typeof value !== 'number' || isNaN(value)) {
            return false;
        }

        switch(capability) {
            case CAPABILITIES.MEASURE_BATTERY_PERCENT:
                return value >= 0 && value <= 100;
            case CAPABILITIES.MEASURE_BATTERY_KWH:
            case CAPABILITIES.REMAINING_KWH_TO_FULL:
                return value >= 0;
            case CAPABILITIES.MEASURE_L1:
            case CAPABILITIES.MEASURE_L2:
            case CAPABILITIES.MEASURE_L3:
            case CAPABILITIES.MEASURE_TOTAL:
            case CAPABILITIES.BATTERY_MAX_CHARGING_POWER:
                return true;
            default:
                return false;
        }
    }

    /**
     * Čištění při smazání zařízení
     */
    async onDeleted() {
        try {
            if (this.dataFetchInterval) {
                this.homey.clearInterval(this.dataFetchInterval);
            }
            if (this.batteryFetchInterval) {
                this.homey.clearInterval(this.batteryFetchInterval);
            }
            
            await this.flowCardManager.destroy();
            this.logger.info('Zařízení bylo úspěšně odstraněno');
        } catch (error) {
            this.logger.error('Chyba při odstraňování zařízení:', error);
        }
    }
}

module.exports = SunberryDevice;