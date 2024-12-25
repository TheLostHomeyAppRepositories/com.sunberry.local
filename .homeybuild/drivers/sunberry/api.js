'use strict';

const Logger = require('../../lib/Logger');
const axios = require('axios');
const DataValidator = require('../../lib/DataValidator');

// Konstanty pro API endpointy
const API_ENDPOINTS = {
    GRID_VALUES: '/grid/values',
    BATTERY_VALUES: '/battery/values',
    BATTERY_MANAGEMENT: '/battery_management/timers'
};

// Konstanty pro výchozí hodnoty
const DEFAULT_VALUES = {
    GRID: { L1: null, L2: null, L3: null, Total: null },
    BATTERY: { actual_kWh: null, actual_percent: null }
};

class SunberryAPI {
    constructor() {
        this.initialized = false;
        this.logger = null;
        this.baseUrl = 'http://sunberry.local';
        this.headers = {
            'Cookie': 'session=eyJub190aW1lcnMiOjF9.Z2fqdQ.NapJY5pCs3H_O87I0TCbH6xFLfw',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8'
        };
    }

    /**
     * Inicializace loggeru
     * @param {Object} homey - Instance Homey
     */
    async initializeLogger(homey) {
        if (!homey) {
            throw new Error('Homey instance is required to initialize the logger.');
        }

        try {
            if (!homey.appLogger) {
                this.logger = new Logger(homey, 'SunberryAPI');
                homey.appLogger = this.logger;
            } else {
                this.logger = homey.appLogger;
            }

            this.initialized = true;
            this.logger.info('SunberryAPI byla inicializována');
            
            // Debug log pro kontrolu
            this.logger.debug('Headers:', this.headers);
            this.logger.debug('BaseUrl:', this.baseUrl);
            
        } catch (error) {
            throw new Error(`Failed to initialize logger: ${error.message}`);
        }
    }

    /**
     * Kontrola inicializace loggeru
     * @private
     */
    ensureLogger() {
        if (!this.initialized || !this.logger) {
            throw new Error('SunberryAPI není inicializována. Zavolejte nejdříve initializeLogger(homey).');
        }
    }

    /**
     * Nastavení základní URL a headers
     * @param {string} ipAddress - IP adresa nebo hostname
     */
    async setBaseUrl(ipAddress) {
        this.ensureLogger();
        try {
            if (!DataValidator.validateIPAddress(ipAddress)) {
                throw new Error('Invalid IP address provided');
            }
            
            this.baseUrl = `http://${ipAddress}`;
            this.headers.Origin = this.baseUrl;
            this.headers.Referer = `${this.baseUrl}/battery_management/settings`;

            this.logger.info('API baseUrl nastavena:', { baseUrl: this.baseUrl });
            this.logger.debug('Aktualizované headers:', this.headers);
        } catch (error) {
            this.logger.error('Chyba při nastavení baseUrl:', error);
            throw error;
        }
    }

    /**
     * Obecná funkce pro API požadavky
     * @private
     */
    async apiRequest({ method = 'GET', endpoint, payload = null, actionDescription }) {
        this.ensureLogger();
        const url = `${this.baseUrl}${endpoint}`;
        const maxRetries = 3;
        let attempt = 0;
    
        while (attempt < maxRetries) {
            try {
                this.logger.debug(`API Request [${method}]:`, { 
                    url, 
                    payload,
                    attempt: attempt + 1,
                    maxRetries
                });
    
                const config = {
                    method,
                    url,
                    timeout: 10000,
                    headers: this.headers,
                    validateStatus: status => status === 200 || status === 302,
                    maxRedirects: 0
                };
    
                if (payload) {
                    const formData = new URLSearchParams();
                    for (const [key, value] of Object.entries(payload)) {
                        formData.append(key, value);
                    }
                    config.data = formData.toString();
                }
    
                const startTime = Date.now();
                const response = await axios(config);
                const duration = Date.now() - startTime;
    
                if (response.status !== 200 && response.status !== 302) {
                    throw new Error(`HTTP ${response.status}`);
                }
    
                const data = response.data;
                this.logger.debug(`${actionDescription} - odpověď přijata:`, { 
                    status: response.status,
                    duration,
                    dataLength: typeof data === 'string' ? data.length : JSON.stringify(data).length
                });
    
                return { success: true, data };
            } catch (error) {
                this.logger.error(`${actionDescription} - pokus ${attempt + 1} selhal:`, {
                    message: error.message,
                    code: error.code,
                    response: error.response?.status,
                    config: error.config
                });
    
                if (attempt === maxRetries - 1) {
                    this.logger.error(`${actionDescription} - všechny pokusy selhaly`, error);
                    return { success: false, data: null, error: error.message };
                }
    
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                attempt++;
            }
        }
    }

