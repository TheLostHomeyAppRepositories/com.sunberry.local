'use strict';

const Homey = require('homey');
const crypto = require('crypto');

class SunberryDriver extends Homey.Driver {

  async onInit() {
    this.log('SunberryDriver has been initialized');

    // Registrace Flow karet
    this.registerFlowCards();
  }

  registerFlowCards() {
    this._registerConditionFlowCards();
    this._registerActionFlowCards();
  }

  _registerConditionFlowCards() {
    this.log('Registering condition Flow cards...');
    try {
      this.homey.flow.getConditionCard('is_force_charging')
        .registerRunListener(async (args, state) => {
          const device = state.device;
          const forceCharging = await device.getCapabilityValue('force_charging');
          return forceCharging === true;
        });

      this.homey.flow.getConditionCard('is_battery_discharge_blocked')
        .registerRunListener(async (args, state) => {
          const device = state.device;
          const blockDischarge = await device.getCapabilityValue('block_battery_discharge');
          return blockDischarge === true;
        });

      this.log('Condition Flow cards registered successfully.');
    } catch (error) {
      this.log('Error registering condition Flow cards:', error);
    }
  }

  _registerActionFlowCards() {
    this.log('Registering action Flow cards...');
    try {
      this.homey.flow.getActionCard('turn_on_battery_charging')
        .registerRunListener(async (args, state) => {
          const devices = this.getDevices();
          const promises = Object.values(devices).map(device => device.fetchAndUpdateGridValues());
          await Promise.all(promises);
          return true;
        });

      this.homey.flow.getActionCard('turn_off_battery_charging')
        .registerRunListener(async (args, state) => {
          const devices = this.getDevices();
          const promises = Object.values(devices).map(device => device.fetchAndUpdateGridValues());
          await Promise.all(promises);
          return true;
        });

      this.homey.flow.getActionCard('block_battery_discharge')
        .registerRunListener(async (args, state) => {
          const devices = this.getDevices();
          const promises = Object.values(devices).map(device => device.fetchAndUpdateGridValues());
          await Promise.all(promises);
          return true;
        });

      this.homey.flow.getActionCard('enable_battery_discharge')
        .registerRunListener(async (args, state) => {
          const devices = this.getDevices();
          const promises = Object.values(devices).map(device => device.fetchAndUpdateGridValues());
          await Promise.all(promises);
          return true;
        });

      this.log('Action Flow cards registered successfully.');
    } catch (error) {
      this.log('Error registering action Flow cards:', error);
    }
  }

  async onPairListDevices() {
    this.log("onPairListDevices called");
    try {
      const deviceId = crypto.randomUUID();
      const deviceName = 'Sunberry Device';

      this.log(`Device found: Name - ${deviceName}, ID - ${deviceId}`);
      return [{ name: deviceName, data: { id: deviceId } }];
      
    } catch (error) {
      this.log("Error during pairing:", error);
      throw error;
    }
  }
}

module.exports = SunberryDriver;
