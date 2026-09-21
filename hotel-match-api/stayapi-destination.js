const STAYAPI_DESTINATION_URL =
  "https://api.stayapi.com/v1/booking/destinations/lookup";

async function lookupStayAPIDestination(query) {
  if (!process.env.STAYAPI_API_KEY) {
    throw new Error("STAYAPI_API_KEY is not configured");
  }

  if (!query || !String(query).trim()) {
    throw new Error("Destination query is required");
  }

  const params = new URLSearchParams({
    query: String(query).trim()
  });

  const response = await fetch(
    `${STAYAPI_DESTINATION_URL}?${params}`,
    {
      headers: {
        "x-api-key": process.env.STAYAPI_API_KEY
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`StayAPI destination lookup ${response.status}: ${body}`);
  }

  const result = await response.json();

  const suggestions = Array.isArray(result.suggestions)
    ? result.suggestions
    : [];

  const citySuggestion =
    suggestions.find(
      suggestion => suggestion.dest_type === "CITY"
    ) || null;

  return {
    destId: citySuggestion?.dest_id ?? result.dest_id ?? null,
    destType: citySuggestion?.dest_type ?? result.dest_type ?? null,
    label: citySuggestion?.label ?? result.normalized_query ?? null,
    suggestions
  };
}

module.exports = {
  lookupStayAPIDestination
};
