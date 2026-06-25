const https = require('https');
require('dotenv').config({ path: '.env.local' });

const apiKey = process.env.APOLLO_API_KEY;
const data = JSON.stringify({ q_keywords: "barilla", person_locations: ["Italy"] });

console.log("Testing with Cache-Control header...");
const req = https.request({
    hostname: 'api.apollo.io',
    path: '/v1/mixed_people/search',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Api-Key': apiKey }
}, res => {
    let rawData = '';
    res.on('data', c => rawData += c);
    res.on('end', () => console.log(rawData));
});
req.write(data);
req.end();
