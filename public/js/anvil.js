import { config } from './configEvent.js';
import { fetchAnvilWorld, fetchAnvilWorldsList } from './anvil-world-client.js';

const SECTION_ORDER = [
    'World',
    'Timeline',
    'Regions',
    'Factions',
    'Characters',
    'Artifacts',
    'Creatures',
    'Architecture',
    'VisualLanguage'
];

/** Only section keys that exist on the world; template names first (when present), then other keys A–Z. */
function getWorldSectionNamesInOrder(world) {
    if (!world?.sections) return [...SECTION_ORDER];
    const keys = new Set(Object.keys(world.sections));
    const ordered = [];
    SECTION_ORDER.forEach((name) => {
        if (keys.has(name)) ordered.push(name);
    });
    Object.keys(world.sections)
        .sort((a, b) => a.localeCompare(b))
        .forEach((k) => {
            if (!ordered.includes(k)) ordered.push(k);
        });
    return ordered.length > 0 ? ordered : [...SECTION_ORDER];
}

const ENTRY_STATUSES = ['Seed', 'Draft', 'Review', 'Locked'];

/** Collapsed Section Board strip: max thumbnails before scrolling (total count still shown in badge). */
const SECTION_BOARD_PEEK_MAX = 24;

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
    aiBusy: false,
    aiBusyMessage: '',
    brainstormSessionsByWorldId: {},
    brainstormDraft: '',
    brainstormModel: 'gpt-4o-mini',
    brainstormSending: false,
    brainstormLoading: false,
    brainstormExpanded: false,
    brainstormPendingTurn: null,
    brainstormTestRunning: false,
    brainstormAttachments: [],
    copilotScenarioFixtureUrl: null,
    copilotThreadStickToBottom: true,
    copilotStreamAbortController: null,
    worldHeroAiPrompt: '',
    worldHeroAiResult: '',
    worldHeroAiLoading: false,
    worldHeroVisualLoading: false,
    worldHeroVisualResult: '',
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
    await loadWorldsFromUrlOrDefault();
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

        state.brainstormModel = settings.brainstormModel || settings.textModel || 'gpt-4o-mini';

        if (settings.textModel && dom.textModel) { dom.textModel.value = settings.textModel; dom.textModel.dispatchEvent(new Event('change')); }
        if (settings.imageModel && dom.imageModel) { dom.imageModel.value = settings.imageModel; dom.imageModel.dispatchEvent(new Event('change')); }
        if (settings.imageRatio && dom.imageRatio) { dom.imageRatio.value = settings.imageRatio; dom.imageRatio.dispatchEvent(new Event('change')); }
        if (settings.imageQuality && dom.imageQuality) { dom.imageQuality.value = settings.imageQuality; dom.imageQuality.dispatchEvent(new Event('change')); }
    } catch (error) {
        console.error('Failed to load Anvil settings:', error);
    }
}

function getBrainstormTextModelOptionsHtml() {
    return dom.textModel?.innerHTML || '';
}

function syncBrainstormModelSelectValue(select) {
    if (!select || !select.options.length) return;
    select.value = state.brainstormModel;
    if (select.value !== state.brainstormModel) {
        const firstVal = select.options[0]?.value;
        if (firstVal) {
            state.brainstormModel = firstVal;
            select.value = firstVal;
        }
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
        parentId: null,
        timelineKind: 'none',
        timelineYear: null,
        aiContextSummary: '',
        generationPresets: {
            textPrompt: '',
            imagePrompt: ''
        },
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
            Timeline: [],
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
        generationHistory: [],
        worldHeroVisualPreset: { coverPrompt: '', anchorPrompt: '' }
    };
}

function ensureWorldShape(world) {
    if (!world) return null;

    const sections = {};
    getWorldSectionNamesInOrder(world).forEach((sectionName) => {
        sections[sectionName] = Array.isArray(world.sections?.[sectionName])
            ? world.sections[sectionName].map((entry) => {
                  const merged = {
                      images: [],
                      references: [],
                      tags: [],
                      links: [],
                      styleKeywords: [],
                      generationPresets: {
                          textPrompt: entry?.generationPresets?.textPrompt || entry?.generationPresets?.lastPrompt || '',
                          imagePrompt: entry?.generationPresets?.imagePrompt || ''
                      },
                      ...entry,
                      section: entry.section || sectionName
                  };
                  merged.parentId =
                      merged.parentId != null && String(merged.parentId).trim()
                          ? String(merged.parentId).trim()
                          : null;
                  merged.timelineKind = merged.timelineKind === 'year' ? 'year' : 'none';
                  merged.timelineYear =
                      merged.timelineKind === 'year' &&
                      merged.timelineYear != null &&
                      Number.isFinite(Number(merged.timelineYear))
                          ? Number(merged.timelineYear)
                          : null;
                  return merged;
              })
            : [];
    });

    return {
        ...world,
        themeKeywords: normalizeTagList(world.themeKeywords),
        styleAnchors: Array.isArray(world.styleAnchors) ? world.styleAnchors : [],
        recentActivities: Array.isArray(world.recentActivities) ? world.recentActivities : [],
        generationHistory: Array.isArray(world.generationHistory) ? world.generationHistory : [],
        worldHeroVisualPreset: {
            coverPrompt: String(world.worldHeroVisualPreset?.coverPrompt || ''),
            anchorPrompt: String(world.worldHeroVisualPreset?.anchorPrompt || '')
        },
        sections
    };
}

function createEmptyBrainstormSession(worldId) {
    return {
        worldId,
        messages: [],
        openAiMessages: [],
        lastProposedOperations: [],
        worldCheckpoints: [],
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
        openAiMessages: Array.isArray(session.openAiMessages) ? session.openAiMessages : [],
        lastProposedOperations: Array.isArray(session.lastProposedOperations) ? session.lastProposedOperations : [],
        worldCheckpoints: Array.isArray(session.worldCheckpoints) ? session.worldCheckpoints : []
    };
}

function collectPendingPlanProposalIds(session) {
    const ids = [];
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (const msg of messages) {
        if (msg.role !== 'assistant' || !Array.isArray(msg.blocks)) continue;
        for (const b of msg.blocks) {
            if (b.type === 'plan_options' && b.state === 'pending' && b.proposalId) {
                ids.push(b.proposalId);
            }
        }
    }
    return ids;
}

async function dismissCopilotPendingPlanOptions() {
    const worldId = state.currentWorld?.id;
    if (!worldId) return;
    const ids = collectPendingPlanProposalIds(getBrainstormSession(worldId));
    if (!ids.length) return;
    try {
        const response = await fetch(
            `/gpt/anvil/brainstorm/session/${encodeURIComponent(worldId)}/plan-options`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actions: ids.map((proposalId) => ({ proposalId, state: 'dismissed' }))
                })
            }
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.session) {
            setBrainstormSession(data.session);
        }
    } catch (err) {
        console.warn('[Anvil Copilot] Could not dismiss pending plan options:', err);
    }
}

async function patchCopilotPlanOptions(actions) {
    const worldId = state.currentWorld?.id;
    if (!worldId || !actions?.length) {
        throw new Error(!worldId ? 'No world selected.' : 'No plan actions to apply.');
    }
    const response = await fetch(
        `/gpt/anvil/brainstorm/session/${encodeURIComponent(worldId)}/plan-options`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions })
        }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    }
    if (data.session) {
        setBrainstormSession(data.session);
    } else {
        console.warn('[Anvil Copilot] plan-options: response OK but missing session payload');
    }
    return true;
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

