const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const bodyParser = require('body-parser');
const multer = require('multer');
const {SearchWiki} = require('./search.js');

function computeStringSizeMB(str) {
    return Buffer.byteLength(str, 'utf8');
}

function normalizePainterApiUrl(apiUrl) {
    if (!apiUrl) return '';

    const trimmedUrl = apiUrl.trim();
    if (trimmedUrl.endsWith('/v1/images/generations')) {
        return trimmedUrl;
    }

    if (trimmedUrl.endsWith('/')) {
        return `${trimmedUrl}v1/images/generations`;
    }

    return `${trimmedUrl}/v1/images/generations`;
}

/**
 * Gemini *image* model ids (2.5 / 3.x, Nano Banana, etc.) use OpenAI-compat
 * POST /v1/chat/completions for image output in this app — not /v1/images/generations.
 * OpenRouter-style ids (google/...) still use the default images API flow.
 */
function isGeminiNativeImageModel(model) {
    const m = String(model || '').trim().toLowerCase();
    if (!m.includes('gemini')) return false;
    if (m.startsWith('google/')) return false;
    return m.includes('image');
}

function normalizeChatApiUrl(apiUrl) {
    if (!apiUrl) return '';

    const trimmedUrl = apiUrl.trim();
    if (trimmedUrl.endsWith('/v1/chat/completions')) {
        return trimmedUrl;
    }

    if (trimmedUrl.endsWith('/')) {
        return `${trimmedUrl}v1/chat/completions`;
    }

    return `${trimmedUrl}/v1/chat/completions`;
}

function getPainterReferenceMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        default:
            return 'image/png';
    }
}

function resolvePainterReferencePath(refImg) {
    if (!refImg || typeof refImg !== 'string') return null;

    if (refImg.startsWith('./')) {
        return path.join(__dirname, '..', 'public', refImg.replace('./', ''));
    }

    const match = refImg.match(/\/(painter_images|painter_uploads|anvil_assets)\/(.+)$/);
    if (!match) return null;

    return path.join(__dirname, '..', 'public', match[1], match[2]);
}

