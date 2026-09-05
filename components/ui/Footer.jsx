import styles from "./Footer.module.css";

/** Shared footer defaults previously inherited from the global element selector. */
export default function Footer({ className = "", ...props }) {
  return <footer className={`${styles.footer} ${className}`} {...props} />;
}
