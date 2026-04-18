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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
}

function normalizeWorld(world) {
    if (!world?.sections) return world;
    const sections = {};
    getWorldSectionNamesInOrder(world).forEach((sectionName) => {
        sections[sectionName] = Array.isArray(world.sections[sectionName])
            ? world.sections[sectionName].map((entry) => {
                  const merged = { ...entry, section: entry.section || sectionName };
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
    return { ...world, sections };
}

function flattenWorldEntries(world) {
    if (!world?.sections) return [];
    return getWorldSectionNamesInOrder(world).flatMap((sectionName) =>
        (world.sections[sectionName] || []).map((e) => ({ ...e, section: sectionName }))
    );
}

function findEntryById(world, id) {
    const sid = String(id || '');
    return flattenWorldEntries(world).find((e) => String(e.id) === sid) || null;
}

function getChildren(world, parentId) {
    const pid = String(parentId || '');
    return flattenWorldEntries(world).filter((e) => e.parentId != null && String(e.parentId) === pid);
}

function getYearAnchors(world) {
    return flattenWorldEntries(world)
        .filter((e) => e.timelineKind === 'year' && e.timelineYear != null && Number.isFinite(e.timelineYear))
        .sort((a, b) => Number(a.timelineYear) - Number(b.timelineYear));
}

function formatYearDelta(prevYear, nextYear) {
    const a = Number(prevYear);
    const b = Number(nextYear);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
    const d = Math.abs(b - a);
    const sign = b >= a ? '+' : '−';
    return `${sign}${d} yrs`;
}

function renderSubtree(entry, world) {
    const kids = getChildren(world, entry.id);
    const btn = `<button type="button" class="timeline-node" data-timeline-entry="${escapeAttribute(entry.id)}">${escapeHtml(entry.title || 'Untitled')}</button>`;
    if (!kids.length) return btn;
    return `${btn}<div class="timeline-node-children">${kids
        .map((k) => `<div class="timeline-node-row">${renderSubtree(k, world)}</div>`)
        .join('')}</div>`;
}

function buildSpineHtml(world) {
    const years = getYearAnchors(world);
    if (!years.length) {
        return `<p class="timeline-muted">No year anchors yet. Add entries in the Timeline section with year type (or use Copilot createTimelineYearEntry), then attach events via parent.</p>`;
    }

    const parts = [];
    parts.push('<div class="timeline-spine-wrap"><div class="timeline-spine-rail"><div class="timeline-spine-line"></div></div><div class="timeline-spine-column">');

    for (let i = 0; i < years.length; i += 1) {
        const y = years[i];
        if (i > 0) {
            const prev = years[i - 1];
            const delta = formatYearDelta(prev.timelineYear, y.timelineYear);
            parts.push(
                `<div class="timeline-gap"><span class="timeline-delta-pill">${escapeHtml(delta)}</span></div>`
            );
        }
        const roots = getChildren(world, y.id);
        const branchHtml = roots.length
            ? `<div class="timeline-branches">${roots.map((r) => `<div class="timeline-node-row">${renderSubtree(r, world)}</div>`).join('')}</div>`
            : '<div class="timeline-muted" style="margin-top:6px;">No entries under this year.</div>';
        parts.push(
            `<div class="timeline-year-row"><div class="timeline-year-badge">${escapeHtml(String(y.timelineYear))}</div>${branchHtml}</div>`
        );
    }

    parts.push('</div></div>');
    return parts.join('');
}

const state = {
    worlds: [],
    currentWorld: null,
    worldId: null
};

let popoverTimer = null;

function positionPopoverNear(x, y) {
    const el = document.getElementById('timeline-popover');
    if (!el) return;
    const pad = 12;
    let left = x + pad;
    let top = y + pad;
    const rect = el.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
}

function showPopoverForEntry(entry, clientX, clientY) {
    const pop = document.getElementById('timeline-popover');
    const textEl = document.getElementById('timeline-popover-text');
    const imgEl = document.getElementById('timeline-popover-img');
    if (!pop || !textEl || !imgEl) return;
    const summary = (entry.summary || '').trim() || 'No summary.';
    textEl.textContent = summary.slice(0, 480);
    const firstImg = Array.isArray(entry.images) && entry.images[0]?.url ? entry.images[0].url : '';
    if (firstImg) {
        imgEl.removeAttribute('hidden');
        imgEl.src = firstImg;
    } else {
        imgEl.setAttribute('hidden', 'true');
        imgEl.removeAttribute('src');
    }
    pop.classList.add('is-visible');
    pop.setAttribute('aria-hidden', 'false');
    positionPopoverNear(clientX, clientY);
}

function hidePopover() {
    const pop = document.getElementById('timeline-popover');
    if (!pop) return;
    pop.classList.remove('is-visible');
    pop.setAttribute('aria-hidden', 'true');
}

async function loadWorld(worldId) {
    const { response, data } = await fetchAnvilWorld(worldId);
    if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
    }
    state.currentWorld = normalizeWorld(data);
    state.worldId = state.currentWorld.id;
    document.getElementById('timeline-world-name').textContent = state.currentWorld.name || 'Timeline';
    document.getElementById('timeline-world-sub').textContent =
        `${getYearAnchors(state.currentWorld).length} year anchor(s) · ${flattenWorldEntries(state.currentWorld).length} entries`;
    document.getElementById('timeline-spine-root').innerHTML = buildSpineHtml(state.currentWorld);
    bindSpineInteractions();
}

function bindSpineInteractions() {
    const root = document.getElementById('timeline-spine-root');
    if (!root) return;
    root.querySelectorAll('[data-timeline-entry]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-timeline-entry');
            if (!id || !state.worldId) return;
            window.location.href = `anvil.html?world=${encodeURIComponent(state.worldId)}&entry=${encodeURIComponent(id)}`;
        });
        btn.addEventListener('mouseenter', (ev) => {
            const id = btn.getAttribute('data-timeline-entry');
            const entry = findEntryById(state.currentWorld, id);
            if (!entry) return;
            clearTimeout(popoverTimer);
            showPopoverForEntry(entry, ev.clientX, ev.clientY);
        });
        btn.addEventListener('mousemove', (ev) => {
            if (!document.getElementById('timeline-popover')?.classList.contains('is-visible')) return;
            positionPopoverNear(ev.clientX, ev.clientY);
        });
        btn.addEventListener('mouseleave', () => {
            popoverTimer = setTimeout(() => hidePopover(), 120);
        });
    });
}

