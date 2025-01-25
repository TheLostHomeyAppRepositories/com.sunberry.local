'use strict';

const Homey = require('homey');
const Logger = require('../../lib/Logger');
const FlowCardManager = require('./FlowCardManager');
const sunberryAPI = require('./api'); 
const IntervalManager = require('../../lib/IntervalManager');
const DataValidator = require('../../lib/DataValidator');

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
            await this.registerFlowCardHandlers();  // Nové
            await this.initializeAPI();
            await this.loadCachedValues();
            
            this.intervalManager = new IntervalManager(this);
            this.logger.info('Volám startPolling() v onInit');
            await this.intervalManager.startPolling();
            
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
    
        const settings = this.getSettings();
        const enableDebugLogs = settings.hasOwnProperty('enable_debug_logs') 
            ? settings.enable_debug_logs 
            : true;
            
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
        this.flowCardManager.setLogger(this.logger);  // Nové - předání loggeru
        await this.flowCardManager.initialize();
        this.logger.info('Flow karty byly inicializovány');
    }

    /**
     * Registrace handlerů pro flow karty
     */
    async registerFlowCardHandlers() {
        try {
            // Registrace akčních karet
            const actionCards = {
                'turn_on_battery_charging': this.turnOnBatteryCharging.bind(this),
                'turn_off_battery_charging': this.turnOffBatteryCharging.bind(this),
                'block_battery_discharge': this.blockBatteryDischarge.bind(this),
                'enable_battery_discharge': this.enableBatteryDischarge.bind(this)
            };

            for (const [cardId, handler] of Object.entries(actionCards)) {
                const card = this.homey.flow.getActionCard(cardId);
                if (card) {
                    card.registerRunListener(async (args) => {
                        return await handler(args);
                    });
                    this.logger.debug(`Registrován handler pro kartu ${cardId}`);
                }
            }

            this.logger.info('Flow card handlery byly úspěšně registrovány');
        } catch (error) {
            this.logger.error('Chyba při registraci flow card handlerů:', error);
            throw error;
        }
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
            }
            await this.setInitialValues();
        } catch (error) {
            this.logger.error('Chyba při načítání cache:', error);
        }
    }

    /**
     * Nastavení počátečních hodnot
     */
    async setInitialValues() {
        const setCapabilityIfValid = async (capability, value) => {
            if (this.hasCapability(capability) && DataValidator.validateCapabilityValue(capability, value)) {
                await this.setCapabilityValue(capability, value);
            }
        };

        for (const [capability, value] of Object.entries(this.#cachedValues)) {
            await setCapabilityIfValid(capability, value);
        }
    }

    /**
     * Registrace capability listenerů
     */
    async registerCapabilityListeners() {
        try {
            this.registerCapabilityListener('force_charging', async (value) => {
                const oldValue = this.getCapabilityValue('force_charging');
                const newValue = value;
              
                this.logger.debug('Capability listener triggered for force_charging:', { oldValue, newValue });
                try {
                  if (newValue) {
                    const limit = this.getSetting('force_charging_limit') || SETTINGS.DEFAULT_CHARGING_LIMIT;
                    this.logger.debug('Turning on battery charging with limit:', { limit });
              
                    // 1) Voláte API
                    await this.turnOnBatteryCharging({ limit });
              
                    // 2) Hned spustíte Flow trigger "started"
                    const card = this.homey.flow.getDeviceTriggerCard('force_charging_started');
                    if (card) {
                      await card.trigger(this, {}, { force_charging: true });
                      this.logger.debug('Trigger force_charging_started executed');
                    }
              
                  } else {
                    this.logger.debug('Turning off battery charging.');
                    
                    // 1) Voláte API
                    await this.turnOffBatteryCharging();
              
                    // 2) Hned spustíte Flow trigger "stopped"
                    const card = this.homey.flow.getDeviceTriggerCard('force_charging_stopped');
                    if (card) {
                      await card.trigger(this, {}, { force_charging: false });
                      this.logger.debug('Trigger force_charging_stopped executed');
                    }
                  }
              
                  this.logger.debug('Capability force_charging listener done:', { oldValue, newValue });
                  return true;
              
                } catch (error) {
                  this.logger.error('Error occurred while updating force_charging capability:', { error, oldValue, newValue });
                  throw error;
                }
              });
                          
    
            this.registerCapabilityListener('block_battery_discharge', async (value) => {
                this.logger.info('Změna block_battery_discharge na:', value);
                try {
                    if (value) {
                        await this.blockBatteryDischarge();
                    } else {
                        await this.enableBatteryDischarge();
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
    async onSettings({ newSettings, changedKeys }) {
        try {
            if (changedKeys.includes('update_interval')) {
                await this.intervalManager.updateInterval(newSettings.update_interval);
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
     * Aktualizace hodnot ze sítě
     */
    async fetchAndUpdateGridValues() {
        try {
            const values = await sunberryAPI.getGridValues();
            if (!values || !DataValidator.validateGridValues(values)) {
                throw new Error('Nepodařilo se získat platné hodnoty ze sítě');
            }

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
            if (!values || !DataValidator.validateBatteryValues(values)) {
                throw new Error('Nepodařilo se získat platné hodnoty z baterie');
            }

            // Výpočet zbývající kapacity
            let remainingKwhToFull = null;
            if (values.actual_kWh && values.actual_percent > 0 && values.actual_percent <= 100) {
                const totalCapacity = values.actual_kWh / (values.actual_percent / 100);
                remainingKwhToFull = Math.max(0, totalCapacity - values.actual_kWh);
            }

            // Aktualizace capabilities
            const updates = [
                { capability: CAPABILITIES.MEASURE_BATTERY_KWH, value: values.actual_kWh },
                { capability: CAPABILITIES.MEASURE_BATTERY_PERCENT, value: values.actual_percent },
                { capability: CAPABILITIES.BATTERY_MAX_CHARGING_POWER, value: values.max_charging_power },
                { capability: CAPABILITIES.REMAINING_KWH_TO_FULL, value: remainingKwhToFull }
            ];

            await this.processUpdates(updates);
            await this.updateCache('battery', values);
            
        } catch (error) {
            this.logger.error('Chyba při aktualizaci battery values:', error);
            throw error;
        }
    }   


    /**
     * Zpracování aktualizací capabilities a spouštění triggerů
     */
    async processUpdates(updates) {
        await Promise.all(updates.map(async update => {
            try {
                const oldValue = this.getCapabilityValue(update.capability);
                
                if (DataValidator.validateCapabilityValue(update.capability, update.value)) {
                    await this.setCapabilityValue(update.capability, update.value);
    
                    // Sledování změn a spouštění triggerů pro jednotlivé capabilities
                    switch(update.capability) {
                        case 'measure_battery_percent':
                            if (oldValue !== update.value) {
                                const tokens = {};
                                const state = { battery_level: update.value };
                                
                                await this.homey.flow
                                    .getDeviceTriggerCard('battery_level_changed')
                                    .trigger(this, tokens, state)
                                    .catch(this.logger.error);
                                    
                                this.logger.debug('Trigger battery_level_changed spuštěn:', { oldValue, newValue: update.value });
                            }
                            break;
    
                        case 'battery_max_charging_power':
                            if (oldValue !== update.value) {
                                const tokens = { power: update.value };
                                const state = {};
                                
                                await this.homey.flow
                                    .getDeviceTriggerCard('battery_max_charging_power_changed')
                                    .trigger(this, tokens, state)
                                    .catch(this.logger.error);
                                    
                                this.logger.debug('Trigger battery_max_charging_power_changed spuštěn:', { oldValue, newValue: update.value });
                            }
                            break;
    
                            case 'force_charging':
                        if (oldValue !== update.value) {
                            const triggerCard = update.value ? 'force_charging_started' : 'force_charging_stopped';
                            const state = { force_charging: update.value };
                            const tokens = {};

                            this.logger.debug(`Starting trigger process for ${triggerCard}:`, {
                                oldValue,
                                newValue: update.value,
                                state
                            });

                            const card = this.homey.flow.getDeviceTriggerCard(triggerCard);
                            if (!card) {
                                this.logger.error(`Trigger card ${triggerCard} not found. Aborting.`);
                                return;
                            }

                            this.logger.debug(`Trigger card ${triggerCard} found. Executing trigger...`, {
                                state
                            });

                            await card.trigger(this, tokens, state)
                                .then(() => {
                                    this.logger.debug(`Trigger ${triggerCard} executed successfully.`, {
                                        oldValue,
                                        newValue: update.value,
                                        state
                                    });
                                })
                                .catch(error => {
                                    this.logger.error(`Error executing trigger ${triggerCard}:`, error);
                                });

                            this.logger.debug(`Trigger process for ${triggerCard} completed.`);
                        }
                        break;

                    }
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
     * Flow karta - Blokování vybíjení baterie
     */
    async blockBatteryDischarge() {
        try {
            await sunberryAPI.blockBatteryDischarge();
            await this.setCapabilityValue('block_battery_discharge', true);
            return true;
        } catch (error) {
            this.logger.error('Chyba při blokování vybíjení baterie:', error);
            throw error;
        }
    }

    /**
     * Flow karta - Povolení vybíjení baterie
     */
    async enableBatteryDischarge() {
        try {
            await sunberryAPI.enableBatteryDischarge();
            await this.setCapabilityValue('block_battery_discharge', false);
            return true;
        } catch (error) {
            this.logger.error('Chyba při povolení vybíjení baterie:', error);
            throw error;
        }
    }

    /**
     * Flow karta - Vypnutí nabíjení baterie
     */
    async turnOffBatteryCharging() {
        try {
            await sunberryAPI.disableForceCharging();
            await this.setCapabilityValue('force_charging', false);
            return true;
        } catch (error) {
            this.logger.error('Chyba při vypnutí nabíjení baterie:', error);
            throw error;
        }
    }

   /**
     * Flow karta - Zapnutí nabíjení baterie
     */
   async turnOnBatteryCharging(args) {
    try {
        const maxChargingPower = await this.getCapabilityValue('battery_max_charging_power');
        const limit = args?.limit || this.getSetting('force_charging_limit') || SETTINGS.DEFAULT_CHARGING_LIMIT;
        
        if (!DataValidator.validateChargingLimit(limit, maxChargingPower)) {
            throw new Error(`Neplatný limit pro nabíjení: ${limit}`);
        }
        
        await sunberryAPI.enableForceCharging(limit);
        await this.setCapabilityValue('force_charging', true);
        return true;
        } catch (error) {
        this.logger.error('Chyba při zapnutí nabíjení baterie:', error);
        throw error;
        }
    }

    /**
     * Čištění při smazání zařízení
     */
    async onDeleted() {
        try {
            this.intervalManager.stop();
            await this.flowCardManager.destroy();
            this.logger.info('Zařízení bylo úspěšně odstraněno');
        } catch (error) {
            this.logger.error('Chyba při odstraňování zařízení:', error);
        }
    }
}

module.exports = SunberryDevice;