'use strict';

// Import loggeru
const Logger = require('/app/lib/Logger');

let logger; // Globální logger pro API

// Inicializace loggeru
function initializeLogger(homey) {
    if (!homey) {
        throw new Error('Homey instance is required to initialize the logger.');
    }

    if (!homey.appLogger) {
        logger = new Logger(homey, 'FallbackLogger');
        homey.appLogger = logger; // Nastavení globální instance
        logger.info('FallbackLogger byl inicializován jako globální logger.');
    } else {
        logger = homey.appLogger;
        logger.info('Globální logger byl úspěšně inicializován pro API.');
    }
}

function ensureLogger() {
    if (!logger) {
        throw new Error('Logger has not been initialized. Call initializeLogger(homey) first.');
    }
}

// Globální URL pro API
let baseUrl = 'http://sunberry.local';

// Nastavení základní URL
function setBaseUrl(ipAddress) {
    ensureLogger();
    if (!ipAddress) {
        logError('Invalid IP address provided');
        return;
    }
    baseUrl = `http://${ipAddress}`;
    logger.info('API baseUrl set to:', { baseUrl });
}

function getBaseUrl() {
    ensureLogger();
    return baseUrl;
}

// Všeobecná funkce pro API requesty
async function apiRequest({ method = 'GET', endpoint, payload = null, actionDescription }) {
    ensureLogger();
    const url = `${baseUrl}${endpoint}`;
    try {
        logger.debug(`Making ${method} request to:`, { url, payload });
        const options = {
            method,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        };
        if (payload) options.body = new URLSearchParams(payload);

        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            logWarning(`${actionDescription} failed`, {
                status: response.status,
                statusText: response.statusText,
                errorText,
            });
            return { success: false, data: null };
        }

        const data = await response.text();
        logger.debug(`${actionDescription} response received:`, { data });
        return { success: true, data };
    } catch (error) {
        logError(`${actionDescription} encountered an error`, error);
        return { success: false, data: null };
    }
}

// Funkce pro načítání hodnot sítě
async function getGridValues() {
    ensureLogger();
    const defaultValues = { L1: null, L2: null, L3: null, Total: null };
    const result = await apiRequest({
        endpoint: '/grid/values',
        actionDescription: 'Fetching grid values',
    });

    if (!result.success) return defaultValues;

    const gridHtml = result.data;
    const values = parseGridHtml(gridHtml, defaultValues);
    logger.info('Parsed grid values:', values);
    return values;
}

// Funkce pro načítání hodnot baterie
async function getBatteryValues() {
    ensureLogger();
    const result = await apiRequest({
        endpoint: '/battery/values',
        actionDescription: 'Fetching battery values',
    });

    if (!result.success) return { actual_kWh: null, actual_percent: null };

    const batteryHtml = result.data;
    const values = parseBatteryHtml(batteryHtml);
    logger.info('Parsed battery values:', values);
    return values;
}

// Funkce pro povolení nabíjení
async function enableForceCharging(limit) {
    ensureLogger();
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
    return await apiRequest({
        method: 'POST',
        endpoint: '/battery_management/timers',
        payload,
        actionDescription: 'Enabling force charging',
    });
}

// Funkce pro zakázání nabíjení
async function disableForceCharging() {
    ensureLogger();
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
    return await apiRequest({
        method: 'POST',
        endpoint: '/battery_management/timers',
        payload,
        actionDescription: 'Disabling force charging',
    });
}

// Parsování HTML pro síťové hodnoty
function parseGridHtml(gridHtml, defaultValues) {
    const L1Match = gridHtml.match(/L1:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
    const L2Match = gridHtml.match(/L2:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
    const L3Match = gridHtml.match(/L3:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);
    const totalMatch = gridHtml.match(/Celkem:\s*<\/label>\s*<label[^>]*>\s*(-?\d+)\s*W/);

    return {
        L1: L1Match ? parseInt(L1Match[1], 10) : defaultValues.L1,
        L2: L2Match ? parseInt(L2Match[1], 10) : defaultValues.L2,
        L3: L3Match ? parseInt(L3Match[1], 10) : defaultValues.L3,
        Total: totalMatch ? parseInt(totalMatch[1], 10) : defaultValues.Total
    };
}

function parseBatteryHtml(batteryHtml) {
    const kWhMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*Wh<\/label>/);
    const percentMatch = batteryHtml.match(/<label[^>]*>\s*(\d+)\s*%\s*<\/label>/);

    return {
        actual_kWh: kWhMatch ? parseInt(kWhMatch[1], 10) / 1000 : null,
        actual_percent: percentMatch ? parseInt(percentMatch[1], 10) : null
    };
}

// Logovací funkce
function logError(message, error = null) {
    ensureLogger();
    logger.error(message, error);
}

function logWarning(message, details = {}) {
    ensureLogger();
    logger.warn(message, details);
}

module.exports = {
    initializeLogger,
    setBaseUrl,
    getBaseUrl,
    getGridValues,
    getBatteryValues,
    enableForceCharging,
    disableForceCharging
};
