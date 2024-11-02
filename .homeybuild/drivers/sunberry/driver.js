'use strict';

const Homey = require('homey');
const axios = require('axios');

class SunberryDriver extends Homey.Driver {

  async onInit() {
    this.log('SunberryDriver byl inicializován');
    this.registerFlowCards();
  }

  registerFlowCards() {
    this._registerConditionFlowCards();
    this._registerActionFlowCards();
  }

  _registerConditionFlowCards() {
    this.log('Registrace podmínkových Flow karet...');
    try {
      this.homey.flow.getConditionCard('is_force_charging')
        .registerRunListener(async (args) => {
          const device = args.device;
          return await device.getCapabilityValue('force_charging') === true;
        });

      this.homey.flow.getConditionCard('is_battery_discharge_blocked')
        .registerRunListener(async (args) => {
          const device = args.device;
          return await device.getCapabilityValue('block_battery_discharge') === true;
        });

      this.log('Podmínkové Flow karty byly úspěšně zaregistrovány.');
    } catch (error) {
      this.log('Chyba při registraci podmínkových Flow karet:', error);
    }
  }

  _registerActionFlowCards() {
    this.log('Registrace akčních Flow karet...');
    try {
      this.homey.flow.getActionCard('turn_on_battery_charging')
        .registerRunListener(async () => {
          return await this.updateAllDevices();
        });

      this.homey.flow.getActionCard('turn_off_battery_charging')
        .registerRunListener(async () => {
          return await this.updateAllDevices();
        });

      this.homey.flow.getActionCard('block_battery_discharge')
        .registerRunListener(async () => {
          return await this.updateAllDevices();
        });

      this.homey.flow.getActionCard('enable_battery_discharge')
        .registerRunListener(async () => {
          return await this.updateAllDevices();
        });

      this.log('Akční Flow karty byly úspěšně zaregistrovány.');
    } catch (error) {
      this.log('Chyba při registraci akčních Flow karet:', error);
    }
  }

  async onPair(session) {
    this.log('Zahájena párovací relace');

    // Definujeme pairingData jako proměnnou dostupnou v handlerech
    const pairingData = {
      ip_address: null
    };

    session.setHandler('getSettings', async () => {
      this.log('getSettings voláno');
      const ip_address = pairingData.ip_address || 'sunberry.local';
      return {
        ip_address: ip_address
      };
    });

    session.setHandler('settingsChanged', async (settings) => {
      this.log('settingsChanged voláno s:', settings);
      pairingData.ip_address = settings.ip_address;
      this.log('Aktualizována ip_address v pairingData na:', settings.ip_address);
      return { success: true };
    });

    session.setHandler('check', async (settings) => {
      const ip = settings.ip_address;
      try {
        const response = await axios.get(`http://${ip}/grid/values`, { timeout: 3000 });
        this.log('Spojení úspěšné, odpověď:', response.data);
        pairingData.ip_address = ip;
        return { success: true };
      } catch (error) {
        this.log('Kontrola spojení selhala s chybou:', error.message);
        return { success: false, error: `Chyba připojení: ${error.message}` };
      }
    });

    session.setHandler('list_devices', async () => {
      this.log('Handler list_devices byl volán');

      const ip_address = pairingData.ip_address;
      if (!ip_address) {
        this.log('Chyba: IP adresa není nastavena v pairingData.');
        return [];
      }

      try {
        const device = {
          name: 'Sunberry Zařízení',
          data: { id: ip_address }, // Použijeme IP adresu jako ID
          settings: {
            ip_address: ip_address
          }
        };

        this.log('Zařízení k přidání s IP adresou:', ip_address);
        return [device];
      } catch (error) {
        this.log('Chyba při vytváření seznamu zařízení:', error);
        return [];
      }
    });
  }

  async updateAllDevices() {
    const devices = this.getDevices();
    const promises = devices.map(device => device.fetchAndUpdateGridValues());
    await Promise.all(promises);
    return true;
  }
}

module.exports = SunberryDriver;