async function loadWorldsFromUrlOrDefault() {
    const params = new URLSearchParams(window.location.search);
    const worldParam = params.get('world');
    const entryParam = params.get('entry');

    try {
        const { response, data } = await fetchAnvilWorldsList();
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        state.worlds = Array.isArray(data) ? data : [];

        if (state.worlds.length > 0) {
            const preferredWorldId =
                worldParam && state.worlds.some((w) => w.id === worldParam)
                    ? worldParam
                    : (state.currentWorld?.id || state.worlds[0].id);
            await selectWorld(preferredWorldId);
            if (entryParam && selectEntryById(entryParam)) {
                renderAll();
                document.querySelector('.entry-studio-main')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        state.currentWorld = null;
        state.activeEntryId = null;
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
        const { response, data } = await fetchAnvilWorld(worldId);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        state.currentWorld = ensureWorldShape(data);
        await loadBrainstormSession(worldId);
        state.activeSection = state.currentWorld.sections[state.activeSection] ? state.activeSection : 'World';
        state.worldHeroExpanded = false;
        state.brainstormExpanded = getBrainstormSession(worldId).messages.length > 0;
        state.brainstormDraft = '';
        state.brainstormAttachments = [];
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
        state.brainstormAttachments = [];
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
        state.brainstormDraft = '';

        if (state.worlds.length > 0) {
            await selectWorld(state.worlds[0].id);
            return;
        }

        updateTimelineSidebarLink();
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

function flattenWorldEntries(world) {
    if (!world?.sections) return [];
    return getWorldSectionNamesInOrder(world).flatMap((sectionName) =>
        (world.sections[sectionName] || []).map((e) => ({ ...e, section: sectionName }))
    );
}

function findEntryByIdInWorld(world, entryId) {
    const id = String(entryId || '').trim();
    if (!id) return null;
    return flattenWorldEntries(world).find((e) => String(e.id) === id) || null;
}

function selectEntryById(entryId) {
    const id = String(entryId || '').trim();
    if (!state.currentWorld || !id) return false;
    const found = findEntryByIdInWorld(state.currentWorld, id);
    if (!found) return false;
    state.activeSection = found.section || getWorldSectionNamesInOrder(state.currentWorld)[0];
    state.activeEntryId = found.id;
    return true;
}

function getDescendantEntryIds(world, rootId) {
    const root = String(rootId || '');
    const byParent = new Map();
    for (const e of flattenWorldEntries(world)) {
        const p = e.parentId != null && String(e.parentId).trim() ? String(e.parentId).trim() : '';
        if (!p) continue;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(String(e.id));
    }
    const out = new Set();
    const stack = [...(byParent.get(root) || [])];
    while (stack.length) {
        const cur = String(stack.pop());
        if (out.has(cur)) continue;
        out.add(cur);
        const kids = byParent.get(cur);
        if (kids) stack.push(...kids);
    }
    return out;
}

function getChildEntriesForEntry(entry, world) {
    const id = String(entry.id);
    return flattenWorldEntries(world).filter((e) => e.parentId != null && String(e.parentId) === id);
}

function updateTimelineSidebarLink() {
    const a = document.getElementById('anvil-timeline-link');
    if (!a) return;
    const wid = state.currentWorld?.id;
    if (wid) {
        a.href = `anvil-timeline.html?world=${encodeURIComponent(wid)}`;
        a.classList.remove('is-disabled');
        a.removeAttribute('aria-disabled');
    } else {
        a.href = 'anvil-timeline.html';
        a.classList.add('is-disabled');
        a.setAttribute('aria-disabled', 'true');
    }
}

function buildEntryParentSelectOptions(entry, world) {
    const selfId = String(entry.id);
    const forbidden = new Set([selfId, ...getDescendantEntryIds(world, selfId)]);
    const all = flattenWorldEntries(world).filter((e) => !forbidden.has(String(e.id)));
    const years = all
        .filter((e) => e.timelineKind === 'year')
        .sort((a, b) => (Number(a.timelineYear) || 0) - (Number(b.timelineYear) || 0));
    const rest = all
        .filter((e) => e.timelineKind !== 'year')
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    const cur = entry.parentId != null && String(entry.parentId).trim() ? String(entry.parentId).trim() : '';
    let html = '<option value="">No parent</option>';
    if (years.length) {
        html += '<optgroup label="Year anchors">';
        for (const y of years) {
            const sel = cur === String(y.id) ? ' selected' : '';
            html += `<option value="${escapeAttribute(y.id)}"${sel}>${escapeHtml(`[${y.timelineYear}] ${y.title || 'Year'}`)}</option>`;
        }
        html += '</optgroup>';
    }
    if (rest.length) {
        html += '<optgroup label="Entries">';
        for (const r of rest) {
            const sel = cur === String(r.id) ? ' selected' : '';
            html += `<option value="${escapeAttribute(r.id)}"${sel}>${escapeHtml(`${r.title || 'Untitled'} (${r.section})`)}</option>`;
        }
        html += '</optgroup>';
    }
    return html;
}

function entryLinkSetHas(links, linkId) {
    const id = String(linkId || '');
    return (Array.isArray(links) ? links : []).some((x) => String(x) === id);
}

function createEntry(sectionName = state.activeSection) {
    if (!state.currentWorld) {
        alert('Create a world first.');
        return;
    }

    const title = `New ${sectionName} Entry`;

    if (!state.currentWorld.sections[sectionName]) {
        state.currentWorld.sections[sectionName] = [];
    }
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

    const removedId = entry.id;
    state.currentWorld.sections[state.activeSection] = getSectionEntries().filter((candidate) => candidate.id !== removedId);
    for (const sectionName of getWorldSectionNamesInOrder(state.currentWorld)) {
        for (const e of state.currentWorld.sections[sectionName] || []) {
            if (e.parentId != null && String(e.parentId) === String(removedId)) {
                e.parentId = null;
            }
        }
    }
    removeAnchorsForDeletedEntry(entry);
    state.activeEntryId = null;
    ensureActiveEntry();
    pushActivity(`Deleted entry ${entry.title}`, 'entry_deleted');
    queueSaveCurrentWorld();
    renderAll();
}

function removeAnchorsForDeletedEntry(entry) {
    const entryImageIds = new Set((entry.images || []).map((image) => image.id));
    state.currentWorld.styleAnchors = state.currentWorld.styleAnchors.filter((anchor) => !entryImageIds.has(anchor.id) && anchor.entryId !== entry.id);
    if (entry.images?.some((image) => image.url === state.currentWorld.coverImage)) {
        state.currentWorld.coverImage = '';
    }
}

function removeWorldCover() {
    if (!state.currentWorld || !String(state.currentWorld.coverImage || '').trim()) return;
    state.currentWorld.coverImage = '';
    pushActivity('Removed world cover image', 'world_cover_removed');
    queueSaveCurrentWorld();
    renderAll();
}

function removeWorldStyleAnchor(anchorId) {
    if (!state.currentWorld || !anchorId) return;
    const before = state.currentWorld.styleAnchors.length;
    state.currentWorld.styleAnchors = state.currentWorld.styleAnchors.filter((anchor) => anchor.id !== anchorId);
    if (state.currentWorld.styleAnchors.length === before) return;
    pushActivity('Removed style anchor', 'anchor_removed');
    queueSaveCurrentWorld();
    renderAll();
}

function getEntryPrimaryImage(entry) {
    return entry?.images?.[0]?.url || '';
}

function getWorldHeroCoverImage() {
    // World overview strip uses only world.coverImage — never borrow entry or style-anchor images.
    return String(state.currentWorld?.coverImage || '').trim();
}

function getWorldOverviewEntry() {
    return state.currentWorld?.sections?.World?.[0] || null;
}

function renderWorldStyleAnchorsStrip(managed) {
    const anchors = state.currentWorld?.styleAnchors || [];
    if (anchors.length === 0) {
        return '<div class="muted">No style anchors yet. Generate one below or mark images from entries.</div>';
    }
    return anchors.map((anchor) => `
        <div class="anchor-card ${managed ? 'anchor-card-managed' : ''}">
            ${managed ? `<button type="button" class="anchor-remove-btn" data-remove-anchor-id="${escapeAttribute(anchor.id)}" title="Remove anchor" aria-label="Remove anchor">×</button>` : ''}
            <img src="${escapeAttribute(anchor.url)}" alt="${escapeAttribute(anchor.label || 'Style anchor')}" data-preview-image="${escapeAttribute(anchor.url)}" data-preview-caption="${escapeAttribute(anchor.label || '')}">
            <div class="asset-caption">${escapeHtml(anchor.label || 'Style Anchor')}</div>
        </div>
    `).join('');
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
    const names = getWorldSectionNamesInOrder(world);
    let entryCount = 0;
    names.forEach((sectionName) => {
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
        sectionCount: names.length,
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
    // Do not renderAll() here — it rebuilds studio/world hero inputs and kills focus + IME composition.
    renderWorldList();
    renderSectionList();
    renderEntryBoard({ suppressCardIntro: true });
    renderSectionBoardPeek(getFilteredEntries());

    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        void saveCurrentWorld();
    }, 450);
}

function setAiBusy(isBusy, message = '') {
    state.aiBusy = isBusy;
    state.aiBusyMessage = isBusy ? (message || 'AI is working...') : '';
}

function renderGlobalBusyOverlay() {
    const existing = document.getElementById('anvil-ai-busy-overlay');
    if (!state.aiBusy) {
        existing?.remove();
        document.body.classList.remove('anvil-ai-busy');
        return;
    }

    document.body.classList.add('anvil-ai-busy');

    if (existing) {
        const messageNode = existing.querySelector('.anvil-ai-busy-message');
        if (messageNode) {
            messageNode.textContent = state.aiBusyMessage || 'AI is working...';
        }
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'anvil-ai-busy-overlay';
    overlay.className = 'anvil-ai-busy-overlay';
    overlay.innerHTML = `
        <div class="anvil-ai-busy-card" role="status" aria-live="polite" aria-busy="true">
            <div class="anvil-ai-busy-spinner" aria-hidden="true"></div>
            <div class="anvil-ai-busy-title">AI Generating</div>
            <div class="anvil-ai-busy-message">${escapeHtml(state.aiBusyMessage || 'AI is working...')}</div>
            <div class="anvil-ai-busy-subtitle">Other actions are temporarily locked to keep the world state consistent.</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function saveCurrentWorld() {
    if (!state.currentWorld) return;
    if (state.saveInFlight) {
        state.saveQueued = true;
        return;
    }

    state.saveInFlight = true;
    const frozenPayload = JSON.parse(JSON.stringify(state.currentWorld));
    const frozenUpdatedAt = frozenPayload.updatedAt;

    try {
        const response = await fetch(`/gpt/anvil/world/${encodeURIComponent(state.currentWorld.id)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(frozenPayload)
        });

        const world = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(world.error || `HTTP error! status: ${response.status}`);
        }

        const normalized = ensureWorldShape(world);
        // If the user kept editing after this payload was sent, do not clobber newer in-memory state.
        if (state.currentWorld.updatedAt === frozenUpdatedAt) {
            state.currentWorld = normalized;
        }
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
    updateTimelineSidebarLink();
    renderWorldList();
    renderSectionList();
    renderWorldHero();
    renderEntryBoard();
    renderEntryStudio();
    renderBrainstormPanel();
    renderGlobalBusyOverlay();
}

function syncWorldHeroNameLabels() {
    if (!dom.worldHero || !state.currentWorld) return;
    const name = state.currentWorld.name || 'Untitled World';
    const stripStrong = dom.worldHero.querySelector('.world-hero-strip-title strong');
    if (stripStrong) stripStrong.textContent = name;
    const panelH1 = dom.worldHero.querySelector('.world-meta h1');
    if (panelH1) panelH1.textContent = name;
}

function renderSectionBoardPeek(entries = null) {
    if (!dom.sectionBoardPeek) return;

    if (!state.currentWorld) {
        dom.sectionBoardPeek.innerHTML = `
            <div class="section-board-peek-empty muted">No world</div>
            <div class="section-board-peek-count">0</div>
        `;
        return;
    }

    const previewEntries = (entries || getFilteredEntries()).slice(0, SECTION_BOARD_PEEK_MAX);
    const count = entries ? entries.length : getFilteredEntries().length;
    const cardsMarkup = previewEntries.length > 0
        ? previewEntries.map((entry) => {
            const cover = getEntryPrimaryImage(entry);
            return `
                <div class="section-board-peek-card">
                    ${cover ? `<img src="${escapeAttribute(cover)}" alt="${escapeAttribute(entry.title || 'Entry')}">` : ''}
                    <div class="section-board-peek-card-label">${escapeHtml(entry.title || 'Untitled')}</div>
                </div>
            `;
        }).join('')
        : `
            <div class="section-board-peek-card section-board-peek-card-empty">
                <div class="section-board-peek-empty-label">No entries</div>
            </div>
        `;

    dom.sectionBoardPeek.innerHTML = `
        <div class="section-board-peek-grid">${cardsMarkup}</div>
        <div class="section-board-peek-count">${count}</div>
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

    dom.sectionList.innerHTML = getWorldSectionNamesInOrder(state.currentWorld).map((sectionName) => {
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
    const visualPreset = state.currentWorld.worldHeroVisualPreset || { coverPrompt: '', anchorPrompt: '' };
    const heroCover = getWorldHeroCoverImage();
    const textAiBusy = state.worldHeroAiLoading || state.aiBusy;
    const visualAiBusy = state.worldHeroVisualLoading || state.aiBusy;
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
                                <div class="eyebrow">World Text AI</div>
                                <div class="muted">Text only — overview, canon and world entry fields. Cover and style anchors use the panel on the right.</div>
                            </div>
                        </div>
                        <textarea id="world-ai-prompt-input" placeholder="Example: help me turn this into a decaying oceanic empire with ritual astronomy and a strict caste system.">${escapeHtml(state.worldHeroAiPrompt || worldHeroPresetPrompt)}</textarea>
                        <div class="ai-button-row">
                            <button class="button-primary" data-world-ai-action="complete" ${textAiBusy || state.worldHeroVisualLoading ? 'disabled' : ''}>Complete World</button>
                            <span class="ai-button-pair">
                                <button class="button-ghost" data-world-ai-action="summary" ${textAiBusy || state.worldHeroVisualLoading ? 'disabled' : ''}>Generate Overview</button>
                                <button class="button-ghost" data-world-ai-action="modify-world" ${textAiBusy || state.worldHeroVisualLoading ? 'disabled' : ''}>Modify Text</button>
                            </span>
                            <button class="button-ghost" data-world-ai-action="canon-expand" ${textAiBusy || state.worldHeroVisualLoading ? 'disabled' : ''}>Expand Canon</button>
                            <button class="button-ghost" data-world-ai-action="canon-rewrite" ${textAiBusy || state.worldHeroVisualLoading ? 'disabled' : ''}>Rewrite Canon</button>
                        </div>
                        <div class="ai-result-panel">${escapeHtml(state.worldHeroAiResult || 'World text AI output will appear here.')}</div>
                    </div>

                    <div class="hero-actions">
                        <button class="button-primary" data-create-entry-hero="true">New ${escapeHtml(state.activeSection)} Entry</button>
                        <button class="button-ghost" data-save-world="true">Save World</button>
                        <button class="button-danger" data-delete-world="true">Delete World</button>
                    </div>
                </div>

                <div class="world-stats">
                    <div class="stat-card world-visual-ai-panel" style="grid-column: 1 / -1;">
                        <div class="ai-panel-header">
                            <div>
                                <div class="eyebrow">World Cover & Style AI</div>
                                <div class="muted">Separate from text AI — generate the world cover and style anchor images here.</div>
                            </div>
                        </div>
                        <div class="world-cover-visual-row">
                            <div class="world-cover-visual-thumb">
                                ${heroCover ? `<img class="world-cover-image" src="${escapeAttribute(heroCover)}" alt="${escapeAttribute(state.currentWorld.name || 'World cover')}" data-preview-image="${escapeAttribute(heroCover)}" data-preview-caption="${escapeAttribute(state.currentWorld.name || 'World cover')}">` : '<div class="world-cover-image world-cover-image-empty">No cover</div>'}
                            </div>
                            <div class="world-cover-visual-actions">
                                ${heroCover ? `<button type="button" class="button-ghost" data-world-remove-cover="true" ${visualAiBusy ? 'disabled' : ''}>Remove Cover</button>` : ''}
                            </div>
                        </div>
                        <label class="eyebrow world-visual-label" for="world-cover-image-prompt">Cover image prompt</label>
                        <textarea id="world-cover-image-prompt" placeholder="Describe the world cover (mood, composition, key motifs...)">${escapeHtml(visualPreset.coverPrompt || '')}</textarea>
                        <div class="ai-button-row">
                            <button type="button" class="button-primary" data-world-visual-action="cover" ${visualAiBusy || state.worldHeroAiLoading ? 'disabled' : ''}>Generate Cover</button>
                        </div>
                        <div class="eyebrow world-visual-label">Style anchors</div>
                        <div class="anchor-strip anchor-strip-managed">${renderWorldStyleAnchorsStrip(true)}</div>
                        <label class="eyebrow world-visual-label" for="world-anchor-image-prompt">Style anchor image prompt</label>
                        <textarea id="world-anchor-image-prompt" placeholder="Describe a reference image for consistent world look (palette, line, materials...)">${escapeHtml(visualPreset.anchorPrompt || '')}</textarea>
                        <div class="ai-button-row">
                            <button type="button" class="button-primary" data-world-visual-action="anchor" ${visualAiBusy || state.worldHeroAiLoading ? 'disabled' : ''}>Generate Style Anchor</button>
                        </div>
                        <div class="ai-result-panel world-visual-result-panel">${escapeHtml(state.worldHeroVisualResult || 'Image AI status will appear here.')}</div>
                    </div>
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
        syncWorldHeroNameLabels();
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

    dom.worldHero.querySelector('#world-cover-image-prompt')?.addEventListener('input', (event) => {
        state.currentWorld.worldHeroVisualPreset = state.currentWorld.worldHeroVisualPreset || {};
        state.currentWorld.worldHeroVisualPreset.coverPrompt = event.target.value;
        queueSaveCurrentWorld();
    });
    dom.worldHero.querySelector('#world-anchor-image-prompt')?.addEventListener('input', (event) => {
        state.currentWorld.worldHeroVisualPreset = state.currentWorld.worldHeroVisualPreset || {};
        state.currentWorld.worldHeroVisualPreset.anchorPrompt = event.target.value;
        queueSaveCurrentWorld();
    });

    dom.worldHero.querySelector('[data-world-remove-cover="true"]')?.addEventListener('click', () => {
        if (state.aiBusy || state.worldHeroVisualLoading) return;
        removeWorldCover();
    });

    dom.worldHero.querySelectorAll('[data-world-visual-action]').forEach((element) => {
        element.addEventListener('click', () => {
            const action = element.dataset.worldVisualAction;
            if (action === 'cover') {
                void runWorldCoverGeneration();
            } else if (action === 'anchor') {
                void runWorldStyleAnchorGeneration();
            }
        });
    });

    dom.worldHero.querySelectorAll('[data-remove-anchor-id]').forEach((element) => {
        element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.aiBusy || state.worldHeroVisualLoading) return;
            removeWorldStyleAnchor(element.dataset.removeAnchorId);
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

/**
 * @param {{ suppressCardIntro?: boolean }} [options] — when true (e.g. autosave queue), skip staggered card mount animation to avoid flicker.
 */
function renderEntryBoard(options = {}) {
    const suppressCardIntro = Boolean(options.suppressCardIntro);
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
        const cover = getEntryPrimaryImage(entry);
        const delay = suppressCardIntro ? 0 : Math.min(index * 0.05, 0.4);
        const introClass = suppressCardIntro ? ' entry-card--no-intro' : '';
        return `
            <article class="entry-card${introClass} ${entry.id === state.activeEntryId ? 'active' : ''}" data-entry-id="${entry.id}" style="animation-delay: ${delay}s">
                ${cover ? `<img class="entry-card-cover" src="${escapeAttribute(cover)}" alt="${escapeAttribute(entry.title)}">` : '<div class="entry-card-cover entry-card-cover-empty"></div>'}
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
            syncEntryBoardSelection();
            renderEntryStudio({ instant: true });
            syncBrainstormHeaderMeta();
        });
    });
}

/** After link toggles, avoid full studio re-render — only sync chip highlights. */
function syncLinkChipActiveClasses() {
    const live = getSelectedEntry();
    if (!dom.studioContent || !live) return;
    dom.studioContent.querySelectorAll('.link-chip[data-link-id]').forEach((el) => {
        const id = String(el.dataset.linkId || '');
        el.classList.toggle('active', entryLinkSetHas(live.links, id));
    });
}

/**
 * @param {{ instant?: boolean }} [options] — pass `instant: true` only for high-frequency updates (e.g. switching selected entry) to skip mount fade and avoid flicker. Default keeps entrance animations.
 */
