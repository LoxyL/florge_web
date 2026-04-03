import { dialog } from './GPT-main.js';

export let config = {};

function configContainerInit(){
    const container = document.getElementById("config-container");

    container.addEventListener('click', function(event){
        container.classList.remove("active");
        container.classList.add("active");
        event.stopPropagation();
    })

    document.addEventListener('click', function() {
        container.classList.remove("active");
    });
}


async function configSave() {
    config.urlGPT = document.getElementById('config-source-GPT') ? document.getElementById('config-source-GPT').value : config.urlGPT;
    config.apikeyGPT = document.getElementById('config-apikey-GPT') ? document.getElementById('config-apikey-GPT').value : config.apikeyGPT;
    config.urlDeepseek = document.getElementById('config-source-deepseek') ? document.getElementById('config-source-deepseek').value : config.urlDeepseek;
    config.apikeyDeepseek = document.getElementById('config-apikey-deepseek') ? document.getElementById('config-apikey-deepseek').value : config.apikeyDeepseek;
    // Painter config
    config.urlPainter = document.getElementById('config-source-painter') ? document.getElementById('config-source-painter').value : config.urlPainter || "https://api.openai-hk.com";
    config.apikeyPainter = document.getElementById('config-apikey-painter') ? document.getElementById('config-apikey-painter').value : config.apikeyPainter;
    config.cxGoogleSearch = document.getElementById('config-cx-google-search') ? document.getElementById('config-cx-google-search').value : config.cxGoogleSearch;
    config.apikeyGoogleSearch = document.getElementById('config-apikey-google-search') ? document.getElementById('config-apikey-google-search').value : config.apikeyGoogleSearch;
    config.systemPromptGPT = document.getElementById('config-system-prompt-GPT') ? document.getElementById('config-system-prompt-GPT').value : config.systemPromptGPT;
    config.useGlobalSystemPrompt = document.getElementById('config-use-global-system-prompt') ? document.getElementById('config-use-global-system-prompt').checked : config.useGlobalSystemPrompt;
    config.useProxy = document.getElementById('config-use-proxy') ? document.getElementById('config-use-proxy').checked : config.useProxy;
    config.proxyUrl = document.getElementById('config-proxy-url') ? document.getElementById('config-proxy-url').value : config.proxyUrl;
    config.useChatSearchGPT = document.getElementById('config-use-chat-search-GPT') ? document.getElementById('config-use-chat-search-GPT').checked : config.useChatSearchGPT;
    config.useChatSearchWiki = document.getElementById('config-use-chat-search-GPT-wiki') ? document.getElementById('config-use-chat-search-GPT-wiki').checked : config.useChatSearchWiki;
    config.useChatSearchBaidu = document.getElementById('config-use-chat-search-GPT-baidu') ? document.getElementById('config-use-chat-search-GPT-baidu').checked : config.useChatSearchBaidu;
    config.useChatSearchZhihu = document.getElementById('config-use-chat-search-GPT-zhihu') ? document.getElementById('config-use-chat-search-GPT-zhihu').checked : config.useChatSearchZhihu;

    try {
        const response = await fetch('/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        const data = await response.text();
        console.log('[INFO][CONFIG]', data);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function configLoad() {
    try {
        const response = await fetch('/config');
        const loadedConfig = await response.json();
        if (!loadedConfig) throw new Error("Config not found or empty.");

        config = loadedConfig;

        if (document.getElementById('config-source-GPT')) document.getElementById('config-source-GPT').value = config.urlGPT || '';
        if (document.getElementById('config-apikey-GPT')) document.getElementById('config-apikey-GPT').value = config.apikeyGPT || '';
        if (document.getElementById('config-source-deepseek')) document.getElementById('config-source-deepseek').value = config.urlDeepseek || '';
        if (document.getElementById('config-apikey-deepseek')) document.getElementById('config-apikey-deepseek').value = config.apikeyDeepseek || '';
        if (document.getElementById('config-source-painter')) document.getElementById('config-source-painter').value = config.urlPainter || 'https://api.openai-hk.com';
        if (document.getElementById('config-apikey-painter')) document.getElementById('config-apikey-painter').value = config.apikeyPainter || '';
        if (document.getElementById('config-cx-google-search')) document.getElementById('config-cx-google-search').value = config.cxGoogleSearch || '';
        if (document.getElementById('config-apikey-google-search')) document.getElementById('config-apikey-google-search').value = config.apikeyGoogleSearch || '';
        if (document.getElementById('config-system-prompt-GPT')) document.getElementById('config-system-prompt-GPT').value = config.systemPromptGPT || '';
        if (document.getElementById('config-use-global-system-prompt')) document.getElementById('config-use-global-system-prompt').checked = config.useGlobalSystemPrompt || false;
        if (document.getElementById('config-use-proxy')) document.getElementById('config-use-proxy').checked = config.useProxy || false;
        if (document.getElementById('config-proxy-url')) document.getElementById('config-proxy-url').value = config.proxyUrl || '';
        
        if (document.getElementById('config-use-chat-search-GPT')) document.getElementById('config-use-chat-search-GPT').checked = config.useChatSearchGPT || false;
        if (document.getElementById('config-use-chat-search-GPT-wiki')) document.getElementById('config-use-chat-search-GPT-wiki').checked = config.useChatSearchWiki || false;
        if (document.getElementById('config-use-chat-search-GPT-baidu')) document.getElementById('config-use-chat-search-GPT-baidu').checked = config.useChatSearchBaidu || false;
        if (document.getElementById('config-use-chat-search-GPT-zhihu')) document.getElementById('config-use-chat-search-GPT-zhihu').checked = config.useChatSearchZhihu || false;

        // Initialize bots after loading config
        if (dialog && document.getElementById('model-GPT')) {
            dialog.initializeBots();
        }

        document.dispatchEvent(new CustomEvent('config-loaded'));

    } catch (error) {
        console.error('Fail loading Configurations:', error);
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

configContainerInit();
configLoad();

window.configSave = configSave;
window.configOpenTab = configOpenTab;
