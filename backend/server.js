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

function buildAnvilTextUserPrompt({ world, sectionName, entry, action, userPrompt }) {
    const contextParts = getAnvilContextParts(world, sectionName, entry);

    return [
        `Action: ${action || 'write'}`,
        `World Name: ${world.name}`,
        `Section: ${sectionName}`,
        `Theme Keywords: ${safeArray(world.themeKeywords).join(', ') || 'None'}`,
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
        userPrompt || 'No extra instruction provided.'
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

fs.mkdirSync(painterUploadsDir, { recursive: true });
fs.mkdirSync(painterImagesDir, { recursive: true });
fs.mkdirSync(anvilAssetsDir, { recursive: true });
fs.mkdirSync(anvilDataDir, { recursive: true });

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
app.use(bodyParser.json({limit:'1mb'}));
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
        const worldsPath = path.join(anvilDataDir, 'worlds.json');
        const worlds = await readJsonOrDefault(worldsPath, []);
        res.json(Array.isArray(worlds) ? worlds : []);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to load worlds list:', error);
        res.status(500).json({ error: 'Failed to load Anvil worlds.' });
    }
});

app.post('/gpt/anvil/world', async (req, res) => {
    try {
        const world = ensureAnvilWorldStructure(req.body || {});
        const worldPath = path.join(anvilDataDir, `${world.id}.json`);
        const worldsPath = path.join(anvilDataDir, 'worlds.json');
        const worlds = await readJsonOrDefault(worldsPath, []);
        const summary = summarizeAnvilWorld(world);
        const nextWorlds = Array.isArray(worlds)
            ? worlds.filter((item) => item.id !== world.id).concat(summary)
            : [summary];

        await writeJson(worldPath, world);
        await writeJson(worldsPath, nextWorlds.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        res.json(world);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to create world:', error);
        res.status(500).json({ error: 'Failed to create Anvil world.' });
    }
});

app.get('/gpt/anvil/world/:id', async (req, res) => {
    try {
        const worldPath = path.join(anvilDataDir, `${req.params.id}.json`);
        const world = await readJsonOrDefault(worldPath, null);

        if (!world) {
            return res.status(404).json({ error: 'Anvil world not found.' });
        }

        res.json(ensureAnvilWorldStructure(world));
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to load world:', error);
        res.status(500).json({ error: 'Failed to load Anvil world.' });
    }
});

app.post('/gpt/anvil/world/:id', async (req, res) => {
    try {
        const world = ensureAnvilWorldStructure({
            ...req.body,
            id: req.params.id,
            updatedAt: Date.now()
        });
        const worldPath = path.join(anvilDataDir, `${world.id}.json`);
        const worldsPath = path.join(anvilDataDir, 'worlds.json');
        const worlds = await readJsonOrDefault(worldsPath, []);
        const summary = summarizeAnvilWorld(world);
        const nextWorlds = Array.isArray(worlds)
            ? worlds.filter((item) => item.id !== world.id).concat(summary)
            : [summary];

        await writeJson(worldPath, world);
        await writeJson(worldsPath, nextWorlds.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        res.json(world);
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to save world:', error);
        res.status(500).json({ error: 'Failed to save Anvil world.' });
    }
});

app.get('/gpt/anvil/world_remove/:id', async (req, res) => {
    try {
        const worldId = req.params.id;
        const worldPath = path.join(anvilDataDir, `${worldId}.json`);
        const worldsPath = path.join(anvilDataDir, 'worlds.json');
        const worlds = await readJsonOrDefault(worldsPath, []);

        await fsPromises.unlink(worldPath).catch((err) => {
            if (err.code !== 'ENOENT') throw err;
        });

        const assetFiles = await fsPromises.readdir(anvilAssetsDir).catch(() => []);
        await Promise.all(
            assetFiles
                .filter((fileName) => fileName.startsWith(`${worldId}_`))
                .map((fileName) => fsPromises.unlink(path.join(anvilAssetsDir, fileName)).catch(() => null))
        );

        const nextWorlds = Array.isArray(worlds) ? worlds.filter((item) => item.id !== worldId) : [];
        await writeJson(worldsPath, nextWorlds);

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
        const entry = flattenAnvilEntries(normalizedWorld).find((candidate) => candidate.id === entryId) || createAnvilEntry({}, sectionName);
        const contextSummary = buildAnvilContextSummary(normalizedWorld, sectionName, entry, {
            referenceStrategy: 'text_world_context'
        });

        const systemPrompt = action === 'align'
            ? 'You are a worldbuilding consistency editor. Review the provided entry against the canon context and identify conflicts, continuity risks, and missing links. Be precise and actionable.'
            : 'You are a senior concept design writer helping build a cohesive fictional universe. Produce vivid but production-usable writing that fits the provided canon and stays internally consistent.';

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
                max_tokens: action === 'align' ? 1200 : 1800,
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
            promptUsed: userContent
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
        const entry = flattenAnvilEntries(normalizedWorld).find((candidate) => candidate.id === entryId) || createAnvilEntry({}, sectionName);
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
            referenceUsedLabel: referencePlan.selectedReference?.label || null
        });
    } catch (error) {
        console.error('[ERROR][ANVIL] Failed to generate image:', error);
        res.status(500).json({ error: 'Failed to generate Anvil image.' });
    }
});