    async getGridValues() {
        this.ensureLogger();
        this.logger.debug('Načítání hodnot sítě začíná');
        
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.GRID_VALUES,
                actionDescription: 'Načítání hodnot sítě'
            });
    
            if (!result.success) {
                this.logger.error('Získání hodnot sítě selhalo');
                return DEFAULT_VALUES.GRID;
            }
    
            const values = this.parseGridHtml(result.data);
            this.logger.debug('Získané hodnoty sítě:', values);
    
            if (!DataValidator.validateGridValues(values)) {
                this.logger.error('Získané hodnoty sítě nejsou validní:', values);
                return DEFAULT_VALUES.GRID;
            }
    
            return values;
        } catch (error) {
            this.logger.error('Chyba při získávání hodnot sítě:', error);
            return DEFAULT_VALUES.GRID;
        }
    }

    async getBatteryValues() {
        this.ensureLogger();
        this.logger.debug('Načítání hodnot baterie začíná');
        
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.BATTERY_VALUES,
                actionDescription: 'Načítání hodnot baterie'
            });
    
            if (!result.success) {
                this.logger.error('Získání hodnot baterie selhalo');
                return DEFAULT_VALUES.BATTERY;
            }
    
            const values = this.parseBatteryHtml(result.data);
            this.logger.debug('Získané hodnoty baterie:', values);
    
            if (!DataValidator.validateBatteryValues(values)) {
                this.logger.error('Získané hodnoty baterie nejsou validní:', values);
                return DEFAULT_VALUES.BATTERY;
            }
    
            return values;
        } catch (error) {
            this.logger.error('Chyba při získávání hodnot baterie:', error);
            return DEFAULT_VALUES.BATTERY;
        }
    }

    async enableForceCharging(limit) {
        this.ensureLogger();
        if (!DataValidator.validateChargingLimit(limit)) {
            throw new Error('Neplatný limit pro nabíjení');
        }

        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            force_chg_enable_0: 'on',
            force_chg_power_0: limit.toString(),
            Mon_0: 'Mon_0',
            Tue_0: 'Tue_0',
            Wed_0: 'Wed_0',
            Thu_0: 'Thu_0',
            Fri_0: 'Fri_0',
            Sat_0: 'Sat_0',
            Sun_0: 'Sun_0',
            submit: ''
        };

        return await this.apiRequest({
            method: 'POST',
            endpoint: API_ENDPOINTS.BATTERY_MANAGEMENT,
            payload,
            actionDescription: 'Povolení vynuceného nabíjení'
        });
    }

    async disableForceCharging() {
        this.ensureLogger();
        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            force_chg_power_0: '100',
            bat_chg_limit_power_0: '0',
            Mon_0: 'Mon_0',
            Tue_0: 'Tue_0',
            Wed_0: 'Wed_0',
            Thu_0: 'Thu_0',
            Fri_0: 'Fri_0',
            Sat_0: 'Sat_0',
            Sun_0: 'Sun_0',
            submit: ''
        };

        return await this.apiRequest({
            method: 'POST',
            endpoint: API_ENDPOINTS.BATTERY_MANAGEMENT,
            payload,
            actionDescription: 'Zakázání vynuceného nabíjení'
        });
    }

    async blockBatteryDischarge() {
        this.ensureLogger();
        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            bat_chg_limit_power_0: '0',
            block_bat_dis_0: 'on',
            Mon_0: 'Mon_0',
            Tue_0: 'Tue_0',
            Wed_0: 'Wed_0',
            Thu_0: 'Thu_0',
            Fri_0: 'Fri_0',
            Sat_0: 'Sat_0',
            Sun_0: 'Sun_0',
            submit: ''
        };

        return await this.apiRequest({
            method: 'POST',
            endpoint: API_ENDPOINTS.BATTERY_MANAGEMENT,
            payload,
            actionDescription: 'Povolení blokování vybíjení baterie'
        });
    }

    async enableBatteryDischarge() {
        this.ensureLogger();
        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            force_chg_power_0: '100',
            bat_chg_limit_power_0: '0',
            Mon_0: 'Mon_0',
            Tue_0: 'Tue_0',
            Wed_0: 'Wed_0',
            Thu_0: 'Thu_0',
            Fri_0: 'Fri_0',
            Sat_0: 'Sat_0',
            Sun_0: 'Sun_0',
            submit: ''
        };

        return await this.apiRequest({
            method: 'POST',
            endpoint: API_ENDPOINTS.BATTERY_MANAGEMENT,
            payload,
            actionDescription: 'Zakázání blokování vybíjení baterie'
        });
    }

    parseGridHtml(gridHtml) {
        const L1Match = gridHtml.match(/L1:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
        const L2Match = gridHtml.match(/L2:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
        const L3Match = gridHtml.match(/L3:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
        const totalMatch = gridHtml.match(/Celkem:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);

        return {
            L1: L1Match ? parseInt(L1Match[1], 10) : null,
            L2: L2Match ? parseInt(L2Match[1], 10) : null,
            L3: L3Match ? parseInt(L3Match[1], 10) : null,
            Total: totalMatch ? parseInt(totalMatch[1], 10) : null
        };
    }

    parseBatteryHtml(batteryHtml) {
        const kWhMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*Wh<\/label>/);
        const percentMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*%\s*<\/label>/);
        const maxChargingMatch = batteryHtml.match(/Max nabíjení:[^>]*>[\s\S]*?<label[^>]*>\s*(\d+)\s*W<\/label>/);
    
        this.logger.debug('Parsing battery HTML matches:', {
            kWhMatch: kWhMatch ? kWhMatch[1] : null,
            percentMatch: percentMatch ? percentMatch[1] : null,
            maxChargingMatch: maxChargingMatch ? maxChargingMatch[1] : null
        });
    
        const actual_kWh = kWhMatch ? parseInt(kWhMatch[1], 10) / 1000 : null;
        const actual_percent = percentMatch ? parseInt(percentMatch[1], 10) : null;
        const max_charging_power = maxChargingMatch ? parseInt(maxChargingMatch[1], 10) : null;
    
        return {
            actual_kWh: actual_kWh || 0,
            actual_percent: actual_percent || 0,
            max_charging_power: max_charging_power || 0
        };
    }
}

// Vytvoření instance API
const sunberryAPI = new SunberryAPI();

module.exports = sunberryAPI;