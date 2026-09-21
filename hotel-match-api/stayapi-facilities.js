const STAYAPI_FACILITIES_URL =
  "https://api.stayapi.com/v1/booking/hotel/facilities";

const {
  getCachedFacilities,
  setCachedFacilities
} = require("./stayapi-facilities-cache");

async function getStayAPIFacilities(hotelId) {
  const cached = getCachedFacilities(hotelId);

  if (cached) {
    return cached.facilities;
  }

  if (!process.env.STAYAPI_API_KEY) {
    throw new Error("STAYAPI_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    hotel_id: String(hotelId)
  });

  const response = await fetch(
    `${STAYAPI_FACILITIES_URL}?${params}`,
    {
      headers: {
        "x-api-key": process.env.STAYAPI_API_KEY
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`StayAPI facilities ${response.status}: ${body}`);
  }

  const result = await response.json();
  const facilities = result.data?.facilities || {};

  setCachedFacilities(hotelId, facilities);

  return facilities;
}

async function getStayAPIFacilitiesForHotels(hotels = []) {
  const entries = await Promise.all(
    hotels.map(async hotel => {
      try {
        const facilities = await getStayAPIFacilities(hotel.hotel_id);

        return [hotel.hotel_id, facilities];
      } catch (error) {
        console.error(
          `StayAPI facilities failed for ${hotel.hotel_id}:`,
          error.message
        );

        return [hotel.hotel_id, {}];
      }
    })
  );

  return Object.fromEntries(entries);
}

module.exports = {
  getStayAPIFacilities,
  getStayAPIFacilitiesForHotels
};
