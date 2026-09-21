function inferCapacity(roomName = "") {
  const name = roomName.toLowerCase();

  // Explicit occupancy wording
  const occupancyMatch = name.match(
    /(?:sleeps?|for|up to)\s*(\d+)\s*(?:guests?|people|persons?)?/
  );

  if (occupancyMatch) {
    const maxPax = Number(occupancyMatch[1]);

    return {
      maxPax,
      maxAdults: maxPax,
      maxChildren: maxPax
    };
  }

  // Family rooms are commonly suitable for at least 4 guests.
  if (name.includes("family")) {
    return {
      maxPax: 4,
      maxAdults: 4,
      maxChildren: 2
    };
  }

  // Suites / apartments often accommodate more than a standard room.
  if (name.includes("apartment") || name.includes("villa")) {
    return {
      maxPax: 4,
      maxAdults: 4,
      maxChildren: 2
    };
  }

  // Default for a normal hotel room.
  return {
    maxPax: 2,
    maxAdults: 2,
    maxChildren: 1
  };
}

const { mapStayAPIFacilities } = require("./stayapi-facility-mapper");

function normalizeStayAPIHotel(hotel, facilities = {}) {
  const roomName = hotel.room_name || "";

  console.log(
    "Normalizer facilities for",
    hotel.hotel_id,
    JSON.stringify(facilities, null, 2)
  );
  const capacity = inferCapacity(roomName);

  return {
    id: `stayapi-${hotel.hotel_id}`,
    hotelCode: `stayapi-${hotel.hotel_id}`,
    providerHotelId: hotel.hotel_id,

    hotelName: hotel.name,
    address: hotel.address || "",
    city: hotel.city || hotel.display_location || "",
    country: hotel.country || null,

    latitude: hotel.latitude,
    longitude: hotel.longitude,

    category:
      hotel.star_rating != null
        ? `${hotel.star_rating}-star`
        : null,

    images: hotel.image_url
      ? [hotel.image_url]
      : [],

    description: null,

    facilitiesMapped: mapStayAPIFacilities(facilities),

    rooms: [
      {
        roomName,

        roomCode: `stayapi-room-${hotel.hotel_id}`,

        minPax: null,
        maxPax: capacity.maxPax,
        maxAdults: capacity.maxAdults,
        maxChildren: capacity.maxChildren,

        roomType: roomName.toLowerCase().includes("suite")
          ? "suite"
          : roomName.toLowerCase().includes("apartment")
            ? "apartment"
            : "standard",

        characteristicCode: null,
        roomFacilities: [],
        roomStays: [],

        adults: null,
        children: null,
        childrenAges: null,

        price: hotel.price?.amount ?? null,
        currency: hotel.price?.currency || null,

        board: null,
        breakfastIncluded: false,

        bookable: !hotel.is_sold_out,
        rateKey: null,
        allotment: null,

        cancellationPolicies: [],

        freeCancellation: hotel.free_cancellation ?? false,
        noPrepayment: hotel.no_prepayment ?? false
      }
    ]
  };
}

function normalizeStayAPIHotels(hotels = [], facilitiesByHotelId = {}) {
  return hotels
    .filter((hotel) => hotel && hotel.hotel_id)
    .map(hotel => normalizeStayAPIHotel(hotel, facilitiesByHotelId[hotel.hotel_id] || {}));
}

module.exports = {
  normalizeStayAPIHotel,
  normalizeStayAPIHotels
};
