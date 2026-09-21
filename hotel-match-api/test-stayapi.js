const { searchStayAPI } = require("./stayapi-client");
const { normalizeStayAPIHotels } = require("./stayapi-normalizer");

async function main() {
  const result = await searchStayAPI({
    destId: -3233180,
    checkin: "2026-10-10",
    checkout: "2026-10-12",
    adults: 2,
    rooms: 1,
    currency: "USD",
    rowsPerPage: 5,
  });

  const hotels = normalizeStayAPIHotels(result.data?.hotels);

  console.log(JSON.stringify(hotels, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
