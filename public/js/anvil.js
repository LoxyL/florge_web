import { config } from './configEvent.js';

const SECTION_ORDER = [
    'World',
    'Regions',
    'Factions',
    'Characters',
    'Artifacts',
    'Creatures',
    'Architecture',
    'VisualLanguage'
];

const ENTRY_STATUSES = ['Seed', 'Draft', 'Review', 'Locked'];
const BRAINSTORM_MODEL_OPTIONS = [
    { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'o1-mini', label: 'o1-mini' },
    { value: 'deepseek-chat', label: 'Deepseek Chat' },
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' }
];

const state = {
    worlds: [],
    currentWorld: null,
    activeSection: 'World',
    activeEntryId: null,
    worldHeroExpanded: false,
    searchTerm: '',
    statusFilter: 'all',
    aiResult: '',
    aiContextSummary: null,
    brainstormSessionsByWorldId: {},
    brainstormDraft: '',
    brainstormModel: 'gpt-4o-mini',
    brainstormPendingPatch: [],
    brainstormSending: false,
    brainstormLoading: false,
    brainstormApplying: false,
    brainstormExpanded: false,
    worldHeroAiPrompt: '',
    worldHeroAiResult: '',
    worldHeroAiLoading: false,
    saveTimer: null,
    saveInFlight: false,
    saveQueued: false
};

const dom = {};

document.addEventListener('DOMContentLoaded', async () => {
    cacheDom();
    bindStaticEvents();
    initCustomSelects();
    loadSidebarSettings();
    await loadWorlds();
});

function cacheDom() {
    dom.worldList = document.getElementById('world-list');
    dom.sectionList = document.getElementById('section-list');
    dom.worldHero = document.getElementById('world-hero');
    dom.boardTitle = document.getElementById('board-title');
    dom.entryBoard = document.getElementById('entry-board');
    dom.studioTitle = document.getElementById('studio-title');
    dom.studioContent = document.getElementById('entry-studio-content');
    dom.entrySearchInput = document.getElementById('entry-search-input');
    dom.entryStatusFilter = document.getElementById('entry-status-filter');
    dom.entryBoardCreateBtn = document.getElementById('entry-board-create-btn');
    dom.textModel = document.getElementById('anvil-text-model');
    dom.imageModel = document.getElementById('anvil-image-model');
    dom.imageRatio = document.getElementById('anvil-image-ratio');
    dom.imageQuality = document.getElementById('anvil-image-quality');
    dom.sectionBoardPeek = document.getElementById('section-board-peek');
    dom.brainstormPanel = document.getElementById('brainstorm-panel');
    dom.lightbox = document.getElementById('lightbox');
    dom.lightboxImg = document.getElementById('lightbox-img');
    dom.lightboxCaption = document.getElementById('lightbox-caption');
}

function bindStaticEvents() {
    document.getElementById('create-world-btn')?.addEventListener('click', createWorld);
    document.getElementById('create-entry-btn')?.addEventListener('click', () => createEntry(state.activeSection));

    dom.entrySearchInput?.addEventListener('input', (event) => {
        state.searchTerm = event.target.value.trim().toLowerCase();
        renderEntryBoard();
    });

    dom.entryStatusFilter?.addEventListener('change', (event) => {
        state.statusFilter = event.target.value;
        renderEntryBoard();
    });

    dom.entryBoardCreateBtn?.addEventListener('click', () => createEntry(state.activeSection));

    [dom.textModel, dom.imageModel, dom.imageRatio, dom.imageQuality].forEach((element) => {
        element?.addEventListener('change', saveSidebarSettings);
    });

    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    dom.lightbox?.addEventListener('click', (event) => {
        if (event.target.dataset.closeLightbox === 'true' || event.target === dom.lightbox) {
            closeLightbox();
        }
    });

    document.addEventListener('click', (event) => {
        if (!state.worldHeroExpanded || !dom.worldHero) return;
        if (dom.worldHero.contains(event.target)) return;

        state.worldHeroExpanded = false;
        dom.worldHero.classList.remove('is-expanded');
        dom.worldHero.classList.add('is-collapsed');
        dom.worldHero.querySelector('.world-hero-strip')?.setAttribute('aria-expanded', 'false');
    });
}

function saveSidebarSettings() {
    const settings = {
        textModel: dom.textModel?.value || 'gpt-4o-mini',
        imageModel: dom.imageModel?.value || 'gpt-image-1',
        imageRatio: dom.imageRatio?.value || '1:1',
        imageQuality: dom.imageQuality?.value || '1024',
        brainstormModel: state.brainstormModel || 'gpt-4o-mini'
    };

    localStorage.setItem('anvilSettings', JSON.stringify(settings));
}

