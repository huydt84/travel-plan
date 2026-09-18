export const EDITOR_ACTIVITY_TYPES = Object.freeze([
  { value: "Transit", labelKey: "adminExtra.message175", icon: "🚆" },
  { value: "Walk", labelKey: "adminExtra.message176", icon: "🚶" },
  { value: "Meet", labelKey: "adminExtra.message242", icon: "🤝" },
  { value: "Visit", labelKey: "adminExtra.message234", icon: "📍" },
  { value: "Show", labelKey: "adminExtra.message236", icon: "🎭" },
  { value: "Festival", labelKey: "adminExtra.message239", icon: "🎉" },
  { value: "Film", labelKey: "adminExtra.message177", icon: "🎬📷" },
  { value: "Relax", labelKey: "adminExtra.message240", icon: "🌿" },
  { value: "Break", labelKey: "adminExtra.message241", icon: "🪑" },
  { value: "Buffer", labelKey: "adminExtra.message178", icon: "🧊" },
  { value: "Rest", labelKey: "adminExtra.message179", icon: "☕" },
  { value: "Cafe", labelKey: "adminExtra.message180", icon: "☕" },
  { value: "Lunch", labelKey: "adminExtra.message181", icon: "🍜" },
  { value: "Dinner", labelKey: "adminExtra.message182", icon: "🍽️" },
  { value: "Reservation", labelKey: "adminExtra.message235", icon: "📞" },
  { value: "FlightBooking", labelKey: "adminExtra.flightBooking", icon: "✈️" },
  { value: "Picnic", labelKey: "adminExtra.message183", icon: "🧺" },
  { value: "Indoor", labelKey: "adminExtra.message184", icon: "🏠" },
]);

const DATE_RANGE_EXEMPT_ACTIVITY_TYPES = new Set(["Reservation", "FlightBooking"]);

export const isActivityDateRangeExempt = (type) => DATE_RANGE_EXEMPT_ACTIVITY_TYPES.has(type);
