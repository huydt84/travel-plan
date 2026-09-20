export const EDITOR_ACTIVITY_ICONS = Object.freeze([
  { key: "train", value: "🚆", labelKey: "adminExtra.message185" },
  { key: "tram", value: "🚃", labelKey: "adminExtra.message186" },
  { key: "walk", value: "🚶", labelKey: "adminExtra.message176" },
  { key: "place", value: "📍", labelKey: "adminExtra.message171" },
  { key: "meet", value: "🤝", labelKey: "adminExtra.message242" },
  { key: "show", value: "🎭", labelKey: "adminExtra.message236" },
  { key: "festival", value: "🎉", labelKey: "adminExtra.message239" },
  { key: "film", value: "🎬📷", labelKey: "adminExtra.message177" },
  { key: "relax", value: "🌿", labelKey: "adminExtra.message240" },
  { key: "break", value: "🪑", labelKey: "adminExtra.message241" },
  { key: "buffer", value: "🧊", labelKey: "adminExtra.message178" },
  { key: "coffee", value: "☕", labelKey: "adminExtra.message187" },
  { key: "moon", value: "🌙", labelKey: "adminExtra.moonIcon" },
  { key: "lunch", value: "🍜", labelKey: "adminExtra.message188" },
  { key: "dinner", value: "🍽️", labelKey: "adminExtra.message189" },
  { key: "phone", value: "📞", labelKey: "adminExtra.message235" },
  { key: "flight", value: "✈️", labelKey: "adminExtra.flightBooking" },
  { key: "picnic", value: "🧺", labelKey: "adminExtra.message190" },
  { key: "indoor", value: "🏠", labelKey: "adminExtra.message184" },
  { key: "shrine", value: "⛩️", labelKey: "adminExtra.message191" },
  { key: "museum", value: "🏛️", labelKey: "adminExtra.message192" },
]);

const iconByKey = Object.fromEntries(EDITOR_ACTIVITY_ICONS.map(({ key, value }) => [key, value]));

export const EDITOR_ACTIVITY_TYPES = Object.freeze([
  { value: "Transit", labelKey: "adminExtra.message175", icon: iconByKey.train },
  { value: "Walk", labelKey: "adminExtra.message176", icon: iconByKey.walk },
  { value: "Meet", labelKey: "adminExtra.message242", icon: iconByKey.meet },
  { value: "Visit", labelKey: "adminExtra.message234", icon: iconByKey.place },
  { value: "Show", labelKey: "adminExtra.message236", icon: iconByKey.show },
  { value: "Festival", labelKey: "adminExtra.message239", icon: iconByKey.festival },
  { value: "Film", labelKey: "adminExtra.message177", icon: iconByKey.film },
  { value: "Relax", labelKey: "adminExtra.message240", icon: iconByKey.relax },
  { value: "Break", labelKey: "adminExtra.message241", icon: iconByKey.break },
  { value: "Buffer", labelKey: "adminExtra.message178", icon: iconByKey.buffer },
  { value: "Rest", labelKey: "adminExtra.message179", icon: iconByKey.coffee },
  { value: "Cafe", labelKey: "adminExtra.message180", icon: iconByKey.coffee },
  { value: "Lunch", labelKey: "adminExtra.message181", icon: iconByKey.lunch },
  { value: "Dinner", labelKey: "adminExtra.message182", icon: iconByKey.dinner },
  { value: "Reservation", labelKey: "adminExtra.message235", icon: iconByKey.phone },
  { value: "FlightBooking", labelKey: "adminExtra.flightBooking", icon: iconByKey.flight },
  { value: "Picnic", labelKey: "adminExtra.message183", icon: iconByKey.picnic },
  { value: "Indoor", labelKey: "adminExtra.message184", icon: iconByKey.indoor },
]);

const DATE_RANGE_EXEMPT_ACTIVITY_TYPES = new Set(["Reservation", "FlightBooking"]);

export const isActivityDateRangeExempt = (type) => DATE_RANGE_EXEMPT_ACTIVITY_TYPES.has(type);