function resolvePainterAssetPath(assetUrl) {
    if (!assetUrl || typeof assetUrl !== 'string') return null;

    const match = assetUrl.match(/(?:\.\/|\/)?(painter_images)\/([^?#]+)/);
    if (!match) return null;

    const safeFileName = path.basename(match[2]);
    return path.join(__dirname, '..', 'public', match[1], safeFileName);
}

function resolveAnvilAssetPath(assetUrl) {
    if (!assetUrl || typeof assetUrl !== 'string') return null;

    const match = assetUrl.match(/(?:\.\/|\/)?(anvil_assets)\/([^?#]+)/);
    if (!match) return null;

    const safeFileName = path.basename(match[2]);
    return path.join(__dirname, '..', 'public', match[1], safeFileName);
}

/** Detect real image type from bytes (extension / multer mime can lie). */
function sniffImageMimeFromBuffer(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    const head6 = buf.toString('ascii', 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
    return null;
}

const ANVIL_SECTION_TEMPLATES = [
    'World',
    'Regions',
    'Factions',
    'Characters',
    'Artifacts',
    'Creatures',
    'Architecture',
    'VisualLanguage'
];

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

const ANVIL_APPLY_OPERATION_TYPES = new Set([
    'updateWorldFields',
    'addSection',
    'deleteSection',
    'renameSection',
    'createEntry',
    'updateEntryFields',
    'deleteEntry',
    'moveEntrySection',
    'setEntryLinks',
    'setEntryTags',
    'appendEntryImages'
]);

/**
 * Models often send a single operation at the JSON root instead of { operations: [...] },
 * or put JSON in a string. Normalize to an array of operation objects.
 */
function normalizeBrainstormApplyOperationsArgs(args) {
    if (!args || typeof args !== 'object') return [];

    const fromArr = safeArray(args.operations).filter((op) => op && typeof op === 'object');
    if (fromArr.length) return fromArr;

    if (typeof args.operations === 'string' && args.operations.trim()) {
        try {
            const parsed = JSON.parse(args.operations);
            if (Array.isArray(parsed)) {
                return parsed.filter((op) => op && typeof op === 'object');
            }
            if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
                return [parsed];
            }
        } catch (_e) {
            /* ignore */
        }
    }

    const fromOpsAlias = safeArray(args.ops).filter((op) => op && typeof op === 'object');
    if (fromOpsAlias.length) return fromOpsAlias;

    if (args.operation && typeof args.operation === 'object' && typeof args.operation.type === 'string') {
        return [args.operation];
    }

    if (typeof args.type === 'string' && ANVIL_APPLY_OPERATION_TYPES.has(args.type)) {
        return [{ ...args }];
    }

    return [];
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(/[,;|]|\n+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
}

/** Merge tag/style candidates from nested entry objects and common model aliases (tag, style, style_keywords). */
function coalesceEntryLabelList(...candidates) {
    const out = [];
    const seen = new Set();
    for (const c of candidates) {
        for (const item of normalizeStringArray(c)) {
            if (seen.has(item)) continue;
            seen.add(item);
            out.push(item);
        }
    }
    return out;
}

/** When the model omits tags/styleKeywords on createEntry, fill minimal defaults so the UI and image tools stay useful. */
function fillCreateEntryMetadataDefaults(entry, sectionName) {
    if (!entry || typeof entry !== 'object') return;
    const section = String(sectionName || 'World').trim() || 'World';
    const title = String(entry.title || '').trim();
    const firstWord = title
        .replace(/^[^a-zA-Z0-9\u4e00-\u9fff]+/, '')
        .split(/[\s/|,:，。]+/)
        .find((w) => w && w.length > 1);
    let tags = coalesceEntryLabelList(entry.tags);
    let styleKeywords = coalesceEntryLabelList(entry.styleKeywords);
    if (tags.length < 2) {
        tags = coalesceEntryLabelList(tags, section, firstWord || 'lore', 'copilot');
    }
    if (styleKeywords.length < 2) {
        styleKeywords = coalesceEntryLabelList(
            styleKeywords,
            'concept art',
            'atmospheric lighting',
            title ? title.slice(0, 48) : section
        );
    }
    entry.tags = tags.slice(0, 24);
    entry.styleKeywords = styleKeywords.slice(0, 24);
}

/**
 * Merge streaming tool_call fragments; some gateways omit index or id on early chunks.
 * Returns OpenAI-shaped tool_calls or null.
 */
function finalizeStreamedToolCalls(toolCallsMerge) {
    const indices = Object.keys(toolCallsMerge)
        .map((k) => Number(k))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
    if (!indices.length) return null;
    return indices.map((i, ord) => {
        const tc = toolCallsMerge[i];
        const id =
            tc.id && String(tc.id).trim()
                ? String(tc.id).trim()
                : `call_${Date.now()}_${ord}_${Math.floor(Math.random() * 1e6)}`;
        return {
            id,
            type: 'function',
            function: {
                name: String(tc.function?.name || ''),
                arguments: String(tc.function?.arguments ?? '')
            }
        };
    });
}

const ANVIL_SECTION_NAME_MAX = 80;

function sanitizeAnvilSectionName(raw) {
    const s = String(raw ?? '').trim();
    if (!s || s.length > ANVIL_SECTION_NAME_MAX) return null;
    if (/[\r\n\x00]/.test(s)) return null;
    return s;
}

/** Template sections first (if present), then any other keys alphabetically */
function orderedAnvilSectionKeys(sections = {}) {
    const keySet = new Set(Object.keys(sections || {}));
    const ordered = [];
    for (const name of ANVIL_SECTION_TEMPLATES) {
        if (keySet.has(name)) ordered.push(name);
    }
    for (const name of Object.keys(sections || {}).sort((a, b) => a.localeCompare(b))) {
        if (!ordered.includes(name)) ordered.push(name);
    }
    return ordered;
}

function createAnvilEntry(entry = {}, sectionName = 'World') {
    const now = Date.now();
    return {
        id: entry.id || `entry_${now}_${Math.floor(Math.random() * 100000)}`,
        title: entry.title || `New ${sectionName} Entry`,
        section: entry.section || sectionName,
        status: entry.status || 'Seed',
        summary: entry.summary || '',
        content: entry.content || '',
        images: safeArray(entry.images),
        references: safeArray(entry.references),
        tags: normalizeStringArray(entry.tags),
        links: normalizeStringArray(entry.links),
        aiContextSummary: entry.aiContextSummary || '',
        generationPresets: entry.generationPresets || {},
        styleKeywords: normalizeStringArray(entry.styleKeywords),
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now
    };
}

function createAnvilSections(existingSections = {}) {
    const sections = {};
    const existing = existingSections || {};

    // Only keys present in stored data — do not recreate template sections the user removed
    for (const [sectionName, entries] of Object.entries(existing)) {
        sections[sectionName] = safeArray(entries).map((entry) => createAnvilEntry(entry, sectionName));
    }

    if (Object.keys(sections).length === 0) {
        for (const sectionName of ANVIL_SECTION_TEMPLATES) {
            sections[sectionName] = [];
        }
    } else if (!Object.prototype.hasOwnProperty.call(sections, 'World')) {
        sections.World = [];
    }

    return sections;
}

function createDefaultAnvilWorld(partial = {}) {
    const now = Date.now();
    return {
        id: partial.id || `world_${now}_${Math.floor(Math.random() * 100000)}`,
        name: partial.name || 'Untitled World',
        summary: partial.summary || '',
        coverImage: partial.coverImage || '',
        themeKeywords: normalizeStringArray(partial.themeKeywords),
        canonContext: partial.canonContext || '',
        styleAnchors: safeArray(partial.styleAnchors),
        sections: createAnvilSections(partial.sections || {}),
        recentActivities: safeArray(partial.recentActivities),
        generationHistory: safeArray(partial.generationHistory),
        worldHeroAiPreset:
            partial.worldHeroAiPreset && typeof partial.worldHeroAiPreset === 'object'
                ? { ...partial.worldHeroAiPreset }
                : {},
        createdAt: partial.createdAt || now,
        updatedAt: partial.updatedAt || now
    };
}

function ensureAnvilWorldStructure(world = {}) {
    const normalized = createDefaultAnvilWorld(world);
    normalized.sections = createAnvilSections(world.sections || normalized.sections || {});
    return normalized;
}

function getAnvilWorldStats(world) {
    const sectionNames = Object.keys(world.sections || {});
    let entryCount = 0;

    for (const sectionName of sectionNames) {
        entryCount += safeArray(world.sections[sectionName]).length;
    }

    return {
        entryCount,
        sectionCount: sectionNames.length,
        characterCount: safeArray(world.sections?.Characters).length,
        regionCount: safeArray(world.sections?.Regions).length
    };
}

function summarizeAnvilWorld(world) {
    const stats = getAnvilWorldStats(world);
    return {
        id: world.id,
        name: world.name,
        summary: world.summary,
        coverImage: world.coverImage,
        themeKeywords: world.themeKeywords,
        updatedAt: world.updatedAt,
        createdAt: world.createdAt,
        ...stats
    };
}

function flattenAnvilEntries(world) {
    const entries = [];
    for (const sectionName of Object.keys(world.sections || {})) {
        entries.push(...safeArray(world.sections[sectionName]));
    }
    return entries;
}

function truncateText(text, maxLength = 1200) {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
}

function getAnvilContextParts(world, sectionName, entry) {
    const allEntries = flattenAnvilEntries(world);
    const linkedEntries = allEntries.filter((candidate) => safeArray(entry?.links).includes(candidate.id));
    const relevantSectionEntries = safeArray(world.sections?.[sectionName])
        .filter((candidate) => candidate.id !== entry?.id)
        .slice(0, 6);
    const styleAnchors = safeArray(world.styleAnchors);
    const entryImages = safeArray(entry?.images);
    const linkedEntryImages = linkedEntries.flatMap((candidate) =>
        safeArray(candidate.images).map((image) => ({
            ...image,
            sourceEntryTitle: candidate.title,
            sourceEntryId: candidate.id
        }))
    );

    return {
        allEntries,
        linkedEntries,
        relevantSectionEntries,
        styleAnchors,
        entryImages,
        linkedEntryImages
    };
}

function buildReferenceDescriptor({ url, label = '', source = '', entryTitle = '', entryId = '' }) {
    if (!url) return null;

    return {
        url,
        label: label || entryTitle || source || 'Reference',
        source,
        entryTitle,
        entryId
    };
}

function dedupeReferenceDescriptors(descriptors) {
    const seen = new Set();
    const result = [];

    for (const descriptor of descriptors) {
        if (!descriptor?.url || seen.has(descriptor.url)) continue;
        seen.add(descriptor.url);
        result.push(descriptor);
    }

    return result;
}

function buildAnvilImageReferencePlan(world, entry, action, incomingReferenceImages = []) {
    const contextParts = getAnvilContextParts(world, entry?.section || 'World', entry);
    const explicitRefs = safeArray(incomingReferenceImages).map((url, index) => buildReferenceDescriptor({
        url,
        label: `Explicit Ref ${index + 1}`,
        source: 'explicit_reference'
    })).filter(Boolean);

    const entryRefs = contextParts.entryImages.map((image) => buildReferenceDescriptor({
        url: image.url,
        label: image.prompt || image.label || entry?.title || 'Entry Image',
        source: 'entry_image',
        entryTitle: entry?.title || '',
        entryId: entry?.id || ''
    })).filter(Boolean);

    const styleAnchorRefs = contextParts.styleAnchors.map((anchor) => buildReferenceDescriptor({
        url: anchor.url,
        label: anchor.label || 'Style Anchor',
        source: 'style_anchor',
        entryTitle: anchor.entryId
            ? flattenAnvilEntries(world).find((candidate) => candidate.id === anchor.entryId)?.title || ''
            : '',
        entryId: anchor.entryId || ''
    })).filter(Boolean);

    const linkedRefs = contextParts.linkedEntryImages.map((image) => buildReferenceDescriptor({
        url: image.url,
        label: image.prompt || image.label || image.sourceEntryTitle || 'Linked Entry Image',
        source: 'linked_entry_image',
        entryTitle: image.sourceEntryTitle || '',
        entryId: image.sourceEntryId || ''
    })).filter(Boolean);

    const prioritized = action === 'variant'
        ? [
            ...entryRefs,
            ...explicitRefs,
            ...linkedRefs,
            ...styleAnchorRefs
        ]
        : [
            ...styleAnchorRefs,
            ...explicitRefs,
            ...entryRefs,
            ...linkedRefs
        ];

    const candidates = dedupeReferenceDescriptors(prioritized);

    return {
        candidates,
        selectedReference: candidates[0] || null,
        styleAnchorRefs,
        entryRefs,
        linkedRefs
    };
}

function buildAnvilContextSummary(world, sectionName, entry, extras = {}) {
    const contextParts = getAnvilContextParts(world, sectionName, entry);

    return {
        world: world.name,
        section: sectionName,
        entry: entry?.title || '',
        themeKeywords: safeArray(world.themeKeywords),
        worldSummaryUsed: Boolean(world.summary),
        canonContextUsed: Boolean(world.canonContext),
        linkedEntries: contextParts.linkedEntries.map((candidate) => candidate.title),
        sectionPeers: contextParts.relevantSectionEntries.map((candidate) => candidate.title),
        styleAnchors: contextParts.styleAnchors.map((anchor) => anchor.label || 'Style Anchor'),
        entryImages: contextParts.entryImages.map((image) => image.prompt || image.label || entry?.title || 'Entry Image'),
        selectedReference: extras.selectedReference || null,
        referenceCandidates: safeArray(extras.referenceCandidates),
        referenceStrategy: extras.referenceStrategy || ''
    };
}

function buildAnvilTextContextTruncationNote() {
    return [
        'Context truncation (inputs may be cut for size; do not assume missing text is empty in the real world):',
        '- World Summary: at most ~1000 characters.',
        '- Canon Context: at most ~2200 characters.',
        '- Current Entry content: at most ~2200 characters.',
        '- Each linked entry content: at most ~800 characters.',
        '- Each other entry in this section: at most ~500 characters.'
    ].join('\n');
}

function buildAnvilTextOutputSpecification(action) {
    const normalized = String(action || 'write').trim() || 'write';

    const common = [
        '',
        '---',
        'OUTPUT_SPEC (mandatory — downstream stores your reply as plain text; follow exactly):',
        '- Plain text only. Forbidden: Markdown and markup — no # / ## headings, **bold**, __italic__, `inline code`, fenced code blocks, bullet lines starting with - * +, numbered list syntax, tables, or [label](url).',
        '- No chat wrapper: do not write preambles ("Sure", "Here is", "Below is") or postscripts ("Hope this helps", "Let me know"). Do not restate the task or repeat section labels like "Summary:" unless the user explicitly asked for that label as content.',
        '- If User Intent asks for one artifact only (e.g. a single summary, one paragraph, or one list of names), output only that artifact — no extra sections.',
        '- Use blank lines between paragraphs when needed; that is not Markdown.',
        '- LANGUAGE_RULE: Write the entire output in the same natural language as the User Intent text whenever User Intent contains substantive wording in that language (e.g. user writes in Chinese → respond in Chinese). If User Intent is empty or has no clear natural language, match the dominant language of Current Entry (summary + content), then World Summary and Canon Context, then Linked Entries; if still unclear, follow the language of the longest substantive context field.',
        '- If User Intent requires a JSON object as the only output, return valid JSON only (no Markdown fences, no commentary) and apply LANGUAGE_RULE to every string value inside the JSON.',
        `- Server max output budget: approximately ${normalized === 'align' ? '1200' : '1800'} tokens — stay concise when the user asks for something short.`
    ];

    const byAction = {
        align: [
            '- Action align: output only the consistency review (findings, risks, suggested fixes). No rewritten canon unless User Intent explicitly asks for a full rewrite.'
        ],
        rewrite: [
            '- Action rewrite: output exactly one final version of the text being rewritten (full replacement). No quotation marks wrapping the whole answer, no "Rewritten version:" prefix.'
        ],
        modify: [
            '- Action modify: revise the Current Entry body to satisfy User Intent. Output the full updated body as one plain-text document (full replacement of the main entry content field). Preserve facts, names, and tone where User Intent does not ask to change them; apply minimal edits when User Intent is vague.'
        ],
        'modify-world': [
            '- Action modify-world: revise the world-level World Summary and Canon Context together per User Intent. Output valid JSON only (no Markdown fences, no commentary) with exactly two string keys: worldSummary and canonContext. Each value is the full replacement text for that field. Preserve facts and names where User Intent does not ask to change them; apply minimal edits when User Intent is vague.'
        ],
        expand: [
            '- Action expand: output only the new text to add. Do not paste the existing entry body back; do not add headings like "Expansion:".'
        ],
        write: [
            '- Action write: output only the new passage to insert (no title line unless User Intent requires a title inside the fiction).'
        ]
    };

    const specific = byAction[normalized] || byAction.write;
    return [...common, ...specific].join('\n');
}

function buildAnvilTextUserPrompt({ world, sectionName, entry, action, userPrompt }) {
    const contextParts = getAnvilContextParts(world, sectionName, entry);

    return [
        `Action: ${action || 'write'}`,
        `World Name: ${world.name}`,
        `Section: ${sectionName}`,
        `Theme Keywords: ${safeArray(world.themeKeywords).join(', ') || 'None'}`,
        '',
        buildAnvilTextContextTruncationNote(),
        '',
        'World Summary:',
        truncateText(world.summary, 1000) || 'None',
        '',
        'Canon Context:',
        truncateText(world.canonContext, 2200) || 'None',
        '',
        'Current Entry:',
        JSON.stringify({
            title: entry?.title || '',
            status: entry?.status || 'Seed',
            summary: entry?.summary || '',
            content: truncateText(entry?.content || '', 2200),
            tags: safeArray(entry?.tags),
            styleKeywords: safeArray(entry?.styleKeywords)
        }, null, 2),
        '',
        'Linked Entries:',
        contextParts.linkedEntries.length > 0
            ? contextParts.linkedEntries.map((candidate) => JSON.stringify({
                title: candidate.title,
                section: candidate.section,
                summary: candidate.summary,
                tags: candidate.tags,
                content: truncateText(candidate.content || '', 800)
            }, null, 2)).join('\n')
            : 'None',
        '',
        'Other Entries In This Section:',
        contextParts.relevantSectionEntries.length > 0
            ? contextParts.relevantSectionEntries.map((candidate) => JSON.stringify({
                title: candidate.title,
                summary: candidate.summary,
                tags: candidate.tags,
                content: truncateText(candidate.content || '', 500)
            }, null, 2)).join('\n')
            : 'None',
        '',
        'User Intent:',
        userPrompt || 'No extra instruction provided.',
        buildAnvilTextOutputSpecification(action)
    ].join('\n');
}

function buildAnvilImagePrompt({ world, sectionName, entry, action, userPrompt }) {
    const contextParts = getAnvilContextParts(world, sectionName, entry);

    return [
        `Create concept art for the world "${world.name}".`,
        `Keep the output visually consistent with the established world style and lore.`,
        `Section focus: ${sectionName}.`,
        `Generation mode: ${action || 'visualize'}.`,
        world.summary ? `World summary: ${truncateText(world.summary, 500)}` : '',
        world.canonContext ? `Canon context: ${truncateText(world.canonContext, 900)}` : '',
        safeArray(world.themeKeywords).length > 0 ? `Theme keywords: ${world.themeKeywords.join(', ')}.` : '',
        entry?.title ? `Entry title: ${entry.title}.` : '',
        entry?.summary ? `Entry summary: ${truncateText(entry.summary, 400)}` : '',
        entry?.content ? `Entry details: ${truncateText(entry.content, 1200)}` : '',
        safeArray(entry?.styleKeywords).length > 0 ? `Style keywords: ${entry.styleKeywords.join(', ')}.` : '',
        contextParts.linkedEntries.length > 0
            ? `Linked entries to stay aligned with: ${contextParts.linkedEntries.map((candidate) => `${candidate.title} (${candidate.section})`).join('; ')}.`
            : '',
        contextParts.linkedEntries.length > 0
            ? `Linked entry details: ${contextParts.linkedEntries.map((candidate) => truncateText(`${candidate.title}: ${candidate.summary || candidate.content || ''}`, 320)).join(' | ')}`
            : '',
        contextParts.relevantSectionEntries.length > 0
            ? `Other entries in this section: ${contextParts.relevantSectionEntries.map((candidate) => truncateText(`${candidate.title}: ${candidate.summary || ''}`, 160)).join(' | ')}`
            : '',
        contextParts.styleAnchors.length > 0
            ? `Visual anchors available: ${contextParts.styleAnchors.map((anchor) => anchor.label || 'Style Anchor').join(', ')}.`
            : '',
        userPrompt ? `Direct instruction: ${userPrompt}` : '',
        'The image should feel production-ready, cinematic, and specific to this world rather than generic fantasy concept art.'
    ].filter(Boolean).join('\n');
}

function buildAnvilBrainstormWorldDigest(world) {
    const normalizedWorld = ensureAnvilWorldStructure(world);
    const sectionDigest = {};

    for (const sectionName of orderedAnvilSectionKeys(normalizedWorld.sections)) {
        sectionDigest[sectionName] = safeArray(normalizedWorld.sections?.[sectionName]).map((entry) => ({
            id: entry.id,
            title: entry.title,
            status: entry.status,
            summary: truncateText(entry.summary || '', 220),
            content: truncateText(entry.content || '', 600),
            tags: safeArray(entry.tags),
            links: safeArray(entry.links),
            styleKeywords: safeArray(entry.styleKeywords),
            imageLabels: safeArray(entry.images).map((image) => image.label || image.prompt || image.url).slice(0, 4)
        }));
    }

    return {
        id: normalizedWorld.id,
        name: normalizedWorld.name,
        summary: truncateText(normalizedWorld.summary || '', 1200),
        canonContext: truncateText(normalizedWorld.canonContext || '', 2400),
        themeKeywords: safeArray(normalizedWorld.themeKeywords),
        styleAnchors: safeArray(normalizedWorld.styleAnchors).map((anchor) => ({
            id: anchor.id,
            label: anchor.label || 'Style Anchor',
            entryId: anchor.entryId || ''
        })),
        sections: sectionDigest
    };
}

const ANVIL_LIST_SECTION_ENTRIES_CAP = 200;

function buildAnvilListSectionsResponse(world) {
    const normalized = ensureAnvilWorldStructure(world);
    const sections = orderedAnvilSectionKeys(normalized.sections).map((name) => ({
        name,
        entryCount: safeArray(normalized.sections[name]).length
    }));
    return { ok: true, sections };
}

/**
 * @param {string} [sectionFilterRaw] - if set, only that section (must exist)
 */
function buildAnvilListSectionEntriesResponse(world, sectionFilterRaw) {
    const normalized = ensureAnvilWorldStructure(world);
    const filter = sectionFilterRaw != null && String(sectionFilterRaw).trim() ? sanitizeAnvilSectionName(sectionFilterRaw) : null;
    if (sectionFilterRaw != null && String(sectionFilterRaw).trim() && !filter) {
        return { ok: false, error: 'invalid_section_name' };
    }
    let keys;
    if (filter) {
        if (!Object.prototype.hasOwnProperty.call(normalized.sections, filter)) {
            return { ok: false, error: 'section_not_found', section: filter };
        }
        keys = [filter];
    } else {
        keys = orderedAnvilSectionKeys(normalized.sections);
    }

    const sections = keys.map((name) => {
        const arr = safeArray(normalized.sections[name]);
        const cap = ANVIL_LIST_SECTION_ENTRIES_CAP;
        const slice = arr.length > cap ? arr.slice(0, cap) : arr;
        return {
            name,
            entryCount: arr.length,
            truncated: arr.length > cap,
            entries: slice.map((entry) => ({
                id: entry.id,
                title: entry.title,
                status: entry.status,
                summaryPreview: truncateText(entry.summary || '', 240),
                tags: safeArray(entry.tags).slice(0, 12),
                styleKeywords: safeArray(entry.styleKeywords).slice(0, 12)
            }))
        };
    });

    return { ok: true, sections };
}

function buildAnvilBrainstormToolSystemPrompt(world, activeSection = 'World', activeEntryId = '') {
    const normalizedWorld = ensureAnvilWorldStructure(world);
    const focusedEntry = activeEntryId
        ? flattenAnvilEntries(normalizedWorld).find((entry) => entry.id === activeEntryId)
        : null;

    return [
        'You are Anvil Copilot: a conversational worldbuilding partner bound to one world.',
        'Reply in natural plain text (no Markdown: no # headings, **bold**, -/* bullet lists, code fences, or links). No filler preambles or sign-offs unless the user wants tone.',
        'You have tools to read the live world and to apply edits. anvil_list_sections returns all section names and entry counts. anvil_list_section_entries lists entries (id, title, status, summary preview) for one section or for every section if you omit section_name. anvil_get_world_digest is a heavier full snapshot; anvil_get_entry loads one entry with longer body text.',
        'Multi-step tools are REQUIRED when the user wants the world changed: you may call read tools first, then you MUST call anvil_apply_world_operations in a later model step with the actual mutations. One read-only tool call followed by plain text is NOT enough if they asked you to create or edit canon. You may issue multiple tool rounds in a row (read → apply → read again to verify) until the task is done.',
        'If anvil_apply_world_operations returns ok:false (for example no_operations) or applied:0 while the user asked you to change the world, you MUST call anvil_apply_world_operations again with a valid non-empty operations array before you finish. Never claim scripted success (for example a user-requested last line like *_OK) unless the required writes actually succeeded (ok:true and applied greater than 0 for those writes).',
        'Use anvil_apply_world_operations to persist changes (world fields, add/delete/rename sections, create/update/delete/move entries, links, tags, appendEntryImages). Writes apply immediately on the server.',
        'addSection / deleteSection / renameSection: custom section names max 80 chars. deleteSection: non-empty sections need relocateEntriesTo. You cannot delete or rename the World section. renameSection: { fromSection, toSection }; target name must not already exist. moveEntrySection creates the target section if missing.',
        'For updateWorldFields, put name, summary, canonContext, themeKeywords, coverImage either inside a fields object or at the top level of that operation next to type (both are accepted).',
        'Entries support tags (short labels for browsing/filtering) and styleKeywords (phrases that steer image generation). Every createEntry MUST include entry.tags and entry.styleKeywords as arrays of strings, each with at least 2 items (derive them from the entry role, section, and tone). On updateEntryFields when adding lore, set tags and styleKeywords the same way. Use entry.tag or entry.style as aliases if needed.',
        'appendEntryImages: { type, entryId, images: [{ url, label }] } — append reference images to an entry; url must be an existing Anvil asset path such as ./anvil_assets/worldId_....',
        'The user may attach images in chat (vision). Describe what you see when it matters to the world; use tools when they ask you to store those images on an entry.',
        'You may answer from general knowledge when the user only wants chat; use tools whenever the question depends on this world or when they ask you to change it.',
        'When you want the user to pick among concrete creative directions (like a Cursor plan), call anvil_propose_directions with 2–6 options (id, title, optional detail). Do not replace this with Markdown numbered lists for exclusive choices. After calling it, briefly acknowledge in plain text that they can choose in the panel or type freely.',
        `UI focus — section: ${activeSection}. Focused entry: ${focusedEntry ? `${focusedEntry.title} (${focusedEntry.id})` : 'none'}.`
    ].join(' ');
}

function getAnvilBrainstormTools() {
    const sectionsList = ANVIL_SECTION_TEMPLATES.join(', ');
    return [
        {
            type: 'function',
            function: {
                name: 'anvil_get_world_digest',
                description:
                    'Returns a compact JSON snapshot of the entire world (sections, entries with truncated bodies, canon, theme). Use before edits. If the user asked you to change data, follow up in the SAME multi-step turn with anvil_apply_world_operations (do not stop after only this read). The response includes _copilot_followup as a reminder.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'anvil_get_entry',
                description:
                    'Returns one entry with longer content (still capped). Use entry id values from anvil_get_world_digest.',
                parameters: {
                    type: 'object',
                    properties: {
                        entry_id: { type: 'string', description: 'Entry id' }
                    },
                    required: ['entry_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'anvil_list_sections',
                description:
                    'Returns every section name in this world with how many entries each has. Lightweight; use before rename/delete or when the user only asks for section names.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'anvil_list_section_entries',
                description:
                    'Returns a structured list of entries per section: id, title, status, summary preview, tags, and styleKeywords. Omit section_name to list all sections. If section_name is set, only that section is returned (error if missing). At most 200 entries per section are returned; truncated is true if more exist.',
                parameters: {
                    type: 'object',
                    properties: {
                        section_name: {
                            type: 'string',
                            description: 'Optional. Exact section name to filter; leave empty for all sections.'
                        }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'anvil_propose_directions',
                description:
                    'Show a choice panel in the chat (like an IDE plan). Use when several worldbuilding directions are viable and the user should pick one. Each option needs a stable id and a short title; optional detail explains the direction. Does not modify the world. After calling, keep your visible reply short; the user selects in the UI or may ignore the panel by sending a normal message.',
                parameters: {
                    type: 'object',
                    properties: {
                        prompt: {
                            type: 'string',
                            description: 'One-line question or framing shown above the options (e.g. Which tone should we develop?).'
                        },
                        options: {
                            type: 'array',
                            minItems: 2,
                            maxItems: 6,
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string', description: 'Stable id, e.g. a, b, noir' },
                                    title: { type: 'string', description: 'Short label for the button' },
                                    detail: { type: 'string', description: 'Optional longer hint' }
                                },
                                required: ['title']
                            }
                        }
                    },
                    required: ['options']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'anvil_apply_world_operations',
                description: `Apply structured mutations immediately. You MUST pass a JSON object whose top-level key is "operations" (array), e.g. {"operations":[{"type":"updateWorldFields","fields":{"name":"..."}}]}. Sending {} or omitting operations is invalid. A single operation may also be sent at the root (same keys as one array element); the server will wrap it. Operation "type" may be: updateWorldFields, addSection, deleteSection, renameSection, createEntry, updateEntryFields, deleteEntry, moveEntrySection, setEntryLinks, setEntryTags, appendEntryImages. Section names may be any of the common set: ${sectionsList}, or custom short labels (max ${ANVIL_SECTION_NAME_MAX} chars). addSection: { type, sectionName }. deleteSection: { type, sectionName, relocateEntriesTo } — relocateEntriesTo is required when the section is non-empty (moves all entries). renameSection: { type, fromSection, toSection } (also accepts from/to or oldName/newName). Cannot delete or rename section "World". For updateWorldFields use fields: { name, summary, canonContext, themeKeywords, coverImage } OR those keys at the operation root. For createEntry use section and entry: { title, summary, content, status, tags, styleKeywords, links }. tags = 2–8 short labels (e.g. region, faction, role). styleKeywords = 2–10 visual/lore cues for concept art (mood, palette, era, materials). Same fields accepted at operation root; aliases: tag→tags, style or style_keywords→styleKeywords. For updateEntryFields use entryId and fields: { title, summary, content, status, canonContext, tags, links, styleKeywords } OR those keys at the operation root next to type. For moveEntrySection use entryId and toSection (target section is created if missing). For appendEntryImages use entryId and images: [{ url, label }]. The tool result ok is false when nothing was applied (check applied/rejected counts).`,
                parameters: {
                    type: 'object',
                    properties: {
                        operations: {
                            type: 'array',
                            description:
                                'Required non-empty list of operation objects unless you send one operation at the root with a type field. Each element must include type and the ids/fields required for that type.',
                            items: { type: 'object' }
                        }
                    },
                    required: ['operations']
                }
            }
        }
    ];
}

function stripChatMessageForApi(msg) {
    if (!msg || typeof msg !== 'object') {
        return msg;
    }

    if (msg.role === 'tool') {
        return {
            role: 'tool',
            tool_call_id: msg.tool_call_id,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '')
        };
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
        return {
            role: 'user',
            content: msg.content
        };
    }

    const out = { role: msg.role };
    if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        out.tool_calls = msg.tool_calls;
        out.content = msg.content != null && msg.content !== '' ? msg.content : null;
    } else {
        out.content = msg.content != null ? String(msg.content) : '';
    }

    return out;
}

async function readLocalAnvilAssetAsDataUrl(assetRef) {
    const assetPath = resolveAnvilAssetPath(assetRef);
    if (!assetPath) {
        return null;
    }

    try {
        const buf = await fsPromises.readFile(assetPath);
        if (!buf || buf.length < 24) {
            console.error('[Anvil] Asset file too small or empty:', assetPath, 'bytes', buf?.length ?? 0);
            return null;
        }
        const mime = sniffImageMimeFromBuffer(buf);
        if (!mime) {
            console.error(
                '[Anvil] Asset is not a valid image (unrecognized magic bytes):',
                assetPath,
                'hex8',
                buf.subarray(0, 8).toString('hex')
            );
            return null;
        }
        const b64 = buf.toString('base64');
        return `data:${mime};base64,${b64}`;
    } catch (_err) {
        return null;
    }
}

async function prepareBrainstormMessagesForProvider(messages, options = {}) {
    if (!Array.isArray(messages)) {
        return [];
    }

    // If your chat API host cannot use data:image/... URLs, set ANVIL_BRAINSTORM_IMAGE_BASE_URL
    // to a public origin that serves /anvil_assets/* (e.g. https://your-tunnel.example.com).
    const imagePublicBase = String(
        options.imagePublicBase || process.env.ANVIL_BRAINSTORM_IMAGE_BASE_URL || ''
    ).trim();

    const out = [];

    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;

        if (msg.role === 'user' && Array.isArray(msg.content)) {
            const nextParts = [];
            for (const part of msg.content) {
                if (!part || typeof part !== 'object') continue;
                if (part.type === 'text') {
                    nextParts.push({ type: 'text', text: String(part.text ?? '') });
                } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
                    const u = String(part.image_url.url);
                    const detail = part.image_url.detail || 'low';
                    if (u.startsWith('data:') || /^https?:\/\//i.test(u)) {
                        nextParts.push({ type: 'image_url', image_url: { url: u, detail } });
                    } else if (imagePublicBase) {
                        const assetPath = resolveAnvilAssetPath(u);
                        if (assetPath) {
                            const name = path.basename(assetPath);
                            const webUrl = `${imagePublicBase.replace(/\/$/, '')}/anvil_assets/${encodeURIComponent(name)}`;
                            nextParts.push({ type: 'image_url', image_url: { url: webUrl, detail } });
                        } else {
                            const dataUrl = await readLocalAnvilAssetAsDataUrl(u);
                            if (dataUrl) {
                                nextParts.push({ type: 'image_url', image_url: { url: dataUrl, detail } });
                            } else {
                                console.error('[Anvil brainstorm] Could not resolve attachment for public URL mode:', u.slice(0, 160));
                            }
                        }
                    } else {
                        const dataUrl = await readLocalAnvilAssetAsDataUrl(u);
                        if (dataUrl) {
                            nextParts.push({ type: 'image_url', image_url: { url: dataUrl, detail } });
                        } else {
                            console.error('[Anvil brainstorm] Could not embed local attachment:', u.slice(0, 160));
                        }
                    }
                }
            }
            out.push({
                ...msg,
                content: nextParts.length ? nextParts : [{ type: 'text', text: '' }]
            });
        } else {
            out.push(msg);
        }
    }

    return out;
}

function buildBrainstormUserOpenAiMessage(userText, attachmentUrls = []) {
    const urls = safeArray(attachmentUrls)
        .map((u) => String(u || '').trim())
        .filter(Boolean);
    const text = String(userText || '').trim();
    if (!urls.length) {
        return { role: 'user', content: text };
    }

    const parts = [];
    if (text) {
        parts.push({ type: 'text', text });
    } else {
        parts.push({ type: 'text', text: 'The user attached image(s) for you to consider.' });
    }

    for (const url of urls) {
        parts.push({ type: 'image_url', image_url: { url } });
    }

    return { role: 'user', content: parts };
}

const ANVIL_PROPOSE_DIRECTIONS_MIN = 2;
const ANVIL_PROPOSE_DIRECTIONS_MAX = 6;

function parseAnvilProposeDirectionsArgs(args) {
    const prompt = String(args.prompt ?? args.question ?? args.title ?? '').trim();
    const rawOpts = safeArray(args.options);
    const options = [];
    for (let i = 0; i < rawOpts.length; i += 1) {
        const o = rawOpts[i];
        if (!o || typeof o !== 'object') continue;
        const idRaw = String(o.id ?? o.key ?? '').trim();
        const id = idRaw || `opt_${i + 1}`;
        const title = String(o.title ?? o.label ?? o.name ?? '').trim();
        const detail = String(o.detail ?? o.summary ?? o.description ?? '').trim();
        if (!title) continue;
        options.push({ id, title, detail });
    }
    if (options.length < ANVIL_PROPOSE_DIRECTIONS_MIN) {
        return { ok: false, error: `Provide at least ${ANVIL_PROPOSE_DIRECTIONS_MIN} options with non-empty titles.` };
    }
    if (options.length > ANVIL_PROPOSE_DIRECTIONS_MAX) {
        options.length = ANVIL_PROPOSE_DIRECTIONS_MAX;
    }
    const proposalId = `plan_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    return { ok: true, proposalId, prompt, options };
}

async function executeAnvilBrainstormToolAsync(worldHolder, worldId, toolName, argsJson) {
    let args = {};
    try {
        args = JSON.parse(typeof argsJson === 'string' && argsJson.trim() ? argsJson : '{}');
    } catch (parseError) {
        return JSON.stringify({
            ok: false,
            error: 'invalid_json_arguments',
            message: String(parseError.message || parseError)
        });
    }

    const world = worldHolder.world;

    if (toolName === 'anvil_get_world_digest') {
        const snap = buildAnvilBrainstormWorldDigest(world);
        snap._copilot_followup =
            'If the user wanted mutations, call anvil_apply_world_operations next. For each createEntry include entry.tags and entry.styleKeywords (arrays, each >= 2 strings).';
        return JSON.stringify(snap);
    }

    if (toolName === 'anvil_get_entry') {
        const entryId = String(args.entry_id || args.entryId || '').trim();
        if (!entryId) {
            return JSON.stringify({ ok: false, error: 'missing_entry_id' });
        }

        const entry = findAnvilEntryById(world, entryId);
        if (!entry) {
            return JSON.stringify({ ok: false, error: 'entry_not_found', entry_id: entryId });
        }

        return JSON.stringify({
            id: entry.id,
            section: entry.section,
            title: entry.title,
            status: entry.status,
            summary: entry.summary || '',
            content: truncateText(entry.content || '', 12000),
            tags: safeArray(entry.tags),
            links: safeArray(entry.links),
            styleKeywords: safeArray(entry.styleKeywords),
            images: safeArray(entry.images).map((image) => ({
                id: image.id,
                label: image.label,
                url: image.url
            }))
        });
    }

    if (toolName === 'anvil_list_sections') {
        return JSON.stringify(buildAnvilListSectionsResponse(world));
    }

    if (toolName === 'anvil_list_section_entries') {
        const sectionName = args.section_name ?? args.sectionName ?? args.section ?? '';
        return JSON.stringify(buildAnvilListSectionEntriesResponse(world, sectionName));
    }

    if (toolName === 'anvil_propose_directions') {
        const parsed = parseAnvilProposeDirectionsArgs(args);
        if (!parsed.ok) {
            return JSON.stringify({ ok: false, error: parsed.error });
        }
        return JSON.stringify({
            ok: true,
            proposalId: parsed.proposalId,
            prompt: parsed.prompt,
            options: parsed.options,
            note: 'Shown in the chat UI. The user may pick an option, use Custom, or send a normal message to skip this plan.'
        });
    }

    if (toolName === 'anvil_apply_world_operations') {
        const operations = normalizeBrainstormApplyOperationsArgs(args);
        if (!operations.length) {
            return JSON.stringify({
                ok: false,
                error: 'no_operations',
                message:
                    'Missing or empty operations. Pass arguments like {"operations":[{"type":"updateWorldFields","fields":{"name":"QA - Amber Shell","summary":"...","canonContext":"...","themeKeywords":["A","B","C"]}}]} — do not call this tool with {}.',
                must_retry: true,
                _copilot_followup:
                    'Call anvil_apply_world_operations again immediately with a non-empty operations array containing the mutations the user asked for.'
            });
        }

        const { world: nextWorld, appliedOperations } = applyAnvilOperations(world, operations);
        const appliedCount = appliedOperations.filter((op) => op.status === 'applied').length;
        const rejectedCount = appliedOperations.filter((op) => op.status === 'rejected').length;

        if (appliedCount > 0) {
            worldHolder.world = ensureAnvilWorldStructure(nextWorld);
            worldHolder.world = await saveAnvilWorld(worldHolder.world);
            worldHolder.mutated = true;
        }

        return JSON.stringify({
            ok: appliedCount > 0,
            applied: appliedCount,
            rejected: rejectedCount,
            details: appliedOperations.map((operation) => ({
                type: operation.type,
                status: operation.status,
                entryId: operation.entryId,
                reason: operation.reason || operation.titleHint
            }))
        });
    }

    return JSON.stringify({ ok: false, error: 'unknown_tool', tool: toolName || '' });
}

async function runAnvilBrainstormWithTools({
    apiUrl,
    apiKey,
    model,
    worldId,
    userOpenAiMessage,
    openAiMessages = [],
    activeSection = 'World',
    activeEntryId = ''
}) {
    const worldHolder = {
        world: await loadAnvilWorld(worldId),
        mutated: false
    };

    if (!worldHolder.world) {
        return {
            error: 'World not found.',
            openAiMessages,
            finalAssistantText: '',
            world: null,
            mutated: false,
            aiTurnLog: [],
            displayBlocks: []
        };
    }

    const systemContent = buildAnvilBrainstormToolSystemPrompt(worldHolder.world, activeSection, activeEntryId);
    const nextOpenAi = [...safeArray(openAiMessages), userOpenAiMessage];
    const MAX_STEPS = 20;
    const aiTurnLog = [];
    const displayBlocks = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
        const messagesForApi = (
            await prepareBrainstormMessagesForProvider([{ role: 'system', content: systemContent }, ...nextOpenAi])
        ).map(stripChatMessageForApi);
        const payload = {
            model,
            stream: false,
            max_tokens: 4096,
            messages: messagesForApi,
            tools: getAnvilBrainstormTools(),
            tool_choice: 'auto',
            parallel_tool_calls: true
        };

        const response = await fetch(normalizeChatApiUrl(apiUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        aiTurnLog.push({ step, request: payload, response: data });

        if (!response.ok) {
            const errText = data?.error?.message || data?.error || `HTTP ${response.status}`;
            const errLine = `The model request failed: ${errText}`;
            displayBlocks.push({ type: 'text', content: errLine });
            return {
                error: errText,
                openAiMessages: nextOpenAi,
                finalAssistantText: errLine,
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                aiTurnLog,
                displayBlocks
            };
        }

        const assistantMsg = data?.choices?.[0]?.message;
        if (!assistantMsg) {
            const emptyLine = 'The model returned an empty message.';
            displayBlocks.push({ type: 'text', content: emptyLine });
            return {
                error: 'empty_response',
                openAiMessages: nextOpenAi,
                finalAssistantText: emptyLine,
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                aiTurnLog,
                displayBlocks
            };
        }

        const assistantRecord = {
            role: 'assistant',
            content: assistantMsg.content != null ? assistantMsg.content : null
        };

        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            assistantRecord.tool_calls = assistantMsg.tool_calls;
        }

        nextOpenAi.push(assistantRecord);

        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            const preface =
                typeof assistantMsg.content === 'string' && assistantMsg.content.trim()
                    ? assistantMsg.content.trim()
                    : null;
            if (preface) {
                displayBlocks.push({ type: 'text', content: preface });
            }
            const calls = [];
            const planBlocksToAppend = [];
            for (const tc of assistantMsg.tool_calls) {
                const toolName = tc.function?.name;
                const rawArgs = tc.function?.arguments ?? '{}';
                const toolResult = await executeAnvilBrainstormToolAsync(worldHolder, worldId, toolName, rawArgs);
                calls.push({
                    name: toolName || 'unknown',
                    callId: tc.id || '',
                    arguments: rawArgs,
                    result: toolResult,
                    state: 'done'
                });
                nextOpenAi.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: toolResult
                });
                if (toolName === 'anvil_propose_directions') {
                    try {
                        const tr = JSON.parse(toolResult);
                        if (tr.ok && tr.proposalId && Array.isArray(tr.options) && tr.options.length > 0) {
                            planBlocksToAppend.push({
                                type: 'plan_options',
                                proposalId: tr.proposalId,
                                prompt: String(tr.prompt || ''),
                                options: tr.options,
                                state: 'pending'
                            });
                        }
                    } catch (_e) {
                        /* ignore */
                    }
                }
            }
            displayBlocks.push({ type: 'tools', calls });
            for (const pb of planBlocksToAppend) {
                displayBlocks.push(pb);
            }
            continue;
        }

        const finalText =
            typeof assistantMsg.content === 'string' && assistantMsg.content.trim()
                ? assistantMsg.content.trim()
                : assistantMsg.content != null
                  ? String(assistantMsg.content)
                  : 'Done.';

        displayBlocks.push({ type: 'text', content: finalText });
        return {
            error: null,
            openAiMessages: nextOpenAi,
            finalAssistantText: finalText,
            world: worldHolder.world,
            mutated: worldHolder.mutated,
            aiTurnLog,
            displayBlocks
        };
    }

    const limitLine = 'Stopped after too many tool rounds; try a shorter request.';
    displayBlocks.push({ type: 'text', content: limitLine });
    return {
        error: 'tool_loop_limit',
        openAiMessages: nextOpenAi,
        finalAssistantText: limitLine,
        world: worldHolder.world,
        mutated: worldHolder.mutated,
        aiTurnLog,
        displayBlocks
    };
}

function sendBrainstormSse(res, payload) {
    if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}

async function consumeOpenAiChatSseStream(response, { onContentDelta, isAborted } = {}) {
    const reader = response.body?.getReader?.();
    if (!reader) {
        const fallbackText = await response.text();
        return {
            error: `No stream reader: ${fallbackText.slice(0, 400)}`,
            content: '',
            tool_calls: null,
            finish_reason: null
        };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallsMerge = {};
    let finish_reason = null;

    while (true) {
        if (typeof isAborted === 'function' && isAborted()) {
            await reader.cancel().catch(() => {});
            return {
                error: 'aborted',
                content,
                tool_calls: null,
                finish_reason: 'abort'
            };
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            for (const line of rawEvent.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') {
                    continue;
                }

                let json;
                try {
                    json = JSON.parse(dataStr);
                } catch (_err) {
                    continue;
                }

                const choice = json.choices?.[0];
                if (!choice) continue;

                if (choice.finish_reason) {
                    finish_reason = choice.finish_reason;
                }

                const delta = choice.delta;
                if (!delta) continue;

                if (delta.content) {
                    content += delta.content;
                    if (typeof onContentDelta === 'function') {
                        onContentDelta(delta.content);
                    }
                }

                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        let idx =
                            typeof tc.index === 'number' && !Number.isNaN(tc.index)
                                ? tc.index
                                : tc.index != null && String(tc.index).trim() !== ''
                                  ? Number(tc.index)
                                  : null;
                        if (idx === null || Number.isNaN(idx)) {
                            if (tc.id) {
                                const hit = Object.keys(toolCallsMerge).find((k) => toolCallsMerge[k].id === tc.id);
                                idx = hit != null ? Number(hit) : null;
                            }
                        }
                        if (idx === null || Number.isNaN(idx)) {
                            const incomingName = tc.function?.name || '';
                            const z = toolCallsMerge[0];
                            if (
                                incomingName &&
                                z &&
                                z.function &&
                                z.function.name &&
                                z.function.name !== incomingName &&
                                !tc.id
                            ) {
                                const keys = Object.keys(toolCallsMerge)
                                    .map((k) => Number(k))
                                    .filter((n) => !Number.isNaN(n));
                                idx = (keys.length ? Math.max(...keys) : -1) + 1;
                            } else {
                                idx = 0;
                            }
                        }
                        if (!toolCallsMerge[idx]) {
                            toolCallsMerge[idx] = {
                                id: '',
                                type: 'function',
                                function: { name: '', arguments: '' }
                            };
                        }
                        if (tc.id) {
                            toolCallsMerge[idx].id = tc.id;
                        }
                        if (tc.type) {
                            toolCallsMerge[idx].type = tc.type;
                        }
                        if (tc.function?.name) {
                            toolCallsMerge[idx].function.name += tc.function.name;
                        }
                        if (tc.function?.arguments != null) {
                            toolCallsMerge[idx].function.arguments += String(tc.function.arguments);
                        }
                    }
                }
            }
        }
    }

    const tool_calls = finalizeStreamedToolCalls(toolCallsMerge);

    return { error: null, content, tool_calls, finish_reason };
}

async function runAnvilBrainstormWithToolsStreaming({
    res,
    apiUrl,
    apiKey,
    model,
    worldId,
    userOpenAiMessage,
    openAiMessages = [],
    activeSection = 'World',
    activeEntryId = '',
    isAborted
}) {
    const worldHolder = {
        world: await loadAnvilWorld(worldId),
        mutated: false
    };

    if (!worldHolder.world) {
        sendBrainstormSse(res, { type: 'error', message: 'World not found.' });
        return {
            error: 'World not found.',
            openAiMessages,
            finalAssistantText: '',
            world: null,
            mutated: false,
            displayBlocks: []
        };
    }

    const systemContent = buildAnvilBrainstormToolSystemPrompt(worldHolder.world, activeSection, activeEntryId);
    const nextOpenAi = [...safeArray(openAiMessages), userOpenAiMessage];
    const MAX_STEPS = 20;
    const displayBlocks = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
        if (typeof isAborted === 'function' && isAborted()) {
            return {
                error: 'aborted',
                openAiMessages: nextOpenAi,
                finalAssistantText: '',
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                displayBlocks
            };
        }

        const messagesForApi = (
            await prepareBrainstormMessagesForProvider([{ role: 'system', content: systemContent }, ...nextOpenAi])
        ).map(stripChatMessageForApi);
        const payload = {
            model,
            stream: true,
            max_tokens: 4096,
            messages: messagesForApi,
            tools: getAnvilBrainstormTools(),
            tool_choice: 'auto',
            parallel_tool_calls: true
        };

        const response = await fetch(normalizeChatApiUrl(apiUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            let parsed = {};
            try {
                parsed = JSON.parse(errText);
            } catch (_e) {
                parsed = {};
            }
            const message = parsed?.error?.message || parsed?.error || errText || `HTTP ${response.status}`;
            sendBrainstormSse(res, { type: 'error', message: String(message) });
            const failLine = `The model request failed: ${message}`;
            displayBlocks.push({ type: 'text', content: failLine });
            return {
                error: String(message),
                openAiMessages: nextOpenAi,
                finalAssistantText: failLine,
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                displayBlocks
            };
        }

        const streamResult = await consumeOpenAiChatSseStream(response, {
            onContentDelta: (chunk) => {
                sendBrainstormSse(res, { type: 'delta', text: chunk });
            },
            isAborted
        });

        if (streamResult.error === 'aborted') {
            return {
                error: 'aborted',
                openAiMessages: nextOpenAi,
                finalAssistantText: '',
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                displayBlocks
            };
        }

        if (streamResult.error) {
            sendBrainstormSse(res, { type: 'error', message: streamResult.error });
            displayBlocks.push({ type: 'text', content: streamResult.error });
            return {
                error: streamResult.error,
                openAiMessages: nextOpenAi,
                finalAssistantText: streamResult.error,
                world: worldHolder.world,
                mutated: worldHolder.mutated,
                displayBlocks
            };
        }

        const assistantRecord = {
            role: 'assistant',
            content: streamResult.content != null && streamResult.content !== '' ? streamResult.content : null
        };

        if (streamResult.tool_calls && streamResult.tool_calls.length > 0) {
            assistantRecord.tool_calls = streamResult.tool_calls;
        }

        nextOpenAi.push(assistantRecord);

        if (streamResult.tool_calls && streamResult.tool_calls.length > 0) {
            const preface =
                typeof streamResult.content === 'string' && streamResult.content.trim()
                    ? streamResult.content.trim()
                    : null;
            if (preface) {
                displayBlocks.push({ type: 'text', content: preface });
            }
            const calls = [];
            const planBlocksToAppend = [];
            for (const tc of streamResult.tool_calls) {
                if (typeof isAborted === 'function' && isAborted()) {
                    return {
                        error: 'aborted',
                        openAiMessages: nextOpenAi,
                        finalAssistantText: '',
                        world: worldHolder.world,
                        mutated: worldHolder.mutated,
                        displayBlocks
                    };
                }
                const toolName = tc.function?.name || 'unknown';
                const rawArgs = tc.function?.arguments ?? '{}';
                sendBrainstormSse(res, {
                    type: 'tool',
                    phase: 'start',
                    name: toolName,
                    callId: tc.id || '',
                    arguments: rawArgs
                });
                const toolResult = await executeAnvilBrainstormToolAsync(worldHolder, worldId, toolName, rawArgs);
                const preview = toolResult.length > 280 ? `${toolResult.slice(0, 280)}…` : toolResult;
                const resultMax = 6000;
                const resultForClient =
                    toolResult.length > resultMax ? `${toolResult.slice(0, resultMax)}…` : toolResult;
                sendBrainstormSse(res, {
                    type: 'tool',
                    phase: 'done',
                    name: toolName,
                    callId: tc.id || '',
                    preview,
                    result: resultForClient
                });
                calls.push({
                    name: toolName,
                    callId: tc.id || '',
                    arguments: rawArgs,
                    result: toolResult,
                    state: 'done'
                });
                nextOpenAi.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: toolResult
                });
                if (toolName === 'anvil_propose_directions') {
                    try {
                        const tr = JSON.parse(toolResult);
                        if (tr.ok && tr.proposalId && Array.isArray(tr.options) && tr.options.length > 0) {
                            const planBlock = {
                                type: 'plan_options',
                                proposalId: tr.proposalId,
                                prompt: String(tr.prompt || ''),
                                options: tr.options,
                                state: 'pending'
                            };
                            planBlocksToAppend.push(planBlock);
                            sendBrainstormSse(res, {
                                type: 'plan_options',
                                proposalId: tr.proposalId,
                                prompt: planBlock.prompt,
                                options: tr.options
                            });
                        }
                    } catch (_e) {
                        /* ignore */
                    }
                }
            }
            displayBlocks.push({ type: 'tools', calls });
            for (const pb of planBlocksToAppend) {
                displayBlocks.push(pb);
            }

            sendBrainstormSse(res, { type: 'step', step });
            continue;
        }

        const finalText =
            typeof streamResult.content === 'string' && streamResult.content.trim()
                ? streamResult.content.trim()
                : streamResult.content != null
                  ? String(streamResult.content)
                  : 'Done.';

        displayBlocks.push({ type: 'text', content: finalText });
        return {
            error: null,
            openAiMessages: nextOpenAi,
            finalAssistantText: finalText,
            world: worldHolder.world,
            mutated: worldHolder.mutated,
            displayBlocks
        };
    }

    const limitMsg = 'Stopped after too many tool rounds; try a shorter request.';
    sendBrainstormSse(res, { type: 'error', message: limitMsg });
    displayBlocks.push({ type: 'text', content: limitMsg });
    return {
        error: 'tool_loop_limit',
        openAiMessages: nextOpenAi,
        finalAssistantText: limitMsg,
        world: worldHolder.world,
        mutated: worldHolder.mutated,
        displayBlocks
    };
}

function normalizeBrainstormOperation(operation = {}) {
    const base = {
        id: operation.id || `op_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        type: String(operation.type || '').trim(),
        reason: String(operation.reason || '').trim(),
        status: operation.status || 'pending'
    };

    if (base.type === 'updateWorldFields') {
        const allowedFields = ['name', 'summary', 'canonContext', 'themeKeywords', 'coverImage'];
        const rawFields =
            operation.fields && typeof operation.fields === 'object' ? { ...operation.fields } : {};

        // Models often put world fields at the operation root instead of under `fields`.
        for (const key of allowedFields) {
            if (key in operation && !(key in rawFields)) {
                rawFields[key] = operation[key];
            }
        }
        if (operation.theme_keywords != null && rawFields.themeKeywords === undefined) {
            rawFields.themeKeywords = operation.theme_keywords;
        }

        const fields = {};
        for (const key of allowedFields) {
            if (!(key in rawFields)) continue;
            if (key === 'themeKeywords') {
                fields[key] = normalizeStringArray(rawFields[key]);
            } else {
                fields[key] = String(rawFields[key] || '');
            }
        }

        return { ...base, fields };
    }

    if (base.type === 'addSection') {
        const sectionName = sanitizeAnvilSectionName(operation.sectionName ?? operation.name ?? operation.section);
        if (!sectionName) return null;
        return { ...base, sectionName };
    }

    if (base.type === 'deleteSection') {
        const sectionName = sanitizeAnvilSectionName(operation.sectionName ?? operation.name ?? operation.section);
        if (!sectionName) return null;
        const relocateRaw = operation.relocateEntriesTo ?? operation.moveEntriesTo ?? operation.targetSection;
        const relocateEntriesTo =
            relocateRaw != null && String(relocateRaw).trim() ? sanitizeAnvilSectionName(relocateRaw) : null;
        return { ...base, sectionName, relocateEntriesTo };
    }

    if (base.type === 'renameSection') {
        const fromSection = sanitizeAnvilSectionName(
            operation.fromSection ?? operation.from ?? operation.oldName ?? operation.old_section
        );
        const toSection = sanitizeAnvilSectionName(
            operation.toSection ?? operation.to ?? operation.newName ?? operation.new_section
        );
        if (!fromSection || !toSection || fromSection === toSection) return null;
        return { ...base, fromSection, toSection };
    }

    if (base.type === 'createEntry') {
        const section = sanitizeAnvilSectionName(operation.section) || 'World';
        const entrySrc = operation.entry && typeof operation.entry === 'object' ? operation.entry : {};
        const tags = coalesceEntryLabelList(
            entrySrc.tags,
            operation.tags,
            entrySrc.tag,
            operation.tag
        );
        const styleKeywords = coalesceEntryLabelList(
            entrySrc.styleKeywords,
            operation.styleKeywords,
            entrySrc.style_keywords,
            operation.style_keywords,
            entrySrc.style,
            operation.style
        );
        const entry = createAnvilEntry(
            {
                title: entrySrc.title || operation.title || `New ${section} Entry`,
                summary: entrySrc.summary != null ? entrySrc.summary : operation.summary || '',
                content: entrySrc.content != null ? entrySrc.content : operation.content || '',
                status: entrySrc.status || operation.status || 'Seed',
                tags,
                links: normalizeStringArray(entrySrc.links != null ? entrySrc.links : operation.links),
                styleKeywords
            },
            section
        );

        fillCreateEntryMetadataDefaults(entry, section);

        return { ...base, section, entry };
    }

    if (base.type === 'updateEntryFields') {
        const rawFields =
            operation.fields && typeof operation.fields === 'object' ? { ...operation.fields } : {};
        const promoteScalar = ['title', 'summary', 'content', 'status', 'canonContext'];
        for (const key of promoteScalar) {
            if (!(key in rawFields) && key in operation) {
                rawFields[key] = operation[key];
            }
        }
        if (!('tags' in rawFields) && 'tags' in operation) rawFields.tags = operation.tags;
        if (!('tags' in rawFields) && 'tag' in operation) rawFields.tags = operation.tag;
        if (!('links' in rawFields) && 'links' in operation) rawFields.links = operation.links;
        if (!('styleKeywords' in rawFields) && 'styleKeywords' in operation) {
            rawFields.styleKeywords = operation.styleKeywords;
        }
        if (!('styleKeywords' in rawFields) && 'style_keywords' in operation) {
            rawFields.styleKeywords = operation.style_keywords;
        }
        if (!('styleKeywords' in rawFields) && 'style' in operation) {
            rawFields.styleKeywords = operation.style;
        }
        if ('tag' in rawFields && !('tags' in rawFields)) rawFields.tags = rawFields.tag;
        if ('style_keywords' in rawFields && !('styleKeywords' in rawFields)) {
            rawFields.styleKeywords = rawFields.style_keywords;
        }
        if ('style' in rawFields && !('styleKeywords' in rawFields)) {
            rawFields.styleKeywords = rawFields.style;
        }

        const fields = {};
        /* section moves must use moveEntrySection — assigning section here would desync arrays */
        const allowedFields = ['title', 'summary', 'content', 'status', 'canonContext'];

        for (const key of allowedFields) {
            if (!(key in rawFields)) continue;
            fields[key] = String(rawFields[key] || '');
        }
        if ('tags' in rawFields) fields.tags = coalesceEntryLabelList(rawFields.tags);
        if ('links' in rawFields) fields.links = normalizeStringArray(rawFields.links);
        if ('styleKeywords' in rawFields) {
            fields.styleKeywords = coalesceEntryLabelList(rawFields.styleKeywords);
        }

        return {
            ...base,
            entryId: String(operation.entryId || operation.entry_id || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            fields
        };
    }

    if (base.type === 'deleteEntry') {
        return {
            ...base,
            entryId: String(operation.entryId || '').trim(),
            titleHint: String(operation.titleHint || '').trim()
        };
    }

    if (base.type === 'moveEntrySection') {
        const toSection = sanitizeAnvilSectionName(
            operation.toSection ?? operation.to_section ?? operation.targetSection
        );
        if (!toSection) return null;
        const entryId = String(operation.entryId || operation.entry_id || '').trim();
        if (!entryId) return null;
        return {
            ...base,
            entryId,
            titleHint: String(operation.titleHint || '').trim(),
            toSection
        };
    }

    if (base.type === 'setEntryLinks') {
        return {
            ...base,
            entryId: String(operation.entryId || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            links: normalizeStringArray(operation.links)
        };
    }

    if (base.type === 'setEntryTags') {
        return {
            ...base,
            entryId: String(operation.entryId || operation.entry_id || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            tags: coalesceEntryLabelList(operation.tags, operation.tag)
        };
    }

    if (base.type === 'appendEntryImages') {
        const rawList = safeArray(operation.images);
        const images = rawList
            .map((img) => ({
                id: img.id || `asset_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
                url: String(img.url || '').trim(),
                label: String(img.label || '').trim() || 'Image',
                prompt: String(img.prompt || ''),
                source: String(img.source || 'copilot'),
                createdAt: typeof img.createdAt === 'number' ? img.createdAt : Date.now()
            }))
            .filter((img) => img.url);

        return {
            ...base,
            entryId: String(operation.entryId || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            images
        };
    }

    return null;
}

function findAnvilEntryById(world, entryId) {
    return flattenAnvilEntries(world).find((entry) => entry.id === entryId) || null;
}

function removeAnvilEntryFromSections(world, entryId) {
    for (const sectionName of Object.keys(world.sections || {})) {
        const entries = safeArray(world.sections[sectionName]);
        const nextEntries = entries.filter((entry) => entry.id !== entryId);
        if (nextEntries.length !== entries.length) {
            world.sections[sectionName] = nextEntries;
            return true;
        }
    }
    return false;
}

function cleanAnvilWorldReferences(world, removedEntryId) {
    for (const entry of flattenAnvilEntries(world)) {
        entry.links = safeArray(entry.links).filter((linkId) => linkId !== removedEntryId);
    }

    world.styleAnchors = safeArray(world.styleAnchors).filter((anchor) => anchor.entryId !== removedEntryId);
}

function applyAnvilOperations(world, operations = []) {
    const nextWorld = ensureAnvilWorldStructure(JSON.parse(JSON.stringify(world)));
    const appliedOperations = [];

    for (const rawOperation of operations) {
        const operation = normalizeBrainstormOperation(rawOperation);
        if (!operation) {
            const t = String(rawOperation?.type || '').trim() || 'unknown';
            appliedOperations.push({
                id: rawOperation?.id || `op_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
                type: t,
                status: 'rejected',
                reason: 'unrecognized_operation_shape',
                entryId: rawOperation?.entryId || rawOperation?.entry_id || ''
            });
            continue;
        }

        const finalizedOperation = { ...operation, status: 'applied' };

        if (operation.type === 'updateWorldFields') {
            const patch = operation.fields || {};
            if (Object.keys(patch).length === 0) {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'updateWorldFields had no fields (put name/summary/etc. in fields{} or at operation root)'
                });
                continue;
            }
            Object.assign(nextWorld, patch);
            nextWorld.themeKeywords = normalizeStringArray(nextWorld.themeKeywords);
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'addSection') {
            if (Object.prototype.hasOwnProperty.call(nextWorld.sections, operation.sectionName)) {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'section_already_exists'
                });
                continue;
            }
            nextWorld.sections[operation.sectionName] = [];
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'deleteSection') {
            if (!Object.prototype.hasOwnProperty.call(nextWorld.sections, operation.sectionName)) {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'section_not_found'
                });
                continue;
            }
            if (operation.sectionName === 'World') {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'cannot_delete_world_section'
                });
                continue;
            }
            const entries = safeArray(nextWorld.sections[operation.sectionName]);
            if (entries.length > 0) {
                const dest = operation.relocateEntriesTo;
                if (!dest) {
                    appliedOperations.push({
                        ...finalizedOperation,
                        status: 'rejected',
                        reason: 'deleteSection requires relocateEntriesTo when section is not empty'
                    });
                    continue;
                }
                if (dest === operation.sectionName) {
                    appliedOperations.push({
                        ...finalizedOperation,
                        status: 'rejected',
                        reason: 'relocateEntriesTo must differ from section being deleted'
                    });
                    continue;
                }
                nextWorld.sections[dest] = safeArray(nextWorld.sections[dest]);
                for (const entry of entries) {
                    entry.section = dest;
                    entry.updatedAt = Date.now();
                    nextWorld.sections[dest].push(entry);
                }
            }
            delete nextWorld.sections[operation.sectionName];
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'renameSection') {
            if (!Object.prototype.hasOwnProperty.call(nextWorld.sections, operation.fromSection)) {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'section_not_found'
                });
                continue;
            }
            if (operation.fromSection === 'World') {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'cannot_rename_world_section'
                });
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(nextWorld.sections, operation.toSection)) {
                appliedOperations.push({
                    ...finalizedOperation,
                    status: 'rejected',
                    reason: 'rename_target_section_already_exists'
                });
                continue;
            }
            const entries = safeArray(nextWorld.sections[operation.fromSection]);
            delete nextWorld.sections[operation.fromSection];
            const now = Date.now();
            for (const entry of entries) {
                entry.section = operation.toSection;
                entry.updatedAt = now;
            }
            nextWorld.sections[operation.toSection] = entries;
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'createEntry') {
            const section = operation.section || 'World';
            nextWorld.sections[section] = safeArray(nextWorld.sections[section]);
            nextWorld.sections[section].unshift(createAnvilEntry(operation.entry, section));
            appliedOperations.push(finalizedOperation);
            continue;
        }

        const targetEntry = findAnvilEntryById(nextWorld, operation.entryId);
        if (!targetEntry) {
            appliedOperations.push({ ...finalizedOperation, status: 'rejected', reason: operation.reason || `Entry ${operation.entryId} was not found.` });
            continue;
        }

        if (operation.type === 'updateEntryFields') {
            Object.assign(targetEntry, operation.fields || {});
            if (operation.fields?.tags) targetEntry.tags = normalizeStringArray(operation.fields.tags);
            if (operation.fields?.links) targetEntry.links = normalizeStringArray(operation.fields.links);
            if (operation.fields?.styleKeywords) targetEntry.styleKeywords = normalizeStringArray(operation.fields.styleKeywords);
            targetEntry.updatedAt = Date.now();
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'deleteEntry') {
            removeAnvilEntryFromSections(nextWorld, targetEntry.id);
            cleanAnvilWorldReferences(nextWorld, targetEntry.id);
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'moveEntrySection') {
            removeAnvilEntryFromSections(nextWorld, targetEntry.id);
            nextWorld.sections[operation.toSection] = safeArray(nextWorld.sections[operation.toSection]);
            targetEntry.section = operation.toSection;
            targetEntry.updatedAt = Date.now();
            nextWorld.sections[operation.toSection].unshift(targetEntry);
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'setEntryLinks') {
            targetEntry.links = normalizeStringArray(operation.links);
            targetEntry.updatedAt = Date.now();
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'setEntryTags') {
            targetEntry.tags = normalizeStringArray(operation.tags);
            targetEntry.updatedAt = Date.now();
            appliedOperations.push(finalizedOperation);
            continue;
        }

        if (operation.type === 'appendEntryImages') {
            const additions = safeArray(operation.images);
            targetEntry.images = safeArray(targetEntry.images);
            targetEntry.images = additions.concat(targetEntry.images);
            targetEntry.updatedAt = Date.now();
            appliedOperations.push(finalizedOperation);
            continue;
        }
    }

    nextWorld.updatedAt = Date.now();
    return {
        world: ensureAnvilWorldStructure(nextWorld),
        appliedOperations
    };
}

