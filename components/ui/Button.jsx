import styles from "./Button.module.css";

/** Native button props (including type and ref) pass through unchanged. */
export default function Button({
  variant = "ghost",
  className = "",
  ...props
}) {
  return (
    <button
      className={`${styles.button} ${styles[variant]} admin-${variant} ${className}`}
      {...props}
    />
  );
}
