'use strict';

class DataValidator {
    static validateCapabilityValue(capability, value) {
        if (typeof value !== 'number' || isNaN(value)) {
            return false;
        }

        switch(capability) {
            case 'measure_battery_percent':
                return value >= 0 && value <= 100;
            case 'measure_battery_kWh':
            case 'remaining_kWh_to_full':
                return value >= 0;
            case 'measure_L1':
            case 'measure_L2':
            case 'measure_L3':
            case 'measure_total':
            case 'battery_max_charging_power':
                return true;
            default:
                return false;
        }
    }

    static validateIPAddress(ip) {
        if (!ip) return false;
        if (ip === 'sunberry.local') return true;

        const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipPattern.test(ip);
    }

    static validateInterval(interval, minInterval = 5) {
        return typeof interval === 'number' && 
               !isNaN(interval) && 
               interval >= minInterval;
    }

    static validateChargingLimit(limit, maxChargingPower) {
        // Přidáme detailnější kontrolu a logování
        if (typeof limit !== 'number' || isNaN(limit)) {
            console.log('Limit není číslo:', limit);
            return false;
        }
        
        // Minimální hodnota je vždy 100W
        if (limit < 100) {
            console.log('Limit je pod minimální hodnotou 100W:', limit);
            return false;
        }
    
        // Pokud máme maxChargingPower, použijeme ho jako horní limit
        if (typeof maxChargingPower === 'number' && !isNaN(maxChargingPower)) {
            if (limit > maxChargingPower) {
                console.log(`Limit ${limit}W přesahuje maximální povolený výkon ${maxChargingPower}W`);
                return false;
            }
        } else {
            // Fallback na 10000W pokud nemáme maxChargingPower
            if (limit > 10000) {
                console.log('Limit přesahuje maximální hodnotu 10000W:', limit);
                return false;
            }
        }
        
        return true;
    }

    static validateGridValues(values) {
        return values && typeof values === 'object' &&
               typeof values.L1 === 'number' && 
               typeof values.L2 === 'number' &&
               typeof values.L3 === 'number' &&
               typeof values.Total === 'number';
    }

    static validateBatteryValues(values) {
        return values && typeof values === 'object' &&
               typeof values.actual_kWh === 'number' &&
               typeof values.actual_percent === 'number' &&
               typeof values.max_charging_power === 'number';
    }

    // Z FlowCardManager.js
    static validateFlowTriggerArgs(args) {
        if (!args) return false;
        
        const { power, battery_level, target_level } = args;
        
        if (power !== undefined) {
            return typeof power === 'number' && !isNaN(power);
        }
        
        if (battery_level !== undefined && target_level !== undefined) {
            return typeof battery_level === 'number' && 
                   typeof target_level === 'number' &&
                   !isNaN(battery_level) &&
                   !isNaN(target_level) &&
                   target_level >= 0 &&
                   target_level <= 100;
        }
        
        return false;
    }

    // Z pair.html - validace hostname
    static validateHostname(hostname) {
        if (!hostname) return false;
        if (hostname === 'sunberry.local') return true;
        
        const hostnamePattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return hostnamePattern.test(hostname) && hostname !== 'localhost';
    }

    // Z device.js - validace settings
    static validateSettings(settings) {
        return settings && 
               this.validateInterval(settings.update_interval) &&
               this.validateIPAddress(settings.ip_address) &&
               this.validateChargingLimit(settings.force_charging_limit) &&
               typeof settings.enable_debug_logs === 'boolean';
    }
}

module.exports = DataValidator;