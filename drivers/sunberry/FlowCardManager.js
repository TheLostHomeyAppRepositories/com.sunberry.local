'use strict';

class FlowCardManager {
    constructor(homey, device) {
        this.homey = homey;
        this.device = device;
        this.logger = this.homey.appLogger || new Logger(this.homey, 'FallbackLogger');

        this._flowCards = {
            conditions: new Map(),
            actions: new Map()
        };
    }

    async initialize() {
        try {
            this.logger.info('Inicializuji Flow karty');

            await this._initializeConditions();
            await this._initializeActions();

            this.logger.info('Flow karty byly úspěšně inicializovány');
        } catch (error) {
            this.logger.error('Chyba při inicializaci Flow karet:', error);
            throw error;
        }
    }

    async _initializeConditions() {
        const conditions = [
            {
                id: 'is_force_charging',
                handler: async () => {
                    const forceCharging = await this.device.getCapabilityValue('force_charging');
                    this.logger.info('Podmínka is_force_charging zpracována:', { forceCharging });
                    return forceCharging === true;
                }
            },
            {
                id: 'is_battery_discharge_blocked',
                handler: async () => {
                    const blockDischarge = await this.device.getCapabilityValue('block_battery_discharge');
                    this.logger.info('Podmínka is_battery_discharge_blocked zpracována:', { blockDischarge });
                    return blockDischarge === true;
                }
            }
        ];

        for (const condition of conditions) {
            const card = this.homey.flow.getConditionCard(condition.id);
            this.logger.debug(`Registrace podmínky ${condition.id}`);
            card.registerRunListener(async (args, state) => {
                this.logger.info(`Podmínka ${condition.id} byla spuštěna s argumenty:`, args);
                const result = await condition.handler(args, state);
                this.logger.info(`Podmínka ${condition.id} byla vyhodnocena s výsledkem:`, result);
                return result;
            });
            this._flowCards.conditions.set(condition.id, card);
            this.logger.info(`Podmínka ${condition.id} byla zaregistrována`);
        }
    }

    async _initializeActions() {
        const actions = [
            {
                id: 'turn_on_battery_charging',
                handler: async (args, state) => {
                    const limit = this.device.getSetting('force_charging_limit') || 5000;
                    this.logger.info(`Akce turn_on_battery_charging spuštěna s limitem:`, { limit });
                    await this.device.setCapabilityValue('force_charging', true);
                    await this.device.enableForceCharging(limit);
                    this.logger.info('Akce turn_on_battery_charging byla úspěšná', { limit });
                    return true;
                }
            },
            {
                id: 'turn_off_battery_charging',
                handler: async (args, state) => {
                    this.logger.info('Akce turn_off_battery_charging spuštěna');
                    await this.device.setCapabilityValue('force_charging', false);
                    await this.device.disableForceCharging();
                    this.logger.info('Akce turn_off_battery_charging byla úspěšná');
                    return true;
                }
            }
        ];

        for (const action of actions) {
            const card = this.homey.flow.getActionCard(action.id);
            this.logger.debug(`Registrace akce ${action.id}`);
            card.registerRunListener(async (args, state) => {
                this.logger.info(`Akce ${action.id} byla spuštěna s argumenty:`, args);
                const result = await action.handler(args, state);
                this.logger.info(`Akce ${action.id} byla dokončena s výsledkem:`, result);
                return result;
            });
            this._flowCards.actions.set(action.id, card);
            this.logger.info(`Akce ${action.id} byla zaregistrována`);
        }
    }

    destroy() {
        this._flowCards.conditions.clear();
        this._flowCards.actions.clear();
        this.logger.info('FlowCardManager byl úspěšně vyčištěn');
    }
}

module.exports = FlowCardManager;