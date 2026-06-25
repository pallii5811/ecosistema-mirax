const apolloKey = "r1bprfif5kfVGJxcvBFICA";

async function test() {
  const body = {
    api_key: apolloKey,
    q_keywords: "emanuele gorgone",
    page: 1,
    per_page: 5
  };

  try {
    const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Total entries:", data.pagination?.total_entries);
    if(data.people && data.people.length > 0) {
        console.log("Found:", data.people[0].first_name, data.people[0].last_name, "Company:", data.people[0].organization?.name);
    } else {
        console.log("No people found");
    }
  } catch (e) {
    console.error("Error", e);
  }
}

test();
