'use strict';

const Homey = require('homey');
const Logger = require('./lib/Logger');

// Konstanty pro nastavení
const APP_SETTINGS = {
    LOGGER_CONTEXT: 'SunberryApp',
    ERROR_HANDLERS: {
        UNCAUGHT_EXCEPTION: 'uncaughtException',
        UNHANDLED_REJECTION: 'unhandledRejection'
    }
};

/**
 * Hlavní třída aplikace Sunberry
 */
class SunberryApp extends Homey.App {
    /**
     * @private
     */
    async initializeLogger() {
        try {
            if (!this.homey.appLogger) {
                this.logger = new Logger(this.homey, APP_SETTINGS.LOGGER_CONTEXT);
                this.logger.setEnabled(true);
                this.homey.appLogger = this.logger;
                this.logger.info('SunberryApp logger byl inicializován');
            } else {
                this.logger = this.homey.appLogger;
                this.logger.info('Používám existující globální logger');
            }
        } catch (error) {
            console.error('Kritická chyba při inicializaci loggeru:', error);
            throw error;
        }
    }

    /**
     * Inicializace globálních event listenerů
     * @private
     */
    async initializeGlobalListeners() {
        try {
            this.logger.info('Inicializace globálních listenerů');

            // Zachycení neošetřených výjimek
            this.homey.on(APP_SETTINGS.ERROR_HANDLERS.UNCAUGHT_EXCEPTION, (error) => {
                this.logger.error('Neošetřená výjimka:', error);
                this.handleGlobalError(error, APP_SETTINGS.ERROR_HANDLERS.UNCAUGHT_EXCEPTION);
            });

            // Zachycení neošetřených Promise rejekcí
            this.homey.on(APP_SETTINGS.ERROR_HANDLERS.UNHANDLED_REJECTION, (reason, promise) => {
                this.logger.error('Neošetřená Promise rejekce:', { reason, promise });
                this.handleGlobalError(reason, APP_SETTINGS.ERROR_HANDLERS.UNHANDLED_REJECTION);
            });

            this.logger.info('Globální listenery byly inicializovány');
        } catch (error) {
            this.logger.error('Chyba při inicializaci globálních listenerů:', error);
            throw error;
        }
    }

    /**
     * Zpracování globálních chyb
     * @private
     */
    async handleGlobalError(error, type) {
        try {
            // Logování detailů chyby
            this.logger.error(`Globální chyba typu ${type}:`, {
                message: error.message,
                stack: error.stack,
                type: error.name,
                timestamp: new Date().toISOString()
            });

            // Zde můžeme přidat další logiku pro zpracování chyb
            // například notifikace admina, restart služeb atd.
        } catch (handlingError) {
            console.error('Kritická chyba při zpracování globální chyby:', handlingError);
        }
    }

    /**
     * Inicializace aplikace
     */
    async onInit() {
        try {
            await this.initializeLogger();
            await this.initializeGlobalListeners();
            
            // Nastavení stavu aplikace
            this.setState('ready');
            this.logger.info('SunberryApp byla úspěšně inicializována');
        } catch (error) {
            console.error('Kritická chyba při inicializaci aplikace:', error);
            throw error;
        }
    }

    /**
     * Nastavení stavu aplikace
     * @private
     */
    setState(state) {
        this.state = state;
        this.logger.info('Stav aplikace změněn na:', { state });
    }

    /**
     * Získání instance loggeru
     */
    getLogger() {
        if (!this.logger) {
            throw new Error('Logger není inicializován');
        }
        return this.logger;
    }

    /**
     * Zpracování událostí aplikace
     */
    async handleAppEvent(eventType, data) {
        try {
            this.logger.info('Zpracovávám událost aplikace:', { eventType, data });
            
            switch (eventType) {
                case 'deviceAdded':
                    await this.handleDeviceAdded(data);
                    break;
                case 'deviceRemoved':
                    await this.handleDeviceRemoved(data);
                    break;
                default:
                    this.logger.warn('Neznámý typ události:', { eventType });
            }
        } catch (error) {
            this.logger.error('Chyba při zpracování události:', error);
            throw error;
        }
    }

    /**
     * Zpracování přidání nového zařízení
     * @private
     */
    async handleDeviceAdded(device) {
        this.logger.info('Nové zařízení bylo přidáno:', { deviceId: device.id });
        // Zde můžeme přidat další logiku pro nová zařízení
    }

    /**
     * Zpracování odebrání zařízení
     * @private
     */
    async handleDeviceRemoved(device) {
        this.logger.info('Zařízení bylo odebráno:', { deviceId: device.id });
        // Zde můžeme přidat logiku pro cleanup při odebrání zařízení
    }
}

module.exports = SunberryApp;