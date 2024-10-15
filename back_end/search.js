const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');


class SearchBase {
    constructor(proxyUrl, useProxy=false) {
        this._url = '';
        this._agent = new HttpsProxyAgent(proxyUrl);
        this._useProxy = useProxy;
    }

    async *getInfo(keyWord) {
        console.log('Getting info...');
        for await (const data of this._search(keyWord)) {
            console.log('Get Result of ' + data.title);
            console.log(data);
            yield data;
        }
    }

    async _search(keyWord) {}

    async _extract(index) {}
};

class SearchWiki extends SearchBase {
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
    
                    const content = await this._extract(pageId);
                    const data = {
                        title: result.title,
                        link: link,
                        content: content
                    }
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
        const maxLength = 80000;

        try {
            const response = await axios.get(this._url, {
                params: {
                    action: 'query',
                    format: 'json',
                    prop: 'revisions',
                    rvprop: 'content',
                    explaintext: true,
                    pageids: index,
                },
                httpAgent: this._useProxy? this._agent:null,
                httpsAgent: this._useProxy? this._agent:null
            });

            let result = '';
    
            const pages = response.data.query.pages;
            for (const pageId in pages) {
                const page = pages[pageId];
                if (page.revisions && page.revisions.length > 0) {
                    const content = page.revisions[0]['*'];
                    // console.log(content);
                    result += content;
                } else {
                    console.log(`No content in page ${pageId}`);
                }
            }

            if(result.length > maxLength) {
                result = result.slice(0, maxLength);
            }
            return JSON.stringify(result);
        } catch (error) {
            console.error('Error getting content:', error.response ? error.response.data : error.message);
        }
    }
}

module.exports = {SearchWiki};


// engine = new SearchWiki('http://127.0.0.1:7890', true);
// (async () => {
//     for await (const piece of engine.getInfo('VCR in physics')){
//         // console.log(piece);
//     }
// })();