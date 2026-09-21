"use client";

import { useMemo, useRef, useState } from "react";
import {
  addCalendarDays,
  calendarDayDifference,
  formatTripDateRange,
  isIsoDate,
} from "../lib/trip-dates.mjs";
import contributionsStyles from "../src/styles/contributions.module.css";
import styles from "./TripDateShiftDialog.module.css";
import { useLocale } from "./LocaleProvider";
import Button from "./ui/Button";
import Dialog, { DialogDescription, DialogTitle } from "./ui/Dialog";

export default function TripDateShiftDialog({
  trip,
  initialStartDate,
  pending,
  error,
  onCancel,
  onConfirm,
}) {
  const { t, intlLocale } = useLocale();
  const [startDate, setStartDate] = useState(initialStartDate);
  const inputRef = useRef(null);
  const duration = calendarDayDifference(trip.startDate, trip.endDate);
  const shift = useMemo(() => {
    if (!isIsoDate(startDate)) return null;
    return {
      startDate,
      endDate: addCalendarDays(startDate, duration),
      days: calendarDayDifference(trip.startDate, startDate),
    };
  }, [duration, startDate, trip.startDate]);
  const canConfirm = Boolean(shift && shift.days !== 0 && !pending);
  const direction = !shift || shift.days === 0
    ? t("adminTripShift.unchanged")
    : shift.days < 0
      ? t("adminTripShift.earlier", { count: Math.abs(shift.days) })
      : t("adminTripShift.later", { count: shift.days });
  const nextRange = shift
    ? formatTripDateRange({ ...trip, startDate: shift.startDate, endDate: shift.endDate }, {}, intlLocale)
    : t("adminTripShift.invalidDate");

  return (
    <Dialog
      onClose={onCancel}
      pending={pending}
      initialFocusRef={inputRef}
      overlayClassName={`${contributionsStyles["suggestion-overlay"]} ${styles.overlay}`}
      aria-describedby="trip-date-shift-description"
    >
      <form
        className={styles.dialog}
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) onConfirm(shift);
        }}
      >
        <DialogTitle asChild>
          <h2>{t("adminTripShift.title")}</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p id="trip-date-shift-description">{t("adminTripShift.description")}</p>
        </DialogDescription>

        <label className={styles.field}>
          <span>{t("adminTripShift.newStartDate")}</span>
          <input
            ref={inputRef}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            disabled={pending}
            required
          />
        </label>

        <div className={styles.preview} aria-live="polite">
          <div>
            <span>{t("adminTripShift.currentRange")}</span>
            <strong>{formatTripDateRange(trip, {}, intlLocale)}</strong>
          </div>
          <div className={styles.transfer} aria-hidden="true" />
          <div>
            <span>{t("adminTripShift.newRange")}</span>
            <strong>{nextRange}</strong>
          </div>
          <p>{direction}</p>
        </div>

        <p className={styles.note}>{t("adminTripShift.exemptNote")}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!canConfirm}>
            {pending ? t("adminTripShift.shifting") : t("adminTripShift.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
