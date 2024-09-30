'use strict';

const Homey = require('homey');
const api = require('./api');

class SunberryDevice extends Homey.Device {

  async onInit() {
    this.log('Sunberry device has been initialized');

    // Připojení k API
    this.api = api;

    // Získání hodnot ze settings nebo nastavení výchozích hodnot
    const updateInterval = this.getSetting('update_interval') || 5;

    this.log('Update interval:', updateInterval);

    // Definice schopností (capabilities)
    const capabilities = [
      'measure_L1', 'measure_L2', 'measure_L3', 'measure_total',
      'force_charging', 'block_battery_discharge'
    ];

    // Přidání schopností, pokud ještě nejsou přidány
    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    // Registrace Flow karet
    this.setupFlowCards();

    // Nastavení intervalu pro získávání dat
    this.startDataFetchInterval(updateInterval);

    // Volání API pro aktualizaci hodnot
    await this.fetchAndUpdateGridValues();

    // Nastavení zařízení jako dostupného
    this.setAvailable();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Sunberry device settings were changed');
    this.log('Old Settings:', oldSettings);
    this.log('New Settings:', newSettings);
    this.log('Changed Keys:', changedKeys);

    // Změna intervalu pro získávání dat, pokud byl update_interval změněn
    if (changedKeys.includes('update_interval')) {
      this.startDataFetchInterval(newSettings.update_interval);
      this.log('Data fetch interval updated to:', newSettings.update_interval);
    }

    // Znovu načte data z API
    await this.fetchAndUpdateGridValues();
  }

  async fetchAndUpdateGridValues() {
    try {
      this.log('Fetching and updating grid values...');
      const values = await this.api.getGridValues();

      await this.setCapabilityValue('measure_L1', values.L1);
      await this.setCapabilityValue('measure_L2', values.L2);
      await this.setCapabilityValue('measure_L3', values.L3);
      await this.setCapabilityValue('measure_total', values.Total);

      this.log('Grid values updated successfully.');
    } catch (error) {
      this.error(`Error fetching grid values: ${error}`);
      this.setUnavailable(`Error fetching data (${error})`);
    }
  }

  async onDeleted() {
    this.log('Sunberry device deleted');
    if (this.dataFetchInterval) {
      this.homey.clearInterval(this.dataFetchInterval);
    }
  }

  setupFlowCards() {
    this.homey.flow.getConditionCard('is_force_charging')
      .registerRunListener(async (args, state) => {
        const forceCharging = await this.getCapabilityValue('force_charging');
        return forceCharging === true;
      });
  
    this.homey.flow.getConditionCard('is_battery_discharge_blocked')
      .registerRunListener(async (args, state) => {
        const blockDischarge = await this.getCapabilityValue('block_battery_discharge');
        return blockDischarge === true;
      });
  }
  

  startDataFetchInterval(interval) {
    if (this.dataFetchInterval) {
      this.homey.clearInterval(this.dataFetchInterval);
    }

    this.dataFetchInterval = this.homey.setInterval(async () => {
      await this.fetchAndUpdateGridValues();
    }, interval * 60 * 1000); // Interval v minutách
  }
}

module.exports = SunberryDevice;
