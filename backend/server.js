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

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
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

    for (const sectionName of ANVIL_SECTION_TEMPLATES) {
        sections[sectionName] = safeArray(existingSections[sectionName]).map((entry) => createAnvilEntry(entry, sectionName));
    }

    for (const [sectionName, entries] of Object.entries(existingSections || {})) {
        if (sections[sectionName]) continue;
        sections[sectionName] = safeArray(entries).map((entry) => createAnvilEntry(entry, sectionName));
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

    for (const sectionName of ANVIL_SECTION_TEMPLATES) {
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

function buildAnvilBrainstormUserPrompt({ world, message, activeSection = 'World', activeEntryId = '' }) {
    const normalizedWorld = ensureAnvilWorldStructure(world);
    const focusedEntry = activeEntryId
        ? flattenAnvilEntries(normalizedWorld).find((entry) => entry.id === activeEntryId)
        : null;

    return [
        'You are inside Anvil, a worldbuilding studio.',
        'Your task is to help brainstorm and, when useful, propose explicit world mutations.',
        'Return valid JSON only.',
        '',
        'Expected JSON schema:',
        JSON.stringify({
            assistantMessage: 'Plain text only inside this string: no Markdown, no preamble or closing pleasantries.',
            proposedOperations: [{
                type: 'updateWorldFields | createEntry | updateEntryFields | deleteEntry | moveEntrySection | setEntryLinks | setEntryTags',
                reason: 'Why this change helps the world.',
                fields: {},
                section: 'World',
                entry: {},
                entryId: 'entry_id',
                toSection: 'Regions',
                links: ['entry_id'],
                tags: ['tag']
            }]
        }, null, 2),
        '',
        'Formatting: assistantMessage is plain prose only (no # headings, **bold**, - bullets, code fences). If the creator asked for one thing only, assistantMessage contains only that.',
        'Snapshot note: world snapshot text is truncated per field (e.g. entry content ~600 chars, canon ~2400); missing detail may exist in the full world.',
        '',
        `Current active section: ${activeSection}`,
        `Focused entry: ${focusedEntry ? `${focusedEntry.title} (${focusedEntry.id})` : 'None'}`,
        '',
        'World snapshot:',
        JSON.stringify(buildAnvilBrainstormWorldDigest(normalizedWorld), null, 2),
        '',
        'Creator request:',
        message || 'No message provided.'
    ].join('\n');
}

function extractJsonObjectFromText(text) {
    const rawText = String(text || '').trim();
    if (!rawText) {
        return null;
    }

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : rawText;

    try {
        return JSON.parse(candidate);
    } catch (_error) {
        const firstBrace = candidate.indexOf('{');
        const lastBrace = candidate.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
            } catch (_innerError) {
                return null;
            }
        }
        return null;
    }
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
        const rawFields = operation.fields && typeof operation.fields === 'object' ? operation.fields : {};
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

    if (base.type === 'createEntry') {
        const section = ANVIL_SECTION_TEMPLATES.includes(operation.section) ? operation.section : 'World';
        const entry = createAnvilEntry({
            title: operation.entry?.title || operation.title || `New ${section} Entry`,
            summary: operation.entry?.summary || '',
            content: operation.entry?.content || '',
            status: operation.entry?.status || 'Seed',
            tags: normalizeStringArray(operation.entry?.tags),
            links: normalizeStringArray(operation.entry?.links),
            styleKeywords: normalizeStringArray(operation.entry?.styleKeywords)
        }, section);

        return { ...base, section, entry };
    }

    if (base.type === 'updateEntryFields') {
        const rawFields = operation.fields && typeof operation.fields === 'object' ? operation.fields : {};
        const fields = {};
        const allowedFields = ['title', 'summary', 'content', 'status', 'section', 'canonContext'];

        for (const key of allowedFields) {
            if (!(key in rawFields)) continue;
            fields[key] = String(rawFields[key] || '');
        }
        if ('tags' in rawFields) fields.tags = normalizeStringArray(rawFields.tags);
        if ('links' in rawFields) fields.links = normalizeStringArray(rawFields.links);
        if ('styleKeywords' in rawFields) fields.styleKeywords = normalizeStringArray(rawFields.styleKeywords);

        return {
            ...base,
            entryId: String(operation.entryId || '').trim(),
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
        return {
            ...base,
            entryId: String(operation.entryId || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            toSection: ANVIL_SECTION_TEMPLATES.includes(operation.toSection) ? operation.toSection : 'World'
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
            entryId: String(operation.entryId || '').trim(),
            titleHint: String(operation.titleHint || '').trim(),
            tags: normalizeStringArray(operation.tags)
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
        if (!operation) continue;

        const finalizedOperation = { ...operation, status: 'applied' };

        if (operation.type === 'updateWorldFields') {
            Object.assign(nextWorld, operation.fields || {});
            nextWorld.themeKeywords = normalizeStringArray(nextWorld.themeKeywords);
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
        lastProposedOperations: [],
        updatedAt: 0
    };
}

async function loadAnvilBrainstormSession(worldId) {
    const session = await readJsonOrDefault(getAnvilChatPath(worldId), null);
    if (!session) {
        return createEmptyAnvilBrainstormSession(worldId);
    }

    return {
        ...createEmptyAnvilBrainstormSession(worldId),
        ...session,
        worldId,
        messages: safeArray(session.messages),
        lastProposedOperations: safeArray(session.lastProposedOperations)
    };
}

async function saveAnvilBrainstormSession(session) {
    const normalizedSession = {
        ...createEmptyAnvilBrainstormSession(session.worldId),
        ...session,
        messages: safeArray(session.messages),
        lastProposedOperations: safeArray(session.lastProposedOperations),
        updatedAt: Date.now()
    };
    await writeJson(getAnvilChatPath(session.worldId), normalizedSession);
    return normalizedSession;
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

    const requestUrl = normalizePainterApiUrl(apiUrl);
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
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
    anvilUpload.single('asset')(req, res, (err) => {
        if (err) {
            const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
            return res.status(isTooLarge ? 413 : 400).json({
                error: isTooLarge ? 'Uploaded image is too large.' : err.message
            });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Missing asset file.' });
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

app.post('/gpt/anvil/brainstorm/chat', async (req, res) => {
    try {
        const {
            worldId,
            apiUrl,
            apiKey,
            model,
            message = '',
            activeSection = 'World',
            activeEntryId = ''
        } = req.body || {};

        if (!worldId) {
            return res.status(400).json({ error: 'Missing worldId.' });
        }

        if (!apiUrl || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing brainstorm API configuration.' });
        }

        const world = await loadAnvilWorld(worldId);
        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        const session = await loadAnvilBrainstormSession(worldId);
        const userText = String(message || '').trim();
        if (!userText) {
            return res.status(400).json({ error: 'Missing brainstorm message.' });
        }

        const requestMessages = [
            {
                role: 'system',
                content: [
                    'You are a worldbuilding brainstorm partner and structured editor.',
                    'You can read the entire world snapshot and propose concrete mutations.',
                    'Respond in strict JSON only.',
                    'The JSON must contain assistantMessage and proposedOperations.',
                    'assistantMessage must be plain text only: no Markdown (no #, **, lists with -/*, code fences, links). No preamble or postscript — only the substantive brainstorm reply.',
                    'Each proposed operation must be safe, specific, and use only the allowed operation types.',
                    'Do not invent operation types outside the schema.',
                    'If no edits are needed, return an empty proposedOperations array.'
                ].join(' ')
            },
            {
                role: 'user',
                content: buildAnvilBrainstormUserPrompt({
                    world,
                    message: userText,
                    activeSection,
                    activeEntryId
                })
            }
        ];

        const response = await fetch(normalizeChatApiUrl(apiUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                stream: false,
                max_tokens: 2200,
                messages: requestMessages
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const rawAssistantText = extractChatCompletionText(data);
        const parsed = extractJsonObjectFromText(rawAssistantText) || {};
        const assistantMessage = String(parsed.assistantMessage || rawAssistantText || '').trim() || 'I reviewed the world and prepared suggestions.';
        const proposedOperations = safeArray(parsed.proposedOperations)
            .map((operation) => normalizeBrainstormOperation(operation))
            .filter(Boolean);

        const nextSession = await saveAnvilBrainstormSession({
            ...session,
            messages: [
                ...safeArray(session.messages),
                {
                    role: 'user',
                    content: userText,
                    createdAt: Date.now()
                },
                {
                    role: 'assistant',
                    content: assistantMessage,
                    createdAt: Date.now()
                }
            ],
            lastProposedOperations: proposedOperations
        });

        res.json({
            assistantMessage,
            proposedOperations,
            session: nextSession,
            aiOutbound: {
                model,
                messages: requestMessages.map((m) => ({
                    role: m.role,
                    content: m.content
                }))
            }
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to run brainstorm chat:', error);
        res.status(500).json({ error: 'Failed to run Anvil brainstorm chat.' });
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
