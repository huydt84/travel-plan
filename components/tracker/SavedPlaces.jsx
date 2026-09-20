"use client";
import { useState } from "react";
import { PlaceForm } from "../admin/EditorForms";
import Button from "../ui/Button";
import { adminErrorMessage } from "../../lib/i18n-admin.mjs";
import { useLocale } from "../LocaleProvider";
import styles from "../../src/styles/contributions.module.css";

export default function SavedPlaces({ places = [], activities = [], canManage = false, onSave, onDelete }) {
  const { t, locale } = useLocale();
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  const save = async (values) => {
    await onSave(values, editor?.place?.id);
    setEditor(null);
    setError("");
  };
  const remove = async (place) => {
    setError("");
    try {
      if (await onDelete(place)) setEditor(null);
    } catch (requestError) {
      setError(adminErrorMessage(requestError, t, locale));
    }
  };
  if (!places.length && !canManage) return null;
  return (
    <section className={styles["saved-places-section"]} aria-labelledby="saved-places-title">
      <header className={styles["saved-places-heading"]}>
        <div className={styles["resource-heading"]}>
          <h2 id="saved-places-title">{t("trackerExtra.savedPlaces")}</h2>
          {canManage && <Button type="button" variant="ghost" aria-expanded={Boolean(editor && !editor.place)}
            onClick={() => { setEditor(editor && !editor.place ? null : { place: null }); setError(""); }}>
            {editor && !editor.place ? t("adminPlaces.cancel") : t("adminPlaces.add")}
          </Button>}
        </div>
        <p>{t("trackerExtra.savedPlacesDescription")}</p>
      </header>
      {editor && !editor.place && <PlaceForm key="new-place" onSave={save} onCancel={() => setEditor(null)} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <ol className={styles.savedPlaces}>
        {places.map((place, index) => {
          const linkedActivities = activities.filter((activity) => activity.placeId === place.id);
          return (
            <li key={place.id}>
              {editor?.place?.id === place.id ? <PlaceForm key={place.id} place={place} onSave={save} onCancel={() => setEditor(null)} /> : <article id={`place-${place.id}`} tabIndex={-1}>
                <span className={styles["saved-place-number"]} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className={styles["saved-place-identity"]}>
                  <h3>{place.name}</h3>
                  {place.address && <address>{place.address}</address>}
                </div>
                <div className={styles["saved-place-detail"]}>
                  {place.notes && <p>{place.notes}</p>}
                  {place.latitude != null && <small>{place.latitude}, {place.longitude}</small>}
                  {linkedActivities.length > 0 && (
                    <div className={styles["saved-place-activities"]}>
                      <strong>{t("trackerExtra.linkedActivities")}</strong>
                      {linkedActivities.map((activity) => <a href={`#${activity.id}`} key={activity.id}>{activity.title}</a>)}
                    </div>
                  )}
                </div>
                <div className={styles["saved-place-actions"]}>
                  {place.website && <a href={place.website} target="_blank" rel="noreferrer">{t("trackerExtra.website")}</a>}
                  {(place.googleMapsUrl || place.googlePlaceId) && <a href={place.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.googlePlaceId)}`} target="_blank" rel="noreferrer">{t("trackerExtra.maps")}</a>}
                  {canManage && <span className={styles["resource-actions"]}>
                    <Button type="button" variant="ghost" onClick={() => { setEditor({ place }); setError(""); }}>{t("adminPlaces.edit")}</Button>
                    <Button type="button" variant="danger" onClick={() => remove(place)}>{t("adminPlaces.delete")}</Button>
                  </span>}
                </div>
              </article>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
