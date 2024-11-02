'use strict';

const Homey = require('homey');
const {
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
    this.log('SunberryDevice byl inicializován');

    // Načteme IP adresu ze settings zařízení
    this.ipAddress = this.getSetting('ip_address');
    if (this.ipAddress) {
      setBaseUrl(this.ipAddress);
      this.log('Používá se IP adresa:', this.ipAddress);
    } else {
      this.log('IP adresa není nastavena, používá se výchozí sunberry.local');
    }

    // Načteme uložené hodnoty, pokud existují
    const storedValues = await this.getStoreValue('cachedMeasurements');
    if (storedValues) {
      this.log('Načítám uložené hodnoty:', storedValues);
      this.#cachedValues = storedValues;
      // Nastavíme počáteční hodnoty z cache
      await this.setInitialValues();
    } else {
      this.log('Nenalezeny žádné uložené hodnoty, používají se výchozí');
    }

    // Získání intervalu aktualizace ze settings nebo výchozí hodnoty
    const updateInterval = this.getSetting('update_interval') || 10;
    this.log('Interval aktualizace nastaven na:', updateInterval, 'sekund');

    // Registrace Flow karet
    this.setupFlowCards();
    this.log('Flow karty byly nastaveny');

    // Provedeme první načtení dat
    try {
      this.log('Provádím počáteční načtení dat');
      await this.fetchAndUpdateGridValues();
    } catch (error) {
      this.error('Počáteční načtení dat selhalo:', error);
    }

    // Nastavení intervalu pro získávání dat
    this.startDataFetchInterval(updateInterval);
    this.log('Interval pro získávání dat site byl spuštěn');

    this.startBatteryFetchInterval(updateInterval);
    this.log('Interval pro získávání dat baterie byl spuštěn');

    // Nastavení zařízení jako dostupného
    this.setAvailable();
    this.log('Inicializace zařízení dokončena');

    this.registerCapabilityListener('force_charging', async (value) => {
      try {
        // Načteme aktuální hodnotu limitu z nastavení zařízení
        const limit = this.getSetting('force_charging_limit') || 5000;
        this.log('Aktuální limit pro force_charging:', limit); // Ladicí výstup
    
        if (value) {
          await enableForceCharging(limit);
        } else {
          await disableForceCharging();
        }
    
        return true;
      } catch (error) {
        this.error('Chyba při zpracování force_charging:', error);
        return false;
      }
    });
    
    
    this.registerCapabilityListener('block_battery_discharge', async (value) => {
      if (value) {
        await enableBlockBatteryDischarge();
      } else {
        await disableBlockBatteryDischarge();
      }
      return Promise.resolve();
    });    
  }

  async setInitialValues() {
    try {
      this.log('Nastavuji počáteční hodnoty z cache');
      await this.setCapabilityValue('measure_L1', this.#cachedValues.measure_L1);
      await this.setCapabilityValue('measure_L2', this.#cachedValues.measure_L2);
      await this.setCapabilityValue('measure_L3', this.#cachedValues.measure_L3);
      await this.setCapabilityValue('measure_total', this.#cachedValues.measure_total);
      this.log('Počáteční hodnoty byly úspěšně nastaveny');
    } catch (error) {
      this.error('Chyba při nastavování počátečních hodnot:', error);
    }
  }

  async fetchAndUpdateGridValues() {
    try {
      this.log('Zahajuji načítání hodnot ze zařízení...');
      const values = await getGridValues();

      if (!values) {
        throw new Error('API nevrátilo žádné hodnoty');
      }

      this.log('Přijaté hodnoty z API:', values);

      // Aktualizujeme pouze pokud dostaneme platnou hodnotu
      if (typeof values.L1 === 'number') {
        this.log('Aktualizuji hodnotu L1:', values.L1);
        this.#cachedValues.measure_L1 = values.L1;
        await this.setCapabilityValue('measure_L1', values.L1);
      }

      if (typeof values.L2 === 'number') {
        this.log('Aktualizuji hodnotu L2:', values.L2);
        this.#cachedValues.measure_L2 = values.L2;
        await this.setCapabilityValue('measure_L2', values.L2);
      }

      if (typeof values.L3 === 'number') {
        this.log('Aktualizuji hodnotu L3:', values.L3);
        this.#cachedValues.measure_L3 = values.L3;
        await this.setCapabilityValue('measure_L3', values.L3);
      }

      if (typeof values.Total === 'number') {
        this.log('Aktualizuji celkovou hodnotu:', values.Total);
        this.#cachedValues.measure_total = values.Total;
        await this.setCapabilityValue('measure_total', values.Total);
      }

      // Uložíme aktuální hodnoty do store
      await this.setStoreValue('cachedMeasurements', this.#cachedValues);
      this.log('Hodnoty byly úspěšně uloženy do cache');

    } catch (error) {
      this.error('Chyba při načítání hodnot:', error);
      this.log('Používám uložené hodnoty:', this.#cachedValues);
    }
  }

  startDataFetchInterval(interval) {
    this.log('Spouštím interval pro načítání dat s intervalem', interval, 'sekund');

    if (this.dataFetchInterval) {
      this.log('Ruším existující interval');
      this.homey.clearInterval(this.dataFetchInterval);
    }

    const intervalMs = interval * 1000; // Interval v milisekundách
    this.log(`Nastavuji interval na ${intervalMs} ms`);

    this.dataFetchInterval = this.homey.setInterval(async () => {
      this.log('Interval spuštěn, načítám nová data');
      try {
        await this.fetchAndUpdateGridValues();
        this.log('Data byla úspěšně načtena v intervalu');
      } catch (err) {
        this.error('Chyba při aktualizaci dat v intervalu:', err);
      }
    }, intervalMs);

    this.log('Interval pro načítání dat byl úspěšně spuštěn');
  }

  async fetchAndUpdateBatteryValues() {
    try {
      this.log('Začínám načítat hodnoty baterie z API...');
      const values = await getBatteryValues();
      
      if (!values) {
        throw new Error('Žádné hodnoty baterie nebyly přijaty z API');
      }
  
      this.log('Hodnoty baterie přijaté z API:', values);
  
      // Nastavíme hodnotu measure_battery_kWh, pokud je platná
      if (typeof values.actual_kWh === 'number') {
        this.log(`Aktualizuji measure_battery_kWh: ${values.actual_kWh} kWh`);
        this.#cachedValues.measure_battery_kWh = values.actual_kWh;
        await this.setCapabilityValue('measure_battery_kWh', values.actual_kWh);
      } else {
        this.log('Hodnota actual_kWh je neplatná, neaktualizováno');
      }
  
      // Nastavíme hodnotu measure_battery_percent, pokud je platná
      if (typeof values.actual_percent === 'number') {
        this.log(`Aktualizuji measure_battery_percent: ${values.actual_percent}%`);
        this.#cachedValues.measure_battery_percent = values.actual_percent;
        await this.setCapabilityValue('measure_battery_percent', values.actual_percent);
  
      // Výpočet zbývající kapacity do plného nabití
      const fullCapacity = values.actual_kWh / (values.actual_percent / 100);
      const remaining_kWh = (fullCapacity - values.actual_kWh).toFixed(2);

      this.log(`Vypočítaná remaining_kWh_to_full: ${remaining_kWh} kWh`);

      this.#cachedValues.remaining_kWh_to_full = parseFloat(remaining_kWh);
      await this.setCapabilityValue('remaining_kWh_to_full', parseFloat(remaining_kWh));
      } else {
      this.log('Hodnota actual_percent je neplatná, neaktualizováno');
      }
  
      // Uložení aktuálních hodnot do cache
      await this.setStoreValue('cachedBatteryValues', this.#cachedValues);
      this.log('Hodnoty baterie byly úspěšně uloženy do cache:', this.#cachedValues);
  
    } catch (error) {
      this.error('Chyba při načítání hodnot baterie:', error);
    }
  }  

  startBatteryFetchInterval(interval) {
    this.log('Spouštím interval pro načítání dat baterie s intervalem', interval, 'sekund');
  
    if (this.batteryFetchInterval) {
      this.log('Ruším existující interval pro načítání dat baterie');
      this.homey.clearInterval(this.batteryFetchInterval);
    }
  
    const intervalMs = interval * 1000; // Interval v milisekundách
    this.batteryFetchInterval = this.homey.setInterval(async () => {
      this.log('Načítám nová data baterie v intervalu');
      try {
        await this.fetchAndUpdateBatteryValues();
        this.log('Data baterie byla úspěšně načtena');
      } catch (error) {
        this.error('Chyba při aktualizaci dat baterie v intervalu:', error);
      }
    }, intervalMs);
  }  

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Nastavení byla změněna:');
    this.log('- Staré nastavení:', oldSettings);
    this.log('- Nové nastavení:', newSettings);
    this.log('- Změněné klíče:', changedKeys);

    if (changedKeys.includes('update_interval')) {
      this.log('Interval aktualizace byl změněn, restartuji interval načítání dat');
      this.startDataFetchInterval(newSettings.update_interval);
    }

    // Pokud se změnila IP adresa, aktualizujeme API
    if (changedKeys.includes('ip_address')) {
      this.ipAddress = newSettings.ip_address;
      setBaseUrl(this.ipAddress);
      this.log('IP adresa byla aktualizována na:', this.ipAddress);
    }

    this.log('Po změně nastavení načítám nová data');
    await this.fetchAndUpdateGridValues();
  }

  setupFlowCards() {
    this.log('Nastavuji Flow karty');

    // Podmínkové Flow karty
    this.homey.flow.getConditionCard('is_force_charging')
      .registerRunListener(async (args) => {
        this.log('Spouštím podmínku is_force_charging');
        const forceCharging = await this.getCapabilityValue('force_charging');
        this.log('Stav force_charging:', forceCharging);
        return forceCharging === true;
      });

    this.homey.flow.getConditionCard('is_battery_discharge_blocked')
      .registerRunListener(async (args) => {
        this.log('Spouštím podmínku is_battery_discharge_blocked');
        const blockDischarge = await this.getCapabilityValue('block_battery_discharge');
        this.log('Stav block_battery_discharge:', blockDischarge);
        return blockDischarge === true;
      });

    // Akční Flow karty
    this.homey.flow.getActionCard('turn_on_battery_charging')
      .registerRunListener(async (args) => {
        this.log('Spouštím akci turn_on_battery_charging');
        try {
          const limit = this.getSetting('force_charging_limit') || 5000;
          await enableForceCharging(limit);
          await this.setCapabilityValue('force_charging', true);
          return true;
        } catch (error) {
          this.error('Chyba při spouštění akce turn_on_battery_charging:', error);
          return false;
        }
      });

    this.homey.flow.getActionCard('turn_off_battery_charging')
      .registerRunListener(async (args) => {
        this.log('Spouštím akci turn_off_battery_charging');
        try {
          await disableForceCharging();
          await this.setCapabilityValue('force_charging', false);
          return true;
        } catch (error) {
          this.error('Chyba při spouštění akce turn_off_battery_charging:', error);
          return false;
        }
      });

    this.homey.flow.getActionCard('block_battery_discharge')
      .registerRunListener(async (args) => {
        this.log('Spouštím akci block_battery_discharge');
        try {
          await enableBlockBatteryDischarge();
          await this.setCapabilityValue('block_battery_discharge', true);
          return true;
        } catch (error) {
          this.error('Chyba při spouštění akce block_battery_discharge:', error);
          return false;
        }
      });

    this.homey.flow.getActionCard('enable_battery_discharge')
      .registerRunListener(async (args) => {
        this.log('Spouštím akci enable_battery_discharge');
        try {
          await disableBlockBatteryDischarge();
          await this.setCapabilityValue('block_battery_discharge', false);
          return true;
        } catch (error) {
          this.error('Chyba při spouštění akce enable_battery_discharge:', error);
          return false;
        }
      });

    this.log('Flow karty byly úspěšně nastaveny');
  }

  async onDeleted() {
    this.log('Zařízení bylo odstraněno, provádím čištění');
    if (this.dataFetchInterval) {
      this.log('Ruším interval načítání dat');
      this.homey.clearInterval(this.dataFetchInterval);
    }
    this.log('Čištění bylo dokončeno');
  }
}

module.exports = SunberryDevice;
