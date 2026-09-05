import "server-only";

import { getSql } from "./db";
import {
  attachTripRequestRecord,
  changeAdminTripRequestState,
  changeOwnTripRequestState,
  countOpenTripRequestRecords,
  createTripForRequestRecord,
  createTripRequestRecord,
  detachTripRequestRecord,
  listTripRequestRecords,
  updateTripRequestRecord,
} from "./trip-request-store.mjs";

export const listOwnTripRequests = (requesterEmail) => listTripRequestRecords(getSql(), { requesterEmail });
export const listAllTripRequests = () => listTripRequestRecords(getSql());
export const countOpenTripRequests = () => countOpenTripRequestRecords(getSql());
export const createTripRequest = (input) => createTripRequestRecord(getSql(), input);
export const updateTripRequest = (input) => updateTripRequestRecord(getSql(), input);
export const changeOwnTripRequest = (input) => changeOwnTripRequestState(getSql(), input);
export const changeAdminTripRequest = (input) => changeAdminTripRequestState(getSql(), input);
export const attachTripRequest = (input) => attachTripRequestRecord(getSql(), input);
export const detachTripRequest = (input) => detachTripRequestRecord(getSql(), input);
export const createTripForRequest = (input) => createTripForRequestRecord(getSql(), input);
