require("dotenv").config();
const { searchHotelsSerpApi } = require("./serpapi-client");

async function main() {
  const results = await searchHotelsSerpApi({
    query: "Paris hotels",
    checkIn: "2026-12-20",
    checkOut: "2026-12-23"
  });

  console.log(`Got ${results.length} hotels`);
  console.log(JSON.stringify(results[0], null, 2));
}

main().catch(err => console.error("Test failed:", err.message));
