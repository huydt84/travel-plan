"use client";

import { useLocale } from "../LocaleProvider";
import styles from "../../src/styles/form-field-label.module.css";

export default function FormFieldLabel({ children, required = false }) {
  const { t } = useLocale();

  return (
    <span className={styles.label}>
      <span>{children}</span>
      {required ? (
        <span className={styles.required} aria-hidden="true" title={t("common.required")} />
      ) : (
        <small className={styles.optional}>{t("common.optional")}</small>
      )}
    </span>
  );
}
