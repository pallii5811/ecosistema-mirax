const https = require('https');
require('dotenv').config({ path: '.env.local' });

const apiKey = process.env.APOLLO_API_KEY;

const testPayloads = [
    { name: "Using q_organization_name", payload: { api_key: apiKey, q_organization_name: "barilla", person_locations: ["Italy"] } },
    { name: "Using q_organization_domains", payload: { api_key: apiKey, q_organization_domains: "barilla.com", person_locations: ["Italy"] } },
    { name: "Using q_keywords", payload: { api_key: apiKey, q_keywords: "barilla", person_locations: ["Italy"] } }
];

async function runTests() {
    for (const test of testPayloads) {
        console.log(`\n--- Test: ${test.name} ---`);
        await new Promise((resolve) => {
            const data = JSON.stringify(test.payload);
            const req = https.request({
                hostname: 'api.apollo.io',
                path: '/v1/mixed_people/search',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
            }, res => {
                let rawData = '';
                res.on('data', c => rawData += c);
                res.on('end', () => {
                    const parsed = JSON.parse(rawData);
                    if (parsed.people) {
                        console.log(`Found: ${parsed.people.length} people. Total: ${parsed.pagination?.total_entries}`);
                    } else {
                        console.log(`Error or no people field:`, parsed);
                    }
                    resolve();
                });
            });
            req.write(data);
            req.end();
        });
    }
}

runTests();
