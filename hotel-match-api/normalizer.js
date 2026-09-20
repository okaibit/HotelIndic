function normalizeHotels(data) {
  const hotelList = Array.isArray(data.hotels)
    ? data.hotels
    : Array.isArray(data.hotels?.hotels)
      ? data.hotels.hotels
      : [];

  return hotelList.map((hotel) => {
    const rooms = [];

    for (const room of hotel.rooms || []) {
      for (const rate of room.rates || []) {
        rooms.push({
          roomName: room.name,
          roomCode: room.code,

          // Hotelbeds Content API metadata
          maxPax: room.contentMetadata?.maxPax ?? null,
          maxAdults: room.contentMetadata?.maxAdults ?? null,
          maxChildren: room.contentMetadata?.maxChildren ?? null,
          minPax: room.contentMetadata?.minPax ?? null,
          roomType: room.contentMetadata?.roomType ?? null,
          characteristicCode:
            room.contentMetadata?.characteristicCode ?? null,

          roomFacilities:
            room.contentMetadata?.roomFacilities || [],

          roomStays: (room.contentMetadata?.roomStays || []).map(stay => ({
            stayType: stay.stayType,
            order: stay.order,
            description: stay.description
          })),

          adults: rate.adults,
          children: rate.children,
          childrenAges: rate.childrenAges || null,

          price: Number(rate.net),
          currency: rate.currency || data.currency,

          board: rate.boardName,

          breakfastIncluded:
            rate.boardCode === "BB" ||
            rate.boardName?.toLowerCase().includes("breakfast"),

          bookable: rate.rateType === "BOOKABLE",
          rateKey: rate.rateKey || null,

          allotment: rate.allotment,

          cancellationPolicies:
            rate.cancellationPolicies || []
        });
      }
    }

    return {
      hotelCode: hotel.code,
      hotelName: hotel.name,
      facilitiesMapped: hotel.facilitiesMapped || {},
      destinationCode: hotel.destinationCode,
      latitude: hotel.latitude,
      longitude: hotel.longitude,

      images: hotel.contentMetadata?.images || [],
      address: hotel.contentMetadata?.address || null,
      city: hotel.contentMetadata?.city || null,
      country: hotel.contentMetadata?.country || null,
      category: hotel.contentMetadata?.category || null,
      description: hotel.contentMetadata?.description || null,

      rooms
    };
  });
}

module.exports = {
  normalizeHotels
};
