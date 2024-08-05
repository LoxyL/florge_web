async function configSave() {
    const urlGPT = document.getElementById('config-source-GPT').value;
    const apikeyGPT = document.getElementById('config-apikey-GPT').value;

    const config = {
        urlGPT: urlGPT,
        apikeyGPT: apikeyGPT
    }

    try {
        const response = await fetch('http://localhost:30962/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        const data = await response.text();
        console.log('[INFO]', data);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function configLoad() {
    try {
        const response = await fetch('http://localhost:30962/config');
        const config = await response.json();

        document.getElementById('config-source-GPT').value = config.urlGPT;
        document.getElementById('config-apikey-GPT').value = config.apikeyGPT;
    } catch (error) {
        alert('Fail loading Configurations.');
    }
}

function configOpenTab(event, tabName) {
    let i, tabcontent, tabbuttons;
    
    tabcontent = document.getElementsByClassName("config-tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
  
    tabbuttons = document.getElementsByClassName("config-tab-button");
    for (i = 0; i < tabbuttons.length; i++) {
        tabbuttons[i].className = tabbuttons[i].className.replace(" active", "");
    }
  
    document.getElementById(tabName).style.display = "flex";
    event.currentTarget.className += " active";
}
  
configLoad();