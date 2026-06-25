const fetch = require('node-fetch');

// This requires having the apollo key. Let's load the env.
require('dotenv').config({ path: '.env.local' });

async function testApollo() {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
        console.error("No APOLLO_API_KEY in .env.local");
        return;
    }

    const payload = {
        api_key: apiKey,
        q_keywords: "emanuele gorgone"
    };

    try {
        const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log("Total entries found:", Object.keys(data).includes('pagination') ? data.pagination.total_entries : "?");
        if (data.people && data.people.length > 0) {
            console.log("Found:", data.people.map(p => p.name));
        } else {
            console.log("No people found.", data);
        }
    } catch (e) {
        console.error("Error", e);
    }
}
testApollo();
