'use strict';

const Logger = require('../../lib/Logger');
const sunberryAPI = require('./api');
const DataValidator = require('../../lib/DataValidator');

// Konstanty pro ID flow cards
const FLOW_CARDS = {
    TRIGGERS: {
        BATTERY_MAX_CHARGING_POWER_CHANGED: 'battery_max_charging_power_changed',
        BATTERY_LEVEL_CHANGED: 'battery_level_changed'
    },
    CONDITIONS: {
        IS_FORCE_CHARGING: 'is_force_charging',
        IS_BATTERY_DISCHARGE_BLOCKED: 'is_battery_discharge_blocked',
        BATTERY_LEVEL_CHECK: 'battery_level_check'
    },
    ACTIONS: {
        TURN_ON_BATTERY_CHARGING: 'turn_on_battery_charging',
        TURN_OFF_BATTERY_CHARGING: 'turn_off_battery_charging',
        BLOCK_BATTERY_DISCHARGE: 'block_battery_discharge',
        ENABLE_BATTERY_DISCHARGE: 'enable_battery_discharge'
    }
};

const CAPABILITIES = {
    FORCE_CHARGING: 'force_charging',
    BLOCK_BATTERY_DISCHARGE: 'block_battery_discharge'
};

class FlowCardManager {
    constructor(homey, device) {
        if (!homey) throw new Error('Homey instance is required');
        if (!device) throw new Error('Device instance is required');

        this.homey = homey;
        this.device = device;

        try {
            this.logger = this.homey.appLogger || new Logger(this.homey, 'FlowCardManager');
            this.logger.info('FlowCardManager byl vytvořen');
        } catch (error) {
            throw new Error(`Failed to initialize FlowCardManager logger: ${error.message}`);
        }

        this._flowCards = {
            triggers: new Map(),
            conditions: new Map(),
            actions: new Map()
        };
    }

