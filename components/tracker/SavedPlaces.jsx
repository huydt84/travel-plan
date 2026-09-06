import styles from "../../src/styles/contributions.module.css";
export default function SavedPlaces({ places = [], activities = [] }) {
  if (!places.length) return null;
  return <section className={styles.sources} aria-labelledby="saved-places-title"><h2 id="saved-places-title">Địa điểm đã lưu</h2>
    <div className={styles.savedPlaces}>{places.map(place => <article id={`place-${place.id}`} key={place.id} tabIndex={-1}>
      <h3>{place.name}</h3><p>{place.address}</p>{place.notes && <p>{place.notes}</p>}
      {place.latitude != null && <p>{place.latitude}, {place.longitude}</p>}
      <div>{place.website && <a href={place.website} target="_blank" rel="noreferrer">Website</a>}{place.googlePlaceId && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.googlePlaceId)}`} target="_blank" rel="noreferrer">Google Maps</a>}</div>
      {activities.filter(a=>a.placeId===place.id).map(a=><p key={a.id}>Hoạt động: <a href={`#${a.id}`}>{a.title}</a></p>)}
    </article>)}</div></section>;
}
