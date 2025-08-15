import { dialog } from './GPT-main.js';

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
    const urlGPT = document.getElementById('config-source-GPT').value;
    const apikeyGPT = document.getElementById('config-apikey-GPT').value;
    const urlDeepseek = document.getElementById('config-source-deepseek').value;
    const apikeyDeepseek = document.getElementById('config-apikey-deepseek').value;
    const cxGoogleSearch = document.getElementById('config-cx-google-search').value;
    const apikeyGoogleSearch = document.getElementById('config-apikey-google-search').value;
    const systemPromptGPT = document.getElementById('config-system-prompt-GPT').value;
    const useGlobalSystemPrompt = document.getElementById('config-use-global-system-prompt').checked;
    const useProxy = document.getElementById('config-use-proxy').checked;
    const proxyUrl = document.getElementById('config-proxy-url').value;

    
    const useChatSearchGPT = document.getElementById('config-use-chat-search-GPT').checked;
    const useChatSearchWiki = document.getElementById('config-use-chat-search-GPT-wiki').checked;
    const useChatSearchBaidu = document.getElementById('config-use-chat-search-GPT-baidu').checked;
    const useChatSearchZhihu = document.getElementById('config-use-chat-search-GPT-zhihu').checked;

    const config = {
        urlGPT: urlGPT,
        apikeyGPT: apikeyGPT,
        urlDeepseek: urlDeepseek,
        apikeyDeepseek: apikeyDeepseek,
        cxGoogleSearch: cxGoogleSearch,
        apikeyGoogleSearch: apikeyGoogleSearch,
        systemPromptGPT: systemPromptGPT,
        useGlobalSystemPrompt: useGlobalSystemPrompt,
        useProxy: useProxy,
        proxyUrl: proxyUrl,
        useChatSearchGPT: useChatSearchGPT,
        useChatSearchWiki: useChatSearchWiki,
        useChatSearchBaidu: useChatSearchBaidu,
        useChatSearchZhihu: useChatSearchZhihu
    }

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
        const config = await response.json();
        if (!config) throw new Error("Config not found or empty.");

        document.getElementById('config-source-GPT').value = config.urlGPT || '';
        document.getElementById('config-apikey-GPT').value = config.apikeyGPT || '';
        document.getElementById('config-source-deepseek').value = config.urlDeepseek || '';
        document.getElementById('config-apikey-deepseek').value = config.apikeyDeepseek || '';
        document.getElementById('config-cx-google-search').value = config.cxGoogleSearch || '';
        document.getElementById('config-apikey-google-search').value = config.apikeyGoogleSearch || '';
        document.getElementById('config-system-prompt-GPT').value = config.systemPromptGPT || '';
        document.getElementById('config-use-global-system-prompt').checked = config.useGlobalSystemPrompt || false;
        document.getElementById('config-use-proxy').checked = config.useProxy || false;
        document.getElementById('config-proxy-url').value = config.proxyUrl || '';
        
        document.getElementById('config-use-chat-search-GPT').checked = config.useChatSearchGPT || false;
        document.getElementById('config-use-chat-search-GPT-wiki').checked = config.useChatSearchWiki || false;
        document.getElementById('config-use-chat-search-GPT-baidu').checked = config.useChatSearchBaidu || false;
        document.getElementById('config-use-chat-search-GPT-zhihu').checked = config.useChatSearchZhihu || false;

        // Initialize bots after loading config
        if (dialog) {
            dialog.initializeBots(config);
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