    async initialize() {
        try {
            this.logger.info('Inicializuji Flow karty');

            const triggers = [
                {
                    id: FLOW_CARDS.TRIGGERS.BATTERY_MAX_CHARGING_POWER_CHANGED,
                    handler: async (args, state) => {
                        try {
                            const powerValue = args.power;
                            this.logger.debug('Trigger battery_max_charging_power_changed spuštěn s:', {
                                args,
                                powerValue
                            });

                            if (typeof powerValue !== 'number' || isNaN(powerValue)) {
                                this.logger.error('Neplatná hodnota power:', powerValue);
                                return false;
                            }

                            this.logger.info('Trigger battery_max_charging_power_changed úspěšně zpracován');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování triggeru battery_max_charging_power_changed:', error);
                            return false;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.TRIGGERS.BATTERY_LEVEL_CHANGED,
                    handler: async (args, state) => {
                        try {
                            const currentLevel = args.battery_level;
                            const targetLevel = args.target_level;
                            const triggerOn = args.trigger_on;
                            const previousLevel = state.previousLevel;
                
                            this.logger.debug('Trigger battery_level_changed kontrola podmínek:', {
                                currentLevel,
                                targetLevel,
                                triggerOn,
                                previousLevel
                            });
                
                            if (typeof currentLevel !== 'number' || isNaN(currentLevel)) {
                                this.logger.error('Neplatná hodnota battery_level:', currentLevel);
                                return false;
                            }
                
                            // Kontrolujeme skutečný přechod přes hranici
                            if (triggerOn === 'above') {
                                // Spustí se pouze pokud předtím byla hodnota pod hranicí a teď je nad
                                const shouldTrigger = previousLevel <= targetLevel && currentLevel > targetLevel;
                                this.logger.debug('Kontrola přechodu nad hranici:', {
                                    shouldTrigger,
                                    previousLevel,
                                    targetLevel,
                                    currentLevel
                                });
                                return shouldTrigger;
                            } else {
                                // Spustí se pouze pokud předtím byla hodnota nad hranicí a teď je pod
                                const shouldTrigger = previousLevel >= targetLevel && currentLevel < targetLevel;
                                this.logger.debug('Kontrola přechodu pod hranici:', {
                                    shouldTrigger,
                                    previousLevel,
                                    targetLevel,
                                    currentLevel
                                });
                                return shouldTrigger;
                            }
                        } catch (error) {
                            this.logger.error('Chyba při zpracování triggeru battery_level_changed:', error);
                            return false;
                        }
                    }
                }
            ];

            await Promise.all(triggers.map(async (trigger) => {
                try {
                    const card = this.homey.flow.getDeviceTriggerCard(trigger.id);
                    if (!card) {
                        throw new Error(`Trigger karta ${trigger.id} nebyla nalezena`);
                    }

                    this.logger.debug(`Registruji trigger ${trigger.id}`, {
                        cardExists: !!card,
                        triggerArgs: trigger
                    });

                    card.registerRunListener(trigger.handler);

                    this._flowCards.triggers.set(trigger.id, card);
                    this.logger.info(`Trigger ${trigger.id} byl úspěšně zaregistrován`);
                } catch (error) {
                    this.logger.error(`Chyba při registraci triggeru ${trigger.id}:`, error);
                    throw error;
                }
            }));

            await Promise.all([
                this._initializeConditions(),
                this._initializeActions()
            ]);

            this.logger.info('Flow karty byly úspěšně inicializovány');
        } catch (error) {
            this.logger.error('Chyba při inicializaci Flow karet:', error);
            throw new Error(`Inicializace Flow karet selhala: ${error.message}`);
        }
    }

    async _initializeConditions() {
        try {
            const conditions = [
                {
                    id: FLOW_CARDS.CONDITIONS.IS_FORCE_CHARGING,
                    handler: async () => {
                        try {
                            const forceCharging = await this.device.getCapabilityValue(CAPABILITIES.FORCE_CHARGING);
                            this.logger.debug('Kontrola podmínky force_charging:', { forceCharging });
                            return forceCharging === true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování podmínky is_force_charging:', error);
                            return false;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.CONDITIONS.IS_BATTERY_DISCHARGE_BLOCKED,
                    handler: async () => {
                        try {
                            const blockDischarge = await this.device.getCapabilityValue(CAPABILITIES.BLOCK_BATTERY_DISCHARGE);
                            this.logger.debug('Kontrola podmínky block_discharge:', { blockDischarge });
                            return blockDischarge === true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování podmínky is_battery_discharge_blocked:', error);
                            return false;
                        }
                    }
                },
                {
                    id: 'battery_level_check',
                    handler: async (args) => {
                        try {
                            const currentLevel = await this.device.getCapabilityValue('measure_battery_percent');
                            const targetLevel = args.level;
                            
                            this.logger.debug('Kontrola úrovně baterie:', { 
                                currentLevel, 
                                targetLevel,
                                comparison: args.comparison
                            });
                
                            if (typeof currentLevel !== 'number' || isNaN(currentLevel)) {
                                this.logger.error('Neplatná hodnota aktuální úrovně baterie:', currentLevel);
                                return false;
                            }
                
                            if (typeof targetLevel !== 'number' || isNaN(targetLevel)) {
                                this.logger.error('Neplatná cílová hodnota baterie:', targetLevel);
                                return false;
                            }
                
                            const result = args.comparison === 'below' 
                                ? currentLevel < targetLevel 
                                : currentLevel > targetLevel;
                
                            this.logger.debug('Výsledek kontroly úrovně baterie:', { 
                                result,
                                comparison: args.comparison
                            });
                
                            return result;
                        } catch (error) {
                            this.logger.error('Chyba při kontrole úrovně baterie:', error);
                            return false;
                        }
                    }
                }
            ];

            await Promise.all(conditions.map(async (condition) => {
                try {
                    const card = this.homey.flow.getConditionCard(condition.id);
                    if (!card) {
                        throw new Error(`Condition karta ${condition.id} nebyla nalezena`);
                    }

                    card.registerRunListener(async (args, state) => {
                        this.logger.debug(`Podmínka ${condition.id} spuštěna s:`, { args, state });
                        return await condition.handler(args, state);
                    });

                    this._flowCards.conditions.set(condition.id, card);
                    this.logger.info(`Podmínka ${condition.id} byla úspěšně zaregistrována`);
                } catch (error) {
                    this.logger.error(`Chyba při registraci podmínky ${condition.id}:`, error);
                    throw error;
                }
            }));
        } catch (error) {
            this.logger.error('Chyba při inicializaci podmínek:', error);
            throw error;
        }
    }

    async _initializeActions() {
        try {
            const actions = [
                {
                    id: FLOW_CARDS.ACTIONS.TURN_ON_BATTERY_CHARGING,
                    handler: async (args, state) => {
                        try {
                            const maxChargingPower = await this.device.getCapabilityValue('battery_max_charging_power');
                            const requestedLimit = args.limit || this.device.getSetting('force_charging_limit') || 5000;
                            
                            this.logger.debug('Kontrola limitu nabíjení:', { 
                                requestedLimit,
                                maxChargingPower,
                                settingsLimit: this.device.getSetting('force_charging_limit')
                            });
                            
                            // Základní validace čísla
                            if (typeof requestedLimit !== 'number' || isNaN(requestedLimit)) {
                                throw new Error(`Neplatný formát limitu: ${requestedLimit}`);
                            }
                
                            // Minimální kontrola
                            if (requestedLimit < 100) {
                                throw new Error(`Limit ${requestedLimit}W je pod minimální hodnotou 100W`);
                            }
                
                            // Kontrola proti maximálnímu výkonu
                            if (typeof maxChargingPower === 'number' && !isNaN(maxChargingPower)) {
                                if (requestedLimit > maxChargingPower) {
                                    this.logger.warn(`Požadovaný limit ${requestedLimit}W byl omezen na maximální výkon ${maxChargingPower}W`);
                                }
                            }
                            
                            // Použijeme nižší z hodnot
                            const finalLimit = Math.min(requestedLimit, maxChargingPower || 10000);
                            this.logger.debug('Zapínám nabíjení baterie s limitem:', { finalLimit });
                            
                            await sunberryAPI.enableForceCharging(finalLimit);
                            await this.device.setCapabilityValue('force_charging', true);
                            
                            this.logger.info('Nabíjení baterie úspěšně zapnuto');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zapínání nabíjení baterie:', error);
                            await this.device.setCapabilityValue('force_charging', false).catch(this.logger.error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.TURN_OFF_BATTERY_CHARGING,
                    handler: async (args, state) => {
                        try {
                            this.logger.debug('Vypínám nabíjení baterie');
                            
                            await sunberryAPI.disableForceCharging();
                            await this.device.setCapabilityValue('force_charging', false);
                            
                            this.logger.info('Nabíjení baterie úspěšně vypnuto');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při vypínání nabíjení baterie:', error);
                            await this.device.setCapabilityValue('force_charging', true).catch(this.logger.error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.BLOCK_BATTERY_DISCHARGE,
                    handler: async (args, state) => {
                        try {
                            this.logger.debug('Blokuji vybíjení baterie');
                            
                            await sunberryAPI.blockBatteryDischarge();
                            await this.device.setCapabilityValue('block_battery_discharge', true);
                            
                            this.logger.info('Vybíjení baterie úspěšně zablokováno');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při blokování vybíjení baterie:', error);
                            await this.device.setCapabilityValue('block_battery_discharge', false).catch(this.logger.error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.ENABLE_BATTERY_DISCHARGE,
                    handler: async (args, state) => {
                        try {
                            this.logger.debug('Povoluji vybíjení baterie');
                            
                            await sunberryAPI.enableBatteryDischarge();
                            await this.device.setCapabilityValue('block_battery_discharge', false);
                            
                            this.logger.info('Vybíjení baterie úspěšně povoleno');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při povolování vybíjení baterie:', error);
                            await this.device.setCapabilityValue('block_battery_discharge', true).catch(this.logger.error);
                            throw error;
                        }
                    }
                }
            ];

            await Promise.all(actions.map(async (action) => {
                try {
                    const card = this.homey.flow.getActionCard(action.id);
                    if (!card) {
                        throw new Error(`Action karta ${action.id} nebyla nalezena`);
                    }

                    card.registerRunListener(async (args, state) => {
                        this.logger.debug(`Akce ${action.id} spuštěna s:`, { args, state });
                        return await action.handler(args, state);
                    });

                    this._flowCards.actions.set(action.id, card);
                    this.logger.info(`Akce ${action.id} byla úspěšně zaregistrována`);
                } catch (error) {
                    this.logger.error(`Chyba při registraci akce ${action.id}:`, error);
                    throw error;
                }
            }));
        } catch (error) {
            this.logger.error('Chyba při inicializaci akcí:', error);
            throw error;
        }
    }

    async destroy() {
        try {
            this._flowCards.triggers.clear();
            this._flowCards.conditions.clear();
            this._flowCards.actions.clear();
            this.logger.info('FlowCardManager byl úspěšně vyčištěn');
        } catch (error) {
            this.logger.error('Chyba při čištění FlowCardManageru:', error);
            throw error;
        }
    }
}

module.exports = FlowCardManager;