function getAnvilWorldPath(worldId) {
    return path.join(anvilDataDir, `${worldId}.json`);
}

function getAnvilWorldsPath() {
    return path.join(anvilDataDir, 'worlds.json');
}

function getAnvilChatPath(worldId) {
    return path.join(anvilChatDir, `${worldId}.json`);
}

async function loadAnvilWorld(worldId) {
    const world = await readJsonOrDefault(getAnvilWorldPath(worldId), null);
    return world ? ensureAnvilWorldStructure(world) : null;
}

async function saveAnvilWorld(world) {
    const normalizedWorld = ensureAnvilWorldStructure({
        ...world,
        updatedAt: Date.now()
    });
    const worldsPath = getAnvilWorldsPath();
    const worlds = await readJsonOrDefault(worldsPath, []);
    const summary = summarizeAnvilWorld(normalizedWorld);
    const nextWorlds = Array.isArray(worlds)
        ? worlds.filter((item) => item.id !== normalizedWorld.id).concat(summary)
        : [summary];

    await writeJson(getAnvilWorldPath(normalizedWorld.id), normalizedWorld);
    await writeJson(worldsPath, nextWorlds.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    return normalizedWorld;
}

function createEmptyAnvilBrainstormSession(worldId) {
    return {
        worldId,
        messages: [],
        openAiMessages: [],
        lastProposedOperations: [],
        worldCheckpoints: [],
        updatedAt: 0
    };
}

async function loadAnvilBrainstormSession(worldId) {
    const session = await readJsonOrDefault(getAnvilChatPath(worldId), null);
    if (!session) {
        return createEmptyAnvilBrainstormSession(worldId);
    }

    let openAiMessages = safeArray(session.openAiMessages);
    const messages = safeArray(session.messages);

    if (!openAiMessages.length && messages.length > 0) {
        openAiMessages = messages
            .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
            .map((entry) => ({
                role: entry.role,
                content: String(entry.content ?? '')
            }));
    }

    return {
        ...createEmptyAnvilBrainstormSession(worldId),
        ...session,
        worldId,
        openAiMessages,
        messages,
        lastProposedOperations: [],
        worldCheckpoints: safeArray(session.worldCheckpoints)
    };
}

async function saveAnvilBrainstormSession(session) {
    const normalizedSession = {
        ...createEmptyAnvilBrainstormSession(session.worldId),
        ...session,
        messages: safeArray(session.messages),
        openAiMessages: safeArray(session.openAiMessages),
        lastProposedOperations: safeArray(session.lastProposedOperations),
        worldCheckpoints: safeArray(session.worldCheckpoints),
        updatedAt: Date.now()
    };
    await writeJson(getAnvilChatPath(session.worldId), normalizedSession);
    return normalizedSession;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

/** Snapshot after an assistant turn: display message count + world + provider message history */
function buildBrainstormCheckpoint(messageLength, world, openAiMessages) {
    return {
        messageLength,
        world: ensureAnvilWorldStructure(cloneJson(world)),
        openAiMessages: cloneJson(safeArray(openAiMessages))
    };
}

function mergeBrainstormCheckpoints(prevCheckpoints, messageLength, world, openAiMessages) {
    const list = safeArray(prevCheckpoints).filter((c) => c && typeof c.messageLength === 'number');
    const next = list.filter((c) => c.messageLength < messageLength);
    next.push(buildBrainstormCheckpoint(messageLength, world, openAiMessages));
    return next.sort((a, b) => a.messageLength - b.messageLength);
}

async function readJsonOrDefault(filePath, fallbackValue) {
    try {
        const raw = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return fallbackValue;
        }
        throw err;
    }
}

async function writeJson(filePath, data) {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
}

function extractChatCompletionText(data) {
    return data?.choices?.[0]?.message?.content || data?.output_text || '';
}

/**
 * Gemini image models (2.5 / 3.x flash-image, Nano Banana, etc.) use OpenAI-compatible
 * POST /v1/chat/completions, not /v1/images/generations. Responses embed image as
 * data URLs or nested inline_data in various shapes.
 */
function extractNestedImageBase64(node, depth = 0, seen = new WeakSet()) {
    if (depth > 16 || node == null) return null;
    if (typeof node === 'object' && node !== null) {
        if (seen.has(node)) return null;
        seen.add(node);
    }

    if (typeof node === 'string') {
        const dm = node.match(/data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)/i);
        if (dm && dm[1].replace(/\s/g, '').length > 80) {
            return dm[1].replace(/\s/g, '');
        }
        return null;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            const r = extractNestedImageBase64(item, depth + 1, seen);
            if (r) return r;
        }
        return null;
    }

    if (typeof node === 'object') {
        if (node.type === 'image_url' && node.image_url?.url) {
            const u = String(node.image_url.url);
            const m = u.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/i);
            if (m) return m[1];
        }
        const inline = node.inlineData || node.inline_data;
        if (inline?.data && /image/i.test(String(inline.mimeType || inline.mime_type || ''))) {
            return String(inline.data).replace(/\s/g, '');
        }
        for (const k of Object.keys(node)) {
            const r = extractNestedImageBase64(node[k], depth + 1, seen);
            if (r) return r;
        }
    }
    return null;
}

