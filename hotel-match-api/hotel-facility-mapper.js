const FACILITY_MAP = {
  pool: [
    [306, 60],
    [313, 60],
    [326, 60],
    [360, 73],
    [361, 73],
    [362, 73],
    [363, 73],
    [364, 73],
    [365, 73],
    [385, 73],
    [573, 70],
    [615, 73]
  ],

  gym: [
    [295, 90],
    [308, 60],
    [470, 70]
  ],

  parking: [
    [320, 70],
    [500, 70],
    [560, 70]
  ],

  kitchen: [
    [110, 60],
    [111, 60],
    [115, 60]
  ],

  familyRoom: [
    [131, 10]
  ],

  internet: [
    [100, 60],
    [250, 70]
  ]
};

function hasFacility(facilities, codes) {
  return facilities.some(facility =>
    codes.some(
      ([code, group]) =>
        facility.facilityCode === code &&
        facility.facilityGroupCode === group
    )
  );
}

function mapHotelFacilities(facilities = []) {
  return Object.fromEntries(
    Object.entries(FACILITY_MAP).map(([name, codes]) => [
      name,
      hasFacility(facilities, codes)
    ])
  );
}

module.exports = {
  mapHotelFacilities
};
