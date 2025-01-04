'use strict';

const Logger = require('../../lib/Logger');
const sunberryAPI = require('./api');
const DataValidator = require('../../lib/DataValidator');

class FlowCardManager {
    constructor(homey, device) {
        if (!homey) throw new Error('Homey instance is required');
        if (!device) throw new Error('Device instance is required');

        this.homey = homey;
        this.device = device;
        this.logger = null;
        
        this._flowCards = {
            triggers: new Map(),
            conditions: new Map(),
            actions: new Map()
        };
    }

    setLogger(logger) {
        this.logger = logger;
        if (this.logger) this.logger.debug('Logger nastaven pro FlowCardManager');
    }

    async initialize() {
        if (this.logger) {
            this.logger.log('Inicializuji Flow karty');
        }
    
        await this._initializeTriggers();
        await this._initializeConditions();
        await this._initializeActions();
    
        if (this.logger) {
            this.logger.log('Flow karty inicializovány');
        }
    }

    async _initializeTriggers() {
        try {
            const triggers = [
                {
                    id: 'battery_max_charging_power_changed',
                    handler: async () => {
                        return true;
                    }
                },
                {
                    id: 'battery_level_changed',
                    handler: async (args, state) => {
                        try {
                            if (!DataValidator.validateFlowTriggerArgs({
                                target_level: args.target_level
                            })) {
                                this.logger.warn('Neplatné argumenty pro battery_level_changed:', args);
                                return false;
                            }
    
                            const currentLevel = Number(state.battery_level);
                            const targetLevel = Number(args.target_level);
    
                            // Porovnáváme přesnou hodnotu
                            const matches = Math.abs(currentLevel - targetLevel) < 0.1;
    
                            this.logger.debug('Vyhodnocení battery_level_changed:', {
                                currentLevel,
                                targetLevel,
                                matches
                            });
    
                            return matches;
                        } catch (error) {
                            this.logger.error('Chyba v battery_level_changed triggeru:', error);
                            return false;
                        }
                    }
                },
                {
                    id: 'force_charging_changed',
                    handler: async (args) => {
                        try {
                            const forceCharging = await this.device.getCapabilityValue('force_charging');
                            // Pro "starts" (!inverted) chceme true, pro "stops" (inverted) chceme false
                            return args.inverted ? !forceCharging : forceCharging;
                        } catch (error) {
                            if (this.logger) {
                                this.logger.error('Chyba v force_charging_changed triggeru:', error);
                            }
                            return false;
                        }
                    }
                }

            ];

            for (const trigger of triggers) {
                const card = this.homey.flow.getDeviceTriggerCard(trigger.id);
                if (!card) continue;

                card.registerRunListener(async (args, state) => {
                    try {
                        return await trigger.handler(args, state);
                    } catch (error) {
                        if (this.logger) {
                            this.logger.error(`Chyba při spuštění triggeru ${trigger.id}:`, error);
                        }
                        return false;
                    }
                });

                this._flowCards.triggers.set(trigger.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrován trigger: ${trigger.id}`);
                }
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci triggerů:', error);
            }
        }
    }

    async _initializeConditions() {
        try {
            const conditions = [
                {
                    id: 'is_force_charging',
                    handler: async (args) => {
                        const value = await this.device.getCapabilityValue('force_charging');
                        return args.inverted ? !value : value;
                    }
                },
                {
                    id: 'is_battery_discharge_blocked',
                    handler: async (args) => {
                        const value = await this.device.getCapabilityValue('block_battery_discharge');
                        return args.inverted ? !value : value;
                    }
                },
                {
                    id: 'battery_level_check',
                    handler: async (args) => {
                        if (!DataValidator.validateFlowTriggerArgs({
                            level: args.level,
                            comparison: args.comparison
                        })) {
                            this.logger.warn('Neplatné argumenty pro battery_level_check:', args);
                            return false;
                        }

                        const currentLevel = await this.device.getCapabilityValue('measure_battery_percent');
                        const targetLevel = args.level;
                        
                        if (this.logger) {
                            this.logger.debug('Kontrola úrovně baterie:', { 
                                currentLevel, 
                                targetLevel,
                                comparison: args.comparison
                            });
                        }

                        return args.comparison === 'below' 
                            ? currentLevel < targetLevel 
                            : currentLevel > targetLevel;
                    }
                }
            ];

            for (const condition of conditions) {
                const card = this.homey.flow.getConditionCard(condition.id);
                if (!card) continue;

                card.registerRunListener(async (args, state) => {
                    try {
                        return await condition.handler(args, state);
                    } catch (error) {
                        if (this.logger) {
                            this.logger.error(`Chyba při vyhodnocení podmínky ${condition.id}:`, error);
                        }
                        return false;
                    }
                });

                this._flowCards.conditions.set(condition.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrována podmínka: ${condition.id}`);
                }
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci podmínek:', error);
            }
        }
    }

    async _initializeActions() {
        try {
            const actions = [
                {
                    id: 'turn_on_battery_charging',
                    handler: async (args) => {
                        const maxChargingPower = await this.device.getCapabilityValue('battery_max_charging_power');
                        const limit = args.limit || this.device.getSetting('force_charging_limit') || 5000;
                        
                        if (!DataValidator.validateChargingLimit(limit, maxChargingPower)) {
                            throw new Error(`Neplatný limit pro nabíjení: ${limit}`);
                        }
                        
                        const finalLimit = Math.min(limit, maxChargingPower || 10000);
                        
                        if (this.logger) {
                            this.logger.debug('Zapínám nabíjení baterie:', { finalLimit });
                        }
                        
                        await sunberryAPI.enableForceCharging(finalLimit);
                        await this.device.setCapabilityValue('force_charging', true);
                    }
                },
                {
                    id: 'turn_off_battery_charging',
                    handler: async () => {
                        await sunberryAPI.disableForceCharging();
                        await this.device.setCapabilityValue('force_charging', false);
                    }
                },
                {
                    id: 'block_battery_discharge',
                    handler: async () => {
                        await sunberryAPI.blockBatteryDischarge();
                        await this.device.setCapabilityValue('block_battery_discharge', true);
                    }
                },
                {
                    id: 'enable_battery_discharge',
                    handler: async () => {
                        await sunberryAPI.enableBatteryDischarge();
                        await this.device.setCapabilityValue('block_battery_discharge', false);
                    }
                }
            ];

            for (const action of actions) {
                const card = this.homey.flow.getActionCard(action.id);
                if (!card) continue;

                card.registerRunListener(async (args) => {
                    try {
                        await action.handler(args);
                        return true;
                    } catch (error) {
                        if (this.logger) {
                            this.logger.error(`Chyba při provádění akce ${action.id}:`, error);
                        }
                        throw error;
                    }
                });

                this._flowCards.actions.set(action.id, card);
                
                if (this.logger) {
                    this.logger.debug(`Registrována akce: ${action.id}`);
                }
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při inicializaci akcí:', error);
            }
        }
    }

    destroy() {
        try {
            this._flowCards.triggers.clear();
            this._flowCards.conditions.clear();
            this._flowCards.actions.clear();
            
            if (this.logger) {
                this.logger.log('FlowCardManager vyčištěn');
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Chyba při čištění FlowCardManageru:', error);
            }
        }
    }
}

module.exports = FlowCardManager;