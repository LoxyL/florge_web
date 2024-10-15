const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

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
    const data = req.body;
    const filePath = path.join(__dirname, 'data', 'gpt', 'record_list.json');

    fs.stat('data/gpt', (err, stat) => {
        if(err){
            if(err.code === 'ENOENT'){
                console.log("No path ./data/gpt");
            }
            fs.mkdir('data', (err) => {
                console.log("Creating directory ./data");
                if(err){
                    console.log("Error creating directory ./data");
                }
                fs.mkdir('data/gpt', (err) => {
                    console.log("Creating directory ./data/gpt");
                    if(err){
                        console.log("Error creating directory ./data/gpt");
                    }
                });
            });
        }
    })

    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            console.log('Error saving Records');
            return res.status(500).send('Error saving Records');
        }
        res.send('Done saving Records');
        console.log(`Save record_list[${computeStringSizeMB(JSON.stringify(data))/1024/1024}MB]`);
    });
})

app.post('/gpt/record/:id', (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const filePath = path.join(__dirname, 'data', 'gpt', `record_${id}.json`);

    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            console.log(`Error saving Record ${id}`);
            return res.status(500).send(`Error saving Record ${id}`);
        }
        res.send('Done saving Records');
        console.log(`Save record_${id}[${computeStringSizeMB(JSON.stringify(data))/1024/1024}MB]`);
    });
})

app.get('/gpt/record', (req, res) => {
    const filePath = path.join(__dirname, 'data', 'gpt', 'record_list.json');

    if(!fs.existsSync(filePath)){
        console.log("No record file.")
        return res.json(undefined);
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading Records');
        }
        res.json(JSON.parse(data));
        console.log(`Load record_list[${computeStringSizeMB(JSON.stringify(data))/1024/1024}MB]`);
    });
})

app.get('/gpt/record/:id', (req, res) => {
    const id = req.params.id;
    const filePath = path.join(__dirname, 'data', 'gpt', `record_${id}.json`);

    if(!fs.existsSync(filePath)){
        console.log(`"record_${id}.json" not found.`)
        return res.json(undefined);
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send(`Error reading "record_${id}.json"`);
        }
        res.json(JSON.parse(data));
        console.log(`Load record_${id}[${computeStringSizeMB(JSON.stringify(data))/1024/1024}MB]`);
    });
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

app.post('/gpt/search/wiki', (req, res) => {
    
})