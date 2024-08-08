const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const PORT = 30962;

app.use(express.static(__dirname));
app.use(bodyParser.json());
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
        res.send('Done saving Configurations');
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
    });
})

app.post('/gpt/record', (req, res) => {
    const data = req.body;
    const filePath = path.join(__dirname, 'data', 'gpt_record.json');

    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            return res.status(500).send('Error saving Records');
        }
        res.send('Done saving Records');
        // console.log('Saving records.');
    });
})

app.get('/gpt/record', (req, res) => {
    const filePath = path.join(__dirname, 'data', 'gpt_record.json');

    if(!fs.existsSync(filePath)){
        console.log("No record file.")
        return res.json(undefined);
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading Records');
        }
        res.json(JSON.parse(data));
    });
})