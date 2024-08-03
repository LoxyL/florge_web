function configSave() {
    const urlGPT = document.getElementById('config-source-GPT').value;
    const apikeyGPT = document.getElementById('config-apikey-GPT').value;

    const config = {
        urlGPT: urlGPT,
        apikeyGPT: apikeyGPT
    }

    localStorage.setItem('chat-tool-web-config.json', JSON.stringify(config));

    alert('Done saving configurations.');
}

function configLoad() {
    const configJson = localStorage.getItem('chat-tool-web-config.json');

    if (configJson) {
        const config = JSON.parse(configJson);

        document.getElementById('config-source-GPT').value = config.urlGPT;
        document.getElementById('config-apikey-GPT').value = config.apikeyGPT;
    } else {
        alert('No configurations found.');
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