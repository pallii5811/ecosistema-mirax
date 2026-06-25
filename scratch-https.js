const https = require('https');
require('dotenv').config({ path: '.env.local' });

const apiKey = process.env.APOLLO_API_KEY;
if (!apiKey) {
    console.error("No APOLLO_API_KEY in .env.local");
    process.exit(1);
}

const data = JSON.stringify({
    api_key: apiKey,
    q_keywords: "emanuele gorgone"
});

const options = {
    hostname: 'api.apollo.io',
    path: '/v1/mixed_people/search',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, res => {
    let rawData = '';
    res.on('data', chunk => { rawData += chunk; });
    res.on('end', () => {
        try {
            const parsedData = JSON.parse(rawData);
            if (parsedData.people && parsedData.people.length > 0) {
                console.log(`FOUND ${parsedData.people.length} people.`);
                console.log(parsedData.people.map(p => p.name));
            } else {
                console.log("NOBODY FOUND. Apollo returned 0 people for this keyword.");
            }
        } catch (e) {
            console.error("Error parsing response", e);
        }
    });
});

req.on('error', e => {
    console.error("Request error:", e);
});

req.write(data);
req.end();
