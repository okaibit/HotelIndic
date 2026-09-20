require("dotenv").config();

const fs = require("fs");
const { Agent } = require("undici");

const hotelbedsDispatcher = new Agent({
  connect: {
    cert: fs.readFileSync("./certificate-39e00eb4d82118becdb11aa32ae1b1a6f2bebd61eef2ed58b1cfe628b9638438.pem"),
    key: fs.readFileSync("./hotelbeds-client.key"),
    passphrase: process.env.HOTELBEDS_KEY_PASSPHRASE
  }
});


const reviewRequestsFile = "./review-requests.json";

function saveReviewRequest(request) {
  let requests = [];

  if (fs.existsSync(reviewRequestsFile)) {
    try {
      requests = JSON.parse(fs.readFileSync(reviewRequestsFile, "utf8"));
      if (!Array.isArray(requests)) requests = [];
    } catch {
      requests = [];
    }
  }

  requests.push({
    id: `review-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    ...request
  });

  fs.writeFileSync(
    reviewRequestsFile,
    JSON.stringify(requests, null, 2)
  );
}

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { normalizeHotels } = require("./normalizer");
const { mapHotelFacilities } = require("./hotel-facility-mapper");
const { matchHotels } = require("./matcher");
const { getHotelContent } = require("./hotelbeds-content");
const { parseHotelQuery } = require("./query-parser");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

const DESTINATION_CODES = {
  dubai: "DXB",
  lagos: "LOS",
  abuja: "ABV",
  accra: "ACC",
  nairobi: "NBO",
  "cape town": "CPT",
  johannesburg: "JNB",
  london: "LON",
  paris: "PAR",
  barcelona: "BCN",
  madrid: "MAD",
  rome: "ROM",
  istanbul: "IST",
  "new york": "NYC",
  miami: "MIA",
  orlando: "ORL",
  toronto: "YTO"
};

app.get("/", (req, res) => {
  res.json({
    status: "HotelIndice API is running"
  });
});

app.get("/api/hotels", async (req, res) => {
  try {
    const apiKey = process.env.HOTELBEDS_API_KEY;
    const secret = process.env.HOTELBEDS_API_SECRET;

    const timestamp = Math.floor(Date.now() / 1000);
    console.log("Hotelbeds auth debug:", { timestamp, endpoint: "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels", keyLength: apiKey?.length, secretLength: secret?.length });
    const signature = crypto
      .createHash("sha256")
      .update(apiKey + secret + timestamp)
      .digest("hex");

    // User requirements
    const parsedQuery = req.query.q
      ? parseHotelQuery(req.query.q)
      : null;

    const adults =
      req.query.adults !== undefined
        ? Number(req.query.adults)
        : parsedQuery?.adults != null
          ? parsedQuery.adults
          : parsedQuery?.totalGuests
            ? 2
            : 2;

    const children =
      req.query.children !== undefined
        ? Number(req.query.children)
        : parsedQuery?.children != null
          ? parsedQuery.children
          : parsedQuery?.totalGuests
            ? Math.max(parsedQuery.totalGuests - adults, 0)
            : 2;

    const childAges =
      req.query.childAges
        ? req.query.childAges
            .split(",")
            .map(age => Number(age.trim()))
        : parsedQuery?.childAges?.length
          ? parsedQuery.childAges
          : [8, 5];

    const paxes = [
      ...Array.from(
        { length: adults },
        () => ({
          type: "AD",
          age: 30
        })
      ),

      ...childAges
        .slice(0, children)
        .map(age => ({
          type: "CH",
          age
        }))
    ];

    const body = {
      stay: {
        checkIn: req.query.checkIn || "2026-10-10",
        checkOut: req.query.checkOut || "2026-10-12"
      },

      occupancies: [
        {
          rooms: 1,
          adults,
          children,
          paxes
        }
      ],

      destination: {
        code:
          req.query.destination ||
          (parsedQuery?.destination
            ? DESTINATION_CODES[parsedQuery.destination]
            : "DXB")
      }
    };

    if (req.query.dryRun === "true") {
      return res.json({
        query: req.query.q || null,
        parsedQuery,
        hotelbedsRequest: body
      });
    }

    const response = await fetch(
      "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels",
      {
        method: "POST",
        dispatcher: hotelbedsDispatcher,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Api-key": apiKey,
          "X-Signature": signature
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    console.log("Hotelbeds status:", response.status);

    if (!response.ok) {
      console.log("Hotelbeds response:", data);

      return res.status(response.status).json(data);
    }

    // Get hotel content metadata
    const availabilityHotels = Array.isArray(data.hotels)
      ? data.hotels
      : Array.isArray(data.hotels?.hotels)
        ? data.hotels.hotels
        : [];

    const availableHotelCodes = availabilityHotels.map(
      hotel => hotel.code
    );

    const contentHotels = await getHotelContent(
      availableHotelCodes
    );

    const contentByHotelCode = new Map(
      contentHotels.map(hotel => [
        String(hotel.code),
        hotel
      ])
    );

    // Attach Content API room metadata to availability rooms
    for (const hotel of availabilityHotels) {
      const contentHotel = contentByHotelCode.get(
        String(hotel.code)
      );

      if (!contentHotel) {
        continue;
      }

      hotel.facilitiesMapped = mapHotelFacilities(contentHotel.facilities || []);

      // Preserve hotel content for presentation
      hotel.contentMetadata = {
        images: contentHotel.images || [],
        address: contentHotel.address || null,
        city: contentHotel.city || null,
        country: contentHotel.country || null,
        category: contentHotel.category || null,
        description: contentHotel.description || null
      };

      const contentRooms = contentHotel.rooms || [];

      for (const room of hotel.rooms || []) {
        const contentRoom = contentRooms.find(
          content =>
            content.roomCode === room.code
        );

        if (contentRoom) {
          room.contentMetadata = contentRoom;
        }
      }
    }

    // Normalize Hotelbeds data
    const hotels = normalizeHotels(data);

    // Match rooms against user requirements
    const checkInDate = new Date(body.stay.checkIn);
    const checkOutDate = new Date(body.stay.checkOut);

    const stayNights = Math.max(
      1,
      Math.round(
        (checkOutDate - checkInDate) /
        (1000 * 60 * 60 * 24)
      )
    );

    const budgetType =
      req.query.budgetType ||
      parsedQuery?.budgetType ||
      "nightly";

    const requestedBudget =
      req.query.maxPrice !== undefined
        ? Number(req.query.maxPrice)
        : parsedQuery?.maxPrice ?? undefined;

    const matcherMaxPrice =
      requestedBudget === undefined
        ? undefined
        : budgetType === "nightly"
          ? requestedBudget * stayNights
          : requestedBudget;

    const matches = matchHotels(hotels, {
      adults,
      children,

      maxPrice: matcherMaxPrice,

      budgetType,
      displayBudget: requestedBudget,

      breakfastRequired:
        req.query.breakfast === "true" ||
        parsedQuery?.breakfast === true,

      poolRequired:
        req.query.pool === "true" ||
        parsedQuery?.pool === true,

      gymRequired:
        req.query.gym === "true" ||
        parsedQuery?.gym === true,

      parkingRequired:
        req.query.parking === "true" ||
        parsedQuery?.parking === true,

      kitchenRequired:
        req.query.kitchen === "true" ||
        parsedQuery?.kitchen === true,

      familyRoomRequired:
        req.query.familyRoom === "true" ||
        parsedQuery?.roomTypePreference === "family room",

      internetRequired:
        req.query.internet === "true" ||
        parsedQuery?.internet === true,

      // Room configuration preferences
      separateSleepingSpace:
        req.query.separateSleepingSpace === "true" ||
        parsedQuery?.separateSleepingSpace === true,

      connectingRooms:
        req.query.connectingRooms === "true" ||
        parsedQuery?.connectingRooms === true,

      roomTypePreference:
        req.query.roomTypePreference ||
        parsedQuery?.roomTypePreference ||
        null,

      roomTypeRequired:
        parsedQuery?.roomTypeRequired === true,

      bedroomsRequired:
        req.query.bedrooms
          ? Number(req.query.bedrooms)
          : parsedQuery?.bedrooms ?? null,

      bedroomMode:
        parsedQuery?.bedroomMode || "exact",

      bedroomMax:
        parsedQuery?.bedroomMax ?? null
    });

    for (const match of matches) {
      match.stayNights = stayNights;
      match.totalStayPrice = match.price;
      match.pricePerNight = Number(
        (match.price / stayNights).toFixed(2)
      );
      match.currency = match.currency || "EUR";
    }

    res.json({
      total: matches.length,

      search: {
        destination: body.destination.code,
        checkIn: body.stay.checkIn,
        checkOut: body.stay.checkOut,
        adults,
        children,
        childAges,

        budgetType,
        budget: requestedBudget,

        separateSleepingSpace:
          req.query.separateSleepingSpace === "true" ||
          parsedQuery?.separateSleepingSpace === true,

        connectingRooms:
          req.query.connectingRooms === "true" ||
          parsedQuery?.connectingRooms === true,

        roomTypePreference:
          req.query.roomTypePreference ||
          parsedQuery?.roomTypePreference ||
          null,

        bedrooms:
          req.query.bedrooms !== undefined
            ? Number(req.query.bedrooms)
            : parsedQuery?.bedrooms ?? null,

        breakfast:
          req.query.breakfast === "true" ||
          parsedQuery?.breakfast === true,

        pool:
          req.query.pool === "true" ||
          parsedQuery?.pool === true,

        gym:
          req.query.gym === "true" ||
          parsedQuery?.gym === true,

        parking:
          req.query.parking === "true" ||
          parsedQuery?.parking === true,

        kitchen:
          req.query.kitchen === "true" ||
          parsedQuery?.kitchen === true
      },

      hotels: matches
    });

  } catch (error) {
    console.error("HotelIndice error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});


app.get("/api/review-requests", (req, res) => {
  const adminToken = req.get("X-HotelIndice-Admin-Token");

  if (!adminToken || adminToken !== process.env.HOTELINDICE_ADMIN_TOKEN) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  let requests = [];

  if (fs.existsSync(reviewRequestsFile)) {
    try {
      requests = JSON.parse(fs.readFileSync(reviewRequestsFile, "utf8"));
      if (!Array.isArray(requests)) requests = [];
    } catch {
      requests = [];
    }
  }

  res.json({ requests });
});

app.post("/api/review-requests", (req, res) => {
  const {
    name,
    email,
    hotelName,
    city,
    message,
    website
  } = req.body || {};

  if (!name || !email || !hotelName || !city || !message) {
    return res.status(400).json({
      error: "Name, email, hotel name, city, and message are required."
    });
  }

  const reviewRequest = {
    name,
    email,
    hotelName,
    city,
    message,
    website: website || null
  };

  saveReviewRequest(reviewRequest);

  console.log("Hotel review request received:", reviewRequest);

  res.status(201).json({
    success: true,
    message: "Your hotel review request has been received."
  });
});

app.listen(PORT, () => {
  console.log(
    `HotelIndice API running at http://localhost:${PORT}`
  );
});