function extractBase64ImageFromChatCompletionResponse(apiData) {
    const msg = apiData?.choices?.[0]?.message;
    if (msg) {
        const fromMsg = extractNestedImageBase64(msg);
        if (fromMsg) return fromMsg;
    }
    return extractNestedImageBase64(apiData);
}

async function forwardGeminiImageViaOpenAiChat({
    apiUrl,
    apiKey,
    payload,
    localSaveDir,
    localUrlPrefix,
    filePrefix = 'img'
}) {
    const requestUrl = normalizeChatApiUrl(apiUrl);
    const prompt = String(payload.prompt || '').trim() || 'Generate a single high-quality image matching the description.';
    const ref = payload.image_url || payload.image;
    const refStr = ref && typeof ref === 'string' ? ref.trim() : '';

    let userContent;
    if (refStr && (refStr.startsWith('data:') || /^https?:\/\//i.test(refStr))) {
        userContent = [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: refStr } }
        ];
    } else {
        userContent = prompt;
    }

    const chatBody = {
        model: payload.model,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: 8192
    };

    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(chatBody)
    });

    const rawText = await response.text();
    let data;
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (_parseErr) {
        return {
            ok: false,
            status: 502,
            data: {
                error: 'Image chat API did not return JSON.',
                requestUrl,
                preview: rawText.slice(0, 400)
            }
        };
    }

    if (!response.ok) {
        return { ok: false, status: response.status, data, requestUrl };
    }

    const b64 = extractBase64ImageFromChatCompletionResponse(data);
    if (!b64) {
        return {
            ok: false,
            status: 502,
            data: {
                error:
                    'No image found in chat completion response. The provider may use a different JSON shape, or the model returned text only.',
                requestUrl,
                preview: rawText.slice(0, 1200)
            }
        };
    }

    let wrapped = { data: [{ b64_json: b64 }] };
    try {
        wrapped = await saveGeneratedImageLocally(wrapped, localSaveDir, localUrlPrefix, filePrefix);
    } catch (saveErr) {
        console.error('[ERROR][IMAGE] Failed to save Gemini chat image:', saveErr);
        return {
            ok: false,
            status: 500,
            data: { error: 'Failed to save generated image.', requestUrl }
        };
    }

    return { ok: true, status: response.status, data: wrapped, requestUrl };
}

