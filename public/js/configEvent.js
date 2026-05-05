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

        // Restore sidebar model/tokens from localStorage before Bot reads `<select>` (custom UI stays in sync via `change` in loadSidebarSettings).
        if (dialog && document.getElementById('model-GPT')) {
            dialog.loadSidebarSettings();
            dialog.initializeBots();
        }

        document.dispatchEvent(new CustomEvent('config-loaded'));

    } catch (error) {
        console.error('Fail loading Configurations:', error);
        alert('Fail loading Configurations.');
    }
}

function initCustomSelects() {
    const selects = document.querySelectorAll('.sidebar-select');
    selects.forEach((select) => enhanceCustomSelect(select));
    
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper').forEach(el => el.classList.remove('open'));
    });
}

function enhanceCustomSelect(select) {
    if (!select || select.dataset.customSelectReady === 'true') return;

    select.style.display = 'none';
    select.dataset.customSelectReady = 'true';
        
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    if (select.dataset.selectPlacement === 'up') {
        wrapper.classList.add('custom-select-placement-up');
    }
    select.parentNode.insertBefore(wrapper, select);
        
    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    trigger.innerHTML = `<span>${escapeHtml(select.options[select.selectedIndex]?.text || '')}</span><span class="custom-select-arrow"></span>`;
        
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'custom-select-options';
        
    Array.from(select.children).forEach((child) => {
        if (child.tagName.toLowerCase() === 'optgroup') {
            const groupLabel = document.createElement('div');
            groupLabel.className = 'custom-select-group-label';
            groupLabel.textContent = child.label;
            optionsDiv.appendChild(groupLabel);
            
            Array.from(child.children).forEach((option) => {
                createOptionElement(option, optionsDiv, select, trigger, wrapper);
            });
        } else if (child.tagName.toLowerCase() === 'option') {
            createOptionElement(child, optionsDiv, select, trigger, wrapper);
        }
    });
        
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsDiv);
        
    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.custom-select-wrapper').forEach((element) => {
            if (element !== wrapper) element.classList.remove('open');
        });
        wrapper.classList.toggle('open');
    });
        
    select.addEventListener('change', () => {
        trigger.querySelector('span').textContent = select.options[select.selectedIndex]?.text || '';
        optionsDiv.querySelectorAll('.custom-select-option').forEach((element) => {
            element.classList.toggle('selected', element.dataset.value === select.value);
        });
    });
}

function createOptionElement(option, optionsDiv, select, trigger, wrapper) {
    const optDiv = document.createElement('div');
    optDiv.className = 'custom-select-option';
    optDiv.textContent = option.text;
    optDiv.dataset.value = option.value;
    if (option.selected) optDiv.classList.add('selected');
        
    optDiv.addEventListener('click', () => {
        select.value = option.value;
        trigger.querySelector('span').textContent = option.text;
        select.dispatchEvent(new Event('change'));
            
        optionsDiv.querySelectorAll('.custom-select-option').forEach((element) => element.classList.remove('selected'));
        optDiv.classList.add('selected');
            
        wrapper.classList.remove('open');
    });
    optionsDiv.appendChild(optDiv);
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
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

document.addEventListener('DOMContentLoaded', () => {
    initCustomSelects();
});

window.configSave = configSave;
window.configOpenTab = configOpenTab;