function renderEntryStudio(options = {}) {
    const instant = options.instant === true;
    if (!dom.studioContent || !dom.studioTitle) return;

    if (!state.currentWorld) {
        dom.studioContent.classList.remove('entry-studio-content--no-mount-anim');
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
        dom.studioContent.classList.remove('entry-studio-content--no-mount-anim');
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

    dom.studioContent.classList.toggle('entry-studio-content--no-mount-anim', instant);

    dom.studioTitle.textContent = entry.title || 'Untitled Entry';

    const allOtherEntries = getWorldSectionNamesInOrder(state.currentWorld).flatMap(
        (sectionName) => state.currentWorld.sections[sectionName] || []
    ).filter((candidate) => candidate.id !== entry.id);

    const childEntries = getChildEntriesForEntry(entry, state.currentWorld);
    const structuralIds = new Set();
    if (entry.parentId != null && String(entry.parentId).trim()) {
        structuralIds.add(String(entry.parentId).trim());
    }
    childEntries.forEach((c) => structuralIds.add(String(c.id)));
    const linkToggleCandidates = allOtherEntries.filter((c) => !structuralIds.has(String(c.id)));
    const parentSelectOptions = buildEntryParentSelectOptions(entry, state.currentWorld);
    const childrenMarkup = childEntries.length
        ? childEntries
              .map(
                  (c) =>
                      `<button type="button" class="link-chip link-chip--child" data-navigate-entry-id="${escapeAttribute(c.id)}">${escapeHtml(c.title || 'Untitled')}</button>`
              )
              .join('')
        : '<div class="muted">No child entries.</div>';

    const imagesMarkup = entry.images?.length
        ? entry.images.map((image, index) => renderImageTile(image, index)).join('')
        : '<div class="muted">Upload references or generate concept art for this entry.</div>';

    const aiContextMarkup = renderAiContextSummary(state.aiContextSummary);
    const textPrompt = entry.generationPresets?.textPrompt || entry.generationPresets?.lastPrompt || '';
    const imagePrompt = entry.generationPresets?.imagePrompt || '';
    const isWorldOverview = entry.section === 'World';

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

            <div class="entry-text-ai-panel">
                <div class="ai-panel-header">
                    <div>
                        <div class="eyebrow">Text Generation</div>
                        <div class="muted">${isWorldOverview ? 'One click can complete the world overview entry, including summary, keywords and lore body.' : 'One click can complete this entry, including summary, tags, style keywords and main content.'}</div>
                    </div>
                </div>
                <textarea id="ai-prompt-input" placeholder="Direct the writing generation. Example: redesign this city as a desert trade hub while preserving the empire's sacred geometry.">${escapeHtml(textPrompt)}</textarea>
                <div class="ai-button-row">
                    <button class="button-primary" data-ai-kind="text" data-ai-action="complete" ${state.aiBusy ? 'disabled' : ''}>Complete Entry</button>
                    <span class="ai-button-pair">
                        <button class="button-ghost" data-ai-kind="text" data-ai-action="write" ${state.aiBusy ? 'disabled' : ''}>Generate Text</button>
                        <button class="button-ghost" data-ai-kind="text" data-ai-action="modify" ${state.aiBusy ? 'disabled' : ''}>Modify Text</button>
                    </span>
                    <button class="button-ghost" data-ai-kind="text" data-ai-action="expand" ${state.aiBusy ? 'disabled' : ''}>Expand</button>
                    <button class="button-ghost" data-ai-kind="text" data-ai-action="rewrite" ${state.aiBusy ? 'disabled' : ''}>Rewrite</button>
                    <button class="button-ghost" data-ai-kind="text" data-ai-action="align" ${state.aiBusy ? 'disabled' : ''}>Align Check</button>
                </div>
                ${aiContextMarkup}
                <div class="ai-result-panel">${escapeHtml(state.aiResult || 'AI text output will appear here. “Complete Entry” will fill summary, tags, style keywords and body together.')}</div>
            </div>

            <div class="eyebrow">Parent (timeline or entry)</div>
            <select id="entry-parent-select" class="sidebar-select entry-parent-select" aria-label="Parent entry">${parentSelectOptions}</select>

            <div class="eyebrow">Children</div>
            <div class="link-chip-row link-chip-row--children">${childrenMarkup}</div>

            <div class="eyebrow">Linked Entries</div>
            <div class="link-chip-row">
                ${linkToggleCandidates.length > 0
                    ? linkToggleCandidates.map((candidate) => `
                        <div class="link-chip ${entryLinkSetHas(entry.links, candidate.id) ? 'active' : ''}" data-link-id="${candidate.id}">
                            ${escapeHtml(candidate.title)}
                        </div>
                    `).join('')
                    : '<div class="muted">No other entries to link.</div>'}
            </div>

            <div class="hero-actions" style="margin-top: 14px;">
                <button class="button-danger" data-delete-entry="true" ${state.aiBusy ? 'disabled' : ''}>Delete Entry</button>
            </div>
        </section>

        <section class="asset-panel" style="animation-delay: 0.08s;">
            <div class="asset-header">
                <div>
                    <div class="eyebrow">Concept Assets</div>
                    <div class="muted">Every image belongs to this entry. Image generation is separated here from text generation.</div>
                </div>
                <div class="hero-actions">
                    <button class="button-ghost" data-upload-assets="true" ${state.aiBusy ? 'disabled' : ''}>Upload Assets</button>
                </div>
            </div>

            <div class="entry-image-ai-panel">
                <div class="ai-panel-header">
                    <div>
                        <div class="eyebrow">Image Generation</div>
                        <div class="muted">Prompts and buttons for concept art live with the image gallery, so text and image workflows stay clearly separated.</div>
                    </div>
                </div>
                <textarea id="image-prompt-input" placeholder="Direct the image generation. Example: towering basalt harbor city at dusk, sacred geometry motifs, misty teal atmosphere.">${escapeHtml(imagePrompt)}</textarea>
                <div class="ai-button-row">
                    <button class="button-primary" data-ai-kind="image" data-ai-action="visualize" ${state.aiBusy ? 'disabled' : ''}>Generate Image</button>
                    <button class="button-ghost" data-ai-kind="image" data-ai-action="variant" ${state.aiBusy ? 'disabled' : ''}>Image Variant</button>
                </div>
            </div>

            <input id="entry-asset-upload" type="file" accept="image/*" multiple hidden>
            <div class="asset-grid">${imagesMarkup}</div>
        </section>
    `;

    bindEntryStudioEvents();
}

let copilotThreadRefreshTimer = null;
function scheduleCopilotThreadRefresh() {
    if (!dom.brainstormPanel || !state.brainstormExpanded) return;
    clearTimeout(copilotThreadRefreshTimer);
    copilotThreadRefreshTimer = setTimeout(() => {
        copilotThreadRefreshTimer = null;
        refreshCopilotThreadDom();
    }, 72);
}

function flushCopilotThreadRefresh() {
    if (copilotThreadRefreshTimer != null) {
        clearTimeout(copilotThreadRefreshTimer);
        copilotThreadRefreshTimer = null;
    }
    refreshCopilotThreadDom();
}

function isBrainstormChatShellMounted() {
    return Boolean(dom.brainstormPanel?.querySelector('.brainstorm-panel-shell--chat'));
}

function syncCopilotDockBusyState() {
    if (!dom.brainstormPanel) return;
    const sending = state.brainstormSending;
    const testing = state.brainstormTestRunning;
    dom.brainstormPanel.classList.toggle('is-copilot-sending', sending);
    dom.brainstormPanel.querySelector('[data-brainstorm-send="true"]')?.toggleAttribute('disabled', sending);
    const sendBtn = dom.brainstormPanel.querySelector('[data-brainstorm-send="true"]');
    if (sendBtn) sendBtn.textContent = sending ? '…' : 'Send';
    const stopBtn = dom.brainstormPanel.querySelector('[data-copilot-stop="true"]');
    if (stopBtn) {
        stopBtn.toggleAttribute('disabled', !sending);
        stopBtn.setAttribute('aria-busy', sending ? 'true' : 'false');
    }
    dom.brainstormPanel.querySelector('[data-brainstorm-attach-pick="true"]')?.toggleAttribute('disabled', sending || testing);
    dom.brainstormPanel.querySelector('[data-copilot-clear-chat="true"]')?.toggleAttribute('disabled', sending || testing);
    dom.brainstormPanel.querySelector('[data-copilot-self-test="true"]')?.toggleAttribute('disabled', sending || testing);
}

function syncBrainstormHeaderMeta() {
    if (!dom.brainstormPanel || !state.currentWorld) return;
    const session = getBrainstormSession();
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const msgCount = messages.length;
    const activeEntry = getSelectedEntry();
    const msgsEl = dom.brainstormPanel.querySelector('[data-brainstorm-pill="msgs"]');
    if (msgsEl) msgsEl.textContent = `${msgCount} msgs`;
    const ctx = dom.brainstormPanel.querySelector('[data-brainstorm-pill="context"]');
    if (ctx) {
        const collapsed = dom.brainstormPanel.classList.contains('is-collapsed');
        const text = collapsed ? activeEntry?.title || state.activeSection : state.activeSection;
        ctx.textContent = String(text || '');
    }
}

function fillCopilotAttachPreviewSlot() {
    const slot = dom.brainstormPanel?.querySelector('#copilot-attach-preview-slot');
    if (!slot) return false;
    if (!Array.isArray(state.brainstormAttachments) || state.brainstormAttachments.length === 0) {
        slot.innerHTML = '';
        return true;
    }
    slot.innerHTML = `<div class="copilot-attach-preview" aria-label="Pending images">${state.brainstormAttachments
        .map(
            (a, i) => `
            <div class="copilot-attach-chip" data-brainstorm-attach-index="${i}">
                <img src="${escapeAttribute(copilotPublicImageSrc(a.url))}" alt="">
                <button type="button" class="copilot-attach-chip-remove" data-brainstorm-attach-remove="${i}" title="Remove">×</button>
            </div>`
        )
        .join('')}</div>`;
    slot.querySelectorAll('[data-brainstorm-attach-remove]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const idx = Number(btn.getAttribute('data-brainstorm-attach-remove'));
            if (!Number.isNaN(idx) && idx >= 0 && idx < state.brainstormAttachments.length) {
                state.brainstormAttachments.splice(idx, 1);
                fillCopilotAttachPreviewSlot();
            }
        });
    });
    return true;
}

/**
 * Refresh world chrome after Copilot changed data. When `serverPersisted` is true, the server already wrote
 * the world during tool execution — skip scheduling another save to avoid races and redundant POSTs.
 */
function patchUiAfterCopilotWorldSync({ serverPersisted = false } = {}) {
    if (!state.currentWorld) return;
    renderWorldList();
    renderSectionList();
    renderWorldHero();
    renderEntryBoard();
    renderEntryStudio({ instant: true });
    renderSectionBoardPeek(getFilteredEntries());
    if (!serverPersisted) {
        state.currentWorld.updatedAt = Date.now();
        upsertWorldSummary(state.currentWorld);
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => {
            void saveCurrentWorld();
        }, 450);
    }
    syncBrainstormHeaderMeta();
    renderGlobalBusyOverlay();
}

function syncEntryBoardSelection() {
    if (!dom.entryBoard) return;
    dom.entryBoard.querySelectorAll('[data-entry-id]').forEach((element) => {
        element.classList.toggle('active', element.dataset.entryId === state.activeEntryId);
    });
}

function refreshCopilotThreadDom() {
    if (!dom.brainstormPanel || !state.brainstormExpanded) return;
    const thread = dom.brainstormPanel.querySelector('.copilot-thread');
    if (!thread) return;
    const session = getBrainstormSession();
    const messages = Array.isArray(session.messages) ? session.messages : [];

    thread.onscroll = () => {
        const gap = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
        state.copilotThreadStickToBottom = gap < 56;
    };

    thread.innerHTML = renderCopilotMessageListHtml(messages, state.brainstormPendingTurn);

    if (state.copilotThreadStickToBottom) {
        scrollCopilotThreadToBottom(true);
    }
}

let copilotStreamScrollRaf = false;
function updateCopilotStreamBody(text) {
    const el = dom.brainstormPanel?.querySelector('[data-copilot-stream-body="true"]');
    if (el) {
        el.textContent = text;
    }
    if (!state.copilotThreadStickToBottom) return;
    if (!copilotStreamScrollRaf) {
        copilotStreamScrollRaf = true;
        requestAnimationFrame(() => {
            copilotStreamScrollRaf = false;
            scrollCopilotThreadToBottom(true);
        });
    }
}

function formatCopilotToolArguments(raw) {
    const s = typeof raw === 'string' ? raw : String(raw ?? '');
    try {
        return JSON.stringify(JSON.parse(s), null, 2);
    } catch (_e) {
        return s;
    }
}

function renderCopilotToolCallRow(call) {
    const name = escapeHtml(call.name || 'tool');
    const state = call.state === 'running' ? 'running' : 'done';
    const argsFormatted = formatCopilotToolArguments(call.arguments || '{}');
    const resultText = String(call.result ?? call.resultPreview ?? '');
    const isOpen = state === 'running';
    return `
        <div class="copilot-tool-call ${isOpen ? 'is-open' : ''}">
            <div class="copilot-tool-call-summary" data-tool-toggle="true">
                <span class="copilot-tool-call-caret" aria-hidden="true"></span>
                <code class="copilot-tool-call-name">${name}</code>
                <span class="copilot-tool-call-status copilot-tool-call-status--${state}">${
                    state === 'running' ? 'Running' : 'Done'
                }</span>
                </div>
            <div class="copilot-tool-call-panel-wrapper">
                <div class="copilot-tool-call-panel">
                    <div class="copilot-tool-call-section">
                        <div class="copilot-tool-call-label">Arguments</div>
                        <pre class="copilot-tool-call-pre">${escapeHtml(argsFormatted)}</pre>
            </div>
                    <div class="copilot-tool-call-section">
                        <div class="copilot-tool-call-label">Result</div>
                        <pre class="copilot-tool-call-pre">${resultText ? escapeHtml(resultText) : '—'}</pre>
                    </div>
                </div>
            </div>
        </div>`;
}

function showCopilotPlanConfirmRow(card) {
    if (!card) return;
    const row = card.querySelector('[data-copilot-plan-confirm-row]');
    const summary = card.querySelector('[data-copilot-plan-confirm-summary]');
    const btn = card.querySelector('[data-copilot-plan-confirm]');
    if (!row || !summary || !btn) return;
    const isCustom = card.dataset.planSelCustom === '1';
    if (isCustom) {
        summary.textContent = 'Ready to continue with your custom direction (not sent until you press Continue).';
    } else {
        const t = card.dataset.planSelTitle || '';
        summary.textContent = t ? `Ready to continue with: ${t}` : 'Pick a direction above, then press Continue.';
    }
    row.hidden = false;
    btn.disabled = false;
}

function clearCopilotPlanSelectionUi(card) {
    if (!card) return;
    card.querySelectorAll('.copilot-plan-option').forEach((b) => b.classList.remove('is-selected'));
    const customBox = card.querySelector('.copilot-plan-custom');
    customBox?.classList.remove('is-selected');
    delete card.dataset.planSelCustom;
    delete card.dataset.planSelOptionId;
    delete card.dataset.planSelTitle;
    delete card.dataset.planSelDetail;
    const row = card.querySelector('[data-copilot-plan-confirm-row]');
    const btn = card.querySelector('[data-copilot-plan-confirm]');
    if (row) row.hidden = true;
    if (btn) btn.disabled = true;
    const summary = card.querySelector('[data-copilot-plan-confirm-summary]');
    if (summary) summary.textContent = '';
}

function renderCopilotPlanOptionsBlock(block) {
    if (!block || block.type !== 'plan_options') return '';
    const proposalId = escapeAttribute(block.proposalId || '');
    const st = block.state || 'pending';
    const promptHtml = block.prompt
        ? `<div class="copilot-plan-prompt">${escapeHtml(block.prompt)}</div>`
        : '';
    const opts = (Array.isArray(block.options) ? block.options : [])
        .map((o) => {
            const oid = escapeAttribute(String(o.id || ''));
            const title = escapeHtml(o.title || '');
            const det = o.detail ? escapeHtml(o.detail) : '';
            const dis = st !== 'pending' ? ' disabled' : '';
            return `<button type="button" class="copilot-plan-option"${dis} data-copilot-plan-select="true" data-plan-proposal-id="${proposalId}" data-plan-option-id="${oid}"><span class="copilot-plan-option-title">${title}</span>${
                det ? `<span class="copilot-plan-option-detail">${det}</span>` : ''
            }</button>`;
        })
        .join('');
    const custom =
        st === 'pending'
            ? `<div class="copilot-plan-custom"><div class="muted copilot-plan-custom-label">Custom direction</div><textarea class="copilot-plan-custom-input" rows="2" placeholder="Describe your own direction…" data-copilot-plan-custom-input data-plan-proposal-id="${proposalId}"></textarea><button type="button" class="button-secondary copilot-plan-use-custom" data-copilot-plan-use-custom="true" data-plan-proposal-id="${proposalId}">Use custom text</button></div>`
            : '';
    const confirmRow =
        st === 'pending'
            ? `<div class="copilot-plan-confirm-row" hidden data-copilot-plan-confirm-row>
                <div class="copilot-plan-confirm-summary muted" data-copilot-plan-confirm-summary></div>
                <div class="copilot-plan-confirm-actions">
                    <button type="button" class="button-primary copilot-plan-confirm-btn" data-copilot-plan-confirm="true" disabled>Continue</button>
                    <button type="button" class="button-ghost copilot-plan-clear-btn" data-copilot-plan-cancel-select="true">Clear</button>
                </div>
            </div>`
            : '';
    let status = '';
    if (st === 'chosen') {
        const ct = escapeHtml(block.choiceTitle || '');
        const cd = block.choiceDetail ? escapeHtml(block.choiceDetail) : '';
        status = `<div class="copilot-plan-status muted">Selected: ${ct}${cd ? ` — ${cd}` : ''}</div>`;
    } else if (st === 'dismissed') {
        status = '<div class="copilot-plan-status muted">Skipped — you continued in the composer</div>';
    }
    return `<div class="copilot-plan-card copilot-plan-card--${escapeAttribute(st)}" data-copilot-plan-card="true" data-plan-proposal-id="${proposalId}">${promptHtml}<div class="copilot-plan-options">${opts}</div>${custom}${confirmRow}${status}</div>`;
}

function renderCopilotBlocksHtml(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    return blocks
        .map((block) => {
            if (block.type === 'text' && block.content != null && String(block.content).length > 0) {
                return `<div class="copilot-block copilot-block--text">${escapeHtml(block.content)}</div>`;
            }
            if (block.type === 'tools' && Array.isArray(block.calls) && block.calls.length > 0) {
                const rows = block.calls.map((c) => renderCopilotToolCallRow(c)).join('');
                return `<div class="copilot-tool-stack">${rows}</div>`;
            }
            if (block.type === 'plan_options' && Array.isArray(block.options) && block.options.length > 0) {
                return `<div class="copilot-block copilot-block--plan">${renderCopilotPlanOptionsBlock(block)}</div>`;
            }
            return '';
        })
        .filter(Boolean)
        .join('');
}

function renderAssistantBubbleInner(message) {
    const blocksHtml = renderCopilotBlocksHtml(message.blocks);
    const streamText = message.streamText;
    let streamHtml = '';
    const streamSlot = Boolean(streamText) || Boolean(message.streaming);
    if (streamSlot) {
        streamHtml = `<div class="copilot-block copilot-block--text" data-copilot-stream-body="true">${escapeHtml(streamText || '')}</div>`;
    }
    const hasStack = Boolean(blocksHtml || streamHtml);
    const legacyContent =
        !hasStack && message.content
            ? `<div class="copilot-bubble-body">${escapeHtml(message.content)}</div>`
            : '';
    const stackHtml = hasStack ? `<div class="copilot-bubble-stack">${blocksHtml}${streamHtml}</div>` : '';
    return stackHtml || legacyContent || '<div class="copilot-bubble-body muted">…</div>';
}

function copilotPublicImageSrc(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u;
    return u.replace(/^\.\//, '');
}

function renderUserCopilotBubbleBody(message) {
    const urls = Array.isArray(message.attachmentUrls) ? message.attachmentUrls.filter(Boolean) : [];
    const attachRow =
        urls.length > 0
            ? `<div class="copilot-attach-row">${urls
                  .map(
                      (u) =>
                          `<img class="copilot-attach-thumb" src="${escapeAttribute(copilotPublicImageSrc(u))}" alt="" loading="lazy">`
                  )
                  .join('')}</div>`
            : '';
    const text = String(message.content || '');
    const textBlock =
        text.trim().length > 0
            ? `<div class="copilot-bubble-body">${escapeHtml(text)}</div>`
            : urls.length > 0
              ? ''
              : `<div class="copilot-bubble-body muted">(no text)</div>`;
    return `${attachRow}${textBlock}`;
}

function renderCopilotMessageListHtml(messages, pendingTurn) {
    if (state.brainstormLoading) {
        return `
            <div class="copilot-thread-empty">
                <div class="copilot-typing"><span>Loading session</span><span class="brainstorm-thinking-dots"><span></span><span></span><span></span></span></div>
            </div>`;
    }

    const savedMessageCount = Array.isArray(messages) ? messages.length : 0;
    const list = Array.isArray(messages) ? [...messages] : [];
    if (pendingTurn) {
        list.push({
            role: 'user',
            content: pendingTurn.user,
            attachmentUrls: Array.isArray(pendingTurn.attachmentUrls) ? pendingTurn.attachmentUrls : [],
            createdAt: Date.now(),
            pending: true
        });
        list.push({
            role: 'assistant',
            content: '',
            blocks: Array.isArray(pendingTurn.blocks) ? pendingTurn.blocks : [],
            streamText: pendingTurn.streamText || '',
            createdAt: Date.now(),
            streaming: Boolean(state.brainstormSending)
        });
    }

    if (list.length === 0) {
        return `
            <div class="copilot-thread-empty">
                <div class="copilot-welcome-icon" aria-hidden="true"></div>
                <h3 class="copilot-welcome-title">World Copilot</h3>
                <p class="copilot-welcome-text">Ask anything about this world. Replies stream in real time; tools read and update your canon when needed. When the model offers direction picks, click an option (or prepare custom text), then press Continue — nothing is sent to the model until Continue. Or type a new message in the composer to skip the plan. Use Stop to cancel generation. Ctrl+hold (⌘+hold on Mac) a past message to revert chat and the world to that point.</p>
            </div>`;
    }

    const bubbles = list
        .map((message, index) => {
            const role = message.role || 'assistant';
            const isUser = role === 'user';
            const isSystem = role === 'system';
            const bubbleClass = isUser ? 'copilot-bubble copilot-bubble--user' : isSystem ? 'copilot-bubble copilot-bubble--system' : 'copilot-bubble copilot-bubble--assistant';
            const label = isUser ? 'You' : isSystem ? 'System' : 'Copilot';
            const body = isUser
                ? renderUserCopilotBubbleBody(message)
                : isSystem
                  ? `<div class="copilot-bubble-body">${escapeHtml(message.content || '')}</div>`
                  : renderAssistantBubbleInner(message);
            
            const isAnimate = index >= list.length - 2;
            const rollbackAttr =
                index < savedMessageCount && !message.pending && (isUser || role === 'assistant' || isSystem)
                    ? ` data-copilot-rollback-index="${index}" title="Ctrl+hold: revert chat and world to here"`
                    : '';

            return `
                <div class="copilot-turn ${isUser ? 'copilot-turn--user' : ''} ${isAnimate ? 'copilot-turn--animate' : ''}"${rollbackAttr}>
                    <div class="${bubbleClass}">
                        <div class="copilot-bubble-meta">${escapeHtml(label)} · ${formatTimestamp(message.createdAt)}</div>
                        ${body}
            </div>
                </div>`;
        })
        .join('');

    return bubbles;
}

function scrollCopilotThreadToBottom(instant = false) {
    const thread = dom.brainstormPanel?.querySelector('.copilot-thread');
    if (thread) {
        requestAnimationFrame(() => {
            thread.scrollTo({ top: thread.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
        });
    }
}

async function readBrainstormSseStream(response, handlers = {}) {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Streaming not supported in this browser.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let donePayload = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf('\n\n');

            for (const line of block.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') continue;
                let json;
                try {
                    json = JSON.parse(raw);
                } catch {
                    continue;
                }

                if (json.type === 'delta' && json.text) {
                    handlers.onDelta?.(json.text);
                } else if (json.type === 'tool') {
                    handlers.onTool?.(json);
                } else if (json.type === 'step') {
                    handlers.onStep?.(json);
                } else if (json.type === 'error') {
                    handlers.onError?.(json.message || 'Unknown error');
                } else if (json.type === 'plan_options') {
                    handlers.onPlanOptions?.(json);
                } else if (json.type === 'done') {
                    donePayload = json;
                    handlers.onDone?.(json);
                }
            }
        }
    }

    return donePayload;
}

async function uploadCopilotScenarioFixturePng() {
    const worldId = state.currentWorld?.id;
    if (!worldId) return null;

    /**
     * Use a small real raster. JPEG often survives third-party OpenAI-compatible gateways
     * that mishandle PNG/base64; server re-sniffs MIME from bytes before sending to the model.
     */
    let blob;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        const grd = ctx.createLinearGradient(0, 0, 128, 128);
        grd.addColorStop(0, '#143d2b');
        grd.addColorStop(1, '#c75b2a');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 4;
        ctx.strokeRect(8, 8, 112, 112);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
        ctx.fillText('QA', 38, 82);
        blob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                (b) => {
                    if (b && b.size > 400) resolve(b);
                    else reject(new Error('toBlob too small or null'));
                },
                'image/jpeg',
                0.92
            );
        });
    } catch (canvasErr) {
        console.error(
            '[Scenario Test] Canvas JPEG fixture failed; skipping upload (multimodal / append-image steps will skip).',
            canvasErr
        );
        return null;
    }

    const formData = new FormData();
    formData.append('asset', blob, 'copilot-qa-fixture.jpg');
    formData.append('worldId', worldId);
    const response = await fetch('/gpt/anvil/asset/upload', { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data.url;
}

/** English Scenario: build a self-consistent mini-world (Regions/Factions/Characters/links/tags/move/append image). */
const COPILOT_SCENARIO_NO_DUP_RULE =
    '[Deduplication] You MUST call anvil_get_world_digest before ANY createEntry. If an entry with the exact same title already exists in the target section, you are FORBIDDEN to createEntry. You MUST use updateEntryFields on that existing entry ID instead. Repeated test runs must not create duplicate entries.';

const COPILOT_SCENARIO_STEPS = [
    {
        id: '0_fixture_png',
        runOnly: async () => {
            try {
                state.copilotScenarioFixtureUrl = await uploadCopilotScenarioFixturePng();
                console.log('[Scenario Test] Uploaded fixture image:', state.copilotScenarioFixtureUrl);
            } catch (err) {
                state.copilotScenarioFixtureUrl = null;
                console.error('[Scenario Test] Fixture image upload failed (append image step may fail)', err);
            }
        }
    },
    {
        id: '1_conversation',
        prompt:
            'Please say hello in a short, natural English sentence (no lists or Markdown). This step only verifies the chat flow.',
        checkReply: (text) => String(text || '').trim().length > 4
    },
    {
        id: '1b_multimodal_attachment',
        shouldRun: () => Boolean(state.copilotScenarioFixtureUrl),
        attachmentUrls: () =>
            state.copilotScenarioFixtureUrl ? [String(state.copilotScenarioFixtureUrl)] : [],
        prompt: [
            'Automated QA: the user attached one Anvil asset image.',
            'In plain English, say in one short sentence what you see (e.g. dominant color). Do not call tools.',
            'The last line MUST be exactly: MULTIMODAL_OK'
        ].join('\n'),
        checkReply: (text) => /MULTIMODAL_OK\s*$/m.test(String(text || ''))
    },
    {
        id: '2_world_shell',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Automated QA. Scenario: "Amber Shell". Use tools to build the world skeleton in one go.',
            '1) First, anvil_get_world_digest.',
            '2) anvil_apply_world_operations with updateWorldFields: name MUST be exactly "QA - Amber Shell"; summary: two sentences about an amber salt-fog trench and an intertidal city-state; canonContext: one sentence highlighting the conflict between the "Salt Crystal Tax" and the "Tide Calendar"; themeKeywords: ["Amber Shell", "Salt Crystal", "Tide"].',
            '3) World Section: if digest shows NO entry exactly named "Intertidal City Overview", then createEntry. If it exists, only updateEntryFields to maintain a two-sentence summary, a three-sentence content, and Draft status. DO NOT create a second one.',
            'Reply in short English. The last line MUST be exactly: AMBER_SHELL_OK'
        ].join('\n'),
        checkReply: (text) => /AMBER_SHELL_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            if (!world) return false;
            const nameOk = String(world.name || '').includes('Amber Shell');
            const sumOk = String(world.summary || '').includes('salt') || String(world.summary || '').includes('tide');
            const canonOk = String(world.canonContext || '').includes('salt') || String(world.canonContext || '').includes('tide');
            const kw = Array.isArray(world.themeKeywords) ? world.themeKeywords.join(' ') : '';
            const kwOk = kw.includes('salt') || kw.includes('tide') || kw.includes('amber') || kw.includes('Amber');
            const entries = Array.isArray(world.sections?.World) ? world.sections.World : [];
            const hubs = entries.filter((e) => String(e.title || '').trim() === 'Intertidal City Overview');
            return nameOk && sumOk && canonOk && kwOk && hubs.length === 1;
        }
    },
    {
        id: '3_regions_factions',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Still in "QA - Amber Shell". First digest, then anvil_apply_world_operations (can call multiple but try to merge):',
            '1) Regions: ONLY if NO entry is exactly named "Salt Frost Strait", then createEntry; else updateEntryFields. Summary: two sentences about fjord fog and lighthouse chains. Content: three sentences. Status: Draft.',
            '2) Factions: ONLY if NO entry is exactly named "Amber Maritime League", then createEntry; else updateEntryFields. Summary: two sentences about escorts and salt tax arbitration. Content: three sentences. Status: Seed.',
            'The last line MUST be exactly: REGION_FACTION_OK'
        ].join('\n'),
        checkReply: (text) => /REGION_FACTION_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const regions = Array.isArray(world?.sections?.Regions) ? world.sections.Regions : [];
            const factions = Array.isArray(world?.sections?.Factions) ? world.sections.Factions : [];
            const rCount = regions.filter((e) => String(e.title || '').trim() === 'Salt Frost Strait').length;
            const fCount = factions.filter((e) => String(e.title || '').trim() === 'Amber Maritime League').length;
            return rCount === 1 && fCount === 1;
        }
    },
    {
        id: '4_character',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Same world. First digest. Characters Section: ONLY if NO entry is exactly named "Ellie Salt-Lamp", then createEntry; if exists, updateEntryFields.',
            'Summary: two sentences. She is a strait pilot who can read the "false shoreline" refracted by salt fog.',
            'Content: two paragraphs about her shift rhythm and superstition towards the Tide Calendar. Status: Seed.',
            'The last line MUST be exactly: CHAR_OK'
        ].join('\n'),
        checkReply: (text) => /CHAR_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const entries = Array.isArray(world?.sections?.Characters) ? world.sections.Characters : [];
            const matches = entries.filter((e) => String(e.title || '').trim() === 'Ellie Salt-Lamp');
            return matches.length === 1;
        }
    },
    {
        id: '5_links_tags',
        prompt: [
            'First anvil_get_world_digest. Find the entry IDs for Regions "Salt Frost Strait" and Characters "Ellie Salt-Lamp".',
            'Then anvil_apply_world_operations:',
            '1) setEntryLinks: Set Ellie\'s links to ONLY contain the ID of Salt Frost Strait (you can add Maritime League ID if you wrote it too). It MUST at least contain the Salt Frost Strait ID.',
            '2) setEntryTags: Set tags for Salt Frost Strait to ["fog", "shipping", "QA"] (order doesn\'t matter).',
            'The last line MUST be exactly: LINK_TAG_OK'
        ].join('\n'),
        checkReply: (text) => /LINK_TAG_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const regions = Array.isArray(world?.sections?.Regions) ? world.sections.Regions : [];
            const chars = Array.isArray(world?.sections?.Characters) ? world.sections.Characters : [];
            const region = regions.find((e) => String(e.title || '').includes('Salt Frost'));
            const chr = chars.find((e) => String(e.title || '').includes('Ellie'));
            if (!region || !chr) return false;
            const tags = Array.isArray(region.tags) ? region.tags.map(String) : [];
            const tagOk = tags.includes('fog') && tags.includes('shipping') && tags.includes('QA');
            const links = Array.isArray(chr.links) ? chr.links : [];
            const linkOk = links.includes(region.id);
            return tagOk && linkOk;
        }
    },
    {
        id: '6_edit_region',
        prompt: [
            'Use anvil_get_entry to read the long text of "Salt Frost Strait" if needed; then use updateEntryFields to modify it:',
            'Append an English sentence to the summary, which MUST contain the phrase "Night Nav-Light Revision". Add a transition sentence before the first paragraph of content, without deleting existing facts.',
            'The last line MUST be exactly: REGION_EDIT_OK'
        ].join('\n'),
        checkReply: (text) => /REGION_EDIT_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const regions = Array.isArray(world?.sections?.Regions) ? world.sections.Regions : [];
            const region = regions.find((e) => String(e.title || '').includes('Salt Frost Strait'));
            return Boolean(region && String(region.summary || '').includes('Night Nav-Light Revision'));
        }
    },
    {
        id: '7_move_entry',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'First digest. Search the whole world for an entry named exactly "Migration Motion Probe":',
            'If it does not exist, createEntry in World section (only one); if it exists, DO NOT create a new one, use its ID directly.',
            'Then moveEntrySection: move that ID to Architecture section (regardless of its current section).',
            'The last line MUST be exactly: MOVE_OK'
        ].join('\n'),
        checkReply: (text) => /MOVE_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            if (!world?.sections) return false;
            const all = [];
            for (const k of Object.keys(world.sections)) {
                const arr = world.sections[k];
                if (Array.isArray(arr)) all.push(...arr);
            }
            const probes = all.filter((e) => String(e.title || '').trim() === 'Migration Motion Probe');
            const arch = Array.isArray(world.sections.Architecture) ? world.sections.Architecture : [];
            return probes.length === 1 && arch.some((e) => String(e.title || '').trim() === 'Migration Motion Probe');
        }
    },
    {
        id: '8_append_image',
        prompt: () => {
            const url = state.copilotScenarioFixtureUrl || '';
            return [
                'Automated QA. Regions should have "Salt Frost Strait". First anvil_get_world_digest to get its entry ID.',
                'Call anvil_apply_world_operations with one appendEntryImages operation:',
                `Use the ID above for entryId; images should be just one: url MUST exactly equal "${url}", label should be "QA Pixel Nail".`,
                'If url is empty, the test environment failed to upload the fixture, just reply with failure explanation; if url is provided, you MUST append it.',
                'On success, the last line MUST be exactly: IMG_OK'
            ].join('\n');
        },
        checkReply: (text) => /IMG_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            if (!state.copilotScenarioFixtureUrl) return false;
            const regions = Array.isArray(world?.sections?.Regions) ? world.sections.Regions : [];
            const region = regions.find((e) => String(e.title || '').includes('Salt Frost Strait'));
            if (!region || !Array.isArray(region.images)) return false;
            return region.images.some(
                (img) =>
                    String(img.label || '').includes('QA Pixel Nail') ||
                    String(img.url || '') === String(state.copilotScenarioFixtureUrl)
            );
        }
    },
    {
        id: '9_world_polish',
        prompt: [
            'Using updateWorldFields only: change the world name to "QA - Amber Shell (Vol 1 Final)";',
            'Append a short sentence to the end of summary, which MUST contain "Salt Tax Archive". Do not delete the previous trench settings.',
            'The last line MUST be exactly: POLISH_OK'
        ].join('\n'),
        checkReply: (text) => /POLISH_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const n = String(world?.name || '');
            const s = String(world?.summary || '');
            return n.includes('Vol 1 Final') && s.includes('Salt Tax Archive');
        }
    },
    {
        id: '10_list_sections_entries',
        prompt: [
            'Automated QA for read-only listing tools. Do NOT call anvil_get_world_digest in this turn.',
            '1) Call anvil_list_sections once.',
            '2) Call anvil_list_section_entries with section_name exactly "Regions" (so we exercise the filtered list API).',
            'Reply in one short English sentence stating whether "Salt Frost Strait" appears in that Regions list output.',
            'The last line MUST be exactly: LIST_TOOLS_OK'
        ].join('\n'),
        checkReply: (text) => /LIST_TOOLS_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const regions = Array.isArray(world?.sections?.Regions) ? world.sections.Regions : [];
            return regions.some((e) => String(e.title || '').trim() === 'Salt Frost Strait');
        }
    },
    {
        id: '11_propose_directions',
        prompt: [
            'Automated QA for the plan UI tool. You MUST call anvil_propose_directions exactly once this turn.',
            'Use prompt: "Which QA subplot should we expand next?"',
            'Provide exactly 3 options with distinct ids a, b, c and short titles (e.g. customs intrigue, lighthouse myth, pilot backstory).',
            'After the tool returns, add one short English sentence telling the user they can pick in the panel.',
            'The last line MUST be exactly: PROPOSE_TOOLS_OK'
        ].join('\n'),
        checkReply: (text) => /PROPOSE_TOOLS_OK\s*$/m.test(String(text || '')),
        verifySession: (session) => {
            const msgs = Array.isArray(session?.messages) ? session.messages : [];
            for (let i = msgs.length - 1; i >= 0; i -= 1) {
                const m = msgs[i];
                if (!m || m.role !== 'assistant' || !Array.isArray(m.blocks)) continue;
                const ok = m.blocks.some(
                    (b) =>
                        b &&
                        b.type === 'plan_options' &&
                        Array.isArray(b.options) &&
                        b.options.length >= 2 &&
                        b.options.length <= 6
                );
                if (ok) return true;
            }
            return false;
        },
        afterStep: dismissCopilotPendingPlanOptions
    },
    {
        id: '12_add_section_and_entry',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Automated QA for addSection + createEntry (metadata required).',
            '1) anvil_get_world_digest.',
            '2) anvil_apply_world_operations: addSection with sectionName exactly "QA Copilot Annex" (skip addSection if that section already exists).',
            '3) In section "QA Copilot Annex", ONLY if NO entry is titled exactly "Annex Clerk Docket", createEntry with:',
            '   title "Annex Clerk Docket", summary two sentences, content two sentences, status Draft,',
            '   tags at least: ["annex", "QA", "clerical"], styleKeywords at least: ["ledger glow", "harbor paperwork", "amber lamp"].',
            'If the entry already exists, only updateEntryFields to ensure those tags and styleKeywords are present.',
            'The last line MUST be exactly: ANNEX_SECTION_OK'
        ].join('\n'),
        checkReply: (text) => /ANNEX_SECTION_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const sec = world?.sections?.['QA Copilot Annex'];
            if (!Array.isArray(sec)) return false;
            const ent = sec.find((e) => String(e.title || '').trim() === 'Annex Clerk Docket');
            if (!ent) return false;
            const tags = Array.isArray(ent.tags) ? ent.tags.map(String) : [];
            const styles = Array.isArray(ent.styleKeywords) ? ent.styleKeywords.map(String) : [];
            const tagOk = tags.includes('annex') && tags.includes('QA') && tags.includes('clerical');
            const styleOk =
                styles.some((s) => /ledger/i.test(s)) &&
                styles.some((s) => /paperwork|harbor/i.test(s)) &&
                styles.some((s) => /amber|lamp/i.test(s));
            return tagOk && styleOk;
        }
    },
    {
        id: '13_rename_section',
        prompt: [
            'Automated QA for renameSection.',
            'Use anvil_list_sections to confirm "QA Copilot Annex" exists; then anvil_apply_world_operations with renameSection:',
            'fromSection "QA Copilot Annex", toSection "QA Copilot Annex Renamed".',
            'If already renamed, skip. Move all entries with the rename (entries stay under the new section name).',
            'The last line MUST be exactly: RENAME_SECTION_OK'
        ].join('\n'),
        checkReply: (text) => /RENAME_SECTION_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const oldSec = world?.sections?.['QA Copilot Annex'];
            const newSec = world?.sections?.['QA Copilot Annex Renamed'];
            if (Array.isArray(oldSec) && oldSec.length > 0) return false;
            if (!Array.isArray(newSec)) return false;
            return newSec.some((e) => String(e.title || '').trim() === 'Annex Clerk Docket');
        }
    },
    {
        id: '14_delete_entry',
        prompt: [
            'Automated QA for deleteEntry.',
            'Use anvil_list_section_entries with section_name "QA Copilot Annex Renamed" to find the entry id for title exactly "Annex Clerk Docket".',
            'Then anvil_apply_world_operations: deleteEntry with that entryId.',
            'The last line MUST be exactly: DELETE_ENTRY_OK'
        ].join('\n'),
        checkReply: (text) => /DELETE_ENTRY_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const sec = world?.sections?.['QA Copilot Annex Renamed'];
            if (!Array.isArray(sec)) return false;
            return !sec.some((e) => String(e.title || '').trim() === 'Annex Clerk Docket');
        }
    },
    {
        id: '15_delete_section',
        prompt: [
            'Automated QA for deleteSection on an empty custom section.',
            'anvil_list_sections to confirm "QA Copilot Annex Renamed" has zero entries; then deleteSection with sectionName "QA Copilot Annex Renamed" (no relocateEntriesTo needed if empty).',
            'If the section is already gone, reply that it is already deleted and still end with the marker line.',
            'The last line MUST be exactly: DELETE_SECTION_OK'
        ].join('\n'),
        checkReply: (text) => /DELETE_SECTION_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const sec = world?.sections?.['QA Copilot Annex Renamed'];
            return sec == null || (Array.isArray(sec) && sec.length === 0);
        }
    },
    {
        id: '16_style_keywords_update',
        prompt: [
            'Automated QA for updateEntryFields with styleKeywords (and tags if missing).',
            'Use anvil_get_entry on the Characters entry whose title is exactly "Ellie Salt-Lamp" (get entry_id from digest or list_section_entries).',
            'Then anvil_apply_world_operations: updateEntryFields ensuring styleKeywords includes the exact phrase "QA brush-pass haze" and tags includes "copilot-qa".',
            'Do not remove her existing lore text; only merge metadata fields as needed.',
            'The last line MUST be exactly: STYLE_PATCH_OK'
        ].join('\n'),
        checkReply: (text) => /STYLE_PATCH_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const chars = Array.isArray(world?.sections?.Characters) ? world.sections.Characters : [];
            const ellie = chars.find((e) => String(e.title || '').trim() === 'Ellie Salt-Lamp');
            if (!ellie) return false;
            const tags = Array.isArray(ellie.tags) ? ellie.tags.map(String) : [];
            const styles = Array.isArray(ellie.styleKeywords) ? ellie.styleKeywords.map(String) : [];
            return tags.includes('copilot-qa') && styles.some((s) => s.includes('QA brush-pass haze'));
        }
    },
    {
        id: '17_delete_section_relocate',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Automated QA for deleteSection on a NON-empty section (relocateEntriesTo is required).',
            '1) anvil_get_world_digest.',
            '2) addSection with sectionName exactly "QA Relocate Bin" if that section key is missing.',
            '3) In section "QA Relocate Bin": only if NO entry is titled exactly "QA Relocate Canary", createEntry with title "QA Relocate Canary", one-sentence summary, one-sentence content, status Draft, tags ["QA","reloc","canary"], styleKeywords ["flat icon","test asset","harbor QA"].',
            '4) anvil_apply_world_operations: deleteSection with sectionName "QA Relocate Bin" and relocateEntriesTo exactly "World".',
            'The last line MUST be exactly: RELOC_DELETE_OK'
        ].join('\n'),
        checkReply: (text) => /RELOC_DELETE_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const bin = world?.sections?.['QA Relocate Bin'];
            if (Array.isArray(bin) && bin.length > 0) return false;
            const w = Array.isArray(world?.sections?.World) ? world.sections.World : [];
            return w.some((e) => String(e.title || '').trim() === 'QA Relocate Canary');
        }
    },
    {
        id: '18_timeline_year_anchors',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Automated QA for createTimelineYearEntry (year anchors on the Timeline).',
            '1) anvil_get_world_digest.',
            '2) For each calendar year 1088 and 1240: if the world already has ANY entry with timelineKind "year" and timelineYear exactly that number, do NOT create a duplicate; otherwise call anvil_apply_world_operations with createTimelineYearEntry:',
            '   year = that number; section "Timeline"; title MUST be exactly "QA Year 1088" or "QA Year 1240" respectively;',
            '   summary: one sentence mentioning Amber Shell chronology; tags at least ["timeline","QA","year"]; styleKeywords at least ["chronicle scroll","amber ink","salt margin"].',
            '3) If an anchor exists but title/summary/tags/style are wrong, use updateEntryFields only (do not create a second year row for the same timelineYear).',
            'The last line MUST be exactly: TIMELINE_YEARS_OK'
        ].join('\n'),
        checkReply: (text) => /TIMELINE_YEARS_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const all = flattenWorldEntries(world);
            const y1088 = all.find((e) => e.timelineKind === 'year' && Number(e.timelineYear) === 1088);
            const y1240 = all.find((e) => e.timelineKind === 'year' && Number(e.timelineYear) === 1240);
            if (!y1088 || !y1240) return false;
            const t1088 = String(y1088.title || '').trim() === 'QA Year 1088';
            const t1240 = String(y1240.title || '').trim() === 'QA Year 1240';
            return t1088 && t1240;
        }
    },
    {
        id: '19_set_entry_parent',
        prompt: [
            COPILOT_SCENARIO_NO_DUP_RULE,
            'Automated QA for setEntryParent (timeline tree).',
            '1) anvil_get_world_digest.',
            '2) Find entry id for Regions entry titled exactly "Salt Frost Strait", and entry id for the Timeline year anchor with timelineYear 1088 (from step 18).',
            '3) anvil_apply_world_operations: setEntryParent with entryId = Salt Frost Strait id, parentId = that 1088 year anchor id.',
            '4) Find Characters entry titled exactly "Ellie Salt-Lamp"; setEntryParent with entryId = Ellie id, parentId = the SAME 1088 year anchor id.',
            'The last line MUST be exactly: PARENT_LINK_OK'
        ].join('\n'),
        checkReply: (text) => /PARENT_LINK_OK\s*$/m.test(String(text || '')),
        verifyWorld: (world) => {
            const all = flattenWorldEntries(world);
            const year1088 = all.find((e) => e.timelineKind === 'year' && Number(e.timelineYear) === 1088);
            if (!year1088?.id) return false;
            const pid = String(year1088.id);
            const salt = all.find((e) => String(e.title || '').trim() === 'Salt Frost Strait');
            const ellie = all.find((e) => String(e.title || '').trim() === 'Ellie Salt-Lamp');
            if (!salt || !ellie) return false;
            const sp = salt.parentId != null && String(salt.parentId).trim();
            const ep = ellie.parentId != null && String(ellie.parentId).trim();
            return sp === pid && ep === pid;
        }
    }
];

async function sendBrainstormStreamRequest(userMessage, attachmentUrls = []) {
    const textConfig = getBrainstormGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        throw new Error('Please configure your text model API in the settings.');
    }

    const urls = Array.isArray(attachmentUrls) ? attachmentUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];

    const brainstormStreamBody = {
        worldId: state.currentWorld.id,
        apiUrl: textConfig.apiUrl,
        apiKey: textConfig.apiKey,
        model: textConfig.model,
        message: userMessage,
        attachmentUrls: urls,
        activeSection: state.activeSection,
        activeEntryId: state.activeEntryId
    };

    try {
        const logBody = {
            ...brainstormStreamBody,
            apiKey: textConfig.apiKey ? '***redacted***' : ''
        };
        console.groupCollapsed('[Anvil Copilot → server] POST /gpt/anvil/brainstorm/chat/stream');
        console.log('payload (apiKey redacted):', logBody);
        console.log('JSON:', JSON.stringify(logBody, null, 2));
        console.groupEnd();
    } catch (_e) {
        /* ignore */
    }

    state.copilotStreamAbortController = new AbortController();
    const { signal } = state.copilotStreamAbortController;

    let response;
    try {
        response = await fetch('/gpt/anvil/brainstorm/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(brainstormStreamBody),
            signal
        });
    } catch (fetchErr) {
        state.copilotStreamAbortController = null;
        if (fetchErr?.name === 'AbortError') {
            return { aborted: true };
        }
        throw fetchErr;
    }

    if (!response.ok) {
        state.copilotStreamAbortController = null;
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.error || `HTTP ${response.status}`);
    }

    let donePayload;
    try {
        donePayload = await readBrainstormSseStream(response, {
            onDelta: (text) => {
                if (state.brainstormPendingTurn) {
                    state.brainstormPendingTurn.streamText = (state.brainstormPendingTurn.streamText || '') + text;
                }
                updateCopilotStreamBody(state.brainstormPendingTurn?.streamText || '');
            },
            onTool: (json) => {
                const p = state.brainstormPendingTurn;
                if (p) {
                    if (json.phase === 'start') {
                        const st = (p.streamText || '').trim();
                        if (st) {
                            p.blocks.push({ type: 'text', content: p.streamText });
                            p.streamText = '';
                        }
                        let last = p.blocks[p.blocks.length - 1];
                        if (!last || last.type !== 'tools') {
                            last = { type: 'tools', calls: [] };
                            p.blocks.push(last);
                        }
                        last.calls.push({
                            name: json.name || 'unknown',
                            callId: json.callId || '',
                            arguments: json.arguments ?? '{}',
                            result: '',
                            state: 'running'
                        });
                    } else if (json.phase === 'done') {
                        const last = p.blocks[p.blocks.length - 1];
                        if (last && last.type === 'tools') {
                            const cid = json.callId;
                            let call = cid
                                ? last.calls.find((c) => c.callId === cid && c.state === 'running')
                                : null;
                            if (!call) {
                                for (let i = last.calls.length - 1; i >= 0; i -= 1) {
                                    if (last.calls[i].state === 'running') {
                                        call = last.calls[i];
                                        break;
                                    }
                                }
                            }
                            if (call) {
                                call.state = 'done';
                                const r =
                                    json.result != null ? String(json.result) : json.preview != null ? String(json.preview) : '';
                                call.result = r;
                            }
                        }
                    }
                }
                if (json.phase === 'start') {
                    console.debug('[Anvil Copilot] tool start', json.name, json.callId);
                } else if (json.phase === 'done') {
                    console.debug('[Anvil Copilot] tool done', json.name, json.callId);
                }
                scheduleCopilotThreadRefresh();
            },
            onPlanOptions: (json) => {
                const p = state.brainstormPendingTurn;
                if (!p || !json.proposalId || !Array.isArray(json.options)) return;
                p.blocks.push({
                    type: 'plan_options',
                    proposalId: json.proposalId,
                    prompt: String(json.prompt || ''),
                    options: json.options,
                    state: 'pending'
                });
                scheduleCopilotThreadRefresh();
            },
            onError: (msg) => {
                console.warn('[Copilot stream]', msg);
            }
        });
    } catch (readErr) {
        if (readErr?.name === 'AbortError' || signal.aborted) {
            state.copilotStreamAbortController = null;
            return { aborted: true };
        }
        state.copilotStreamAbortController = null;
        throw readErr;
    }

    state.copilotStreamAbortController = null;

    if (!donePayload) {
        if (signal.aborted) {
            return { aborted: true };
        }
        throw new Error('Stream ended without a result.');
    }

    try {
        console.groupCollapsed('[Anvil Copilot ← server] stream finished');
        console.log('model:', textConfig.model);
        console.log('assistantMessage:', donePayload.assistantMessage);
        console.groupEnd();
    } catch (_e) {
        /* ignore */
    }

    if (donePayload.brainstormError) {
        console.warn('[Anvil Copilot]', donePayload.brainstormError);
    }

    setBrainstormSession(donePayload.session || createEmptyBrainstormSession(state.currentWorld.id));

    const worldMutated = Boolean(donePayload.worldMutated);
    if (donePayload.world) {
        state.currentWorld = ensureWorldShape(donePayload.world);
        upsertWorldSummary(state.currentWorld);
        if (worldMutated) {
            state.activeSection = state.currentWorld.sections[state.activeSection] ? state.activeSection : 'World';
            ensureActiveEntry();
        }
    }

    state.brainstormPendingTurn = null;
    flushCopilotThreadRefresh();

    return {
        assistantMessage: donePayload.assistantMessage,
        session: donePayload.session,
        brainstormError: donePayload.brainstormError,
        worldMutated,
        aborted: false
    };
}

async function clearBrainstormChat() {
    if (!state.currentWorld || state.brainstormSending || state.brainstormTestRunning) return;

    const worldId = state.currentWorld.id;
    try {
        const response = await fetch(`/gpt/anvil/brainstorm/session/${encodeURIComponent(worldId)}/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
        }
        setBrainstormSession(data);
        state.brainstormPendingTurn = null;
        state.brainstormAttachments = [];
        state.brainstormDraft = '';
        state.copilotThreadStickToBottom = true;
        if (isBrainstormChatShellMounted()) {
            const inputEl = dom.brainstormPanel.querySelector('#brainstorm-input');
            if (inputEl) {
                inputEl.value = '';
                inputEl.style.height = '48px';
            }
            flushCopilotThreadRefresh();
            fillCopilotAttachPreviewSlot();
            syncCopilotDockBusyState();
            syncBrainstormHeaderMeta();
        } else {
            renderBrainstormPanel();
        }
        console.info('[Anvil Copilot] Conversation cleared.');
    } catch (error) {
        console.error('Failed to clear Copilot chat:', error);
        alert(`Could not clear chat: ${error.message}`);
    }
}

