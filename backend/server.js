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

    const match = refImg.match(/\/(painter_images|painter_uploads)\/(.+)$/);
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

fs.mkdirSync(painterUploadsDir, { recursive: true });
fs.mkdirSync(painterImagesDir, { recursive: true });

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

        if (!apiUrl || !apiKey) {
            return res.status(400).json({ error: 'Missing apiUrl or apiKey' });
        }

        // --- Handle local file paths as reference images ---
        // If the payload contains an image parameter that is a local path, read it and convert to base64
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
                        console.log('[INFO][PAINTER] Converted local reference image to base64:', {
                            key,
                            refImg
                        });
                    }
                } catch (readErr) {
                    console.error('[ERROR][PAINTER] Failed to read local reference image:', readErr);
                }
            }
        }

        const requestUrl = normalizePainterApiUrl(apiUrl);
        console.log('[INFO][PAINTER] Forwarding request:', {
            originalApiUrl: apiUrl,
            requestUrl,
            model: payload.model,
            size: payload.size,
            promptPreview: typeof payload.prompt === 'string' ? payload.prompt.slice(0, 80) : ''
        });

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
            console.error('Painter API returned non-JSON response:', rawText.slice(0, 300));
            return res.status(502).json({
                error: 'Painter API did not return JSON. Please check the API URL.',
                requestUrl
            });
        }

        if (!response.ok) {
            console.log('[INFO][PAINTER] Upstream error:', {
                status: response.status,
                requestUrl,
                model: payload.model,
                response: data
            });
            return res.status(response.status).json(data);
        }

        console.log('[INFO][PAINTER] Upstream success:', {
            status: response.status,
            requestUrl,
            model: payload.model
        });
        
        // --- Try to save image locally to prevent dead links ---
        try {
            const fs = require('fs');
            const path = require('path');
            if (!fs.existsSync(painterImagesDir)) {
                fs.mkdirSync(painterImagesDir, { recursive: true });
            }

            const firstItem = Array.isArray(data?.data) ? data.data[0] : null;
            let imageUrl = firstItem?.url || firstItem?.image_url || firstItem?.imageUrl || data?.output?.[0]?.url || data?.output?.[0]?.image_url;
            let b64Data = firstItem?.b64_json || firstItem?.b64 || data?.output?.[0]?.b64_json;

            if (imageUrl && !b64Data) {
                // If it's a URL, download it
                const imgRes = await fetch(imageUrl);
                if (imgRes.ok) {
                    const arrayBuffer = await imgRes.arrayBuffer();
                    b64Data = Buffer.from(arrayBuffer).toString('base64');
                }
            }

            if (b64Data) {
                const fileName = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
                const filePath = path.join(painterImagesDir, fileName);
                fs.writeFileSync(filePath, Buffer.from(b64Data, 'base64'));
                
                // Override the response to return the local URL instead
                if (firstItem) {
                    firstItem.url = `./painter_images/${fileName}`;
                    firstItem.b64_json = undefined;
                    firstItem.b64 = undefined;
                } else if (data?.output?.[0]) {
                    data.output[0].url = `./painter_images/${fileName}`;
                    data.output[0].b64_json = undefined;
                } else if (!data.data) {
                    data.data = [{ url: `./painter_images/${fileName}` }];
                }
                console.log(`[INFO][PAINTER] Image saved locally: ${fileName}`);
            }
        } catch (saveErr) {
            console.error('[ERROR][PAINTER] Failed to save image locally:', saveErr);
            // Ignore error and just return original data if we fail to save locally
        }

        res.json(data);
    } catch (error) {
        console.error('Error proxying painter request:', error);
        res.status(500).json({ error: 'Internal server error proxying to painter API' });
    }
});
