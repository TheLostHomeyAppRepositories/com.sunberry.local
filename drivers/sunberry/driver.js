'use strict';

const Homey = require('homey');

class SunberryDriver extends Homey.Driver {

  async onInit() {
    // Použití globálního loggeru
    this.logger = this.homey.appLogger || new Logger(this.homey, 'FallbackLogger');
    this.logger.info('SunberryDriver byl inicializován');
  }

  async onPair(session) {
    this.logger.info('Zahájena párovací relace');

    const pairingData = {
      ip_address: null
    };

    session.setHandler('getSettings', async () => {
      this.logger.info('getSettings voláno');
      const ip_address = pairingData.ip_address || 'sunberry.local';
      return {
        ip_address: ip_address
      };
    });

    session.setHandler('settingsChanged', async (settings) => {
      this.logger.info('settingsChanged voláno s:', settings);
      pairingData.ip_address = settings.ip_address;
      this.logger.info('Aktualizována ip_address v pairingData na:', settings.ip_address);
      return { success: true };
    });

    session.setHandler('check', async (settings) => {
      const ip = settings.ip_address;
      try {
        this.logger.info('Kontrola spojení na IP:', ip);
        const response = await axios.get(`http://${ip}/grid/values`, { timeout: 3000 });
        this.logger.info('Spojení úspěšné, odpověď:', response.data);
        pairingData.ip_address = ip;
        return { success: true };
      } catch (error) {
        this.logger.error('Kontrola spojení selhala s chybou:', error.message);
        return { success: false, error: `Chyba připojení: ${error.message}` };
      }
    });

    session.setHandler('list_devices', async () => {
      this.logger.info('Handler list_devices byl volán');

      const ip_address = pairingData.ip_address;
      if (!ip_address) {
        this.logger.error('Chyba: IP adresa není nastavena v pairingData.');
        return [];
      }

      try {
        const device = {
          name: 'Sunberry Zařízení',
          data: { id: ip_address },
          settings: {
            ip_address: ip_address
          }
        };

        this.logger.info('Zařízení k přidání s IP adresou:', ip_address);
        return [device];
      } catch (error) {
        this.logger.error('Chyba při vytváření seznamu zařízení:', error);
        return [];
      }
    });
  }
}

module.exports = SunberryDriver;