const COPILOT_ROLLBACK_HOLD_MS = 520;

async function performCopilotRollback(lastMessageIndex) {
    if (!state.currentWorld || state.brainstormSending || state.brainstormTestRunning) return;
    const session = getBrainstormSession();
    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (lastMessageIndex < -1 || lastMessageIndex >= messages.length) return;

    const confirmed = window.confirm(
        'Revert to this message? All later chat will be removed and the world (entries, sections, fields) will be restored to match this point.'
    );
    if (!confirmed) return;

    try {
        const response = await fetch(
            `/gpt/anvil/brainstorm/session/${encodeURIComponent(state.currentWorld.id)}/rollback`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastMessageIndex })
            }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
        }
        setBrainstormSession(data.session);
        state.currentWorld = ensureWorldShape(data.world);
        upsertWorldSummary(state.currentWorld);
        state.brainstormPendingTurn = null;
        state.activeSection = state.currentWorld.sections[state.activeSection] ? state.activeSection : 'World';
        ensureActiveEntry();
        state.copilotThreadStickToBottom = true;
        if (isBrainstormChatShellMounted()) {
            flushCopilotThreadRefresh();
            syncBrainstormHeaderMeta();
        } else {
            renderBrainstormPanel();
        }
        patchUiAfterCopilotWorldSync({ serverPersisted: true });
        console.info('[Anvil Copilot] Rolled back to message index', lastMessageIndex);
    } catch (error) {
        console.error('Copilot rollback failed:', error);
        alert(`Rollback failed: ${error.message}`);
    }
}

