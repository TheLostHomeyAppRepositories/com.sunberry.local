'use strict';

const Logger = require('../../lib/Logger');
const axios = require('axios');

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
        this.logger = null;
        this.baseUrl = 'http://sunberry.local';
        this.headers = null;
    }

    /**
     * Inicializace loggeru
     * @param {Object} homey - Instance Homey
     * @throws {Error} Pokud není poskytnuta instance Homey
     */
    initializeLogger(homey) {
        if (!homey) {
            throw new Error('Homey instance is required to initialize the logger.');
        }

        try {
            if (!homey.appLogger) {
                this.logger = new Logger(homey, 'SunberryAPI');
                homey.appLogger = this.logger;
                this.logger.info('SunberryAPI logger byl inicializován');
            } else {
                this.logger = homey.appLogger;
                this.logger.info('Používám existující logger pro SunberryAPI');
            }
        } catch (error) {
            throw new Error(`Failed to initialize logger: ${error.message}`);
        }
    }

    /**
     * Kontrola inicializace loggeru
     * @private
     */
    ensureLogger() {
        if (!this.logger) {
            throw new Error('Logger není inicializován. Nejdříve zavolejte initializeLogger(homey).');
        }
    }

    /**
     * Nastavení základní URL a headers
     * @param {string} ipAddress - IP adresa nebo hostname
     */
    setBaseUrl(ipAddress) {
        this.ensureLogger();
        if (!ipAddress) {
            this.logger.error('Nebyla poskytnuta platná IP adresa');
            throw new Error('Invalid IP address provided');
        }
        
        this.baseUrl = `http://${ipAddress}`;
        
        // Nastavení headers s aktuální IP adresou
        this.headers = {
            'Cookie': 'session=eyJub190aW1lcnMiOjF9.Z2fqdQ.NapJY5pCs3H_O87I0TCbH6xFLfw',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache',
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
            'Origin': this.baseUrl,
            'Referer': `${this.baseUrl}/battery_management/settings`
        };

        this.logger.info('API baseUrl a headers nastaveny na:', { 
            baseUrl: this.baseUrl
        });
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
                this.logger.debug(`Pokus ${attempt + 1}/${maxRetries} - Odesílám ${method} požadavek na:`, { url, payload });
    
                const config = {
                    method,
                    url,
                    timeout: 10000,
                    headers: this.headers,
                    validateStatus: function (status) {
                        // Považujeme 200 a 302 za úspěšné stavové kódy
                        return status === 200 || status === 302;
                    },
                    maxRedirects: 0
                };
    
                if (payload) {
                    const formData = new URLSearchParams();
                    for (const [key, value] of Object.entries(payload)) {
                        formData.append(key, value);
                    }
                    config.data = formData.toString();
                }
    
                const response = await axios(config);
    
                // Úspěšná odpověď může být buď 200 nebo 302
                if (response.status !== 200 && response.status !== 302) {
                    throw new Error(`HTTP ${response.status}`);
                }
    
                const data = response.data;
                this.logger.debug(`${actionDescription} - odpověď přijata:`, { 
                    status: response.status,
                    data: data
                });
                return { success: true, data };
            } catch (error) {
                this.logger.warn(`${actionDescription} - pokus ${attempt + 1} selhal:`, {
                    message: error.message,
                    code: error.code,
                    response: error.response?.status
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

    // Všechny ostatní metody zůstávají stejné...
    async getGridValues() {
        this.ensureLogger();
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.GRID_VALUES,
                actionDescription: 'Načítání hodnot sítě'
            });

            if (!result.success) return DEFAULT_VALUES.GRID;

            const values = this.parseGridHtml(result.data);
            return values;
        } catch (error) {
            this.logger.error('Chyba při získávání hodnot sítě:', error);
            return DEFAULT_VALUES.GRID;
        }
    }

    async getBatteryValues() {
        this.ensureLogger();
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.BATTERY_VALUES,
                actionDescription: 'Načítání hodnot baterie'
            });

            if (!result.success) return DEFAULT_VALUES.BATTERY;

            const values = this.parseBatteryHtml(result.data);
            return values;
        } catch (error) {
            this.logger.error('Chyba při získávání hodnot baterie:', error);
            return DEFAULT_VALUES.BATTERY;
        }
    }

    async enableForceCharging(limit) {
        this.ensureLogger();
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

    /**
     * Povolení blokování vybíjení baterie
     */
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

    /**
     * Zakázání blokování vybíjení baterie
     */
    async enableBatteryDischarge() {
        this.ensureLogger();
        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            force_chg_power_0: '100',    // Přidáno podle vašeho payloadu
            bat_chg_limit_power_0: '0',  // Změněno na '0'
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

        // Detailní logging maxChargingMatch
        this.logger.debug('maxChargingMatch výsledek:', {
            fullMatch: maxChargingMatch?.[0],  // celá shoda
            capturedGroup: maxChargingMatch?.[1],  // zachycená hodnota v závorce
            isMatch: !!maxChargingMatch,  // bool zda došlo ke shodě
            matchGroups: maxChargingMatch?.groups,  // případné pojmenované skupiny
            matchLength: maxChargingMatch?.length  // délka pole shod
        });

        return {
            actual_kWh: kWhMatch ? parseInt(kWhMatch[1], 10) / 1000 : null,
            actual_percent: percentMatch ? parseInt(percentMatch[1], 10) : null,
            max_charging_power: maxChargingMatch ? parseInt(maxChargingMatch[1], 10) : null
        };
    }
}

// Vytvoření instance API
const sunberryAPI = new SunberryAPI();

module.exports = sunberryAPI;