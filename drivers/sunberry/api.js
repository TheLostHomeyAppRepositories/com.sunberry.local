'use strict';

// Místo pevné adresy budeme mít proměnnou
let baseUrl = 'http://sunberry.local'; // výchozí hodnota

// Přidáme funkci pro změnu základní URL
function setBaseUrl(ipAddress) {
  if (!ipAddress) {
      console.error('Invalid IP address');
      return;
  }
  baseUrl = `http://${ipAddress}`;
  console.log('API baseUrl set to:', baseUrl);
}

// Přidáme funkci pro získání aktuální baseUrl (pro debugging)
function getBaseUrl() {
    return baseUrl;
}

async function getGridValues() {
  console.log('Fetching grid values from API');
  try {
    console.log('Making request to:', `${baseUrl}/grid/values`);
    const response = await fetch(`${baseUrl}/grid/values`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch grid values: ${response.status} ${response.statusText}`);
    }

    const gridHtml = await response.text();
    console.log('Raw API response:', gridHtml);

    // Přidáme výchozí hodnoty pro případ, že matching selže
    const defaultValues = {
      L1: null,
      L2: null,
      L3: null,
      Total: null
    };

    // Získáme hodnoty s ošetřením null případů
    const L1Match = gridHtml.match(/L1:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const L2Match = gridHtml.match(/L2:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const L3Match = gridHtml.match(/L3:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);
    const totalMatch = gridHtml.match(/Celkem:\s*<\/label>\s*<label[^>]*>\s*(\d+)\s*W/);

    console.log('Regex matches:', {
      L1: L1Match ? L1Match[1] : null,
      L2: L2Match ? L2Match[1] : null,
      L3: L3Match ? L3Match[1] : null,
      Total: totalMatch ? totalMatch[1] : null
    });

    const values = {
      L1: L1Match ? parseInt(L1Match[1], 10) : defaultValues.L1,
      L2: L2Match ? parseInt(L2Match[1], 10) : defaultValues.L2,
      L3: L3Match ? parseInt(L3Match[1], 10) : defaultValues.L3,
      Total: totalMatch ? parseInt(totalMatch[1], 10) : defaultValues.Total
    };

    console.log('Parsed values:', values);
    return values;

  } catch (error) {
    console.error("Error fetching grid values:", error);
    // Vrátíme objekt s null hodnotami místo null
    return {
      L1: null,
      L2: null,
      L3: null,
      Total: null
    };
  }
}

async function enableForceCharging(limit) {
  console.log('Volá se enableForceCharging s limitem:', limit); // Ladicí výstup
  
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
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'session=eyJub190aW1lcnMiOjF9.ZyYEyg.ifFQ2ULKmpc_G1coeDbybyFMa64'  // Použijte aktuální hodnotu session cookie
      },
      body: payload
    });

    if (response.ok) {
      console.log(`${actionDescription} úspěšné.`);
      return true;
    } else {
      console.error(`${actionDescription} neúspěšné. Status: ${response.status}`);
      const errorText = await response.text();
      console.error('Chybová odpověď serveru:', errorText);
      return false;
    }
  } catch (error) {
    console.error(`${actionDescription} se nezdařilo:`, error);
    return false;
  }
}


module.exports = {
  setBaseUrl,
  getBaseUrl,
  getGridValues,
  enableForceCharging,
  disableForceCharging,
  enableBlockBatteryDischarge,
  disableBlockBatteryDischarge
};