async function runCopilotSelfTest() {
    if (!state.currentWorld || state.brainstormTestRunning || state.brainstormSending) return;

    state.brainstormExpanded = true;
    state.brainstormTestRunning = true;
    if (!isBrainstormChatShellMounted()) {
        renderBrainstormPanel();
    }

    console.groupCollapsed('[Anvil Copilot] Scenario Self-Test (Amber Shell Complete World)');
    console.info(
        'Using real API. Covers: chat; multimodal user attachments; digest/get_entry; anvil_list_sections + anvil_list_section_entries; anvil_propose_directions (plan panel); apply ops: updateWorldFields, create/update/delete entry, setEntryLinks, setEntryTags, moveEntrySection, appendEntryImages, addSection, renameSection, deleteEntry, deleteSection (empty + relocateEntriesTo), updateEntryFields (tags/styleKeywords). Check console for step pass/fail.'
    );

    try {
        for (const step of COPILOT_SCENARIO_STEPS) {
            if (!state.brainstormTestRunning) break;

            if (typeof step.runOnly === 'function') {
                console.groupCollapsed(`Step ${step.id} (Local Only)`);
                try {
                    await step.runOnly();
                } catch (err) {
                    console.error(`Step ${step.id} error`, err);
                } finally {
                    console.groupEnd();
                }
                await new Promise((resolve) => setTimeout(resolve, 120));
                continue;
            }

            if (typeof step.shouldRun === 'function' && !step.shouldRun()) {
                console.info(`Step ${step.id} skipped (shouldRun returned false).`);
                await new Promise((resolve) => setTimeout(resolve, 80));
                continue;
            }

            const promptText = typeof step.prompt === 'function' ? step.prompt() : step.prompt;
            const attachUrls =
                typeof step.attachmentUrls === 'function'
                    ? step.attachmentUrls()
                    : Array.isArray(step.attachmentUrls)
                      ? step.attachmentUrls
                      : [];

            state.brainstormPendingTurn = {
                user: promptText,
                attachmentUrls: attachUrls,
                blocks: [],
                streamText: ''
            };
            state.brainstormSending = true;
            if (isBrainstormChatShellMounted()) {
                syncCopilotDockBusyState();
                flushCopilotThreadRefresh();
            } else {
                renderBrainstormPanel();
            }

            console.groupCollapsed(`Step ${step.id}`);
            console.log('Sent prompt:\n', promptText);
            if (attachUrls.length) {
                console.log('Attachment URLs:', attachUrls);
            }

            let stepWorldMutated = false;
            try {
                const result = await sendBrainstormStreamRequest(promptText, attachUrls);
                if (result.aborted) {
                    console.warn('Step stopped (aborted).');
                    break;
                }
                stepWorldMutated = Boolean(result.worldMutated);
                const text = result.assistantMessage || '';
                let passReply = step.checkReply ? step.checkReply(text) : true;
                let passWorld = step.verifyWorld ? step.verifyWorld(state.currentWorld) : true;
                let passSession = step.verifySession ? step.verifySession(getBrainstormSession()) : true;
                const pass = passReply && passWorld && passSession;

                if (step.verifySession && !passSession) {
                    console.warn('Session assertion failed (e.g. missing plan_options block on last assistant turn).');
                }
                if (step.verifyWorld && !passWorld) {
                    console.warn('World data assertion failed (model may not have followed instructions, or previous step failed).', {
                        name: state.currentWorld?.name,
                        summarySample: String(state.currentWorld?.summary || '').slice(0, 120)
                    });
                }
                if (step.checkReply && !passReply) {
                    console.warn('Reply assertion failed (tail marker line unexpected).', { tail: text.slice(-80) });
                }

                console[pass ? 'log' : 'warn'](pass ? 'Pass' : 'Fail', {
                    replyPreview: text.slice(0, 280),
                    brainstormError: result.brainstormError || null
                });
            } catch (err) {
                console.error(`Step ${step.id} error`, err);
            } finally {
                state.brainstormSending = false;
                state.brainstormPendingTurn = null;
                console.groupEnd();
            }

            if (typeof step.afterStep === 'function') {
                try {
                    await step.afterStep();
                } catch (afterErr) {
                    console.warn(`Step ${step.id} afterStep error`, afterErr);
                }
            }

            if (stepWorldMutated) {
                patchUiAfterCopilotWorldSync({ serverPersisted: true });
            } else {
                syncBrainstormHeaderMeta();
            }
            if (isBrainstormChatShellMounted()) {
                syncCopilotDockBusyState();
                flushCopilotThreadRefresh();
            } else {
                renderBrainstormPanel();
            }
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
        console.log('Scenario self-test finished.');
    } finally {
        console.groupEnd();
        state.brainstormTestRunning = false;
        state.brainstormSending = false;
        state.brainstormPendingTurn = null;
        syncBrainstormHeaderMeta();
        if (isBrainstormChatShellMounted()) {
            syncCopilotDockBusyState();
            flushCopilotThreadRefresh();
        } else {
            renderBrainstormPanel();
        }
    }
}

function syncBrainstormInputHeight(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
}

function renderBrainstormPanel() {
    if (!dom.brainstormPanel) return;

    if (!state.currentWorld) {
        dom.brainstormPanel.className = 'brainstorm-panel is-collapsed';
        dom.brainstormPanel.innerHTML = `
            <div class="brainstorm-panel-shell brainstorm-panel-shell--unified">
                <div class="brainstorm-header brainstorm-header--strip brainstorm-header--disabled">
                    <div class="brainstorm-heading">
                        <div class="brainstorm-orb" aria-hidden="true"></div>
                        <div class="brainstorm-heading-copy">
                            <strong>World Copilot</strong>
                            <span class="brainstorm-header-tagline">Select a world to use chat</span>
            </div>
                    </div>
                    <div class="brainstorm-meta">
                        <span class="brainstorm-toggle" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    const session = getBrainstormSession();
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const activeEntry = getSelectedEntry();
    const textModelOptionsHtml = getBrainstormTextModelOptionsHtml();

    dom.brainstormPanel.className = `brainstorm-panel ${state.brainstormExpanded ? 'is-expanded' : 'is-collapsed'}`;

    dom.brainstormPanel.innerHTML = `
        <div class="brainstorm-panel-shell brainstorm-panel-shell--unified brainstorm-panel-shell--chat">
            <header class="brainstorm-header brainstorm-header--strip brainstorm-header--expanded" data-brainstorm-toggle="true" aria-expanded="${state.brainstormExpanded ? 'true' : 'false'}">
                <div class="brainstorm-heading">
                    <div class="brainstorm-orb" aria-hidden="true"></div>
                    <div class="brainstorm-heading-copy">
                        <strong>World Copilot</strong>
                        <span class="brainstorm-header-tagline">${escapeHtml(state.currentWorld.name || 'Untitled World')} · ${escapeHtml(activeEntry?.title || state.activeSection)}</span>
                    </div>
                </div>
                <div class="brainstorm-meta">
                    <span class="brainstorm-pill" data-brainstorm-pill="msgs">${messages.length} msgs</span>
                    <span class="brainstorm-pill" data-brainstorm-pill="context">${escapeHtml(state.activeSection)}</span>
                    <button type="button" class="button-ghost copilot-self-test-btn" data-copilot-self-test="true" ${state.brainstormSending || state.brainstormTestRunning ? 'disabled' : ''}>Run Scenario Test</button>
                    <button type="button" class="copilot-header-collapse" title="Toggle chat">
                        <span class="brainstorm-toggle" aria-hidden="true"></span>
                    </button>
                </div>
            </header>
            <div class="brainstorm-body brainstorm-body--chat">
                <div class="brainstorm-body-inner brainstorm-body-inner--chat">
                    <div class="copilot-thread">${renderCopilotMessageListHtml(messages, state.brainstormPendingTurn)}</div>
                    <footer class="copilot-dock">
                        <div id="copilot-attach-preview-slot"></div>
                        <div class="copilot-dock-row">
                            <div class="copilot-dock-left">
                                <div class="copilot-dock-select-wrap">
                                    <select id="anvil-brainstorm-model" class="sidebar-select" data-select-placement="up" aria-label="Text model">${textModelOptionsHtml}</select>
                                </div>
                                <textarea id="brainstorm-input" class="copilot-textarea" rows="1" placeholder="Message… (${escapeAttribute(state.activeSection)}) · Enter send, Shift+Enter newline">${escapeHtml(state.brainstormDraft || '')}</textarea>
                            </div>
                            <div class="copilot-dock-actions">
                                <input type="file" id="brainstorm-attach-input" class="copilot-attach-input" accept="image/*" multiple hidden>
                                <button type="button" class="button-ghost copilot-attach-btn" data-brainstorm-attach-pick="true" title="Attach images" ${state.brainstormSending || state.brainstormTestRunning ? 'disabled' : ''}>Image</button>
                                <button type="button" class="button-ghost copilot-clear-btn" data-copilot-clear-chat="true" title="Clear conversation" ${state.brainstormSending || state.brainstormTestRunning ? 'disabled' : ''}>Clear chat</button>
                                <button type="button" class="button-ghost copilot-stop-btn" data-copilot-stop="true" title="Stop generation" ${state.brainstormSending ? '' : 'disabled'}>Stop</button>
                                <button type="button" class="button-primary copilot-send-btn" data-brainstorm-send="true" ${state.brainstormSending ? 'disabled' : ''}>${state.brainstormSending ? '…' : 'Send'}</button>
                            </div>
                        </div>
                    </footer>
                </div>
            </div>
        </div>
    `;

    fillCopilotAttachPreviewSlot();

    const brainstormModelSelect = dom.brainstormPanel.querySelector('#anvil-brainstorm-model');
    if (brainstormModelSelect) {
        syncBrainstormModelSelectValue(brainstormModelSelect);
        enhanceCustomSelect(brainstormModelSelect);
    }
    bindBrainstormPanelEvents();
    syncBrainstormExpandedUi();
    syncCopilotDockBusyState();
    const threadEl = dom.brainstormPanel.querySelector('.copilot-thread');
    if (threadEl) {
        threadEl.onscroll = () => {
            const gap = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
            state.copilotThreadStickToBottom = gap < 56;
        };
    }
    if (state.copilotThreadStickToBottom) {
        scrollCopilotThreadToBottom(true);
    }
    requestAnimationFrame(() => syncBrainstormInputHeight(dom.brainstormPanel.querySelector('#brainstorm-input')));
}

function bindBrainstormPanelEvents() {
    if (dom.brainstormPanel._copilotRollbackAbort) {
        dom.brainstormPanel._copilotRollbackAbort.abort();
    }
    dom.brainstormPanel._copilotRollbackAbort = new AbortController();
    const rollbackSignal = dom.brainstormPanel._copilotRollbackAbort.signal;

    let rollbackHoldTimer = null;
    let rollbackHoldIdx = null;
    const cancelRollbackHold = () => {
        clearTimeout(rollbackHoldTimer);
        rollbackHoldTimer = null;
        rollbackHoldIdx = null;
    };

    dom.brainstormPanel.addEventListener(
        'pointerdown',
        (event) => {
            if (event.button !== 0) return;
            const turn = event.target.closest('[data-copilot-rollback-index]');
            if (!turn) return;
            if (!event.ctrlKey && !event.metaKey) return;
            const idx = Number(turn.getAttribute('data-copilot-rollback-index'));
            if (Number.isNaN(idx)) return;
            event.preventDefault();
            rollbackHoldIdx = idx;
            clearTimeout(rollbackHoldTimer);
            rollbackHoldTimer = setTimeout(() => {
                rollbackHoldTimer = null;
                const i = rollbackHoldIdx;
                rollbackHoldIdx = null;
                if (i == null || state.brainstormSending || state.brainstormTestRunning) return;
                void performCopilotRollback(i);
            }, COPILOT_ROLLBACK_HOLD_MS);
        },
        { signal: rollbackSignal }
    );
    dom.brainstormPanel.addEventListener('pointerup', cancelRollbackHold, { signal: rollbackSignal });
    dom.brainstormPanel.addEventListener('pointercancel', cancelRollbackHold, { signal: rollbackSignal });

    dom.brainstormPanel.addEventListener('click', (event) => {
        const toolToggle = event.target.closest('[data-tool-toggle="true"]');
        if (toolToggle) {
            const toolCall = toolToggle.closest('.copilot-tool-call');
            if (toolCall) {
                toolCall.classList.toggle('is-open');
                event.stopPropagation();
            }
        }

        const planSelect = event.target.closest('[data-copilot-plan-select="true"]');
        if (planSelect && !planSelect.disabled && !state.brainstormSending && !state.brainstormTestRunning) {
            const card = planSelect.closest('[data-copilot-plan-card="true"]');
            const proposalId = planSelect.getAttribute('data-plan-proposal-id');
            const optionId = planSelect.getAttribute('data-plan-option-id') || '';
            const titleEl = planSelect.querySelector('.copilot-plan-option-title');
            const detailEl = planSelect.querySelector('.copilot-plan-option-detail');
            const title = titleEl ? titleEl.textContent.trim() : '';
            const detail = detailEl ? detailEl.textContent.trim() : '';
            if (proposalId && title && card) {
                event.preventDefault();
                card.querySelectorAll('.copilot-plan-option').forEach((b) => b.classList.remove('is-selected'));
                planSelect.classList.add('is-selected');
                card.querySelector('.copilot-plan-custom')?.classList.remove('is-selected');
                card.dataset.planSelCustom = '0';
                card.dataset.planSelOptionId = optionId;
                card.dataset.planSelTitle = title;
                card.dataset.planSelDetail = detail;
                showCopilotPlanConfirmRow(card);
            }
            return;
        }

        const useCustomBtn = event.target.closest('[data-copilot-plan-use-custom="true"]');
        if (useCustomBtn && !state.brainstormSending && !state.brainstormTestRunning) {
            const card = useCustomBtn.closest('[data-copilot-plan-card="true"]');
            const proposalId = useCustomBtn.getAttribute('data-plan-proposal-id');
            const ta = card?.querySelector('[data-copilot-plan-custom-input]');
            const raw = ta ? String(ta.value || '').trim() : '';
            if (!proposalId || !card) return;
            event.preventDefault();
            if (!raw) {
                alert('Enter a custom direction first.');
                return;
            }
            card.querySelectorAll('.copilot-plan-option').forEach((b) => b.classList.remove('is-selected'));
            card.querySelector('.copilot-plan-custom')?.classList.add('is-selected');
            card.dataset.planSelCustom = '1';
            delete card.dataset.planSelOptionId;
            card.dataset.planSelTitle = 'Custom';
            card.dataset.planSelDetail = raw;
            showCopilotPlanConfirmRow(card);
            return;
        }

        const planCancelSel = event.target.closest('[data-copilot-plan-cancel-select="true"]');
        if (planCancelSel && !state.brainstormSending && !state.brainstormTestRunning) {
            const card = planCancelSel.closest('[data-copilot-plan-card="true"]');
            if (card) {
                event.preventDefault();
                clearCopilotPlanSelectionUi(card);
            }
            return;
        }

        const planConfirm = event.target.closest('[data-copilot-plan-confirm="true"]');
        if (planConfirm && !planConfirm.disabled && !state.brainstormSending && !state.brainstormTestRunning) {
            const card = planConfirm.closest('[data-copilot-plan-card="true"]');
            const proposalId = card?.getAttribute('data-plan-proposal-id');
            if (!proposalId || !card) return;
            event.preventDefault();
            if (card.dataset.planSelCustom === '1') {
                const ta = card.querySelector('[data-copilot-plan-custom-input]');
                const raw = ta ? String(ta.value || '').trim() : '';
                if (!raw) {
                    alert('Enter a custom direction first.');
                    return;
                }
                const msg = `I choose (custom): ${raw}`;
                void confirmCopilotPlanSelection(proposalId, 'Custom', raw, msg);
                return;
            }
            const title = card.dataset.planSelTitle || '';
            if (!title) return;
            const detail = card.dataset.planSelDetail || '';
            const optionId = card.dataset.planSelOptionId || '';
            const msg = detail ? `I choose (${optionId || 'option'}): ${title}\n${detail}` : `I choose (${optionId || 'option'}): ${title}`;
            void confirmCopilotPlanSelection(proposalId, title, detail, msg);
            return;
        }
    });

    dom.brainstormPanel.querySelector('[data-copilot-stop="true"]')?.addEventListener('click', () => {
        if (state.copilotStreamAbortController) {
            state.copilotStreamAbortController.abort();
        }
    });

    dom.brainstormPanel.querySelector('[data-brainstorm-toggle="true"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target.closest('.copilot-self-test-btn')) return;
        state.brainstormExpanded = !state.brainstormExpanded;
        syncBrainstormExpandedUi();
    });

    dom.brainstormPanel.querySelector('#brainstorm-input')?.addEventListener('input', (event) => {
        state.brainstormDraft = event.target.value;
        syncBrainstormInputHeight(event.target);
    });

    dom.brainstormPanel.querySelector('#brainstorm-input')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        void sendBrainstormMessage();
    });

    dom.brainstormPanel.querySelector('#anvil-brainstorm-model')?.addEventListener('change', (event) => {
        state.brainstormModel = event.target.value;
        saveSidebarSettings();
    });

    dom.brainstormPanel.querySelector('[data-brainstorm-send="true"]')?.addEventListener('click', () => {
        void sendBrainstormMessage();
    });

    dom.brainstormPanel.querySelector('[data-copilot-self-test="true"]')?.addEventListener('click', () => {
        void runCopilotSelfTest();
    });

    dom.brainstormPanel.querySelector('[data-copilot-clear-chat="true"]')?.addEventListener('click', () => {
        void clearBrainstormChat();
    });

    dom.brainstormPanel.querySelector('[data-brainstorm-attach-pick="true"]')?.addEventListener('click', () => {
        dom.brainstormPanel.querySelector('#brainstorm-attach-input')?.click();
    });

    dom.brainstormPanel.querySelector('#brainstorm-attach-input')?.addEventListener('change', (event) => {
        const input = event.target;
        void addBrainstormAttachmentsFromFiles(input.files);
        input.value = '';
    });
}

function syncBrainstormExpandedUi() {
    if (!dom.brainstormPanel) return;
    dom.brainstormPanel.classList.toggle('is-expanded', state.brainstormExpanded);
    dom.brainstormPanel.classList.toggle('is-collapsed', !state.brainstormExpanded);
    dom.brainstormPanel.querySelector('[data-brainstorm-toggle="true"]')?.setAttribute('aria-expanded', state.brainstormExpanded ? 'true' : 'false');
    if (state.brainstormExpanded) {
        requestAnimationFrame(() => scrollCopilotThreadToBottom(true));
    }
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

function bindEntryStudioEvents() {
    dom.studioContent.querySelector('#entry-title-input')?.addEventListener('input', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.title = event.target.value;
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
        dom.studioTitle.textContent = live.title || 'Untitled Entry';
    });

    dom.studioContent.querySelector('#entry-status-input')?.addEventListener('change', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.status = event.target.value;
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-summary-input')?.addEventListener('input', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.summary = event.target.value;
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-content-input')?.addEventListener('input', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.content = event.target.value;
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-tags-input')?.addEventListener('input', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.tags = normalizeTagList(event.target.value);
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-style-input')?.addEventListener('input', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        live.styleKeywords = normalizeTagList(event.target.value);
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelector('#entry-parent-select')?.addEventListener('change', (event) => {
        const live = getSelectedEntry();
        if (!live) return;
        const v = String(event.target.value || '').trim();
        live.parentId = v || null;
        live.updatedAt = Date.now();
        queueSaveCurrentWorld();
    });

    dom.studioContent.querySelectorAll('[data-navigate-entry-id]').forEach((element) => {
        element.addEventListener('click', (ev) => {
            ev.preventDefault();
            const id = String(element.getAttribute('data-navigate-entry-id') || '').trim();
            if (!id || !selectEntryById(id)) return;
            renderEntryBoard();
            renderEntryStudio({ instant: true });
        });
    });

    dom.studioContent.querySelectorAll('[data-link-id]').forEach((element) => {
        element.addEventListener('click', () => {
            const live = getSelectedEntry();
            if (!live) return;
            const linkId = String(element.dataset.linkId || '');
            const nextLinks = new Set((live.links || []).map((id) => String(id)));
            if (nextLinks.has(linkId)) {
                nextLinks.delete(linkId);
            } else {
                nextLinks.add(linkId);
            }
            live.links = Array.from(nextLinks);
            live.updatedAt = Date.now();
            queueSaveCurrentWorld();
            syncLinkChipActiveClasses();
        });
    });

    dom.studioContent.querySelector('[data-delete-entry="true"]')?.addEventListener('click', deleteSelectedEntry);
    dom.studioContent.querySelector('[data-upload-assets="true"]')?.addEventListener('click', () => {
        if (state.aiBusy) return;
        dom.studioContent.querySelector('#entry-asset-upload')?.click();
    });
    dom.studioContent.querySelector('#entry-asset-upload')?.addEventListener('change', (event) => {
        if (state.aiBusy) {
            event.target.value = '';
            return;
        }
        void uploadEntryAssets(Array.from(event.target.files || []));
        event.target.value = '';
    });

    dom.studioContent.querySelectorAll('[data-image-action]').forEach((element) => {
        element.addEventListener('click', () => {
            if (state.aiBusy) return;
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
            if (state.aiBusy) return;
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
            state.currentWorld.coverImage = '';
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
    if (!state.currentWorld || state.worldHeroAiLoading || state.aiBusy || state.worldHeroVisualLoading) return;

    const textConfig = getTextGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the settings.');
        return;
    }

    const rawWorldPrompt = state.worldHeroAiPrompt.trim();
    const worldModifyDefaultIntent = 'Revise the World Summary and Canon Context: improve clarity, structure, and internal consistency; keep established facts and tone unless User Intent asks otherwise or a contradiction must be fixed. If no specific direction was given, make only minimal edits.';
    state.currentWorld.worldHeroAiPreset = {
        ...(state.currentWorld.worldHeroAiPreset || {}),
        prompt: rawWorldPrompt
    };

    const userPromptForModifyWorld = mode === 'modify-world' && !rawWorldPrompt
        ? worldModifyDefaultIntent
        : rawWorldPrompt;

    state.worldHeroAiLoading = true;
    const busyWorld = mode === 'complete'
        ? 'Completing world overview...'
        : mode === 'modify-world'
            ? 'Modifying world summary and canon...'
            : 'Generating world overview...';
    const previewWorld = mode === 'complete'
        ? 'Completing world overview entry, summary, canon and keywords...'
        : mode === 'modify-world'
            ? 'Applying edits to world summary and canon...'
            : 'Generating world overview...';
    setAiBusy(true, busyWorld);
    state.worldHeroAiResult = previewWorld;
    renderAll();

    const action = mode === 'summary'
        ? 'rewrite'
        : mode === 'canon-expand'
            ? 'expand'
            : mode === 'modify-world'
                ? 'modify-world'
                : 'rewrite';

    const payload = {
        apiUrl: textConfig.apiUrl,
        apiKey: textConfig.apiKey,
        model: textConfig.model,
        world: state.currentWorld,
        sectionName: 'World',
        entryId: null,
        action,
        userPrompt: mode === 'complete'
            ? `${rawWorldPrompt ? `${rawWorldPrompt}\n\n` : ''}Return a JSON object with keys: worldSummary, themeKeywords, canonContext, entrySummary, entryTags, entryStyleKeywords, entryContent. Fill all keys for the world overview.`
            : mode === 'modify-world'
                ? `${userPromptForModifyWorld ? `${userPromptForModifyWorld}\n\n` : ''}Return a JSON object with exactly two keys: worldSummary and canonContext. Each value must be the full revised text for that field (complete replacement of the existing World Summary and Canon Context shown in context). Preserve facts and names where User Intent does not ask to change them.`
                : rawWorldPrompt || (mode === 'summary'
                    ? 'Generate a compelling world overview for this setting.'
                    : mode === 'canon-expand'
                        ? 'Expand the canon and rules of this world in a coherent way.'
                        : 'Rewrite the canon context into a cleaner, stronger, more cohesive version.')
    };

    try {
        const response = await fetch('/gpt/anvil/generate/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        logAiOutboundFromResponse(`generate/text world-${mode}`, data);

        const generatedText = String(data.text || '').trim();

        if (mode === 'complete') {
            let completed = null;
            try {
                completed = JSON.parse(generatedText);
            } catch (error) {
                completed = null;
            }
            if (!completed || typeof completed !== 'object') {
                throw new Error('World overview completion response is not valid JSON.');
            }

            state.currentWorld.summary = String(completed.worldSummary || state.currentWorld.summary || '').trim();
            state.currentWorld.themeKeywords = normalizeTagList(completed.themeKeywords || state.currentWorld.themeKeywords || []);
            state.currentWorld.canonContext = String(completed.canonContext || state.currentWorld.canonContext || '').trim();

            const overviewEntry = state.currentWorld.sections?.World?.[0];
            if (overviewEntry) {
                overviewEntry.summary = String(completed.entrySummary || overviewEntry.summary || '').trim();
                overviewEntry.tags = normalizeTagList(completed.entryTags || overviewEntry.tags || []);
                overviewEntry.styleKeywords = normalizeTagList(completed.entryStyleKeywords || overviewEntry.styleKeywords || []);
                overviewEntry.content = String(completed.entryContent || overviewEntry.content || '').trim();
                overviewEntry.updatedAt = Date.now();
            }

            state.worldHeroAiResult = 'World overview completed successfully.';
        } else if (mode === 'modify-world') {
            let revised = null;
            try {
                revised = JSON.parse(generatedText);
            } catch (error) {
                revised = null;
            }
            if (!revised || typeof revised !== 'object') {
                throw new Error('World modify response is not valid JSON (expected worldSummary and canonContext).');
            }

            state.currentWorld.summary = String(revised.worldSummary ?? state.currentWorld.summary ?? '').trim();
            state.currentWorld.canonContext = String(revised.canonContext ?? state.currentWorld.canonContext ?? '').trim();
            state.worldHeroAiResult = 'World summary and canon updated.';
        } else {
            state.worldHeroAiResult = generatedText || 'No text was returned.';

            if (mode === 'summary') {
                state.currentWorld.summary = generatedText;
            } else if (mode === 'canon-expand') {
                state.currentWorld.canonContext = [state.currentWorld.canonContext, generatedText].filter(Boolean).join('\n\n');
            } else {
                state.currentWorld.canonContext = generatedText;
            }
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
        setAiBusy(false);
        renderAll();
    }
}

async function addBrainstormAttachmentsFromFiles(fileList) {
    if (!state.currentWorld || state.brainstormSending) return;
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    for (const file of files) {
        const formData = new FormData();
        formData.append('asset', file);
        formData.append('worldId', state.currentWorld.id);
        try {
            const response = await fetch('/gpt/anvil/asset/upload', { method: 'POST', body: formData });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            state.brainstormAttachments.push({
                url: data.url,
                label: data.originalName || file.name
            });
        } catch (err) {
            console.error('[Anvil Copilot] Image upload failed:', err);
            alert(`Image upload failed: ${err.message}`);
        }
    }
    if (!fillCopilotAttachPreviewSlot()) {
        renderBrainstormPanel();
    }
}

/**
 * @param {string} userMessage
 * @param {string[]} attachmentUrls
 * @param {{ restoreOnAbort?: boolean, backupAttachments?: { url: string, label?: string }[], suppressBrainstormAlerts?: boolean }} [opts]
 */
async function sendCopilotUserTurn(userMessage, attachmentUrls = [], opts = {}) {
    const restoreOnAbort = opts.restoreOnAbort !== false;
    const backupAttachments = Array.isArray(opts.backupAttachments) ? opts.backupAttachments : null;
    const suppressBrainstormAlerts = Boolean(opts.suppressBrainstormAlerts);

    if (!state.currentWorld || state.brainstormSending) return { cancelled: true };

    const trimmed = String(userMessage || '').trim();
    const urls = Array.isArray(attachmentUrls) ? attachmentUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    if (!trimmed && !urls.length) return { cancelled: true };

    const textConfig = getBrainstormGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        if (suppressBrainstormAlerts) {
            return { ok: false, reason: 'no_config', message: 'Configure the text model API in settings.' };
        }
        alert('Please configure your text model API in the settings.');
        return { cancelled: true };
    }

    state.copilotThreadStickToBottom = true;
    state.brainstormSending = true;
    state.brainstormPendingTurn = {
        user: trimmed,
        attachmentUrls: urls,
        blocks: [],
        streamText: ''
    };
    state.brainstormExpanded = true;
    if (!isBrainstormChatShellMounted()) {
        renderBrainstormPanel();
    } else {
        syncCopilotDockBusyState();
        flushCopilotThreadRefresh();
    }

    try {
        const streamResult = await sendBrainstormStreamRequest(trimmed, urls);
        if (streamResult.aborted) {
            state.brainstormPendingTurn = null;
            if (restoreOnAbort) {
                state.brainstormDraft = trimmed;
                state.brainstormAttachments =
                    backupAttachments && backupAttachments.length
                        ? backupAttachments.map((a) => ({ url: a.url, label: a.label || '' }))
                        : urls.map((url, i) => ({ url, label: `Image ${i + 1}` }));
            }
            flushCopilotThreadRefresh();
            if (isBrainstormChatShellMounted()) {
                const inputEl = dom.brainstormPanel.querySelector('#brainstorm-input');
                if (inputEl && restoreOnAbort) {
                    inputEl.value = state.brainstormDraft;
                    syncBrainstormInputHeight(inputEl);
                }
                fillCopilotAttachPreviewSlot();
                syncCopilotDockBusyState();
            }
            console.info('[Anvil Copilot] Generation stopped.');
            return { aborted: true };
        }

        state.brainstormExpanded = true;
        if (streamResult.worldMutated) {
            patchUiAfterCopilotWorldSync({ serverPersisted: true });
        } else {
            syncBrainstormHeaderMeta();
        }
        if (isBrainstormChatShellMounted()) {
            syncCopilotDockBusyState();
        } else {
            renderBrainstormPanel();
        }
        return streamResult;
    } catch (error) {
        console.error('Failed Anvil brainstorm chat:', error);
        state.brainstormPendingTurn = null;
        flushCopilotThreadRefresh();
        if (suppressBrainstormAlerts) {
            return { ok: false, message: error.message || String(error) };
        }
        alert(`Brainstorm request failed: ${error.message}`);
        throw error;
    } finally {
        state.brainstormSending = false;
        if (isBrainstormChatShellMounted()) {
            syncCopilotDockBusyState();
            flushCopilotThreadRefresh();
        } else {
            renderBrainstormPanel();
        }
    }
}

/** After user pressed Continue: mark plan chosen on server, then run one Copilot turn with the selection message. */
async function confirmCopilotPlanSelection(proposalId, choiceTitle, choiceDetail, userMessage) {
    if (!state.currentWorld || state.brainstormSending || state.brainstormTestRunning) return;
    try {
        await patchCopilotPlanOptions([
            {
                proposalId,
                state: 'chosen',
                choiceTitle,
                choiceDetail: choiceDetail || ''
            }
        ]);
        if (isBrainstormChatShellMounted()) {
            flushCopilotThreadRefresh();
        }
        const result = await sendCopilotUserTurn(userMessage, [], {
            restoreOnAbort: false,
            suppressBrainstormAlerts: true
        });
        if (result?.aborted) return;
        if (result?.cancelled) return;
        if (result && result.ok === false) {
            const hint = result.message || result.reason || 'Request did not complete.';
            alert(`Plan choice was saved, but Copilot could not continue: ${hint}`);
        }
    } catch (err) {
        console.error('[Anvil Copilot] Plan choice failed:', err);
        alert(`Plan choice failed: ${err.message}`);
    }
}

async function sendBrainstormMessage() {
    if (!state.currentWorld || state.brainstormSending) return;

    const userMessage = state.brainstormDraft.trim();
    const backupAttachments = state.brainstormAttachments.map((a) => ({ url: a.url, label: a.label || '' }));
    const pendingUrls = backupAttachments.map((a) => a.url).filter(Boolean);
    if (!userMessage && pendingUrls.length === 0) {
        alert('Enter a message or attach at least one image.');
        return;
    }

    const textConfig = getBrainstormGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the settings.');
        return;
    }

    await dismissCopilotPendingPlanOptions();
    if (isBrainstormChatShellMounted()) {
        flushCopilotThreadRefresh();
    }

    state.brainstormDraft = '';
    state.brainstormAttachments = [];
    if (isBrainstormChatShellMounted()) {
        const inputEl = dom.brainstormPanel.querySelector('#brainstorm-input');
        if (inputEl) {
            inputEl.value = '';
            inputEl.style.height = '48px';
        }
        fillCopilotAttachPreviewSlot();
    }

    await sendCopilotUserTurn(userMessage, pendingUrls, { restoreOnAbort: true, backupAttachments });
}

async function runTextGeneration(action) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) {
        alert('Select an entry first.');
        return;
    }
    if (state.aiBusy) return;

    const textConfig = getTextGenerationConfig();
    if (!textConfig.apiUrl || !textConfig.apiKey) {
        alert('Please configure your text model API in the top-right settings.');
        return;
    }

    const promptInput = dom.studioContent.querySelector('#ai-prompt-input');
    const rawPrompt = promptInput?.value.trim() || '';
    const modifyDefaultIntent = 'Revise and refine the current entry body: improve clarity and flow; keep established facts, names, and tone unless they conflict with canon or User Intent asks otherwise. If no specific edits were requested, make only minimal improvements.';
    const userPrompt = action === 'modify' && !rawPrompt ? modifyDefaultIntent : rawPrompt;
    entry.generationPresets = {
        ...(entry.generationPresets || {}),
        textPrompt: rawPrompt,
        lastPrompt: rawPrompt
    };

    const busyMessage = action === 'complete'
        ? 'Completing entry content and metadata...'
        : action === 'modify'
            ? 'Modifying entry text...'
            : 'Generating text content...';
    const resultPreview = action === 'complete'
        ? 'Completing entry: summary, tags, style keywords and full text...'
        : action === 'modify'
            ? 'Applying edits to current entry body...'
            : 'Generating text...';

    setAiBusy(true, busyMessage);
    state.aiResult = resultPreview;
    renderAll();

    const payload = {
                apiUrl: textConfig.apiUrl,
                apiKey: textConfig.apiKey,
                model: textConfig.model,
                world: state.currentWorld,
                sectionName: state.activeSection,
                entryId: entry.id,
        action: action === 'complete' ? 'rewrite' : action,
        userPrompt: action === 'complete'
            ? `${rawPrompt ? `${rawPrompt}\n\n` : ''}Return a JSON object with keys: summary, tags, styleKeywords, content. Fill all keys for this entry based on the world canon and linked context.`
            : userPrompt
    };

    try {
        const response = await fetch('/gpt/anvil/generate/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        logAiOutboundFromResponse(`generate/text entry-${action}`, data);

        const generatedText = String(data.text || '').trim();
        state.aiContextSummary = data.contextSummary || null;
        entry.aiContextSummary = formatContextSummary(data.contextSummary);

        if (action === 'complete') {
            let completed = null;
            try {
                completed = JSON.parse(generatedText);
            } catch (error) {
                completed = null;
            }

            if (!completed || typeof completed !== 'object') {
                throw new Error('Complete Entry response is not valid JSON.');
            }

            entry.summary = String(completed.summary || entry.summary || '').trim();
            entry.tags = normalizeTagList(completed.tags || entry.tags || []);
            entry.styleKeywords = normalizeTagList(completed.styleKeywords || entry.styleKeywords || []);
            entry.content = String(completed.content || entry.content || '').trim();
            state.aiResult = 'Entry completed successfully.';
        } else {
            state.aiResult = generatedText || 'No text was returned.';

        if (action === 'align') {
            renderEntryStudio();
            return;
        }

            if (action === 'rewrite' || action === 'modify') {
            entry.content = generatedText;
        } else if (action === 'expand') {
            entry.content = [entry.content, generatedText].filter(Boolean).join('\n\n');
        } else {
            entry.content = entry.content ? `${entry.content}\n\n${generatedText}` : generatedText;
        }

        if (!entry.summary) {
            entry.summary = deriveSummaryFromText(generatedText);
            }
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
    } finally {
        setAiBusy(false);
        renderAll();
    }
}

async function runImageGeneration(action) {
    const entry = getSelectedEntry();
    if (!state.currentWorld || !entry) {
        alert('Select an entry first.');
        return;
    }
    if (state.aiBusy) return;

    const imageConfig = getImageGenerationConfig();
    if (!imageConfig.apiUrl || !imageConfig.apiKey) {
        alert('Please configure your image model API in the top-right settings.');
        return;
    }

    const promptInput = dom.studioContent.querySelector('#image-prompt-input');
    const userPrompt = promptInput?.value.trim() || '';
    entry.generationPresets = {
        ...(entry.generationPresets || {}),
        imagePrompt: userPrompt
    };

    setAiBusy(true, 'Generating concept art...');
    state.aiResult = 'Generating concept art...';
    renderAll();

    const payload = {
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
    };

    try {
        const response = await fetch('/gpt/anvil/generate/image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        logAiOutboundFromResponse(`generate/image entry-${action}`, data);

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

        const liveEntry = getSelectedEntry();
        if (!liveEntry || liveEntry.id !== entry.id) {
            throw new Error('Selected entry changed during image generation.');
        }

        liveEntry.images = Array.isArray(liveEntry.images) ? liveEntry.images : [];
        liveEntry.images.unshift(generatedImage);
        liveEntry.updatedAt = Date.now();
        state.aiContextSummary = data.contextSummary || null;
        const selectedReferenceLabel = data.contextSummary?.selectedReference?.label || data.referenceUsedLabel || '';
        const referenceCount = Array.isArray(data.contextSummary?.referenceCandidates) ? data.contextSummary.referenceCandidates.length : 0;
        state.aiResult = `Generated image with ${imageConfig.model}. ${selectedReferenceLabel ? `Primary reference: ${selectedReferenceLabel}. ` : ''}${referenceCount > 0 ? `Reference pool: ${referenceCount}.` : 'No explicit reference image was used.'}`;

        pushActivity(`Generated ${action} image for ${liveEntry.title}`, 'image_generated');
        state.currentWorld.generationHistory.unshift({
            id: `gen_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            kind: 'image',
            action,
            entryId: liveEntry.id,
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
    } finally {
        setAiBusy(false);
        renderAll();
    }
}

function logAiOutboundFromResponse(label, data) {
    if (!data || typeof data !== 'object') return;

    let outbound = data.aiOutbound;
    const hasImageReferenceFields = Object.prototype.hasOwnProperty.call(data, 'referenceUsed')
        || Object.prototype.hasOwnProperty.call(data, 'referenceUsedLabel');

    if (!outbound && (data.systemPromptUsed || data.promptUsed) && !hasImageReferenceFields) {
        outbound = {
            model: data.model,
            messages: [
                ...(data.systemPromptUsed ? [{ role: 'system', content: data.systemPromptUsed }] : []),
                ...(data.promptUsed ? [{ role: 'user', content: data.promptUsed }] : [])
            ]
        };
    }
    if (!outbound && data.promptUsed != null && hasImageReferenceFields) {
        outbound = {
            model: data.model,
            prompt: data.promptUsed,
            referenceUrl: data.referenceUsed,
            referenceLabel: data.referenceUsedLabel
        };
    }
    if (!outbound) return;

    try {
        console.groupCollapsed(`[Anvil AI → model] ${label}`);
        if (outbound.model) {
            console.log('model:', outbound.model);
        }
        if (outbound.size) {
            console.log('size:', outbound.size);
        }
        if (Array.isArray(outbound.messages)) {
            outbound.messages.forEach((m) => {
                const role = m.role || 'message';
                console.log(`── ${role} ──`);
                console.log(m.content != null ? m.content : '');
            });
        }
        if (outbound.prompt != null && String(outbound.prompt).length > 0) {
            console.log('── image prompt (to provider) ──');
            console.log(outbound.prompt);
        }
        if (outbound.referenceUrl || outbound.referenceLabel) {
            console.log('reference image:', outbound.referenceLabel || '(none)', outbound.referenceUrl || '');
        }
        console.groupEnd();
    } catch (error) {
        console.groupEnd();
    }
}

async function runWorldCoverGeneration() {
    if (!state.currentWorld || state.worldHeroVisualLoading || state.aiBusy || state.worldHeroAiLoading) return;

    const imageConfig = getImageGenerationConfig();
    if (!imageConfig.apiUrl || !imageConfig.apiKey) {
        alert('Please configure your image model API in the settings.');
        return;
    }

    const promptFromDom = dom.worldHero?.querySelector('#world-cover-image-prompt')?.value?.trim() || '';
    const userPrompt = promptFromDom || (state.currentWorld.worldHeroVisualPreset?.coverPrompt || '').trim();
    state.currentWorld.worldHeroVisualPreset = state.currentWorld.worldHeroVisualPreset || {};
    state.currentWorld.worldHeroVisualPreset.coverPrompt = promptFromDom || state.currentWorld.worldHeroVisualPreset.coverPrompt;

    state.worldHeroVisualLoading = true;
    setAiBusy(true, 'Generating world cover image...');
    state.worldHeroVisualResult = 'Generating world cover image...';
    renderAll();

    const payload = {
        apiUrl: imageConfig.apiUrl,
        apiKey: imageConfig.apiKey,
        model: imageConfig.model,
        size: imageConfig.size,
        world: state.currentWorld,
        sectionName: 'World',
        entryId: getWorldOverviewEntry()?.id || null,
        action: 'world-cover',
        userPrompt,
        referenceImages: [
            ...(state.currentWorld.styleAnchors || []).map((anchor) => anchor.url)
        ]
    };

    try {
        const response = await fetch('/gpt/anvil/generate/image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        logAiOutboundFromResponse('generate/image world-cover', data);

        const imageUrl = extractImageUrl(data);
        state.currentWorld.coverImage = imageUrl;
        state.worldHeroVisualResult = `World cover generated with ${imageConfig.model}.`;
        pushActivity('Generated world cover image', 'world_cover_generated');
        queueSaveCurrentWorld();
    } catch (error) {
        console.error('Failed world cover generation:', error);
        state.worldHeroVisualResult = `World cover generation failed: ${error.message}`;
    } finally {
        state.worldHeroVisualLoading = false;
        setAiBusy(false);
        renderAll();
    }
}

async function runWorldStyleAnchorGeneration() {
    if (!state.currentWorld || state.worldHeroVisualLoading || state.aiBusy || state.worldHeroAiLoading) return;

    const imageConfig = getImageGenerationConfig();
    if (!imageConfig.apiUrl || !imageConfig.apiKey) {
        alert('Please configure your image model API in the settings.');
        return;
    }

    const promptFromDom = dom.worldHero?.querySelector('#world-anchor-image-prompt')?.value?.trim() || '';
    const userPrompt = promptFromDom || (state.currentWorld.worldHeroVisualPreset?.anchorPrompt || '').trim()
        || 'A cohesive visual style reference for this world (palette, lighting, materials, line quality).';
    state.currentWorld.worldHeroVisualPreset = state.currentWorld.worldHeroVisualPreset || {};
    state.currentWorld.worldHeroVisualPreset.anchorPrompt = promptFromDom || state.currentWorld.worldHeroVisualPreset.anchorPrompt;

    state.worldHeroVisualLoading = true;
    setAiBusy(true, 'Generating style anchor image...');
    state.worldHeroVisualResult = 'Generating style anchor image...';
    renderAll();

    const referenceImages = [
        ...(state.currentWorld.coverImage ? [state.currentWorld.coverImage] : []),
        ...(state.currentWorld.styleAnchors || []).map((anchor) => anchor.url)
    ].filter(Boolean);

    const payload = {
        apiUrl: imageConfig.apiUrl,
        apiKey: imageConfig.apiKey,
        model: imageConfig.model,
        size: imageConfig.size,
        world: state.currentWorld,
        sectionName: 'World',
        entryId: null,
        action: 'visualize',
        userPrompt,
        referenceImages
    };

    try {
        const response = await fetch('/gpt/anvil/generate/image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error?.message || data.error || `HTTP error! status: ${response.status}`);
        }

        logAiOutboundFromResponse('generate/image world-style-anchor', data);

        const imageUrl = extractImageUrl(data);
        const label = userPrompt.length > 90 ? `${userPrompt.slice(0, 87)}...` : userPrompt;
        state.currentWorld.styleAnchors.unshift({
            id: `anchor_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            url: imageUrl,
            label: label || 'AI Style Anchor',
            entryId: null
        });
        state.worldHeroVisualResult = `Style anchor added (${imageConfig.model}).`;
        pushActivity('Generated style anchor image', 'anchor_generated');
        queueSaveCurrentWorld();
    } catch (error) {
        console.error('Failed style anchor generation:', error);
        state.worldHeroVisualResult = `Style anchor generation failed: ${error.message}`;
    } finally {
        state.worldHeroVisualLoading = false;
        setAiBusy(false);
        renderAll();
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
