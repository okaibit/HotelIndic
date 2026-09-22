function normalizeSerpApiHotel(h) {
  return {
    name: h.name,
    description: h.description || "",
    price: h.rate_per_night?.extracted_lowest ?? null,
    totalPrice: h.total_rate?.extracted_lowest ?? null,
    currency: "USD",
    photos: (h.images || []).map(i => i.original_image).filter(Boolean),
    thumbnails: (h.images || []).map(i => i.thumbnail).filter(Boolean),
    rating: h.overall_rating ?? null,
    reviewCount: h.reviews ?? null,
    amenities: h.amenities || [],
    coordinates: h.gps_coordinates || null,
    reviewSentiment: (h.reviews_breakdown || []).map(r => ({
      category: r.name,
      mentioned: r.total_mentioned,
      positive: r.positive,
      negative: r.negative
    })),
    checkInTime: h.check_in_time || null,
    checkOutTime: h.check_out_time || null,
    source: "serpapi"
  };
}

module.exports = { normalizeSerpApiHotel };
