const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const bodyParser = require('body-parser');
const {SearchWiki} = require('./search.js');

function computeStringSizeMB(str) {
    return Buffer.byteLength(str, 'utf8');
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
