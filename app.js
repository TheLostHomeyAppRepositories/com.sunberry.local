'use strict';

const Homey = require('homey');
const Logger = require('./lib/Logger');

class SunberryApp extends Homey.App {

async onInit() {
    // Kontrola existence globálního loggeru
    if (!this.homey.appLogger) {
        this.logger = new Logger(this.homey, 'SunberryApp');
        this.logger.setEnabled(true);

        // Nastavení centrální instance loggeru
        this.homey.appLogger = this.logger;
        this.logger.info('SunberryApp has been initialized');
    } else {
        this.logger = this.homey.appLogger;
        this.logger.info('Globální logger již existuje, používám existující instanci.');
    }

    this.initializeGlobalListeners();
}

  initializeGlobalListeners() {
    this.logger.info('Initializing global listeners');

    // Example: Listening for uncaught exceptions
    this.homey.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception occurred:', error);
    });

    this.logger.info('Global listeners have been initialized');
  }

  async handleSomeEvent(data) {
    this.logger.info('Handling some event', { data });
    // Add event handling logic here
  }

  async someRecurringTask() {
    this.logger.info('Running a recurring task');
    // Add recurring task logic here
  }

  getLogger() {
    return this.homey.appLogger;
  }
}

module.exports = SunberryApp;
