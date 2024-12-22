'use strict';

const Logger = require('../../lib/Logger');
const sunberryAPI = require('./api');

// Konstanty pro ID flow cards
const FLOW_CARDS = {
    TRIGGERS: {
        BATTERY_MAX_CHARGING_POWER_CHANGED: 'battery_max_charging_power_changed',
        BATTERY_LEVEL_CHANGED: 'battery_level_changed'
    },
    CONDITIONS: {
        IS_FORCE_CHARGING: 'is_force_charging',
        IS_BATTERY_DISCHARGE_BLOCKED: 'is_battery_discharge_blocked'
    },
    ACTIONS: {
        TURN_ON_BATTERY_CHARGING: 'turn_on_battery_charging',
        TURN_OFF_BATTERY_CHARGING: 'turn_off_battery_charging',
        BLOCK_BATTERY_DISCHARGE: 'block_battery_discharge',
        ENABLE_BATTERY_DISCHARGE: 'enable_battery_discharge'
    }
};

// Konstanty pro capability IDs
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

            // Registrace triggerů
            const triggers = [
                {
                    id: FLOW_CARDS.TRIGGERS.BATTERY_MAX_CHARGING_POWER_CHANGED,
                    handler: async (args, state) => {
                        this.logger.info('Trigger battery_max_charging_power_changed spuštěn s:', { args });
                        return true;
                    }
                },
                {
                    id: FLOW_CARDS.TRIGGERS.BATTERY_LEVEL_CHANGED,
                    handler: async (args, state) => {
                        try {
                            const currentLevel = state.battery_level;
                            const targetLevel = args.target_level;
                            const triggerOn = args.trigger_on;
    
                            this.logger.info('Kontrola podmínky battery_level_changed:', {
                                currentLevel,
                                targetLevel,
                                triggerOn
                            });
    
                            if (triggerOn === 'above') {
                                return currentLevel > targetLevel;
                            } else {
                                return currentLevel < targetLevel;
                            }
                        } catch (error) {
                            this.logger.error('Chyba při vyhodnocení battery_level_changed:', error);
                            return false;
                        }
                    }
                }
            ];

            await Promise.all(triggers.map(async (trigger) => {
                try {
                    const card = this.homey.flow.getTriggerCard(trigger.id);
                    if (!card) {
                        throw new Error(`Trigger karta ${trigger.id} nebyla nalezena`);
                    }

                    this.logger.debug(`Registrace triggeru ${trigger.id}`);
                    card.registerRunListener(trigger.handler);

                    this._flowCards.triggers.set(trigger.id, card);
                    this.logger.info(`Trigger ${trigger.id} byl úspěšně zaregistrován`);
                } catch (error) {
                    this.logger.error(`Chyba při registraci triggeru ${trigger.id}:`, error);
                    throw error;
                }
            }));

            // Inicializace conditions a actions
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
                            this.logger.info('Podmínka is_force_charging zpracována:', { forceCharging });
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
                            this.logger.info('Podmínka is_battery_discharge_blocked zpracována:', { blockDischarge });
                            return blockDischarge === true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování podmínky is_battery_discharge_blocked:', error);
                            return false;
                        }
                    }
                }
            ];

            await Promise.all(conditions.map(async (condition) => {
                try {
                    const card = this.homey.flow.getConditionCard(condition.id);
                    if (!card) {
                        throw new Error(`Condition card ${condition.id} not found`);
                    }

                    this.logger.debug(`Registrace podmínky ${condition.id}`);
                    
                    card.registerRunListener(async (args, state) => {
                        this.logger.info(`Podmínka ${condition.id} spuštěna s argumenty:`, args);
                        try {
                            const result = await condition.handler(args, state);
                            this.logger.info(`Podmínka ${condition.id} vyhodnocena s výsledkem:`, result);
                            return result;
                        } catch (error) {
                            this.logger.error(`Chyba při vyhodnocení podmínky ${condition.id}:`, error);
                            throw error;
                        }
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
                            const limit = args.limit || this.device.getSetting('force_charging_limit') || 5000;
                            this.logger.info('Akce turn_on_battery_charging spuštěna s limitem:', { limit });
                            
                            await this.device.setCapabilityValue('force_charging', true);
                            await sunberryAPI.enableForceCharging(limit);
                            
                            this.logger.info('Akce turn_on_battery_charging byla úspěšná', { limit });
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování akce turn_on_battery_charging:', error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.TURN_OFF_BATTERY_CHARGING,
                    handler: async (args, state) => {
                        try {
                            this.logger.info('Akce turn_off_battery_charging spuštěna');
                            
                            await this.device.setCapabilityValue('force_charging', false);
                            await sunberryAPI.disableForceCharging();
                            
                            this.logger.info('Akce turn_off_battery_charging byla úspěšná');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování akce turn_off_battery_charging:', error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.BLOCK_BATTERY_DISCHARGE,
                    handler: async (args, state) => {
                        try {
                            this.logger.info('Akce block_battery_discharge spuštěna');
                            
                            await this.device.setCapabilityValue('block_battery_discharge', true);
                            await sunberryAPI.blockBatteryDischarge();
                            
                            this.logger.info('Akce block_battery_discharge byla úspěšná');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování akce block_battery_discharge:', error);
                            throw error;
                        }
                    }
                },
                {
                    id: FLOW_CARDS.ACTIONS.ENABLE_BATTERY_DISCHARGE,
                    handler: async (args, state) => {
                        try {
                            this.logger.info('Akce enable_battery_discharge spuštěna');
                            
                            await this.device.setCapabilityValue('block_battery_discharge', false);
                            await sunberryAPI.enableBatteryDischarge();
                            
                            this.logger.info('Akce enable_battery_discharge byla úspěšná');
                            return true;
                        } catch (error) {
                            this.logger.error('Chyba při zpracování akce enable_battery_discharge:', error);
                            throw error;
                        }
                    }
                }
            ];

            await Promise.all(actions.map(async (action) => {
                try {
                    const card = this.homey.flow.getActionCard(action.id);
                    if (!card) {
                        throw new Error(`Action card ${action.id} not found`);
                    }

                    this.logger.debug(`Registrace akce ${action.id}`);
                    
                    card.registerRunListener(async (args, state) => {
                        this.logger.info(`Akce ${action.id} spuštěna s argumenty:`, args);
                        try {
                            const result = await action.handler(args, state);
                            this.logger.info(`Akce ${action.id} dokončena s výsledkem:`, result);
                            return result;
                        } catch (error) {
                            this.logger.error(`Chyba při vykonání akce ${action.id}:`, error);
                            throw error;
                        }
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