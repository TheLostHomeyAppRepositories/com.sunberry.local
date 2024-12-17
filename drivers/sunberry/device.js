'use strict';

const Homey = require('homey');
const FlowCardManager = require('./FlowCardManager');
const {
  initializeLogger,
  setBaseUrl,
  getGridValues,
  getBatteryValues,
  enableForceCharging,
  disableForceCharging,
  enableBlockBatteryDischarge,
  disableBlockBatteryDischarge
} = require('./api');

class SunberryDevice extends Homey.Device {

  #cachedValues = {
    measure_L1: 0,
    measure_L2: 0,
    measure_L3: 0,
    measure_total: 0,
    measure_battery_kWh: 0,
    measure_battery_percent: 0,
    remaining_kWh_to_full: 0
  };

  async onInit() {
    // Inicializace loggeru s kontrolou globální instance
    if (!this.homey.appLogger) {
        this.logger = new Logger(this.homey, 'FallbackLogger');
        this.homey.appLogger = this.logger; // Nastavení globálního loggeru
        this.logger.info('Fallback logger byl inicializován jako globální logger');
    } else {
        this.logger = this.homey.appLogger;
        this.logger.info('Používám globální logger z aplikace');
    }

    // Zavolej inicializaci loggeru pro API
    initializeLogger(this.homey);

    // Nastavení zapnutí/vypnutí debug logů
    const enableDebugLogs = this.getSetting('enable_debug_logs');
    this.logger.setEnabled(enableDebugLogs);

    this.logger.info('SunberryDevice byl inicializován');

    // Inicializace Flow karet
    this.flowCardManager = new FlowCardManager(this.homey, this, this.logger);
    await this.flowCardManager.initialize();

    // Načteme IP adresu ze settings zařízení
    this.ipAddress = this.getSetting('ip_address');
    if (this.ipAddress) {
      setBaseUrl(this.ipAddress); // Nastav API base URL
      this.logger.info('Používá se IP adresa:', { ipAddress: this.ipAddress });
    } else {
      this.logger.warn('IP adresa není nastavena, používá se výchozí sunberry.local');
    }

    // Načtení uložených hodnot, pokud existují
    const storedValues = await this.getStoreValue('cachedMeasurements');
    if (storedValues) {
      this.logger.info('Načítám uložené hodnoty:', storedValues);
      this.#cachedValues = storedValues;
      await this.setInitialValues();
    } else {
      this.logger.info('Nenalezeny žádné uložené hodnoty, používají se výchozí');
    }

    // Nastavení intervalu aktualizace
    const updateInterval = this.getSetting('update_interval') || 10;
    this.logger.info('Interval aktualizace nastaven na:', { updateInterval });

    try {
      this.logger.info('Provádím počáteční načtení dat');
      await this.fetchAndUpdateGridValues();
    } catch (error) {
      this.logger.error('Počáteční načtení dat selhalo:', error);
    }

    // Spuštění intervalů pro získávání dat
    this.startDataFetchInterval(updateInterval);
    this.logger.info('Interval pro získávání dat site byl spuštěn');

    this.startBatteryFetchInterval(updateInterval);
    this.logger.info('Interval pro získávání dat baterie byl spuštěn');

    // Označení zařízení jako dostupné
    this.setAvailable();
    this.logger.info('Inicializace zařízení dokončena');
}


  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.logger.info('Nastavení byla změněna:', { oldSettings, newSettings, changedKeys });

    if (changedKeys.includes('update_interval')) {
      const newInterval = newSettings.update_interval;
      this.logger.info('Interval aktualizace změněn na:', { newInterval });
      this.startDataFetchInterval(newInterval);
    }

    if (changedKeys.includes('ip_address')) {
      this.ipAddress = newSettings.ip_address;
      setBaseUrl(this.ipAddress);
      this.logger.info('IP adresa aktualizována na:', { ipAddress: this.ipAddress });
    }

    if (changedKeys.includes('enable_debug_logs')) {
      const enableDebugLogs = newSettings.enable_debug_logs;
      this.logger.setEnabled(enableDebugLogs);
      this.logger.info(`Debug logy byly ${enableDebugLogs ? 'zapnuty' : 'vypnuty'}`);
    }

    this.logger.info('Načítám nová data po změně nastavení');
    await this.fetchAndUpdateGridValues();
  }

  async fetchAndUpdateGridValues() {
    try {
      this.logger.info('Zahajuji načítání hodnot ze zařízení');
      const values = await getGridValues();
      if (!values) throw new Error('API nevrátilo žádné hodnoty');

      this.logger.info('Přijaté hodnoty z API:', values);
      this.#cachedValues = { ...this.#cachedValues, ...values };
      await this.setStoreValue('cachedMeasurements', this.#cachedValues);
      this.logger.info('Hodnoty byly úspěšně uloženy do cache');
    } catch (error) {
      this.logger.error('Chyba při načítání hodnot:', error);
    }
  }

  async setInitialValues() {
    try {
        this.logger.info('Nastavuji počáteční hodnoty z cache');
        for (const [key, value] of Object.entries(this.#cachedValues)) {
            const capability = `measure_${key}`; // Přidá prefix measure_ k názvu capability
            if (this.hasCapability(capability)) {
                await this.setCapabilityValue(capability, value);
                this.logger.info(`Capability ${capability} byla nastavena na:`, value);
            } else {
                this.logger.warn(`Capability ${capability} není dostupná v zařízení`);
            }
        }
        this.logger.info('Počáteční hodnoty byly úspěšně nastaveny');
    } catch (error) {
        this.logger.error('Chyba při nastavování počátečních hodnot:', error);
    }
}

  startDataFetchInterval(interval) {
    if (this.dataFetchInterval) this.homey.clearInterval(this.dataFetchInterval);
    this.dataFetchInterval = this.homey.setInterval(async () => {
      await this.fetchAndUpdateGridValues();
    }, interval * 1000);
  }

  startBatteryFetchInterval(interval) {
    if (this.batteryFetchInterval) this.homey.clearInterval(this.batteryFetchInterval);
    this.batteryFetchInterval = this.homey.setInterval(async () => {
      await this.fetchAndUpdateBatteryValues();
    }, interval * 1000);
  }

  async fetchAndUpdateBatteryValues() {
    try {
      const values = await getBatteryValues();
      this.logger.info('Přijaté hodnoty baterie:', values);
      this.#cachedValues = { ...this.#cachedValues, ...values };
      await this.setStoreValue('cachedBatteryValues', this.#cachedValues);
    } catch (error) {
      this.logger.error('Chyba při načítání hodnot baterie:', error);
    }
  }

  async onDeleted() {
    this.logger.info('Zařízení bylo odstraněno, provádím čištění');

    if (this.dataFetchInterval) {
      this.logger.info('Ruším interval načítání dat');
      this.homey.clearInterval(this.dataFetchInterval);
    }

    if (this.batteryFetchInterval) {
      this.logger.info('Ruším interval načítání dat baterie');
      this.homey.clearInterval(this.batteryFetchInterval);
    }

    this.flowCardManager.destroy();
    this.logger.info('Čištění bylo dokončeno');
  }
}

module.exports = SunberryDevice;