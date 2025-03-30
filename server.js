const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const {SearchWiki} = require('./back_end/search.js');

function computeStringSizeMB(str) {
    return new Blob([str]).size;
}

const app = express();
const PORT = 30962;

app.use(express.static(__dirname));
app.use(bodyParser.json({limit:'1mb'}));
app.use(bodyParser.urlencoded({extended: true}));

const server = app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
    console.error('Error starting server:', err);
});

app.post('/config', (req, res) => {
    const config = req.body;
    const filePath = path.join(__dirname, 'config.json');

    fs.writeFile(filePath, JSON.stringify(config), (err) => {
        if (err) {
            return res.status(500).send('Error saving Configurations');
        }
        res.send(`Done saving Configurations.`);
        console.log(`Save configurations[${computeStringSizeMB(JSON.stringify(config))/1024/1024}MB]`);
    });
})

app.get('/config', (req, res) => {
    const filePath = path.join(__dirname, 'config.json');

    if(!fs.existsSync(filePath)){
        console.log("No config file.")
        return res.json(undefined);
    }

    fs.readFile(filePath, 'utf8', (err, config) => {
        if (err) {
            return res.status(500).send('Error reading Configurations');
        }
        res.json(JSON.parse(config));
        console.log(`Load configurations[${computeStringSizeMB(JSON.stringify(config))/1024/1024}MB]`);
    });
})

app.post('/gpt/record', (req, res) => {
    const filePath = path.join(__dirname, 'data', 'gpt', 'record_list.json');

    fs.stat('data/gpt', (err, stat) => {
        if(err){
            if(err.code === 'ENOENT'){
                console.log("No path ./data/gpt");
            }
            fs.mkdir('data', { recursive: true }, (err) => {
                if(err){
                    console.log("Error creating directory ./data");
                    return res.status(500).send('Error creating directories');
                }
                fs.mkdir('data/gpt', (err) => {
                    if(err){
                        console.log("Error creating directory ./data/gpt");
                        return res.status(500).send('Error creating directories');
                    }
                    handleStreamWrite();
                });
            });
        } else {
            handleStreamWrite();
        }
    });

    function handleStreamWrite() {
        const writeStream = fs.createWriteStream(filePath);
        let dataSize = 0;
        
        writeStream.on('error', (err) => {
            console.log('Error saving Records:', err);
            return res.status(500).send('Error saving Records');
        });
        
        writeStream.on('finish', () => {
            res.send('Done saving Records');
            console.log(`Save record_list[${dataSize/1024/1024}MB]`);
        });
        
        if (req.body) {
            const data = JSON.stringify(req.body);
            dataSize = new Blob([data]).size;
            writeStream.write(data);
            writeStream.end();
        } else {
            let chunks = [];
            req.on('data', (chunk) => {
                chunks.push(chunk);
                writeStream.write(chunk);
            });
            
            req.on('end', () => {
                dataSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
                writeStream.end();
            });
        }
    }
})

app.post('/gpt/record/:id', (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, 'data', 'gpt', `record_${id}.json`);
    
    const writeStream = fs.createWriteStream(filePath);
    let dataSize = 0;
    
    writeStream.on('error', (err) => {
        console.log(`Error saving Record ${id}:`, err);
        return res.status(500).send(`Error saving Record ${id}`);
    });
    
    writeStream.on('finish', () => {
        res.send('Done saving Records');
        console.log(`Save record_${id}[${dataSize/1024/1024}MB]`);
    });
    
    if (req.body) {
        const data = JSON.stringify(req.body);
        dataSize = new Blob([data]).size;
        writeStream.write(data);
        writeStream.end();
    } else {
        let chunks = [];
        req.on('data', (chunk) => {
            chunks.push(chunk);
            writeStream.write(chunk);
        });
        
        req.on('end', () => {
            dataSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
            writeStream.end();
        });
    }
})

app.get('/gpt/record', (req, res) => {
    const filePath = path.join(__dirname, 'data', 'gpt', 'record_list.json');

    if(!fs.existsSync(filePath)){
        console.log("No record file.")
        return res.json(undefined);
    }

    res.setHeader('Content-Type', 'application/json');
    
    const readStream = fs.createReadStream(filePath);
    
    readStream.on('error', (err) => {
        console.log('Error reading Records:', err);
        if (!res.headersSent) {
            return res.status(500).send('Error reading Records');
        }
        res.end();
    });
    
    let dataSize = 0;
    readStream.on('data', (chunk) => {
        dataSize += chunk.length;
    });
    
    readStream.on('end', () => {
        console.log(`Load record_list[${dataSize/1024/1024}MB]`);
    });
    
    readStream.pipe(res);
})

app.get('/gpt/record/:id', (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, 'data', 'gpt', `record_${id}.json`);

    if(!fs.existsSync(filePath)){
        console.log(`"record_${id}.json" not found.`)
        return res.json(undefined);
    }

    res.setHeader('Content-Type', 'application/json');
    
    const readStream = fs.createReadStream(filePath);
    
    readStream.on('error', (err) => {
        console.log(`Error reading "record_${id}.json":`, err);
        if (!res.headersSent) {
            return res.status(500).send(`Error reading "record_${id}.json"`);
        }
        res.end();
    });
    
    let dataSize = 0;
    readStream.on('data', (chunk) => {
        dataSize += chunk.length;
    });
    
    readStream.on('end', () => {
        console.log(`Load record_${id}[${dataSize/1024/1024}MB]`);
    });
    
    readStream.pipe(res);
})

app.get('/gpt/record_remove/:id', (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, 'data', 'gpt', `record_${id}.json`);

    if(!fs.existsSync(filePath)){
        console.log(`"record_${id}.json" not found.`)
        return res.json(undefined);
    }

    fs.unlink(filePath, (err) => {
        if (err) {
            return res.status(500).send(`Error reading "record_${id}.json"`);
        }
    });
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
        if (error instanceof SomeSpecificError) {
            return res.status(500).json({ error: 'A specific error occurred' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
