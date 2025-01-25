'use strict';

const Logger = require('../../lib/Logger');
const axios = require('axios');
const DataValidator = require('../../lib/DataValidator');
const CookieManager = require('../../lib/CookieManager');

// Konstanty pro API endpointy
const API_ENDPOINTS = {
    GRID_VALUES: '/grid/values',
    BATTERY_VALUES: '/battery/values',
    BATTERY_MANAGEMENT: '/battery_management/timers'
};

// Konstanty pro typy operací - přehlednější logování
const OPERATION_TYPES = {
    FETCH_GRID: {
        id: 'FETCH_GRID',
        description: 'Načítání hodnot sítě'
    },
    FETCH_BATTERY: {
        id: 'FETCH_BATTERY',
        description: 'Načítání hodnot baterie'
    },
    ENABLE_CHARGING: {
        id: 'ENABLE_CHARGING',
        description: 'Povolení vynuceného nabíjení'
    },
    DISABLE_CHARGING: {
        id: 'DISABLE_CHARGING',
        description: 'Vypnutí vynuceného nabíjení'
    },
    BLOCK_DISCHARGE: {
        id: 'BLOCK_DISCHARGE',
        description: 'Blokování vybíjení baterie'
    },
    ENABLE_DISCHARGE: {
        id: 'ENABLE_DISCHARGE',
        description: 'Povolení vybíjení baterie'
    }
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
        this.cookieManager = new CookieManager(null);
        this.headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Cache-Control': 'max-age=0', 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0',
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
            
            this.cookieManager.logger = this.logger;
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
     * Obecná funkce pro API požadavky s vylepšeným logováním
     * @private
     */
    async apiRequest({ method, endpoint, payload, operationType }) {
        const url = `${this.baseUrl}${endpoint}`;
        const maxRetries = 3;
        let attempt = 0;
 
        while (attempt < maxRetries) {
            try {
                const cookie = await this.cookieManager.getCookie(this.baseUrl);
                const headers = {
                    ...this.headers,
                    'Origin': this.baseUrl,
                    'Referer': `${this.baseUrl}/battery_management/settings`,
                    'Cookie': `session=${cookie}`
                };
 
                const config = {
                    method,
                    url,
                    headers,
                    timeout: 10000,
                    maxRedirects: 0,
                    validateStatus: function(status) {
                        return status === 200 || status === 302;
                    }
                };
 
                if (payload) {
                    const formData = new URLSearchParams();
                    Object.entries(payload).forEach(([key, value]) => {
                        formData.append(key, value);
                    });
                    config.data = formData.toString();
                }
 
                const response = await axios(config);
                
                if (response.status === 200 || response.status === 302) {
                    return { success: true, data: response.data };
                }
                throw new Error(`HTTP ${response.status}`);
 
            } catch (error) {
                this.logger.error(`${operationType.description} - pokus ${attempt + 1} selhal:`, error);
                
                if (error.response?.status === 500) {
                    this.cookieManager.clearCookie();
                }
 
                if (attempt === maxRetries - 1) {
                    return { success: false, error: error.message };
                }
 
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                attempt++;
            }
        }
    }

    /**
     * Sanitizace payloadu pro bezpečné logování
     * @private
     */
    #sanitizePayload(payload) {
        const sanitized = { ...payload };
        // Odstranění citlivých údajů
        delete sanitized.Cookie;
        return sanitized;
    }

    /**
     * Získání hodnot ze sítě
     */
    async getGridValues() {
        this.ensureLogger();
        
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.GRID_VALUES,
                operationType: OPERATION_TYPES.FETCH_GRID
            });
    
            if (!result.success) {
                this.logger.error('Získání hodnot sítě selhalo');
                return DEFAULT_VALUES.GRID;
            }
    
            const values = this.parseGridHtml(result.data);
            
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

    /**
     * Získání hodnot z baterie
     */
    async getBatteryValues() {
        this.ensureLogger();
        
        try {
            const result = await this.apiRequest({
                endpoint: API_ENDPOINTS.BATTERY_VALUES,
                operationType: OPERATION_TYPES.FETCH_BATTERY
            });
    
            if (!result.success) {
                this.logger.error('Získání hodnot baterie selhalo');
                return DEFAULT_VALUES.BATTERY;
            }
    
            const values = this.parseBatteryHtml(result.data);
            
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

    /**
     * Povolení vynuceného nabíjení
     */
    async enableForceCharging(limit) {
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
            operationType: {
                ...OPERATION_TYPES.ENABLE_CHARGING,
                description: `${OPERATION_TYPES.ENABLE_CHARGING.description} s limitem ${limit}W`
            }
        });
    }

    /**
     * Vypnutí vynuceného nabíjení
     */
    async disableForceCharging() {
        const payload = {
            start_0: '00:00',
            stop_0: '23:59',
            force_chg_power_0: this.lastForceChargingLimit?.toString() || '7000',
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
            operationType: OPERATION_TYPES.DISABLE_CHARGING
        });
    }

    /**
     * Blokování vybíjení baterie
     */
    async blockBatteryDischarge() {
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
            operationType: OPERATION_TYPES.BLOCK_DISCHARGE
        });
     }

    /**
     * Povolení vybíjení baterie
     */
    async enableBatteryDischarge() {
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
            operationType: OPERATION_TYPES.ENABLE_DISCHARGE
        });
     }

    /**
     * Parsování HTML s hodnotami sítě
     * @private
     */
    parseGridHtml(gridHtml) {
        const parseValue = (matchResult) => {
            if (!matchResult) return null;
            const value = matchResult[1];
            if (value.includes('<')) return 0;
            return parseInt(value, 10);
        };
    
        const L1Match = gridHtml.match(/L1:\s*<\/label>\s*<label[^>]*>\s*([^W]*)\s*W/);
        const L2Match = gridHtml.match(/L2:\s*<\/label>\s*<label[^>]*>\s*([^W]*)\s*W/);
        const L3Match = gridHtml.match(/L3:\s*<\/label>\s*<label[^>]*>\s*([^W]*)\s*W/);
        const totalMatch = gridHtml.match(/Celkem:\s*<\/label>\s*<label[^>]*>\s*([^W]*)\s*W/);
    
        this.logger.debug('Parsované hodnoty sítě:', {
            L1: L1Match ? L1Match[1] : null,
            L2: L2Match ? L2Match[1] : null,
            L3: L3Match ? L3Match[1] : null,
            total: totalMatch ? totalMatch[1] : null
        });
    
        return {
            L1: parseValue(L1Match),
            L2: parseValue(L2Match),
            L3: parseValue(L3Match),
            Total: parseValue(totalMatch)
        };
    }

    /**
     * Parsování HTML s hodnotami baterie
     * @private
     */
    parseBatteryHtml(batteryHtml) {
        const kWhMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*Wh<\/label>/);
        const percentMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*%\s*<\/label>/);
        const maxChargingMatch = batteryHtml.match(/Max nabíjení:[^>]*>[\s\S]*?<label[^>]*>\s*(\d+)\s*W<\/label>/);
    
        this.logger.debug('Parsování baterie - matches:', {
            kWh: kWhMatch ? kWhMatch[1] : null,
            percent: percentMatch ? percentMatch[1] : null,
            maxCharging: maxChargingMatch ? maxChargingMatch[1] : null
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