function renderWorldList() {
    const list = document.getElementById('timeline-world-list');
    if (!list) return;
    if (!state.worlds.length) {
        list.innerHTML = '<div class="timeline-muted">No worlds.</div>';
        return;
    }
    list.innerHTML = state.worlds
        .map((w) => {
            const active = w.id === state.worldId ? ' is-active' : '';
            return `<button type="button" class="timeline-world-item${active}" data-world-id="${escapeAttribute(w.id)}">${escapeHtml(w.name || w.id)}</button>`;
        })
        .join('');
    list.querySelectorAll('[data-world-id]').forEach((b) => {
        b.addEventListener('click', async () => {
            const id = b.getAttribute('data-world-id');
            if (!id) return;
            try {
                await loadWorld(id);
                window.history.replaceState({}, '', `anvil-timeline.html?world=${encodeURIComponent(id)}`);
                renderWorldList();
            } catch (e) {
                console.error(e);
                alert(`Failed to load world: ${e.message}`);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const worldParam = params.get('world');

    try {
        const { response, data } = await fetchAnvilWorldsList();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.worlds = Array.isArray(data) ? data : [];
        renderWorldList();

        const pick =
            worldParam && state.worlds.some((w) => w.id === worldParam) ? worldParam : state.worlds[0]?.id;
        if (pick) {
            await loadWorld(pick);
            renderWorldList();
        } else {
            document.getElementById('timeline-world-name').textContent = 'Timeline';
            document.getElementById('timeline-world-sub').textContent = 'Create a world in Anvil first.';
            document.getElementById('timeline-spine-root').innerHTML = '';
        }
    } catch (e) {
        console.error(e);
        alert(`Failed to load: ${e.message}`);
    }

    document.getElementById('timeline-popover')?.addEventListener('mouseenter', () => {
        clearTimeout(popoverTimer);
    });
    document.getElementById('timeline-popover')?.addEventListener('mouseleave', () => {
        hidePopover();
    });
});