async function saveGeneratedImageLocally(data, targetDir, urlPrefix, filePrefix = 'img') {
    const firstItem = Array.isArray(data?.data) ? data.data[0] : null;
    let imageUrl = firstItem?.url || firstItem?.image_url || firstItem?.imageUrl || data?.output?.[0]?.url || data?.output?.[0]?.image_url;
    let b64Data = firstItem?.b64_json || firstItem?.b64 || data?.output?.[0]?.b64_json;

    if (imageUrl && !b64Data) {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            b64Data = Buffer.from(arrayBuffer).toString('base64');
        }
    }

    if (!b64Data) {
        return data;
    }

    await fsPromises.mkdir(targetDir, { recursive: true });
    const fileName = `${filePrefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
    const filePath = path.join(targetDir, fileName);
    await fsPromises.writeFile(filePath, Buffer.from(b64Data, 'base64'));

    if (firstItem) {
        firstItem.url = `${urlPrefix}/${fileName}`;
        delete firstItem.b64_json;
        delete firstItem.b64;
    } else if (data?.output?.[0]) {
        data.output[0].url = `${urlPrefix}/${fileName}`;
        delete data.output[0].b64_json;
    } else if (!data.data) {
        data.data = [{ url: `${urlPrefix}/${fileName}` }];
    }

    return data;
}

async function forwardImageGeneration({ apiUrl, apiKey, payload, localSaveDir, localUrlPrefix, filePrefix = 'img' }) {
    if (!apiUrl || !apiKey) {
        return {
            ok: false,
            status: 400,
            data: { error: 'Missing apiUrl or apiKey' }
        };
    }

    for (const key of ['image', 'image_url']) {
        const refImg = payload[key];
        if (refImg && typeof refImg === 'string') {
            const localImagePath = resolvePainterReferencePath(refImg);
            if (!localImagePath) {
                continue;
            }

            try {
                if (fs.existsSync(localImagePath)) {
                    const fileBuffer = fs.readFileSync(localImagePath);
                    const mimeType = getPainterReferenceMimeType(localImagePath);
                    payload[key] = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
                }
            } catch (readErr) {
                console.error('[ERROR][IMAGE] Failed to read local reference image:', readErr);
            }
        }
    }

    if (isGeminiNativeImageModel(payload.model)) {
        return forwardGeminiImageViaOpenAiChat({
            apiUrl,
            apiKey,
            payload,
            localSaveDir,
            localUrlPrefix,
            filePrefix
        });
    }

    const requestUrl = normalizePainterApiUrl(apiUrl);
    const outbound = { ...payload };
    if (outbound.response_format == null) {
        outbound.response_format = 'b64_json';
    }

    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(outbound)
    });

    const rawText = await response.text();
    let data;

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
        return {
            ok: false,
            status: 502,
            data: {
                error: 'Painter API did not return JSON. Please check the API URL.',
                requestUrl
            }
        };
    }

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            data
        };
    }

    try {
        data = await saveGeneratedImageLocally(data, localSaveDir, localUrlPrefix, filePrefix);
    } catch (saveErr) {
        console.error('[ERROR][IMAGE] Failed to save image locally:', saveErr);
    }

    return {
        ok: true,
        status: response.status,
        data,
        requestUrl
    };
}

async function handleStreamWrite(filePath, req, res, recordId = null) {
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        let dataSize = 0;

        writeStream.on('error', (err) => {
            const idStr = recordId ? ` ${recordId}` : '';
            console.log(`Error saving Record${idStr}:`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: `Error saving Record${idStr}` });
            }
            reject(err);
        });

        writeStream.on('finish', () => {
            const idStr = recordId ? `_${recordId}` : '_list';
            if (!res.headersSent) {
                res.json({ message: 'Done saving Records' });
            }
            console.log(`Save record${idStr}[${dataSize/1024/1024}MB]`);
            resolve();
        });

        if (req.body && (Object.keys(req.body).length > 0 || Array.isArray(req.body))) {
            const data = JSON.stringify(req.body);
            dataSize = Buffer.byteLength(data, 'utf8');
            writeStream.write(data);
            writeStream.end();
        } else {
            req.pipe(writeStream);
            req.on('data', (chunk) => {
                dataSize += chunk.length;
            });
        }
    });
}

async function handleStreamRead(filePath, res, recordId = null) {
    try {
        await fsPromises.access(filePath); // Check if file exists.
        res.setHeader('Content-Type', 'application/json');
        
        const readStream = fs.createReadStream(filePath);
        let dataSize = 0;
        
        readStream.on('error', (err) => {
            const idStr = recordId ? ` "${recordId}"` : '';
            console.log(`Error reading Records${idStr}:`, err);
            if (!res.headersSent) {
                return res.status(500).json({ error: `Error reading Records${idStr}` });
            }
            res.end();
        });

        readStream.on('data', (chunk) => {
            dataSize += chunk.length;
        });
        
        readStream.on('end', () => {
            const idStr = recordId ? `_${recordId}` : '_list';
            console.log(`Load record${idStr}[${dataSize/1024/1024}MB]`);
        });
        
        readStream.pipe(res);
    } catch (err) {
        if (err.code === 'ENOENT') {
            const idStr = recordId ? ` "${recordId}"` : '';
            console.log(`Record file${idStr} not found.`);
            return res.status(404).json({ error: `Record${idStr} not found` });
        }
        const idStr = recordId ? ` "${recordId}"` : '';
        console.error(`Error accessing record file${idStr}:`, err);
        res.status(500).json({ error: `Error accessing record file${idStr}` });
    }
}

const app = express();
const PORT = 30962;
const painterUploadsDir = path.join(__dirname, '..', 'public', 'painter_uploads');
const painterImagesDir = path.join(__dirname, '..', 'public', 'painter_images');
const painterDataDir = path.join(__dirname, '..', 'data', 'painter');
const anvilAssetsDir = path.join(__dirname, '..', 'public', 'anvil_assets');
const anvilDataDir = path.join(__dirname, '..', 'data', 'anvil');
const anvilChatDir = path.join(anvilDataDir, 'chats');

fs.mkdirSync(painterUploadsDir, { recursive: true });
fs.mkdirSync(painterImagesDir, { recursive: true });
fs.mkdirSync(anvilAssetsDir, { recursive: true });
fs.mkdirSync(anvilDataDir, { recursive: true });
fs.mkdirSync(anvilChatDir, { recursive: true });

const painterUploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, painterUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const uniqueName = `ref_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`;
        cb(null, uniqueName);
    }
});

const painterUpload = multer({
    storage: painterUploadStorage,
    limits: {
        fileSize: 50 * 1024 * 1024
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            cb(null, true);
            return;
        }

        cb(new Error('Only image uploads are supported.'));
    }
});

const anvilAssetStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, anvilAssetsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const worldId = String(req.body?.worldId || 'world').replace(/[^a-zA-Z0-9_-]/g, '');
        const uniqueName = `${worldId}_${Date.now()}_${Math.floor(Math.random() * 100000)}${ext}`;
        cb(null, uniqueName);
    }
});

const anvilUpload = multer({
    storage: anvilAssetStorage,
    limits: {
        fileSize: 50 * 1024 * 1024
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            cb(null, true);
            return;
        }

        cb(new Error('Only image uploads are supported.'));
    }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(bodyParser.json({limit:'4mb'}));
app.use(bodyParser.urlencoded({extended: true}));

const server = app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
    console.error('Error starting server:', err);
});

app.post('/config', async (req, res) => {
    const config = req.body;
    const filePath = path.join(__dirname, '..', 'config.json');

    try {
        await fsPromises.writeFile(filePath, JSON.stringify(config));
        res.json({ message: `Done saving Configurations.` });
        console.log(`Save configurations[${computeStringSizeMB(JSON.stringify(config))/1024/1024}MB]`);
    } catch (err) {
        res.status(500).json({ error: 'Error saving Configurations' });
    }
})

app.get('/config', async (req, res) => {
    const filePath = path.join(__dirname, '..', 'config.json');

    try {
        if (!fs.existsSync(filePath)) { // existsSync is not in fs.promises, so we keep it as is.
            console.log("No config file.")
            return res.json({}); // Return an empty object for graceful handling on client
        }

        const config = await fsPromises.readFile(filePath, 'utf8');
        res.json(JSON.parse(config));
        console.log(`Load configurations[${computeStringSizeMB(JSON.stringify(config))/1024/1024}MB]`);
    } catch (err) {
        res.status(500).json({ error: 'Error reading Configurations' });
    }
})

app.post('/gpt/record', async (req, res) => {
    const gptDataPath = path.join(__dirname, '..', 'data', 'gpt');
    const filePath = path.join(gptDataPath, 'record_list.json');

    try {
        await fsPromises.mkdir(gptDataPath, { recursive: true });
        await handleStreamWrite(filePath, req, res);
    } catch (err) {
        console.error("Error handling record save:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error saving record' });
        }
    }
});

app.post('/gpt/record/:id', async (req, res) => {
    const id = req.params.id;
    const gptDataPath = path.join(__dirname, '..', 'data', 'gpt');
    const filePath = path.join(gptDataPath, `record_${id}.json`);

    try {
        await fsPromises.mkdir(gptDataPath, { recursive: true });
        await handleStreamWrite(filePath, req, res, id);
    } catch (err) {
        console.error(`Error handling record ${id} save:`, err);
        if (!res.headersSent) {
            res.status(500).json({ error: `Error saving record ${id}` });
        }
    }
});

app.get('/gpt/record', async (req, res) => {
    const filePath = path.join(__dirname, '..', 'data', 'gpt', 'record_list.json');
    await handleStreamRead(filePath, res);
})

app.get('/gpt/record/:id', async (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, '..', 'data', 'gpt', `record_${id}.json`);
    await handleStreamRead(filePath, res, id);
})

app.post('/gpt/painter/record', async (req, res) => {
    const filePath = path.join(painterDataDir, 'record_list.json');

    try {
        await fsPromises.mkdir(painterDataDir, { recursive: true });
        await handleStreamWrite(filePath, req, res, 'painter_list');
    } catch (err) {
        console.error('Error handling painter record save:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error saving painter record' });
        }
    }
});

app.get('/gpt/painter/record', async (req, res) => {
    const filePath = path.join(painterDataDir, 'record_list.json');
    await handleStreamRead(filePath, res, 'painter_list');
});

app.post('/gpt/painter/record_remove', async (req, res) => {
    const assetPath = resolvePainterAssetPath(req.body?.url);

    if (!assetPath) {
        return res.json({ message: 'No local painter asset to delete.' });
    }

    try {
        await fsPromises.access(assetPath);
        await fsPromises.unlink(assetPath);
        console.log(`[INFO][PAINTER] Deleted local painter asset: ${path.basename(assetPath)}`);
        res.json({ message: 'Painter asset deleted successfully.' });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.json({ message: 'Painter asset already removed.' });
        }

        console.error('[ERROR][PAINTER] Failed to delete local painter asset:', err);
        res.status(500).json({ error: 'Error deleting painter asset.' });
    }
});

app.get('/gpt/record_remove/:id', async (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, '..', 'data', 'gpt', `record_${id}.json`);

    try {
        await fsPromises.access(filePath); // Check if file exists
        await fsPromises.unlink(filePath);
        res.json({ message: `Record ${id} deleted successfully.` });
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`"record_${id}.json" not found for deletion.`);
            return res.status(404).json({ error: `Record ${id} not found.` });
        }
        console.error(`Error deleting "record_${id}.json":`, err);
        res.status(500).json({ error: `Error deleting "record_${id}.json"` });
    }
})

app.post('/gpt/search/wiki', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    try {
        const body = req.body;
        const keyword = body.keyword;
        const useProxy = body.useProxy;
        const proxyUrl = body.proxyUrl;

        if (!keyword) {
            return res.status(400).json({ error: 'Keyword is required' });
        }

        console.log(`Searching on Wiki for "${keyword}"`);

        const search = new SearchWiki(proxyUrl, useProxy);
        
        for await (const data of search.getInfo(keyword)) {
            res.write(JSON.stringify(data) + '<splitMark>');
        }

        res.end();
    } catch (error) {
        console.error('Error during search:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/gpt/painter/upload', (req, res) => {
    painterUpload.single('image')(req, res, (err) => {
        if (err) {
            const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
            return res.status(isTooLarge ? 413 : 400).json({
                error: isTooLarge ? 'Uploaded image is too large.' : err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Missing image file.' });
        }

        const relativeUrl = `./painter_uploads/${req.file.filename}`;
        console.log('[INFO][PAINTER] Reference image uploaded:', {
            fileName: req.file.filename,
            size: req.file.size,
            mimeType: req.file.mimetype
        });

        res.json({
            url: relativeUrl,
            path: relativeUrl,
            mimeType: req.file.mimetype,
            originalName: req.file.originalname,
            size: req.file.size
        });
    });
});

app.post('/gpt/painter', async (req, res) => {
    try {
        const { apiUrl, apiKey, ...payload } = req.body;
        const result = await forwardImageGeneration({
            apiUrl,
            apiKey,
            payload,
            localSaveDir: painterImagesDir,
            localUrlPrefix: './painter_images',
            filePrefix: 'img'
        });

        if (!result.ok) {
            return res.status(result.status).json(result.data);
        }

        res.json(result.data);
    } catch (error) {
        console.error('Error proxying painter request:', error);
        res.status(500).json({ error: 'Internal server error proxying to painter API' });
    }
});

app.get('/gpt/anvil/worlds', async (_req, res) => {
    try {
        const worlds = await readJsonOrDefault(getAnvilWorldsPath(), []);
        res.json(Array.isArray(worlds) ? worlds : []);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to load worlds list:', error);
        res.status(500).json({ error: 'Failed to load Anvil worlds.' });
    }
});

app.post('/gpt/anvil/world', async (req, res) => {
    try {
        const world = ensureAnvilWorldStructure(req.body || {});
        res.json(await saveAnvilWorld(world));
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to create world:', error);
        res.status(500).json({ error: 'Failed to create Anvil world.' });
    }
});

app.get('/gpt/anvil/world/:id', async (req, res) => {
    try {
        const world = await loadAnvilWorld(req.params.id);

        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        res.json(world);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to load world:', error);
        res.status(500).json({ error: 'Failed to load Anvil world.' });
    }
});

app.post('/gpt/anvil/world/:id', async (req, res) => {
    try {
        const world = {
            ...req.body,
            id: req.params.id
        };
        res.json(await saveAnvilWorld(world));
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to save world:', error);
        res.status(500).json({ error: 'Failed to save Anvil world.' });
    }
});

app.get('/gpt/anvil/world_remove/:id', async (req, res) => {
    try {
        const worldId = req.params.id;
        const worlds = await readJsonOrDefault(getAnvilWorldsPath(), []);

        await fsPromises.unlink(getAnvilWorldPath(worldId)).catch((err) => {
            if (err.code !== 'ENOENT') throw err;
        });
        await fsPromises.unlink(getAnvilChatPath(worldId)).catch((err) => {
            if (err.code !== 'ENOENT') throw err;
        });

        const assetFiles = await fsPromises.readdir(anvilAssetsDir).catch(() => []);
        await Promise.all(
            assetFiles
                .filter((fileName) => fileName.startsWith(`${worldId}_`))
                .map((fileName) => fsPromises.unlink(path.join(anvilAssetsDir, fileName)).catch(() => null))
        );

        const nextWorlds = Array.isArray(worlds) ? worlds.filter((item) => item.id !== worldId) : [];
        await writeJson(getAnvilWorldsPath(), nextWorlds);

        res.json({ message: 'Anvil world deleted successfully.' });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to delete world:', error);
        res.status(500).json({ error: 'Failed to delete Anvil world.' });
    }
});

app.post('/gpt/anvil/asset/upload', (req, res) => {
    anvilUpload.single('asset')(req, res, async (err) => {
        if (err) {
            const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
            return res.status(isTooLarge ? 413 : 400).json({
                error: isTooLarge ? 'Uploaded image is too large.' : err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Missing asset file.' });
        }

        try {
            const buf = await fsPromises.readFile(req.file.path);
            if (!sniffImageMimeFromBuffer(buf)) {
                await fsPromises.unlink(req.file.path).catch(() => {});
                return res.status(400).json({
                    error: 'Uploaded file is not a valid image (unrecognized or empty binary).'
                });
            }
        } catch (readErr) {
            await fsPromises.unlink(req.file.path).catch(() => {});
            console.error('[ERROR][ANVIL] Asset upload validation failed:', readErr);
            return res.status(500).json({ error: 'Could not validate uploaded image.' });
        }

        const relativeUrl = `./anvil_assets/${req.file.filename}`;
        res.json({
            url: relativeUrl,
            path: relativeUrl,
            mimeType: req.file.mimetype,
            originalName: req.file.originalname,
            size: req.file.size
        });
    });
});

app.post('/gpt/anvil/asset/remove', async (req, res) => {
    const assetPath = resolveAnvilAssetPath(req.body?.url);

    if (!assetPath) {
        return res.json({ message: 'No local Anvil asset to delete.' });
    }

    try {
        await fsPromises.access(assetPath);
        await fsPromises.unlink(assetPath);
        res.json({ message: 'Anvil asset deleted successfully.' });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.json({ message: 'Anvil asset already removed.' });
        }

        console.error('[ERROR][ANVIL] Failed to delete local asset:', err);
        res.status(500).json({ error: 'Error deleting Anvil asset.' });
    }
});

app.get('/gpt/anvil/brainstorm/session/:worldId', async (req, res) => {
    try {
        const world = await loadAnvilWorld(req.params.worldId);
        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        res.json(await loadAnvilBrainstormSession(req.params.worldId));
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to load brainstorm session:', error);
        res.status(500).json({ error: 'Failed to load Anvil brainstorm session.' });
    }
});

app.post('/gpt/anvil/brainstorm/session/:worldId/clear', async (req, res) => {
    try {
        const worldId = req.params.worldId;
        const world = await loadAnvilWorld(worldId);
        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const w = await loadAnvilWorld(worldId);
        const nextSession = await saveAnvilBrainstormSession({
            ...createEmptyAnvilBrainstormSession(worldId),
            worldCheckpoints: w ? [buildBrainstormCheckpoint(0, w, [])] : []
        });
        res.json(nextSession);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to clear brainstorm session:', error);
        res.status(500).json({ error: 'Failed to clear brainstorm session.' });
    }
});

app.post('/gpt/anvil/brainstorm/session/:worldId/rollback', async (req, res) => {
    try {
        const worldId = req.params.worldId;
        const rawIdx = req.body?.lastMessageIndex;
        const lastMessageIndex = rawIdx === undefined || rawIdx === null ? NaN : Number(rawIdx);
        if (!Number.isInteger(lastMessageIndex) || lastMessageIndex < -1) {
            return res.status(400).json({ error: 'Invalid lastMessageIndex (integer >= -1).' });
        }

        const worldExists = await loadAnvilWorld(worldId);
        if (!worldExists) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const session = await loadAnvilBrainstormSession(worldId);
        const messages = safeArray(session.messages);
        if (lastMessageIndex >= messages.length) {
            return res.status(400).json({ error: 'lastMessageIndex out of range.' });
        }

        const truncated = lastMessageIndex < 0 ? [] : messages.slice(0, lastMessageIndex + 1);
        const targetLen = truncated.length;
        const checkpoints = safeArray(session.worldCheckpoints);

        if (checkpoints.length === 0) {
            return res.status(400).json({
                error: 'No checkpoints in this session. Send at least one Copilot message after updating the app to enable rollback.'
            });
        }

        const viable = checkpoints.filter(
            (c) => c && typeof c.messageLength === 'number' && c.messageLength <= targetLen && c.world
        );
        const pick = viable.reduce((best, c) => {
            if (!best || c.messageLength > best.messageLength) return c;
            return best;
        }, null);

        if (!pick) {
            return res.status(400).json({ error: 'No checkpoint covers this chat position.' });
        }

        const restored = ensureAnvilWorldStructure(cloneJson(pick.world));
        const savedWorld = await saveAnvilWorld(restored);
        const nextCheckpoints = checkpoints.filter((c) => c && typeof c.messageLength === 'number' && c.messageLength <= targetLen);

        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            messages: truncated,
            openAiMessages: safeArray(pick.openAiMessages),
            worldCheckpoints: nextCheckpoints
        });

        res.json({ session: nextSession, world: savedWorld });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to rollback brainstorm session:', error);
        res.status(500).json({ error: 'Failed to rollback brainstorm session.' });
    }
});

app.post('/gpt/anvil/brainstorm/session/:worldId/plan-options', async (req, res) => {
    try {
        const worldId = req.params.worldId;
        const world = await loadAnvilWorld(worldId);
        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const actions = safeArray(req.body?.actions);
        if (!actions.length) {
            return res.status(400).json({ error: 'Missing actions array.' });
        }

        const session = await loadAnvilBrainstormSession(worldId);
        const messages = cloneJson(safeArray(session.messages));

        for (const msg of messages) {
            if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.blocks)) continue;
            for (const block of msg.blocks) {
                if (!block || block.type !== 'plan_options' || !block.proposalId) continue;
                const act = actions.find((a) => a && String(a.proposalId) === String(block.proposalId));
                if (!act) continue;
                if (block.state && block.state !== 'pending') continue;
                const st = String(act.state || '').trim();
                if (st !== 'chosen' && st !== 'dismissed') continue;
                block.state = st;
                if (act.choiceTitle != null) block.choiceTitle = String(act.choiceTitle);
                if (act.choiceDetail != null) block.choiceDetail = String(act.choiceDetail);
            }
        }

        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            messages
        });
        res.json({ session: nextSession });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to patch brainstorm plan options:', error);
        res.status(500).json({ error: 'Failed to update plan options.' });
    }
});

app.post('/gpt/anvil/brainstorm/chat', async (req, res) => {
    try {
        const {
            worldId,
            apiUrl,
            apiKey,
            model,
            message = '',
            attachmentUrls: rawAttachmentUrls = [],
            activeSection = 'World',
            activeEntryId = ''
        } = req.body || {};

        if (!worldId) {
            return res.status(400).json({ error: 'Missing worldId.' });
        }

        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing brainstorm API configuration.' });
        }

        const existingWorld = await loadAnvilWorld(worldId);
        if (!existingWorld) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const session = await loadAnvilBrainstormSession(worldId);
        const userText = String(message || '').trim();
        const attachmentUrls = safeArray(rawAttachmentUrls)
            .map((u) => String(u || '').trim())
            .filter(Boolean);
        if (!userText && !attachmentUrls.length) {
            return res.status(400).json({ error: 'Missing brainstorm message or image attachments.' });
        }

        const userOpenAiMessage = buildBrainstormUserOpenAiMessage(userText, attachmentUrls);

        const result = await runAnvilBrainstormWithTools({
            apiUrl,
            apiKey,
            model,
            worldId,
            userOpenAiMessage,
            openAiMessages: safeArray(session.openAiMessages),
            activeSection,
            activeEntryId
        });

        const assistantMessage = result.finalAssistantText || '…';
        const now = Date.now();
        const userDisplay = {
            role: 'user',
            content: userText,
            createdAt: now
        };
        if (attachmentUrls.length) {
            userDisplay.attachmentUrls = attachmentUrls;
        }
        let checkpoints = safeArray(session.worldCheckpoints);
        if (checkpoints.length === 0) {
            const w0 = await loadAnvilWorld(worldId);
            const mlen = safeArray(session.messages).length;
            const oa0 = safeArray(session.openAiMessages);
            checkpoints =
                mlen === 0
                    ? [buildBrainstormCheckpoint(0, w0, oa0)]
                    : [buildBrainstormCheckpoint(0, w0, []), buildBrainstormCheckpoint(mlen, w0, oa0)];
        }
        const nextMessages = [
            ...safeArray(session.messages),
            userDisplay,
            {
                role: 'assistant',
                content: assistantMessage,
                createdAt: now,
                blocks: safeArray(result.displayBlocks)
            }
        ];
        const nextWorld = ensureAnvilWorldStructure(result.world || (await loadAnvilWorld(worldId)));
        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            openAiMessages: result.openAiMessages,
            messages: nextMessages,
            lastProposedOperations: [],
            worldCheckpoints: mergeBrainstormCheckpoints(
                checkpoints,
                nextMessages.length,
                nextWorld,
                result.openAiMessages
            )
        });

        const lastTurn = result.aiTurnLog.length > 0 ? result.aiTurnLog[result.aiTurnLog.length - 1] : null;
        const lastRequest = lastTurn?.request;

        res.json({
            assistantMessage,
            proposedOperations: [],
            world: result.mutated ? result.world : null,
            session: nextSession,
            brainstormError: result.error,
            aiOutbound: lastRequest
                ? {
                      model,
                      messages: lastRequest.messages
                  }
                : {
                      model,
                      messages: []
                  }
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to run brainstorm chat:', error);
        res.status(500).json({ error: 'Failed to run Anvil brainstorm chat.' });
    }
});

app.post('/gpt/anvil/brainstorm/chat/stream', async (req, res) => {
    try {
        const {
            worldId,
            apiUrl,
            apiKey,
            model,
            message = '',
            attachmentUrls: streamRawAttachments = [],
            activeSection = 'World',
            activeEntryId = ''
        } = req.body || {};

        if (!worldId) {
            return res.status(400).json({ error: 'Missing worldId.' });
        }

        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing brainstorm API configuration.' });
        }

        const existingWorld = await loadAnvilWorld(worldId);
        if (!existingWorld) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const session = await loadAnvilBrainstormSession(worldId);
        const userText = String(message || '').trim();
        const attachmentUrls = safeArray(streamRawAttachments)
            .map((u) => String(u || '').trim())
            .filter(Boolean);
        if (!userText && !attachmentUrls.length) {
            return res.status(400).json({ error: 'Missing brainstorm message or image attachments.' });
        }

        const userOpenAiMessage = buildBrainstormUserOpenAiMessage(userText, attachmentUrls);

        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        let clientClosed = false;
        const onReqClose = () => {
            clientClosed = true;
        };
        req.once('close', onReqClose);

        let result;
        try {
            result = await runAnvilBrainstormWithToolsStreaming({
                res,
                apiUrl,
                apiKey,
                model,
                worldId,
                userOpenAiMessage,
                openAiMessages: safeArray(session.openAiMessages),
                activeSection,
                activeEntryId,
                isAborted: () => clientClosed || res.writableEnded
            });
        } finally {
            req.removeListener('close', onReqClose);
        }

        if (result.error === 'aborted' || clientClosed) {
            if (!res.writableEnded) {
                res.end();
            }
            return;
        }

        const assistantMessage = result.finalAssistantText || '…';
        const now = Date.now();
        const streamUserDisplay = {
            role: 'user',
            content: userText,
            createdAt: now
        };
        if (attachmentUrls.length) {
            streamUserDisplay.attachmentUrls = attachmentUrls;
        }
        let streamCheckpoints = safeArray(session.worldCheckpoints);
        if (streamCheckpoints.length === 0) {
            const wSeed = await loadAnvilWorld(worldId);
            const mlen0 = safeArray(session.messages).length;
            const oaSeed = safeArray(session.openAiMessages);
            streamCheckpoints =
                mlen0 === 0
                    ? [buildBrainstormCheckpoint(0, wSeed, oaSeed)]
                    : [buildBrainstormCheckpoint(0, wSeed, []), buildBrainstormCheckpoint(mlen0, wSeed, oaSeed)];
        }
        const streamNextMessages = [
            ...safeArray(session.messages),
            streamUserDisplay,
            {
                role: 'assistant',
                content: assistantMessage,
                createdAt: now,
                blocks: safeArray(result.displayBlocks)
            }
        ];
        const streamNextWorld = ensureAnvilWorldStructure(result.world || (await loadAnvilWorld(worldId)));
        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            openAiMessages: result.openAiMessages,
            messages: streamNextMessages,
            lastProposedOperations: [],
            worldCheckpoints: mergeBrainstormCheckpoints(
                streamCheckpoints,
                streamNextMessages.length,
                streamNextWorld,
                result.openAiMessages
            )
        });

        sendBrainstormSse(res, {
            type: 'done',
            assistantMessage,
            proposedOperations: [],
            world: result.world,
            worldMutated: Boolean(result.mutated),
            session: nextSession,
            brainstormError: result.error
        });
        res.end();
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to run brainstorm chat stream:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to run Anvil brainstorm chat stream.' });
        } else {
            sendBrainstormSse(res, { type: 'error', message: error.message || 'Stream failed.' });
            res.end();
        }
    }
});

app.post('/gpt/anvil/brainstorm/apply', async (req, res) => {
    try {
        const { worldId, operations = [] } = req.body || {};
        if (!worldId) {
            return res.status(400).json({ error: 'Missing worldId.' });
        }

        const world = await loadAnvilWorld(worldId);
        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const { world: nextWorld, appliedOperations } = applyAnvilOperations(world, operations);
        const savedWorld = await saveAnvilWorld(nextWorld);
        const session = await loadAnvilBrainstormSession(worldId);
        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            messages: [
                ...safeArray(session.messages),
                {
                    role: 'system',
                    content: `Applied ${appliedOperations.filter((operation) => operation.status === 'applied').length} brainstorm operation(s).`,
                    createdAt: Date.now()
                }
            ],
            lastProposedOperations: appliedOperations
        });

        res.json({
            world: savedWorld,
            appliedOperations,
            session: nextSession
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to apply brainstorm operations:', error);
        res.status(500).json({ error: 'Failed to apply Anvil brainstorm changes.' });
    }
});

app.post('/gpt/anvil/generate/text', async (req, res) => {
    try {
        const {
            apiUrl,
            apiKey,
            model,
            world,
            sectionName = 'World',
            entryId,
            action = 'write',
            userPrompt = ''
        } = req.body || {};

        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing text generation API configuration.' });
        }

        const normalizedWorld = ensureAnvilWorldStructure(world || {});
        const entryIdTrimmed = entryId != null && String(entryId).trim() !== '' ? String(entryId).trim() : '';
        const entry = entryIdTrimmed
            ? (flattenAnvilEntries(normalizedWorld).find((candidate) => candidate.id === entryIdTrimmed) || createAnvilEntry({}, sectionName))
            : null;
        const contextSummary = buildAnvilContextSummary(normalizedWorld, sectionName, entry, {
            referenceStrategy: 'text_world_context'
        });

        const systemPrompt = action === 'align'
            ? 'You are a worldbuilding consistency editor. Review the provided entry against the canon context and identify conflicts, continuity risks, and missing links. Be precise and actionable. Obey every OUTPUT_SPEC rule in the user message: plain text only (no Markdown), no conversational framing before or after the review.'
            : 'You are a senior concept design writer helping build a cohesive fictional universe. Produce vivid but production-usable writing that fits the provided canon and stays internally consistent. Obey every OUTPUT_SPEC rule in the user message: plain text only (no Markdown), no conversational framing — deliver only the requested text body.';

        const userContent = buildAnvilTextUserPrompt({
            world: normalizedWorld,
            sectionName,
            entry,
            action,
            userPrompt
        });

        const response = await fetch(normalizeChatApiUrl(apiUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                stream: false,
                max_tokens: action === 'align' ? 1200 : action === 'modify-world' ? 3200 : 1800,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            text: extractChatCompletionText(data),
            model,
            contextSummary,
            promptUsed: userContent,
            systemPromptUsed: systemPrompt,
            aiOutbound: {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ]
            }
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to generate text:', error);
        res.status(500).json({ error: 'Failed to generate Anvil text.' });
    }
});

app.post('/gpt/anvil/generate/image', async (req, res) => {
    try {
        const {
            apiUrl,
            apiKey,
            model,
            size = '1024x1024',
            world,
            sectionName = 'World',
            entryId,
            action = 'visualize',
            userPrompt = '',
            referenceImages = []
        } = req.body || {};

        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing image generation API configuration.' });
        }

        const normalizedWorld = ensureAnvilWorldStructure(world || {});
        const entryIdTrimmed = entryId != null && String(entryId).trim() !== '' ? String(entryId).trim() : '';
        const entry = entryIdTrimmed
            ? (flattenAnvilEntries(normalizedWorld).find((candidate) => candidate.id === entryIdTrimmed) || createAnvilEntry({}, sectionName))
            : null;
        const referencePlan = buildAnvilImageReferencePlan(normalizedWorld, entry, action, referenceImages);
        const contextSummary = buildAnvilContextSummary(normalizedWorld, sectionName, entry, {
            selectedReference: referencePlan.selectedReference,
            referenceCandidates: referencePlan.candidates.slice(0, 6),
            referenceStrategy: action === 'variant'
                ? 'entry_images_first_then_linked_then_world_anchors'
                : 'world_style_anchors_first_then_entry_images'
        });
        const prompt = buildAnvilImagePrompt({
            world: normalizedWorld,
            sectionName,
            entry,
            action,
            userPrompt
        });

        const payload = {
            model,
            prompt,
            n: 1,
            size
        };

        if (referencePlan.selectedReference?.url) {
            payload.image = referencePlan.selectedReference.url;
            payload.image_url = referencePlan.selectedReference.url;
        }

        const result = await forwardImageGeneration({
            apiUrl,
            apiKey,
            payload,
            localSaveDir: anvilAssetsDir,
            localUrlPrefix: './anvil_assets',
            filePrefix: normalizedWorld.id || 'anvil'
        });

        if (!result.ok) {
            return res.status(result.status).json(result.data);
        }

        res.json({
            ...result.data,
            contextSummary,
            promptUsed: prompt,
            referenceUsed: referencePlan.selectedReference?.url || null,
            referenceUsedLabel: referencePlan.selectedReference?.label || null,
            aiOutbound: {
                model,
                size,
                prompt,
                referenceUrl: referencePlan.selectedReference?.url || null,
                referenceLabel: referencePlan.selectedReference?.label || null
            }
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to generate image:', error);
        res.status(500).json({ error: 'Failed to generate Anvil image.' });
    }
});
