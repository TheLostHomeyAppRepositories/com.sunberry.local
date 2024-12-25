'use strict';

const Homey = require('homey');
const Logger = require('../../lib/Logger');
const sunberryAPI = require('./api');
const axios = require('axios');
const DataValidator = require('../../lib/DataValidator');

// Konstanty pro nastavení
const SETTINGS = {
   DEFAULT_IP: 'sunberry.local',
   CONNECTION_TIMEOUT: 3000,
   DEFAULT_DEVICE_NAME: 'Sunberry Zařízení'
};

// Konstanty pro API endpointy
const API_ENDPOINTS = {
   GRID_VALUES: '/grid/values'
};

/**
* Driver třída pro Sunberry zařízení
*/
class SunberryDriver extends Homey.Driver {
   /**
    * Inicializace driveru
    */
   async onInit() {
        try {
        console.log('SunberryDriver se inicializuje...');
        
        // Inicializace loggeru
        if (!this.homey.appLogger) {
            this.logger = new Logger(this.homey, 'SunberryDriver');
            this.logger.setEnabled(true); // Explicitně zapneme
            this.homey.appLogger = this.logger;
        } else {
            this.logger = this.homey.appLogger;
        }
        
        console.log('SunberryDriver logger inicializován');
        
        // Inicializace API
        await sunberryAPI.initializeLogger(this.homey);
        
        this.logger.info('SunberryDriver byl úspěšně inicializován');
        } catch (error) {
        console.error('Chyba při inicializaci SunberryDriver:', error);
        throw error;
        }
    }

   /**
    * Párovací proces
    * @param {Object} session - Párovací session
    */
   async onPair(session) {
       this.logger.info('Zahájena párovací relace');

       // Data uložená během párovací relace
       const pairingData = {
           ip_address: null
       };

       try {
           // Handler pro načtení nastavení
           session.setHandler('getSettings', async () => {
               this.logger.info('getSettings voláno');
               return { 
                   ip_address: pairingData.ip_address || SETTINGS.DEFAULT_IP 
               };
           });

           // Handler pro změnu nastavení
           session.setHandler('settingsChanged', async (settings) => {
               try {
                   if (!DataValidator.validateIPAddress(settings.ip_address)) {
                       throw new Error('Neplatný formát IP adresy');
                   }
                   
                   this.logger.info('settingsChanged voláno s:', settings);
                   pairingData.ip_address = settings.ip_address;
                   this.logger.info('Aktualizována IP adresa v pairingData na:', settings.ip_address);
                   
                   return { success: true };
               } catch (error) {
                   this.logger.error('Chyba při změně nastavení:', error);
                   return { success: false, error: error.message };
               }
           });

           // Handler pro kontrolu spojení
           session.setHandler('check', async (settings) => {
               try {
                   const ip = settings.ip_address;
                   if (!DataValidator.validateIPAddress(ip)) {
                       throw new Error('Neplatný formát IP adresy');
                   }

                   this.logger.info('Kontrola spojení na IP:', ip);
                   await this.testConnection(ip);
                   
                   pairingData.ip_address = ip;
                   sunberryAPI.setBaseUrl(ip);
                   
                   return { success: true };
               } catch (error) {
                   this.logger.error('Kontrola spojení selhala:', error);
                   return { 
                       success: false, 
                       error: `Chyba připojení: ${error.message}` 
                   };
               }
           });

           // Handler pro získání seznamu zařízení
           session.setHandler('list_devices', async () => {
               try {
                   const ip_address = pairingData.ip_address;
                   if (!ip_address) {
                       throw new Error('IP adresa není nastavena');
                   }

                   const device = await this.createDeviceObject(ip_address);
                   this.logger.info('Vytvořeno zařízení:', device);
                   
                   return [device];
               } catch (error) {
                   this.logger.error('Chyba při vytváření seznamu zařízení:', error);
                   return [];
               }
           });

       } catch (error) {
           this.logger.error('Kritická chyba během párování:', error);
           throw error;
       }
   }

   /**
    * Test připojení k zařízení
    * @private
    */
   async testConnection(ip) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            this.logger.debug(`Pokus ${attempt + 1}/${maxRetries} - Test připojení k:`, ip);
            const url = `http://${ip}${API_ENDPOINTS.GRID_VALUES}`;

            const response = await axios({
                method: 'get',
                url,
                timeout: 10000,
                headers: {
                    'Cache-Control': 'no-cache, no-store',
                    'Pragma': 'no-cache',
                    'User-Agent': 'HomeyApp/1.0',
                    'Accept': '*/*'
                },
                validateStatus: null, // akceptuje jakýkoliv status kód
                maxRedirects: 0
            });

            if (response.status !== 200) {
                throw new Error(`Server odpověděl s chybou ${response.status}`);
            }

            return response.data;
        } catch (error) {
            this.logger.warn(`Test připojení - pokus ${attempt + 1} selhal:`, {
                message: error.message,
                code: error.code,
                response: error.response?.status,
                config: error.config
            });

            if (attempt === maxRetries - 1) {
                this.logger.error('Všechny pokusy o připojení selhaly:', error);
                throw new Error(`Nelze se připojit k zařízení: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            attempt++;
            }
        }
    }

   /**
    * Vytvoření objektu zařízení
    * @private
    */
   async createDeviceObject(ip_address) {
       const defaultSettings = {
           ip_address,
           update_interval: 10,
           force_charging_limit: 5000,
           enable_debug_logs: false
       };

       if (!DataValidator.validateSettings(defaultSettings)) {
           throw new Error('Neplatná výchozí nastavení zařízení');
       }

       return {
           name: SETTINGS.DEFAULT_DEVICE_NAME,
           data: { 
               id: ip_address 
           },
           settings: defaultSettings
       };
   }
}

module.exports = SunberryDriver;