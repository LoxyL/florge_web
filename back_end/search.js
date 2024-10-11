const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');


class searchBase {
    constructor(proxyUrl, useProxy=false) {
        this._url = '';
        this._agent = new HttpsProxyAgent(proxyUrl);
        this._useProxy = useProxy;
    }

    async getInfo(keyWord) {
        for await (const data of this._search(keyWord)) {
            console.log('----Piece----');
            console.log(data);
        }
    }

    async _search(keyWord) {}

    async _extract(index) {}
};

class searchWiki extends searchBase {
    constructor(proxyUrl, useProxy=false) {
        super(proxyUrl, useProxy);
        this._url = 'https://en.wikipedia.org/w/api.php';
    }

    async *_search(keyWord) {
        try {
            const response = await axios.get(this._url, {
                params: {
                    action: 'query',
                    format: 'json',
                    list: 'search',
                    srsearch: keyWord,
                    utf8: 1,
                    srlimit: 5,
                },
                httpAgent: this._useProxy? this._agent:null,
                httpsAgent: this._useProxy? this._agent:null
            });
    
            const searchResults = response.data.query.search;
            
            if (searchResults.length > 0) {
                for (const result of searchResults) {
                    const pageId = result.pageid;
                    const snippet = result.snippet;
                    const link = `https://en.wikipedia.org/?curid=${pageId}`;
                    // console.log(`Title: ${result.title}`);
                    // console.log(`Snippet: ${snippet}`);
                    // console.log(`Link: ${link}`);
                    // console.log('---');
    
                    const data = await this._extract(pageId);
                    yield data;
                }
            } else {
                console.log(`No information for "${keyWord}"`);
            }
        } catch (error) {
            console.error('Request fail:', error.response ? error.response.data : error.message);
        }
    }

    async _extract(index) {
        try {
            const response = await axios.get(this._url, {
                params: {
                    action: 'query',
                    format: 'json',
                    prop: 'extracts',
                    exintro: true,
                    explaintext: true,
                    pageids: index,
                },
                httpAgent: this._useProxy? this._agent:null,
                httpsAgent: this._useProxy? this._agent:null
            });
    
            const page = response.data.query.pages[index];
    
            if (page && page.extract) {
                // console.log(`Extract for ${page.title}:`);
                // console.log(page.extract);
                // console.log('---');
            } else {
                console.log(`No content in page ${index}`);
            }

            return page.extract;
        } catch (error) {
            console.error('Error getting content:', error.response ? error.response.data : error.message);
        }
    }
}


engine = new searchWiki('http://127.0.0.1:7890', true);
engine.getInfo('Java');