function loadSidebarSettings() {
    try {
        const raw = localStorage.getItem('anvilSettings');
        if (!raw) return;
        const settings = JSON.parse(raw);

        if (settings.textModel && dom.textModel) { dom.textModel.value = settings.textModel; dom.textModel.dispatchEvent(new Event('change')); }
        if (settings.imageModel && dom.imageModel) { dom.imageModel.value = settings.imageModel; dom.imageModel.dispatchEvent(new Event('change')); }
        if (settings.imageRatio && dom.imageRatio) { dom.imageRatio.value = settings.imageRatio; dom.imageRatio.dispatchEvent(new Event('change')); }
        if (settings.imageQuality && dom.imageQuality) { dom.imageQuality.value = settings.imageQuality; dom.imageQuality.dispatchEvent(new Event('change')); }
        state.brainstormModel = settings.brainstormModel || settings.textModel || 'gpt-4o-mini';
    } catch (error) {
        console.error('Failed to load Anvil settings:', error);
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
    select.parentNode.insertBefore(wrapper, select);

    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    trigger.innerHTML = `<span>${escapeHtml(select.options[select.selectedIndex]?.text || '')}</span><span class="custom-select-arrow"></span>`;

    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'custom-select-options';

    Array.from(select.options).forEach((option) => {
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

function createEmptyEntry(sectionName, title = `New ${sectionName} Entry`) {
    const now = Date.now();
    return {
        id: `entry_${now}_${Math.floor(Math.random() * 100000)}`,
        title,
        section: sectionName,
        status: 'Seed',
        summary: '',
        content: '',
        images: [],
        references: [],
        tags: [],
        links: [],
        aiContextSummary: '',
        generationPresets: {},
        styleKeywords: [],
        createdAt: now,
        updatedAt: now
    };
}

function createEmptyWorld(name) {
    const worldOverview = createEmptyEntry('World', `${name} Overview`);

    return {
        name,
        summary: '',
        coverImage: '',
        themeKeywords: [],
        canonContext: '',
        styleAnchors: [],
        sections: {
            World: [worldOverview],
            Regions: [],
            Factions: [],
            Characters: [],
            Artifacts: [],
            Creatures: [],
            Architecture: [],
            VisualLanguage: []
        },
        recentActivities: [{
            id: `activity_${Date.now()}`,
            type: 'world_created',
            label: `Created world ${name}`,
            createdAt: Date.now()
        }],
        generationHistory: []
    };
}

function ensureWorldShape(world) {
    if (!world) return null;

    const sections = {};
    SECTION_ORDER.forEach((sectionName) => {
        sections[sectionName] = Array.isArray(world.sections?.[sectionName])
            ? world.sections[sectionName].map((entry) => ({
                images: [],
                references: [],
                tags: [],
                links: [],
                styleKeywords: [],
                generationPresets: {},
                ...entry,
                section: entry.section || sectionName
            }))
            : [];
    });

    return {
        ...world,
        themeKeywords: normalizeTagList(world.themeKeywords),
        styleAnchors: Array.isArray(world.styleAnchors) ? world.styleAnchors : [],
        recentActivities: Array.isArray(world.recentActivities) ? world.recentActivities : [],
        generationHistory: Array.isArray(world.generationHistory) ? world.generationHistory : [],
        sections
    };
}

function createEmptyBrainstormSession(worldId) {
    return {
        worldId,
        messages: [],
        lastProposedOperations: [],
        updatedAt: 0
    };
}

function getBrainstormSession(worldId = state.currentWorld?.id) {
    if (!worldId) return createEmptyBrainstormSession('');

    if (!state.brainstormSessionsByWorldId[worldId]) {
        state.brainstormSessionsByWorldId[worldId] = createEmptyBrainstormSession(worldId);
    }

    return state.brainstormSessionsByWorldId[worldId];
}

function setBrainstormSession(session) {
    if (!session?.worldId) return;
    state.brainstormSessionsByWorldId[session.worldId] = {
        ...createEmptyBrainstormSession(session.worldId),
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : [],
        lastProposedOperations: Array.isArray(session.lastProposedOperations) ? session.lastProposedOperations : []
    };
    if (session.worldId === state.currentWorld?.id) {
        state.brainstormPendingPatch = state.brainstormSessionsByWorldId[session.worldId].lastProposedOperations;
    }
}

async function loadBrainstormSession(worldId) {
    if (!worldId) return;

    state.brainstormLoading = true;

    try {
        const response = await fetch(`/gpt/anvil/brainstorm/session/${encodeURIComponent(worldId)}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        setBrainstormSession(data);
    } catch (error) {
        console.error('Failed to load Anvil brainstorm session:', error);
        setBrainstormSession(createEmptyBrainstormSession(worldId));
    } finally {
        state.brainstormLoading = false;
    }
}

async function loadWorlds() {
    try {
        const response = await fetch('/gpt/anvil/worlds');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        state.worlds = await response.json();

        if (state.worlds.length > 0) {
            const preferredWorldId = state.currentWorld?.id || state.worlds[0].id;
            await selectWorld(preferredWorldId);
            return;
        }

        state.currentWorld = null;
        state.activeEntryId = null;
        state.brainstormPendingPatch = [];
        state.brainstormDraft = '';
        state.brainstormExpanded = false;
        renderAll();
    } catch (error) {
        console.error('Failed to load Anvil worlds:', error);
        alert(`Failed to load Anvil worlds: ${error.message}`);
    }
}

async function selectWorld(worldId) {
    try {
        const response = await fetch(`/gpt/anvil/world/${encodeURIComponent(worldId)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        state.currentWorld = ensureWorldShape(await response.json());
        await loadBrainstormSession(worldId);
        state.activeSection = state.currentWorld.sections[state.activeSection] ? state.activeSection : 'World';
        state.worldHeroExpanded = false;
        state.brainstormExpanded = getBrainstormSession(worldId).messages.length > 0 || state.brainstormPendingPatch.length > 0;
        state.brainstormDraft = '';
        ensureActiveEntry();
        renderAll();
    } catch (error) {
        console.error('Failed to load Anvil world:', error);
        alert(`Failed to load Anvil world: ${error.message}`);
    }
}

async function createWorld() {
    const worldName = 'New World';

    try {
        const response = await fetch('/gpt/anvil/world', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(createEmptyWorld(worldName))
        });

        const world = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(world.error || `HTTP error! status: ${response.status}`);
        }

        state.currentWorld = ensureWorldShape(world);
        state.activeSection = 'World';
        state.worldHeroExpanded = true;
        setBrainstormSession(createEmptyBrainstormSession(state.currentWorld.id));
        state.brainstormExpanded = true;
        state.brainstormDraft = '';
        state.brainstormPendingPatch = [];
        ensureActiveEntry();
        upsertWorldSummary(state.currentWorld);
        renderAll();
        
        setTimeout(() => {
            const nameInput = document.getElementById('world-name-input');
            if (nameInput) {
                nameInput.focus();
                nameInput.select();
            }
        }, 50);
    } catch (error) {
        console.error('Failed to create Anvil world:', error);
        alert(`Failed to create Anvil world: ${error.message}`);
    }
}

async function deleteCurrentWorld() {
    if (!state.currentWorld) return;

    const confirmed = window.confirm(`Delete world "${state.currentWorld.name}"?`);
    if (!confirmed) return;

    try {
        const response = await fetch(`/gpt/anvil/world_remove/${encodeURIComponent(state.currentWorld.id)}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        state.worlds = state.worlds.filter((world) => world.id !== state.currentWorld.id);
        state.currentWorld = null;
        state.activeEntryId = null;
        state.brainstormPendingPatch = [];
        state.brainstormDraft = '';

        if (state.worlds.length > 0) {
            await selectWorld(state.worlds[0].id);
            return;
        }

        renderAll();
    } catch (error) {
        console.error('Failed to delete Anvil world:', error);
        alert(`Failed to delete Anvil world: ${error.message}`);
    }
}

function getSectionEntries(sectionName = state.activeSection) {
    return Array.isArray(state.currentWorld?.sections?.[sectionName]) ? state.currentWorld.sections[sectionName] : [];
}

function ensureActiveEntry() {
    const entries = getSectionEntries(state.activeSection);
    if (entries.length === 0) {
        state.activeEntryId = null;
        return;
    }

    if (!entries.some((entry) => entry.id === state.activeEntryId)) {
        state.activeEntryId = entries[0].id;
    }
}

function setActiveSection(sectionName) {
    state.activeSection = sectionName;
    ensureActiveEntry();
    state.aiResult = '';
    state.aiContextSummary = null;
    renderAll();
}

function getSelectedEntry() {
    return getSectionEntries().find((entry) => entry.id === state.activeEntryId) || null;
}

function createEntry(sectionName = state.activeSection) {
    if (!state.currentWorld) {
        alert('Create a world first.');
        return;
    }

    const title = `New ${sectionName} Entry`;

    const entry = createEmptyEntry(sectionName, title);
    state.currentWorld.sections[sectionName].unshift(entry);
    state.activeSection = sectionName;
    state.activeEntryId = entry.id;
    pushActivity(`Created entry ${entry.title}`, 'entry_created');
    queueSaveCurrentWorld();
    renderAll();
    
    setTimeout(() => {
        const titleInput = document.getElementById('entry-title-input');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 50);
}

function deleteSelectedEntry() {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) return;

    const confirmed = window.confirm(`Delete entry "${entry.title}"?`);
    if (!confirmed) return;

    state.currentWorld.sections[state.activeSection] = getSectionEntries().filter((candidate) => candidate.id !== entry.id);
    removeAnchorsForDeletedEntry(entry);
    state.activeEntryId = null;
    ensureActiveEntry();
    pushActivity(`Deleted entry ${entry.title}`, 'entry_deleted');
    queueSaveCurrentWorld();
    renderAll();
}

function removeAnchorsForDeletedEntry(entry) {
    const entryImageIds = new Set((entry.images || []).map((image) => image.id));
    state.currentWorld.styleAnchors = state.currentWorld.styleAnchors.filter((anchor) => !entryImageIds.has(anchor.id));
    if (entry.images?.some((image) => image.url === state.currentWorld.coverImage)) {
        state.currentWorld.coverImage = state.currentWorld.styleAnchors[0]?.url || '';
    }
}

function normalizeTagList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }

    return [];
}

function summarizeWorld(world) {
    let entryCount = 0;
    SECTION_ORDER.forEach((sectionName) => {
        entryCount += world.sections[sectionName]?.length || 0;
    });

    return {
        id: world.id,
        name: world.name,
        summary: world.summary,
        coverImage: world.coverImage,
        updatedAt: world.updatedAt,
        createdAt: world.createdAt,
        themeKeywords: world.themeKeywords,
        entryCount,
        sectionCount: SECTION_ORDER.length,
        characterCount: world.sections.Characters?.length || 0,
        regionCount: world.sections.Regions?.length || 0
    };
}

function upsertWorldSummary(world) {
    const summary = summarizeWorld(world);
    const existingIndex = state.worlds.findIndex((candidate) => candidate.id === world.id);

    if (existingIndex >= 0) {
        state.worlds.splice(existingIndex, 1, summary);
    } else {
        state.worlds.unshift(summary);
    }

    state.worlds.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function pushActivity(label, type = 'updated') {
    if (!state.currentWorld) return;

    state.currentWorld.recentActivities = [{
        id: `activity_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        type,
        label,
        createdAt: Date.now()
    }, ...(state.currentWorld.recentActivities || [])].slice(0, 12);
}

function queueSaveCurrentWorld() {
    if (!state.currentWorld) return;

    state.currentWorld.updatedAt = Date.now();
    upsertWorldSummary(state.currentWorld);
    renderWorldList();

    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        void saveCurrentWorld();
    }, 450);
}

async function saveCurrentWorld() {
    if (!state.currentWorld) return;
    if (state.saveInFlight) {
        state.saveQueued = true;
        return;
    }

    state.saveInFlight = true;

    try {
        const response = await fetch(`/gpt/anvil/world/${encodeURIComponent(state.currentWorld.id)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state.currentWorld)
        });

        const world = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(world.error || `HTTP error! status: ${response.status}`);
        }

        state.currentWorld = ensureWorldShape(world);
        upsertWorldSummary(state.currentWorld);
        renderWorldList();
    } catch (error) {
        console.error('Failed to save Anvil world:', error);
    } finally {
        state.saveInFlight = false;
        if (state.saveQueued) {
            state.saveQueued = false;
            void saveCurrentWorld();
        }
    }
}

function renderAll() {
    renderWorldList();
    renderSectionList();
    renderWorldHero();
    renderEntryBoard();
    renderEntryStudio();
    renderBrainstormPanel();
}

function renderSectionBoardPeek(entries = null) {
    if (!dom.sectionBoardPeek) return;

    if (!state.currentWorld) {
        dom.sectionBoardPeek.innerHTML = `
            <div class="section-board-peek-grid">
                <div class="section-board-peek-card"></div>
                <div class="section-board-peek-card"></div>
                <div class="section-board-peek-card"></div>
            </div>
            <div class="section-board-peek-count">0</div>
        `;
        return;
    }

    const previewEntries = (entries || getFilteredEntries()).slice(0, 3);
    const cardsMarkup = previewEntries.length > 0
        ? previewEntries.map((entry) => {
            const cover = entry.images?.[0]?.url || state.currentWorld.coverImage || '';
            return `
                <div class="section-board-peek-card">
                    ${cover ? `<img src="${escapeAttribute(cover)}" alt="${escapeAttribute(entry.title || 'Entry')}">` : ''}
                    <div class="section-board-peek-card-label">${escapeHtml(entry.title || 'Untitled')}</div>
                </div>
            `;
        }).join('')
        : `
            <div class="section-board-peek-card"><div class="section-board-peek-card-label">No entries</div></div>
            <div class="section-board-peek-card"></div>
            <div class="section-board-peek-card"></div>
        `;

    dom.sectionBoardPeek.innerHTML = `
        <div class="section-board-peek-grid">${cardsMarkup}</div>
        <div class="section-board-peek-count">${entries ? entries.length : getFilteredEntries().length}</div>
    `;
}

function renderWorldList() {
    if (!dom.worldList) return;

    if (state.worlds.length === 0) {
        dom.worldList.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">No worlds yet</div>
                <div>Create your first Anvil world to begin building canon, characters, cities and concept art.</div>
                <div class="empty-state-actions">
                    <button class="button-primary" data-create-world="true">Create World</button>
                </div>
            </div>
        `;
        dom.worldList.querySelector('[data-create-world="true"]')?.addEventListener('click', createWorld);
        return;
    }

    dom.worldList.innerHTML = state.worlds.map((world) => `
        <div class="world-item ${world.id === state.currentWorld?.id ? 'active' : ''}" data-world-id="${world.id}">
            <span class="world-item-title">${escapeHtml(world.name || 'Untitled World')}</span>
            <div class="world-item-meta">${world.entryCount || 0} entries</div>
            <div class="world-item-meta">${escapeHtml((world.summary || 'No summary yet').slice(0, 70))}</div>
        </div>
    `).join('');

    dom.worldList.querySelectorAll('[data-world-id]').forEach((element) => {
        element.addEventListener('click', () => {
            void selectWorld(element.dataset.worldId);
        });
    });
}

function renderSectionList() {
    if (!dom.sectionList) return;

    if (!state.currentWorld) {
        dom.sectionList.innerHTML = '<div class="muted">Select a world to browse sections.</div>';
        return;
    }

    dom.sectionList.innerHTML = SECTION_ORDER.map((sectionName) => {
        const count = state.currentWorld.sections?.[sectionName]?.length || 0;
        return `
            <div class="section-item ${sectionName === state.activeSection ? 'active' : ''}" data-section-name="${sectionName}">
                <span class="section-item-title">${sectionName}</span>
                <div class="section-item-meta">${count} entries</div>
            </div>
        `;
    }).join('');

    dom.sectionList.querySelectorAll('[data-section-name]').forEach((element) => {
        element.addEventListener('click', () => setActiveSection(element.dataset.sectionName));
    });
}

function renderWorldHero() {
    if (!dom.worldHero) return;

    if (!state.currentWorld) {
        dom.worldHero.className = 'world-hero is-expanded';
        dom.worldHero.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">Anvil</div>
                <h2>World-aware AI design studio</h2>
                <div>Store canon, grow sections, and generate text or concept art that stays aligned with your world.</div>
                <div class="empty-state-actions">
                    <button class="button-primary" data-create-world="true">Create your first world</button>
                </div>
            </div>
        `;
        dom.worldHero.querySelector('[data-create-world="true"]')?.addEventListener('click', createWorld);
        return;
    }

    const stats = summarizeWorld(state.currentWorld);
    const activities = (state.currentWorld.recentActivities || []).slice(0, 4);
    const isExpanded = state.worldHeroExpanded;
    const legacyWorldPrompt = state.currentWorld.sections?.World?.[0]?.generationPresets?.worldPrompt;
    const worldHeroPresetPrompt = state.currentWorld.worldHeroAiPreset?.prompt || legacyWorldPrompt || '';
    const anchorMarkup = (state.currentWorld.styleAnchors || []).length > 0
        ? state.currentWorld.styleAnchors.map((anchor) => `
            <div class="anchor-card">
                <img src="${escapeAttribute(anchor.url)}" alt="${escapeAttribute(anchor.label || 'Style anchor')}" data-preview-image="${escapeAttribute(anchor.url)}" data-preview-caption="${escapeAttribute(anchor.label || '')}">
                <div class="asset-caption">${escapeHtml(anchor.label || 'Style Anchor')}</div>
            </div>
        `).join('')
        : '<div class="muted">Mark entry images as style anchors to give AI a visual memory for this world.</div>';

    dom.worldHero.className = `world-hero ${isExpanded ? 'is-expanded' : 'is-collapsed'}`;
    dom.worldHero.innerHTML = `
        <button class="world-hero-strip" type="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <div class="world-hero-strip-main">
                <div class="world-hero-strip-title">
                    <div class="eyebrow">Anvil World</div>
                    <strong>${escapeHtml(state.currentWorld.name || 'Untitled World')}</strong>
                </div>
                <div class="world-hero-strip-meta">
                    <span class="world-hero-mini-stat">${stats.entryCount} entries</span>
                    <span class="world-hero-mini-stat">${stats.characterCount} characters</span>
                    <span class="world-hero-mini-stat">${stats.regionCount} regions</span>
                    <span class="world-hero-mini-stat">${escapeHtml(activities[0]?.label || 'No activity yet')}</span>
                </div>
            </div>
            <span class="world-hero-strip-arrow" aria-hidden="true"></span>
        </button>

        <div class="world-hero-panel-wrapper">
            <div class="world-hero-panel">
                <div class="world-hero-inner">
                    <div class="world-meta">
                    <div class="eyebrow">World Overview</div>
                    <div class="world-name-row">
                        <div style="flex:1;">
                            <h1>${escapeHtml(state.currentWorld.name || 'Untitled World')}</h1>
                            <div class="muted">AI generation in this world will reference canon text, linked entries and style anchors.</div>
                        </div>
                    </div>

                    <input id="world-name-input" type="text" value="${escapeAttribute(state.currentWorld.name || '')}" placeholder="World name">
                    <textarea id="world-summary-input" placeholder="High-level overview of the world, tone and themes...">${escapeHtml(state.currentWorld.summary || '')}</textarea>
                    <input id="world-theme-input" type="text" value="${escapeAttribute((state.currentWorld.themeKeywords || []).join(', '))}" placeholder="Theme keywords, separated by commas">
                    <textarea id="world-canon-input" placeholder="Canon context: immutable truths, rules, timelines, taboo elements...">${escapeHtml(state.currentWorld.canonContext || '')}</textarea>

                    <div class="world-ai-panel">
                        <div class="ai-panel-header">
                            <div>
                                <div class="eyebrow">World Overview AI</div>
                                <div class="muted">Uses world summary and canon fields only — does not create or edit World entries.</div>
                            </div>
                        </div>
                        <textarea id="world-ai-prompt-input" placeholder="Example: help me turn this into a decaying oceanic empire with ritual astronomy and a strict caste system.">${escapeHtml(state.worldHeroAiPrompt || worldHeroPresetPrompt)}</textarea>
                        <div class="ai-button-row">
                            <button class="button-primary" data-world-ai-action="summary" ${state.worldHeroAiLoading ? 'disabled' : ''}>Generate Overview</button>
                            <button class="button-ghost" data-world-ai-action="canon-expand" ${state.worldHeroAiLoading ? 'disabled' : ''}>Expand Canon</button>
                            <button class="button-ghost" data-world-ai-action="canon-rewrite" ${state.worldHeroAiLoading ? 'disabled' : ''}>Rewrite Canon</button>
                        </div>
                        <div class="ai-result-panel">${escapeHtml(state.worldHeroAiResult || 'World-level AI output will appear here. It can directly rewrite the top overview and canon fields.')}</div>
                    </div>

                    <div class="hero-actions">
                        <button class="button-primary" data-create-entry-hero="true">New ${escapeHtml(state.activeSection)} Entry</button>
                        <button class="button-ghost" data-save-world="true">Save World</button>
                        <button class="button-danger" data-delete-world="true">Delete World</button>
                    </div>
                </div>

                <div class="world-stats">
                    <div class="stat-card">
                        <div class="eyebrow">Entries</div>
                        <strong>${stats.entryCount}</strong>
                    </div>
                    <div class="stat-card">
                        <div class="eyebrow">Characters</div>
                        <strong>${stats.characterCount}</strong>
                    </div>
                    <div class="stat-card">
                        <div class="eyebrow">Regions</div>
                        <strong>${stats.regionCount}</strong>
                    </div>
                    <div class="stat-card">
                        <div class="eyebrow">Recent Activity</div>
                        <div class="muted">${activities.length > 0 ? escapeHtml(activities[0].label) : 'No activity yet'}</div>
                    </div>
                    <div class="stat-card" style="grid-column: 1 / -1;">
                        <div class="eyebrow">Style Anchors</div>
                        <div class="anchor-strip">${anchorMarkup}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    dom.worldHero.querySelector('.world-hero-strip')?.addEventListener('click', (event) => {
        event.stopPropagation();
        state.worldHeroExpanded = !state.worldHeroExpanded;
        dom.worldHero.classList.toggle('is-expanded', state.worldHeroExpanded);
        dom.worldHero.classList.toggle('is-collapsed', !state.worldHeroExpanded);
        dom.worldHero.querySelector('.world-hero-strip').setAttribute('aria-expanded', state.worldHeroExpanded ? 'true' : 'false');
    });

    dom.worldHero.querySelector('#world-name-input')?.addEventListener('input', (event) => {
        state.currentWorld.name = event.target.value;
        queueSaveCurrentWorld();
        renderWorldList();
    });
    dom.worldHero.querySelector('#world-summary-input')?.addEventListener('input', (event) => {
        state.currentWorld.summary = event.target.value;
        queueSaveCurrentWorld();
    });
    dom.worldHero.querySelector('#world-theme-input')?.addEventListener('input', (event) => {
        state.currentWorld.themeKeywords = normalizeTagList(event.target.value);
        queueSaveCurrentWorld();
    });
    dom.worldHero.querySelector('#world-canon-input')?.addEventListener('input', (event) => {
        state.currentWorld.canonContext = event.target.value;
        queueSaveCurrentWorld();
    });
    dom.worldHero.querySelector('#world-ai-prompt-input')?.addEventListener('input', (event) => {
        state.worldHeroAiPrompt = event.target.value;
    });
    dom.worldHero.querySelector('[data-create-entry-hero="true"]')?.addEventListener('click', () => createEntry(state.activeSection));
    dom.worldHero.querySelector('[data-save-world="true"]')?.addEventListener('click', () => {
        clearTimeout(state.saveTimer);
        void saveCurrentWorld();
    });
    dom.worldHero.querySelector('[data-delete-world="true"]')?.addEventListener('click', () => {
        void deleteCurrentWorld();
    });
    dom.worldHero.querySelectorAll('[data-world-ai-action]').forEach((element) => {
        element.addEventListener('click', () => {
            void runWorldOverviewGeneration(element.dataset.worldAiAction);
        });
    });

    dom.worldHero.querySelectorAll('[data-preview-image]').forEach((element) => {
        element.addEventListener('click', () => {
            openLightbox(element.dataset.previewImage, element.dataset.previewCaption || '');
        });
    });
}

function getFilteredEntries() {
    const entries = getSectionEntries();
    return entries.filter((entry) => {
        const matchesSearch = !state.searchTerm || [
            entry.title,
            entry.summary,
            entry.content,
            (entry.tags || []).join(' ')
        ].join(' ').toLowerCase().includes(state.searchTerm);
        const matchesStatus = state.statusFilter === 'all' || entry.status === state.statusFilter;
        return matchesSearch && matchesStatus;
    });
}

function renderEntryBoard() {
    if (!dom.entryBoard || !dom.boardTitle) return;

    dom.boardTitle.textContent = state.currentWorld ? state.activeSection : 'Anvil';

    if (!state.currentWorld) {
        renderSectionBoardPeek([]);
        dom.entryBoard.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">No active world</div>
                <div>Create or select a world to see its section board.</div>
            </div>
        `;
        return;
    }

    const entries = getFilteredEntries();
    if (entries.length === 0) {
        renderSectionBoardPeek(entries);
        dom.entryBoard.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">${escapeHtml(state.activeSection)}</div>
                <div>No entries match the current filter.</div>
                <div class="empty-state-actions">
                    <button class="button-primary" data-create-entry-board="true">Create Entry</button>
                </div>
            </div>
        `;
        dom.entryBoard.querySelector('[data-create-entry-board="true"]')?.addEventListener('click', () => createEntry(state.activeSection));
        return;
    }

    renderSectionBoardPeek(entries);

    dom.entryBoard.innerHTML = entries.map((entry, index) => {
        const cover = entry.images?.[0]?.url || state.currentWorld.coverImage || '';
        const delay = Math.min(index * 0.05, 0.4);
        return `
            <article class="entry-card ${entry.id === state.activeEntryId ? 'active' : ''}" data-entry-id="${entry.id}" style="animation-delay: ${delay}s">
                ${cover ? `<img class="entry-card-cover" src="${escapeAttribute(cover)}" alt="${escapeAttribute(entry.title)}">` : ''}
                <div class="entry-card-header">
                    <span class="status-badge">${escapeHtml(entry.status || 'Seed')}</span>
                </div>
                <h3>${escapeHtml(entry.title || 'Untitled Entry')}</h3>
                <div class="entry-card-meta">${escapeHtml((entry.summary || 'No summary yet').slice(0, 180))}</div>
                <div class="entry-tags">
                    ${(entry.tags || []).slice(0, 4).map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
                </div>
            </article>
        `;
    }).join('');

    dom.entryBoard.querySelectorAll('[data-entry-id]').forEach((element) => {
        element.addEventListener('click', () => {
            state.activeEntryId = element.dataset.entryId;
            state.aiResult = '';
            state.aiContextSummary = null;
            renderEntryBoard();
            renderEntryStudio();
        });
    });
}

function renderEntryStudio() {
    if (!dom.studioContent || !dom.studioTitle) return;

    if (!state.currentWorld) {
        dom.studioTitle.textContent = 'Select a world';
        dom.studioContent.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">Entry Studio</div>
                <div>Your world-aware writing and concept tools will appear here once a world is active.</div>
            </div>
        `;
        return;
    }

    const entry = getSelectedEntry();
    if (!entry) {
        dom.studioTitle.textContent = 'No entry selected';
        dom.studioContent.innerHTML = `
            <div class="empty-state">
                <div class="eyebrow">${escapeHtml(state.activeSection)}</div>
                <div>Select an existing entry or create a new one to start editing.</div>
                <div class="empty-state-actions">
                    <button class="button-primary" data-create-entry-studio="true">Create Entry</button>
                </div>
            </div>
        `;
        dom.studioContent.querySelector('[data-create-entry-studio="true"]')?.addEventListener('click', () => createEntry(state.activeSection));
        return;
    }

    dom.studioTitle.textContent = entry.title || 'Untitled Entry';

    const allOtherEntries = SECTION_ORDER.flatMap((sectionName) => state.currentWorld.sections[sectionName] || [])
        .filter((candidate) => candidate.id !== entry.id);

    const imagesMarkup = entry.images?.length
        ? entry.images.map((image, index) => renderImageTile(image, index)).join('')
        : '<div class="muted">Upload references or generate concept art for this entry.</div>';

    const aiContextMarkup = renderAiContextSummary(state.aiContextSummary);

    dom.studioContent.innerHTML = `
        <section class="entry-form" style="animation-delay: 0s;">
            <div class="form-grid">
                <input id="entry-title-input" type="text" value="${escapeAttribute(entry.title || '')}" placeholder="Entry title">
                <select id="entry-status-input">
                    ${ENTRY_STATUSES.map((status) => `<option value="${status}" ${status === entry.status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
            </div>

            <textarea id="entry-summary-input" placeholder="Short production summary...">${escapeHtml(entry.summary || '')}</textarea>
            <textarea id="entry-content-input" placeholder="Detailed lore, design notes, production constraints, visual direction...">${escapeHtml(entry.content || '')}</textarea>

            <div class="form-grid">
                <input id="entry-tags-input" type="text" value="${escapeAttribute((entry.tags || []).join(', '))}" placeholder="Tags, separated by commas">
                <input id="entry-style-input" type="text" value="${escapeAttribute((entry.styleKeywords || []).join(', '))}" placeholder="Style keywords, separated by commas">
            </div>

            <div class="eyebrow">Linked Entries</div>
            <div class="link-chip-row">
                ${allOtherEntries.length > 0
                    ? allOtherEntries.map((candidate) => `
                        <div class="link-chip ${entry.links?.includes(candidate.id) ? 'active' : ''}" data-link-id="${candidate.id}">
                            ${escapeHtml(candidate.title)}
                        </div>
                    `).join('')
                    : '<div class="muted">No other entries yet.</div>'}
            </div>

            <div class="hero-actions" style="margin-top: 14px;">
                <button class="button-danger" data-delete-entry="true">Delete Entry</button>
            </div>
        </section>

        <section class="asset-panel" style="animation-delay: 0.08s;">
            <div class="asset-header">
                <div>
                    <div class="eyebrow">Concept Assets</div>
                    <div class="muted">Every image belongs to an entry. Use style anchors to teach Anvil your world's look.</div>
                </div>
                <div class="hero-actions">
                    <button class="button-ghost" data-upload-assets="true">Upload Assets</button>
                </div>
            </div>
            <input id="entry-asset-upload" type="file" accept="image/*" multiple hidden>
            <div class="asset-grid">${imagesMarkup}</div>
        </section>

        <section class="ai-panel" style="animation-delay: 0.16s;">
            <div class="ai-panel-header">
                <div>
                    <div class="eyebrow">AI Create Panel</div>
                    <div class="muted">Generate using world canon, linked entries and style anchors.</div>
                </div>
            </div>

            <textarea id="ai-prompt-input" placeholder="Direct this generation. Example: redesign this city as a desert trade hub while preserving the empire's sacred geometry.">${escapeHtml(entry.generationPresets?.lastPrompt || '')}</textarea>

            <div class="ai-button-row">
                <button class="button-primary" data-ai-kind="text" data-ai-action="write">Generate Text</button>
                <button class="button-ghost" data-ai-kind="text" data-ai-action="expand">Expand</button>
                <button class="button-ghost" data-ai-kind="text" data-ai-action="rewrite">Rewrite</button>
                <button class="button-ghost" data-ai-kind="text" data-ai-action="align">Align Check</button>
            </div>

            <div class="ai-button-row">
                <button class="button-primary" data-ai-kind="image" data-ai-action="visualize">Generate Image</button>
                <button class="button-ghost" data-ai-kind="image" data-ai-action="variant">Image Variant</button>
            </div>

            ${aiContextMarkup}
            <div class="ai-result-panel">${escapeHtml(state.aiResult || 'AI output will appear here. Generated text can write, expand or rewrite the current entry. Align Check reports lore conflicts without overwriting content.')}</div>
        </section>
    `;

    bindEntryStudioEvents(entry);
}

function renderBrainstormPanel() {
    if (!dom.brainstormPanel) return;

    if (!state.currentWorld) {
        dom.brainstormPanel.className = 'brainstorm-panel is-collapsed';
        dom.brainstormPanel.innerHTML = `
            <div class="brainstorm-panel-shell">
                <div class="brainstorm-header">
                    <div class="brainstorm-heading">
                        <div class="brainstorm-orb"></div>
                        <div class="brainstorm-heading-copy">
                            <strong>World Brainstorm</strong>
                            <span>Pick a world first to start world-aware ideation.</span>
                        </div>
                    </div>
                    <div class="brainstorm-toggle" aria-hidden="true"></div>
                </div>
            </div>
        `;
        return;
    }

    const session = getBrainstormSession();
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const operations = Array.isArray(state.brainstormPendingPatch) ? state.brainstormPendingPatch : [];
    const pendingCount = operations.filter((operation) => operation.status !== 'applied' && operation.status !== 'rejected').length;
    const activeEntry = getSelectedEntry();

    dom.brainstormPanel.className = `brainstorm-panel ${state.brainstormExpanded ? 'is-expanded' : 'is-collapsed'}`;
    dom.brainstormPanel.innerHTML = `
        <div class="brainstorm-panel-shell">
            <button class="brainstorm-header" type="button" data-brainstorm-toggle="true" aria-expanded="${state.brainstormExpanded ? 'true' : 'false'}">
                <div class="brainstorm-heading">
                    <div class="brainstorm-orb"></div>
                    <div class="brainstorm-heading-copy">
                        <strong>World Brainstorm</strong>
                        <span>${escapeHtml(state.currentWorld.name || 'Untitled World')} · AI can read the full world and propose batch changes.</span>
                    </div>
                </div>
                <div class="brainstorm-meta">
                    <span class="brainstorm-pill">${messages.length} turns</span>
                    <span class="brainstorm-pill">${pendingCount} pending changes</span>
                    <span class="brainstorm-pill">${escapeHtml(activeEntry?.title || state.activeSection)}</span>
                    <span class="brainstorm-toggle" aria-hidden="true"></span>
                </div>
            </button>

            <div class="brainstorm-body">
                <div class="brainstorm-body-inner">
                    <div class="brainstorm-column">
                        <section class="brainstorm-chat-shell">
                            <div class="brainstorm-chat-header">
                                <div>
                                    <div class="eyebrow">Brainstorm Chat</div>
                                    <div class="muted">Bound to this world. It can ideate from all current canon, entries and anchors.</div>
                                </div>
                            </div>
                            <div class="brainstorm-chat-log">${renderBrainstormMessages(messages)}</div>
                        </section>

                        <section class="brainstorm-composer">
                            <div class="brainstorm-toolbar">
                                <div class="brainstorm-toolbar-group">
                                    <div>
                                        <div class="eyebrow">Chat Direction</div>
                                        <div class="muted">Use this for ideation, restructuring, continuity planning, or batch edits.</div>
                                    </div>
                                </div>
                                <div class="brainstorm-toolbar-group">
                                    <div class="brainstorm-select-wrap">
                                        <select id="anvil-brainstorm-model" class="brainstorm-model-select">
                                            ${BRAINSTORM_MODEL_OPTIONS.map((option) => `
                                                <option value="${escapeAttribute(option.value)}" ${option.value === state.brainstormModel ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                                            `).join('')}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <textarea id="brainstorm-input" placeholder="Tell the AI what you want to explore or change. Example: help me brainstorm three rival city-states, then suggest a batch of new entries and canon updates.">${escapeHtml(state.brainstormDraft || '')}</textarea>

                            <div class="brainstorm-submit-row">
                                <div class="muted">Current focus: ${escapeHtml(activeEntry?.title || `Section ${state.activeSection}`)}</div>
                                <button class="button-primary" data-brainstorm-send="true" ${state.brainstormSending ? 'disabled' : ''}>${state.brainstormSending ? 'Thinking...' : 'Send to Brainstorm AI'}</button>
                            </div>
                        </section>
                    </div>

                    <aside class="brainstorm-side">
                        <section class="brainstorm-patch-panel">
                            <div class="brainstorm-patch-header">
                                <div>
                                    <div class="eyebrow">Planned Changes</div>
                                    <div class="muted">AI can suggest edits, but they only write into the world after your batch confirmation.</div>
                                </div>
                            </div>
                            <div class="brainstorm-patch-list">${renderBrainstormPatchList(operations)}</div>
                            <div class="brainstorm-patch-actions">
                                <div class="muted">${pendingCount > 0 ? `${pendingCount} pending operations are ready to apply.` : 'No pending operations yet.'}</div>
                                <button class="button-primary" data-brainstorm-apply="true" ${pendingCount === 0 || state.brainstormApplying ? 'disabled' : ''}>${state.brainstormApplying ? 'Applying...' : 'Apply This Batch'}</button>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    `;

    enhanceCustomSelect(dom.brainstormPanel.querySelector('#anvil-brainstorm-model'));
    bindBrainstormPanelEvents();
    syncBrainstormExpandedUi();

    const log = dom.brainstormPanel.querySelector('.brainstorm-chat-log');
    if (log) {
        requestAnimationFrame(() => {
            log.scrollTop = log.scrollHeight;
        });
    }
}

function renderBrainstormMessages(messages) {
    if (state.brainstormLoading) {
        return `
            <div class="brainstorm-empty">
                <div class="brainstorm-thinking">
                    <span>Loading world session</span>
                    <span class="brainstorm-thinking-dots"><span></span><span></span><span></span></span>
                </div>
            </div>
        `;
    }

    if (!Array.isArray(messages) || messages.length === 0) {
        return `
            <div class="brainstorm-empty">
                <div class="eyebrow">No brainstorm yet</div>
                <div>Start with a goal, tension, redesign direction, or vague vibe. The AI will brainstorm from this world's existing material and can return a batch of proposed edits.</div>
            </div>
        `;
    }

    const messageMarkup = messages.map((message) => {
        const role = message.role || 'assistant';
        const roleClass = role === 'user'
            ? 'brainstorm-message-user'
            : role === 'system'
                ? 'brainstorm-message-system'
                : 'brainstorm-message-assistant';
        const roleLabel = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Anvil AI';

        return `
            <article class="brainstorm-message ${roleClass}">
                <div class="brainstorm-message-meta">${escapeHtml(roleLabel)} · ${formatTimestamp(message.createdAt)}</div>
                <div>${escapeHtml(message.content || '')}</div>
            </article>
        `;
    }).join('');

    const thinkingMarkup = state.brainstormSending
        ? `
            <article class="brainstorm-message brainstorm-message-assistant">
                <div class="brainstorm-message-meta">Anvil AI · Thinking</div>
                <div class="brainstorm-thinking">
                    <span>Shaping ideas and possible edits</span>
                    <span class="brainstorm-thinking-dots"><span></span><span></span><span></span></span>
                </div>
            </article>
        `
        : '';

    return `${messageMarkup}${thinkingMarkup}`;
}

function renderBrainstormPatchList(operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
        return `
            <div class="brainstorm-side-empty">
                <div class="eyebrow">Awaiting proposal</div>
                <div>The AI can respond with structured operations like world summary updates, new entries, section moves, tag relinks, or entry deletions.</div>
            </div>
        `;
    }

    return operations.map((operation, index) => {
        const status = operation.status || 'pending';
        return `
            <article class="brainstorm-patch-card is-${escapeAttribute(status)}" style="animation-delay: ${Math.min(index * 0.04, 0.28)}s">
                <div class="brainstorm-patch-topline">
                    <span class="brainstorm-patch-type">${escapeHtml(operation.type || 'operation')}</span>
                    <span class="brainstorm-patch-status">${escapeHtml(status)}</span>
                </div>
                <div class="brainstorm-patch-desc">${escapeHtml(describeBrainstormOperation(operation))}</div>
                ${operation.reason ? `<div class="brainstorm-patch-reason">${escapeHtml(operation.reason)}</div>` : ''}
            </article>
        `;
    }).join('');
}

function bindBrainstormPanelEvents() {
    dom.brainstormPanel.querySelector('[data-brainstorm-toggle="true"]')?.addEventListener('click', () => {
        state.brainstormExpanded = !state.brainstormExpanded;
        syncBrainstormExpandedUi();
    });

    dom.brainstormPanel.querySelector('#brainstorm-input')?.addEventListener('input', (event) => {
        state.brainstormDraft = event.target.value;
    });

    dom.brainstormPanel.querySelector('#brainstorm-input')?.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void sendBrainstormMessage();
        }
    });

    dom.brainstormPanel.querySelector('#anvil-brainstorm-model')?.addEventListener('change', (event) => {
        state.brainstormModel = event.target.value;
        saveSidebarSettings();
    });

    dom.brainstormPanel.querySelector('[data-brainstorm-send="true"]')?.addEventListener('click', () => {
        void sendBrainstormMessage();
    });

    dom.brainstormPanel.querySelector('[data-brainstorm-apply="true"]')?.addEventListener('click', () => {
        void applyBrainstormPatch();
    });
}

function syncBrainstormExpandedUi() {
    if (!dom.brainstormPanel) return;
    dom.brainstormPanel.classList.toggle('is-expanded', state.brainstormExpanded);
    dom.brainstormPanel.classList.toggle('is-collapsed', !state.brainstormExpanded);
    dom.brainstormPanel.querySelector('[data-brainstorm-toggle="true"]')?.setAttribute('aria-expanded', state.brainstormExpanded ? 'true' : 'false');
}

function describeBrainstormOperation(operation) {
    if (!operation || !operation.type) return 'Unknown operation';

    if (operation.type === 'updateWorldFields') {
        return `Update world fields: ${Object.keys(operation.fields || {}).join(', ') || 'world metadata'}`;
    }

    if (operation.type === 'createEntry') {
        return `Create entry "${operation.entry?.title || 'Untitled Entry'}" in ${operation.section || 'World'}`;
    }

    if (operation.type === 'updateEntryFields') {
        return `Update entry ${operation.entryId || operation.titleHint || 'unknown'}: ${Object.keys(operation.fields || {}).join(', ') || 'content'}`;
    }

    if (operation.type === 'deleteEntry') {
        return `Delete entry ${operation.entryId || operation.titleHint || 'unknown'}`;
    }

    if (operation.type === 'moveEntrySection') {
        return `Move entry ${operation.entryId || operation.titleHint || 'unknown'} to ${operation.toSection || 'another section'}`;
    }

    if (operation.type === 'setEntryLinks') {
        return `Replace links for ${operation.entryId || operation.titleHint || 'unknown'} with ${Array.isArray(operation.links) ? operation.links.length : 0} target(s)`;
    }

    if (operation.type === 'setEntryTags') {
        return `Replace tags for ${operation.entryId || operation.titleHint || 'unknown'} with ${(operation.tags || []).join(', ') || 'no tags'}`;
    }

    return operation.type;
}

function renderImageTile(image, index = 0) {
    const isCover = image.url === state.currentWorld.coverImage;
    const isAnchor = state.currentWorld.styleAnchors?.some((anchor) => anchor.id === image.id);
    const delay = Math.min(index * 0.05, 0.4);

    return `
        <div class="image-tile" data-image-id="${image.id}" style="animation-delay: ${delay}s">
            <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.label || image.prompt || 'Anvil asset')}" data-preview-image="${escapeAttribute(image.url)}" data-preview-caption="${escapeAttribute(image.prompt || image.label || '')}">
            <div class="asset-caption">${escapeHtml(image.prompt || image.label || 'Untitled asset')}</div>
            <div class="image-tile-actions">
                <button class="image-tile-action ${isCover ? 'active' : ''}" data-image-action="cover" data-image-id="${image.id}">${isCover ? 'Cover' : 'Set Cover'}</button>
                <button class="image-tile-action ${isAnchor ? 'active' : ''}" data-image-action="anchor" data-image-id="${image.id}">${isAnchor ? 'Style Anchor' : 'Use as Anchor'}</button>
                <button class="image-tile-action" data-image-action="delete" data-image-id="${image.id}">Delete</button>
            </div>
        </div>
    `;
}

function bindEntryStudioEvents(entry) {
    dom.studioContent.querySelector('#entry-title-input')?.addEventListener('input', (event) => {
        entry.title = event.target.value;
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
        renderEntryBoard();
        dom.studioTitle.textContent = entry.title || 'Untitled Entry';
    });

    dom.studioContent.querySelector('#entry-status-input')?.addEventListener('change', (event) => {
        entry.status = event.target.value;
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
        renderEntryBoard();
    });

    dom.studioContent.querySelector('#entry-summary-input')?.addEventListener('input', (event) => {
        entry.summary = event.target.value;
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
        renderEntryBoard();
    });

    dom.studioContent.querySelector('#entry-content-input')?.addEventListener('input', (event) => {
        entry.content = event.target.value;
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-tags-input')?.addEventListener('input', (event) => {
        entry.tags = normalizeTagList(event.target.value);
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
        renderEntryBoard();
    });

    dom.studioContent.querySelector('#entry-style-input')?.addEventListener('input', (event) => {
        entry.styleKeywords = normalizeTagList(event.target.value);
        entry.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelectorAll('[data-link-id]').forEach((element) => {
        element.addEventListener('click', () => {
            const linkId = element.dataset.linkId;
            const nextLinks = new Set(entry.links || []);
            if (nextLinks.has(linkId)) {
                nextLinks.delete(linkId);
            } else {
                nextLinks.add(linkId);
            }
            entry.links = Array.from(nextLinks);
            entry.updatedAt = Date.now();
            queueSaveCurrentWorld();
            renderEntryStudio();
        });
    });

    dom.studioContent.querySelector('[data-delete-entry="true"]')?.addEventListener('click', deleteSelectedEntry);
    dom.studioContent.querySelector('[data-upload-assets="true"]')?.addEventListener('click', () => {
        dom.studioContent.querySelector('#entry-asset-upload')?.click();
    });
    dom.studioContent.querySelector('#entry-asset-upload')?.addEventListener('change', (event) => {
        void uploadEntryAssets(Array.from(event.target.files || []));
        event.target.value = '';
    });

    dom.studioContent.querySelectorAll('[data-image-action]').forEach((element) => {
        element.addEventListener('click', () => {
            void handleImageAction(element.dataset.imageAction, element.dataset.imageId);
        });
    });

    dom.studioContent.querySelectorAll('[data-preview-image]').forEach((element) => {
        element.addEventListener('click', () => {
            openLightbox(element.dataset.previewImage, element.dataset.previewCaption || '');
        });
    });

    dom.studioContent.querySelectorAll('[data-ai-kind]').forEach((element) => {
        element.addEventListener('click', () => {
            const kind = element.dataset.aiKind;
            const action = element.dataset.aiAction;
            if (kind === 'text') {
                void runTextGeneration(action);
            } else if (kind === 'image') {
                void runImageGeneration(action);
            }
        });
    });
}

async function uploadEntryAssets(files) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry || files.length === 0) return;

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        try {
            const formData = new FormData();
            formData.append('asset', file);
            formData.append('worldId', state.currentWorld.id);

            const response = await fetch('/gpt/anvil/asset/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }

            entry.images.unshift({
                id: `asset_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
                url: data.url,
                label: data.originalName || file.name,
                prompt: '',
                source: 'upload',
                createdAt: Date.now()
            });

            if (!state.currentWorld.coverImage) {
                state.currentWorld.coverImage = data.url;
            }

            pushActivity(`Uploaded asset to ${entry.title}`, 'asset_uploaded');
            queueSaveCurrentWorld();
            renderEntryStudio();
            renderEntryBoard();
            renderWorldHero();
        } catch (error) {
            console.error('Failed to upload Anvil asset:', error);
            alert(`Failed to upload Anvil asset: ${error.message}`);
        }
    }
}

async function handleImageAction(action, imageId) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) return;

    const image = entry.images.find((candidate) => candidate.id === imageId);
    if (!image) return;

    if (action === 'cover') {
        state.currentWorld.coverImage = image.url;
        pushActivity(`Set cover image from ${entry.title}`, 'cover_set');
        queueSaveCurrentWorld();
        renderWorldHero();
        renderEntryStudio();
        renderEntryBoard();
        return;
    }

    if (action === 'anchor') {
        const exists = state.currentWorld.styleAnchors.some((anchor) => anchor.id === image.id);
        if (exists) {
            state.currentWorld.styleAnchors = state.currentWorld.styleAnchors.filter((anchor) => anchor.id !== image.id);
            pushActivity(`Removed style anchor from ${entry.title}`, 'anchor_removed');
        } else {
            state.currentWorld.styleAnchors.unshift({
                id: image.id,
                url: image.url,
                label: image.prompt || image.label || entry.title,
                entryId: entry.id
            });
            pushActivity(`Added style anchor from ${entry.title}`, 'anchor_added');
        }
        queueSaveCurrentWorld();
        renderWorldHero();
        renderEntryStudio();
        return;
    }

    if (action === 'delete') {
        const confirmed = window.confirm('Delete this asset?');
        if (!confirmed) return;

        entry.images = entry.images.filter((candidate) => candidate.id !== image.id);
        state.currentWorld.styleAnchors = state.currentWorld.styleAnchors.filter((anchor) => anchor.id !== image.id);
        if (state.currentWorld.coverImage === image.url) {
            state.currentWorld.coverImage = entry.images[0]?.url || state.currentWorld.styleAnchors[0]?.url || '';
        }

        try {
            await fetch('/gpt/anvil/asset/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: image.url })
            });
        } catch (error) {
            console.error('Failed to remove Anvil asset from server:', error);
        }

        pushActivity(`Deleted asset from ${entry.title}`, 'asset_deleted');
        queueSaveCurrentWorld();
        renderWorldHero();
        renderEntryStudio();
        renderEntryBoard();
    }
}

function getTextGenerationConfig() {
    const model = dom.textModel?.value || 'gpt-4o-mini';
    if (model.startsWith('deepseek')) {
        return {
            model,
            apiUrl: config.urlDeepseek,
            apiKey: config.apikeyDeepseek
        };
    }

    return {
        model,
        apiUrl: config.urlGPT,
        apiKey: config.apikeyGPT
    };
}

function getBrainstormGenerationConfig() {
    const model = state.brainstormModel || 'gpt-4o-mini';
    if (model.startsWith('deepseek')) {
        return {
            model,
            apiUrl: config.urlDeepseek,
            apiKey: config.apikeyDeepseek
        };
    }

    return {
        model,
        apiUrl: config.urlGPT,
        apiKey: config.apikeyGPT
    };
}

function getImageGenerationConfig() {
    return {
        model: dom.imageModel?.value || 'gpt-image-1',
        apiUrl: config.urlPainter,
        apiKey: config.apikeyPainter,
        size: getResolution(dom.imageRatio?.value || '1:1', dom.imageQuality?.value || '1024')
    };
}

async function runWorldOverviewGeneration(mode) {
    if (!state.currentWorld || state.worldHeroAiLoading) return;

    const textConfig = getTextGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the settings.');
        return;
    }

    const userPrompt = state.worldHeroAiPrompt.trim();
    state.currentWorld.worldHeroAiPreset = {
        ...(state.currentWorld.worldHeroAiPreset || {}),
        prompt: userPrompt
    };

    state.worldHeroAiLoading = true;
    state.worldHeroAiResult = 'Generating world overview...';
    renderWorldHero();

    const action = mode === 'summary' ? 'rewrite' : mode === 'canon-expand' ? 'expand' : 'rewrite';

    try {
        const response = await fetch('/gpt/anvil/generate/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiUrl: textConfig.apiUrl,
                apiKey: textConfig.apiKey,
                model: textConfig.model,
                world: state.currentWorld,
                sectionName: 'World',
                entryId: null,
                action,
                userPrompt: userPrompt || (mode === 'summary'
                    ? 'Generate a compelling world overview for this setting.'
                    : mode === 'canon-expand'
                        ? 'Expand the canon and rules of this world in a coherent way.'
                        : 'Rewrite the canon context into a cleaner, stronger, more cohesive version.')
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        const generatedText = String(data.text || '').trim();
        state.worldHeroAiResult = generatedText || 'No text was returned.';

        if (mode === 'summary') {
            state.currentWorld.summary = generatedText;
        } else if (mode === 'canon-expand') {
            state.currentWorld.canonContext = [state.currentWorld.canonContext, generatedText].filter(Boolean).join('\n\n');
        } else {
            state.currentWorld.canonContext = generatedText;
        }

        pushActivity(`Generated ${mode} for world overview`, 'world_ai_generated');
        queueSaveCurrentWorld();
        renderWorldHero();
    } catch (error) {
        console.error('Failed world overview generation:', error);
        state.worldHeroAiResult = `World overview generation failed: ${error.message}`;
        renderWorldHero();
    } finally {
        state.worldHeroAiLoading = false;
        renderWorldHero();
    }
}

async function sendBrainstormMessage() {
    if (!state.currentWorld || state.brainstormSending) return;

    const userMessage = state.brainstormDraft.trim();
    if (!userMessage) {
        alert('Give the brainstorm AI a direction first.');
        return;
    }

    const textConfig = getBrainstormGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the settings.');
        return;
    }

    state.brainstormSending = true;
    state.brainstormExpanded = true;
    renderBrainstormPanel();

    try {
        const response = await fetch('/gpt/anvil/brainstorm/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                worldId: state.currentWorld.id,
                apiUrl: textConfig.apiUrl,
                apiKey: textConfig.apiKey,
                model: textConfig.model,
                message: userMessage,
                activeSection: state.activeSection,
                activeEntryId: state.activeEntryId
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        setBrainstormSession(data.session || createEmptyBrainstormSession(state.currentWorld.id));
        state.brainstormDraft = '';
        state.brainstormPendingPatch = Array.isArray(data.proposedOperations)
            ? data.proposedOperations
            : getBrainstormSession().lastProposedOperations || [];
        state.brainstormExpanded = true;
        renderBrainstormPanel();
    } catch (error) {
        console.error('Failed Anvil brainstorm chat:', error);
        alert(`Brainstorm request failed: ${error.message}`);
    } finally {
        state.brainstormSending = false;
        renderBrainstormPanel();
    }
}

async function applyBrainstormPatch() {
    if (!state.currentWorld || state.brainstormApplying) return;

    const operations = (state.brainstormPendingPatch || []).filter((operation) => operation.status !== 'applied' && operation.status !== 'rejected');
    if (operations.length === 0) return;

    state.brainstormApplying = true;
    renderBrainstormPanel();

    try {
        const response = await fetch('/gpt/anvil/brainstorm/apply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                worldId: state.currentWorld.id,
                operations
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        state.currentWorld = ensureWorldShape(data.world);
        upsertWorldSummary(state.currentWorld);
        state.activeSection = state.currentWorld.sections[state.activeSection] ? state.activeSection : 'World';
        ensureActiveEntry();
        setBrainstormSession(data.session || createEmptyBrainstormSession(state.currentWorld.id));
        state.brainstormPendingPatch = getBrainstormSession().lastProposedOperations || [];
        state.brainstormExpanded = true;
        renderAll();
    } catch (error) {
        console.error('Failed to apply Anvil brainstorm patch:', error);
        alert(`Applying brainstorm changes failed: ${error.message}`);
    } finally {
        state.brainstormApplying = false;
        renderBrainstormPanel();
    }
}

async function runTextGeneration(action) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) {
        alert('Select an entry first.');
        return;
    }

    const textConfig = getTextGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the top-right settings.');
        return;
    }

    const promptInput = dom.studioContent.querySelector('#ai-prompt-input');
    const userPrompt = promptInput?.value.trim() || '';
    entry.generationPresets = {
        ...(entry.generationPresets || {}),
        lastPrompt: userPrompt
    };

    state.aiResult = 'Generating text...';
    renderEntryStudio();

    try {
        const response = await fetch('/gpt/anvil/generate/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiUrl: textConfig.apiUrl,
                apiKey: textConfig.apiKey,
                model: textConfig.model,
                world: state.currentWorld,
                sectionName: state.activeSection,
                entryId: entry.id,
                action,
                userPrompt
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        const generatedText = String(data.text || '').trim();
        state.aiContextSummary = data.contextSummary || null;
        state.aiResult = generatedText || 'No text was returned.';
        entry.aiContextSummary = formatContextSummary(data.contextSummary);

        if (action === 'align') {
            renderEntryStudio();
            return;
        }

        if (action === 'rewrite') {
            entry.content = generatedText;
        } else if (action === 'expand') {
            entry.content = [entry.content, generatedText].filter(Boolean).join('\n\n');
        } else {
            entry.content = entry.content ? `${entry.content}\n\n${generatedText}` : generatedText;
        }

        if (!entry.summary) {
            entry.summary = deriveSummaryFromText(generatedText);
        }

        entry.updatedAt = Date.now();
        pushActivity(`Generated ${action} text for ${entry.title}`, 'text_generated');
        state.currentWorld.generationHistory.unshift({
            id: `gen_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            kind: 'text',
            action,
            entryId: entry.id,
            prompt: userPrompt,
            createdAt: Date.now()
        });
        queueSaveCurrentWorld();
        renderEntryStudio();
        renderEntryBoard();
    } catch (error) {
        console.error('Failed Anvil text generation:', error);
        state.aiResult = `Text generation failed: ${error.message}`;
        renderEntryStudio();
    }
}

async function runImageGeneration(action) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) {
        alert('Select an entry first.');
        return;
    }

    const imageConfig = getImageGenerationConfig();
    if (!imageConfig.apiUrl || !imageConfig.apiKey) {
        alert('Please configure your image model API in the top-right settings.');
        return;
    }

    const promptInput = dom.studioContent.querySelector('#ai-prompt-input');
    const userPrompt = promptInput?.value.trim() || '';
    entry.generationPresets = {
        ...(entry.generationPresets || {}),
        lastPrompt: userPrompt
    };

    state.aiResult = 'Generating concept art...';
    renderEntryStudio();

    try {
        const response = await fetch('/gpt/anvil/generate/image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiUrl: imageConfig.apiUrl,
                apiKey: imageConfig.apiKey,
                model: imageConfig.model,
                size: imageConfig.size,
                world: state.currentWorld,
                sectionName: state.activeSection,
                entryId: entry.id,
                action,
                userPrompt,
                referenceImages: [
                    ...(entry.images || []).map((image) => image.url),
                    ...(state.currentWorld.styleAnchors || []).map((anchor) => anchor.url)
                ]
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        const imageUrl = extractImageUrl(data);
        const generatedImage = {
            id: `asset_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            url: imageUrl,
            label: action === 'variant' ? 'AI Variant' : 'AI Concept',
            prompt: userPrompt || data.promptUsed || '',
            source: 'ai',
            model: imageConfig.model,
            size: imageConfig.size,
            createdAt: Date.now()
        };

        entry.images.unshift(generatedImage);
        entry.updatedAt = Date.now();
        state.aiContextSummary = data.contextSummary || null;
        const selectedReferenceLabel = data.contextSummary?.selectedReference?.label || data.referenceUsedLabel || '';
        const referenceCount = Array.isArray(data.contextSummary?.referenceCandidates) ? data.contextSummary.referenceCandidates.length : 0;
        state.aiResult = `Generated image with ${imageConfig.model}. ${selectedReferenceLabel ? `Primary reference: ${selectedReferenceLabel}. ` : ''}${referenceCount > 0 ? `Reference pool: ${referenceCount}.` : 'No explicit reference image was used.'}`;

        if (!state.currentWorld.coverImage) {
            state.currentWorld.coverImage = generatedImage.url;
        }

        pushActivity(`Generated ${action} image for ${entry.title}`, 'image_generated');
        state.currentWorld.generationHistory.unshift({
            id: `gen_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            kind: 'image',
            action,
            entryId: entry.id,
            prompt: userPrompt,
            createdAt: Date.now()
        });
        queueSaveCurrentWorld();
        renderWorldHero();
        renderEntryStudio();
        renderEntryBoard();
    } catch (error) {
        console.error('Failed Anvil image generation:', error);
        state.aiResult = `Image generation failed: ${error.message}`;
        renderEntryStudio();
    }
}

function deriveSummaryFromText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function formatContextSummary(summary) {
    if (!summary) return '';
    return `World: ${summary.world || ''}; Section: ${summary.section || ''}; Linked: ${(summary.linkedEntries || []).join(', ') || 'None'}; Anchors: ${(summary.styleAnchors || []).join(', ') || 'None'}; Selected ref: ${summary.selectedReference?.label || 'None'}`;
}

function renderAiContextSummary(summary) {
    if (!summary) return '';

    const worldFacts = [
        `World: ${summary.world || ''}`,
        `Section: ${summary.section || ''}`,
        `Entry: ${summary.entry || ''}`,
        `Theme Keywords: ${(summary.themeKeywords || []).join(', ') || 'None'}`,
        `World Summary Used: ${summary.worldSummaryUsed ? 'Yes' : 'No'}`,
        `Canon Context Used: ${summary.canonContextUsed ? 'Yes' : 'No'}`,
        `Reference Strategy: ${summary.referenceStrategy || 'Default'}`
    ];

    const linkedEntries = renderAiContextTagList('Linked Entries', summary.linkedEntries);
    const sectionPeers = renderAiContextTagList('Section Peers', summary.sectionPeers);
    const styleAnchors = renderAiContextTagList('Style Anchors', summary.styleAnchors);
    const entryImages = renderAiContextTagList('Entry Images', summary.entryImages);
    const selectedReference = summary.selectedReference
        ? `<div class="ai-context-reference"><strong>Selected Reference</strong><span>${escapeHtml(summary.selectedReference.label || summary.selectedReference.url || 'Reference')}</span><span>${escapeHtml(summary.selectedReference.source || '')}</span></div>`
        : `<div class="ai-context-reference"><strong>Selected Reference</strong><span>None</span></div>`;
    const referenceCandidates = Array.isArray(summary.referenceCandidates) && summary.referenceCandidates.length > 0
        ? `
            <div class="ai-context-group">
                <strong>Reference Pool</strong>
                <div class="ai-context-tags">
                    ${summary.referenceCandidates.map((reference) => `
                        <span class="tag-chip">${escapeHtml(reference.label || reference.url || 'Reference')}</span>
                    `).join('')}
                </div>
            </div>
        `
        : '';

    return `
        <div class="ai-context-list">
            ${worldFacts.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
        </div>
        ${selectedReference}
        ${linkedEntries}
        ${sectionPeers}
        ${styleAnchors}
        ${entryImages}
        ${referenceCandidates}
    `;
}

function renderAiContextTagList(title, items) {
    const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];

    return `
        <div class="ai-context-group">
            <strong>${escapeHtml(title)}</strong>
            <div class="ai-context-tags">
                ${normalizedItems.length > 0
                    ? normalizedItems.map((item) => `<span class="tag-chip">${escapeHtml(item)}</span>`).join('')
                    : '<span class="muted">None</span>'}
            </div>
        </div>
    `;
}

function extractImageUrl(data) {
    const firstItem = Array.isArray(data?.data) ? data.data[0] : null;
    const imageUrl =
        firstItem?.url ||
        firstItem?.image_url ||
        firstItem?.imageUrl ||
        data?.output?.[0]?.url ||
        data?.output?.[0]?.image_url;

    if (!imageUrl) {
        throw new Error('Image response format is unsupported.');
    }

    return imageUrl;
}

function getResolution(ratio, quality) {
    const base = Number.parseInt(quality, 10) || 1024;
    const [wRatio, hRatio] = String(ratio || '1:1').split(':').map(Number);

    if (!wRatio || !hRatio) {
        return `${base}x${base}`;
    }

    let width;
    let height;

    if (wRatio >= hRatio) {
        width = base;
        height = Math.round((base / wRatio) * hRatio);
    } else {
        height = base;
        width = Math.round((base / hRatio) * wRatio);
    }

    width = Math.round(width / 64) * 64;
    height = Math.round(height / 64) * 64;
    return `${width}x${height}`;
}

function openLightbox(src, caption) {
    if (!dom.lightbox || !dom.lightboxImg || !dom.lightboxCaption) return;
    dom.lightboxImg.src = src;
    dom.lightboxCaption.textContent = caption || '';
    dom.lightbox.classList.add('active');
}

function closeLightbox() {
    dom.lightbox?.classList.remove('active');
}

function formatTimestamp(value) {
    if (!value) return 'Just now';

    try {
        return new Date(value).toLocaleString();
    } catch (_error) {
        return 'Just now';
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
