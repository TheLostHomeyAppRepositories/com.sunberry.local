'use strict';

const baseUrl = 'http://sunberry.local';

async function getGridValues() {
  try {
    const response = await fetch(`${baseUrl}/grid/values`);
    if (!response.ok) {
      throw new Error('Failed to fetch grid values');
    }

    const gridHtml = await response.text();
    const L1Match = gridHtml.match(/L1:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const L2Match = gridHtml.match(/L2:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const L3Match = gridHtml.match(/L3:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const totalMatch = gridHtml.match(/Celkem:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);

    return {
      L1: L1Match ? parseInt(L1Match[1], 10) : null,
      L2: L2Match ? parseInt(L2Match[1], 10) : null,
      L3: L3Match ? parseInt(L3Match[1], 10) : null,
      Total: totalMatch ? parseInt(totalMatch[1], 10) : null
    };
  } catch (error) {
    console.error("Error fetching grid values:", error);
    return null;
  }
}

async function enableForceCharging(limit) {
  const payload = new URLSearchParams({
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
  });

  return sendPostRequest('/battery_management/timers', payload, 'Nucené nabíjení baterie');
}

async function disableForceCharging() {
  const payload = new URLSearchParams({
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
  });

  return sendPostRequest('/battery_management/timers', payload, 'Vypnutí nuceného nabíjení');
}

async function enableBlockBatteryDischarge() {
  const payload = new URLSearchParams({
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
  });

  return sendPostRequest('/battery_management/timers', payload, 'Blokování vybíjení baterie');
}

async function disableBlockBatteryDischarge() {
  const payload = new URLSearchParams({
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
  });

  return sendPostRequest('/battery_management/timers', payload, 'Vypnutí blokování vybíjení baterie');
}

async function sendPostRequest(path, payload, actionDescription) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });

    if (response.ok) {
      console.log(`${actionDescription} úspěšné.`);
    } else {
      console.error(`${actionDescription} neúspěšné.`);
    }
  } catch (error) {
    console.error(`${actionDescription} se nezdařilo:`, error);
  }
}

module.exports = {
  getGridValues,
  enableForceCharging,
  disableForceCharging,
  enableBlockBatteryDischarge,
  disableBlockBatteryDischarge
};
