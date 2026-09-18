"use client";
import { useLocale } from "../LocaleProvider";
import styles from "../../src/styles/contributions.module.css";

export default function SavedPlaces({ places = [], activities = [] }) {
  const { t } = useLocale();
  if (!places.length) return null;
  return (
    <section className={styles["saved-places-section"]} aria-labelledby="saved-places-title">
      <header className={styles["saved-places-heading"]}>
        <h2 id="saved-places-title">{t("trackerExtra.savedPlaces")}</h2>
        <p>{t("trackerExtra.savedPlacesDescription")}</p>
      </header>
      <ol className={styles.savedPlaces}>
        {places.map((place, index) => {
          const linkedActivities = activities.filter((activity) => activity.placeId === place.id);
          return (
            <li key={place.id}>
              <article id={`place-${place.id}`} tabIndex={-1}>
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
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
